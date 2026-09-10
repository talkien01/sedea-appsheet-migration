#!/usr/bin/env bash
# Monitoreo en vivo del servidor VPS durante un evento de entrega.
#
#   1. Conectate por SSH al VPS.
#   2. Guarda este archivo ahi (o pegalo)  ->  nano monitor-entrega.sh
#   3. Corre:  bash monitor-entrega.sh          (refresca cada 20 s)
#              bash monitor-entrega.sh 10       (cada 10 s)
#   4. Salir: Ctrl+C
#
# Solo LEE estado (docker ps/inspect/logs, psql SELECT, df, du). No escribe
# nada, no reinicia nada.
set -u
REFRESCO="${1:-20}"
PGUSER="${PGUSER:-sedea}"
PGDB="${PGDB:-sedea}"
TZ_MX="America/Mexico_City"

db_cont()      { docker ps --format '{{.Names}}' | grep -iE 'db'      | grep -i sedea | head -1; }
backend_cont() { docker ps --format '{{.Names}}' | grep -iE 'backend' | grep -i sedea | head -1; }

psql_q() {
  local c; c="$(db_cont)"
  [ -z "$c" ] && return 1
  docker exec "$c" psql -U "$PGUSER" -d "$PGDB" -At -F '|' -c "$1" 2>/dev/null
}
regla() { printf '%.0s-' $(seq 1 90); echo; }

while true; do
  BE="$(backend_cont)"
  clear
  echo "SEDEA - monitoreo de entrega    $(date '+%F %T')    refresca cada ${REFRESCO}s - Ctrl+C para salir"
  regla

  echo "CONTENEDORES"
  docker ps --format '  {{.Names}}   {{.Status}}' | grep -i sedea || echo "  (ninguno con 'sedea' en el nombre)"
  if [ -n "$BE" ]; then
    echo "  salud backend: $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin healthcheck{{end}}' "$BE" 2>/dev/null) | reinicios: $(docker inspect -f '{{.RestartCount}}' "$BE" 2>/dev/null)"
  fi
  echo

  echo "ENTREGAS  (por hora de llegada al servidor)"
  psql_q "
    SELECT
      count(*) FILTER (WHERE creado_en >= now() - interval '5 minutes'),
      count(*) FILTER (WHERE creado_en >= now() - interval '1 hour'),
      count(*) FILTER (WHERE creado_en >= now() - interval '12 hours'),
      count(*) FILTER (WHERE creado_en >= now() - interval '12 hours' AND sin_gps),
      to_char(max(creado_en) AT TIME ZONE '$TZ_MX', 'HH24:MI:SS')
    FROM entregas_apoyo;" | awk -F'|' '{
      printf "  ultimos 5 min: %-4s  ultima hora: %-4s  ultimas 12 h: %-5s  (sin GPS: %s)\n",$1,$2,$3,$4
      printf "  ultima entrega recibida: %s\n",($5==""?"(ninguna)":$5" hrs")
    }'
  echo "  por concepto (ultimas 12 h):"
  psql_q "
    SELECT t.nombre, count(*), COALESCE(round(sum(sc.cantidad)::numeric,0),0)
      FROM entregas_apoyo ea
      JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
      JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
     WHERE ea.creado_en >= now() - interval '12 hours'
     GROUP BY t.nombre ORDER BY 2 DESC;" | awk -F'|' 'NF{printf "    %-34s %4s entregas   %s (kg/pieza)\n",$1,$2,$3}'
  psql_q "
    SELECT COALESCE(r.nombre,'?'), count(*)
      FROM entregas_apoyo ea
      JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
      JOIN solicitudes s ON s.id = sc.solicitud_id
      LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
     WHERE ea.creado_en >= now() - interval '12 hours'
     GROUP BY 1 ORDER BY 2 DESC;" | awk -F'|' 'NF{printf "    Regional %-18s %4s\n",$1,$2}'
  echo

  echo "BASE DE DATOS"
  psql_q "SELECT count(*), count(*) FILTER (WHERE state='active') FROM pg_stat_activity WHERE datname='$PGDB';" \
    | awk -F'|' 'NF{printf "  conexiones: %s totales, %s activas\n",$1,$2}'
  echo

  echo "DISCO  (las fotos viven aqui)"
  df -h / | awk 'NR==2{printf "  raiz: %s usado de %s (%s libre %s)\n",$3,$2,$4,$5}'
  if [ -n "$BE" ]; then
    echo "  /app/media: $(docker exec "$BE" du -sh /app/media 2>/dev/null | awk '{print $1}')  ($(docker exec "$BE" sh -c 'find /app/media -name "*.jpg" | wc -l' 2>/dev/null) fotos)"
  fi
  echo

  echo "ERRORES DEL BACKEND  (ultimos 5 min)"
  if [ -n "$BE" ]; then
    E="$(docker logs --since 5m "$BE" 2>&1 | grep -iE 'error|econnrefused|etimedout|fatal|unhandled|\"statusCode\":5' | grep -viE 'favicon' | tail -6)"
    [ -n "$E" ] && echo "$E" | sed 's/^/  /' || echo "  (sin errores)"
  fi

  regla
  sleep "$REFRESCO"
done
