#!/usr/bin/env bash
# Prueba de punta a punta: respalda, restaura en una base temporal y compara
# conteos de las tablas clave contra el original. Un respaldo sin esta prueba no cuenta.
# Uso: ./probar_restauracion.sh <contenedor_postgres> <contenedor_backend>
set -euo pipefail
pg="${1:?contenedor postgres}"; bk="${2:?contenedor backend}"
aqui="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"
PG_CONTAINER="$pg" MEDIA_CONTAINER="$bk" DESTINO_LOCAL="$tmp" "$aqui/respaldo.sh"
dump="$(ls "$tmp"/db/*.dump | head -1)"
"$aqui/restaurar.sh" "$dump" "$pg" sedea_prueba_restauracion
u="${PG_USER:-sedea}"; ok=1
for t in solicitudes solicitud_conceptos beneficiarios capturas entregas_apoyo usuarios auditoria_log; do
  a=$(docker exec "$pg" psql -U "$u" -d "${PG_DB:-sedea}" -Atc "select count(*) from $t")
  b=$(docker exec "$pg" psql -U "$u" -d sedea_prueba_restauracion -Atc "select count(*) from $t")
  [ "$a" = "$b" ] && echo "OK   $t: $a" || { echo "FALLA $t: original=$a restaurada=$b"; ok=0; }
done
docker exec "$pg" psql -U "$u" -d postgres -c 'DROP DATABASE sedea_prueba_restauracion;' > /dev/null
rm -rf "$tmp"
[ "$ok" = 1 ] && echo "PRUEBA DE RESTAURACION: EXITOSA" || { echo "PRUEBA DE RESTAURACION: FALLO"; exit 1; }
