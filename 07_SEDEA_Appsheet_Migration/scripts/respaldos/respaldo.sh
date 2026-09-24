#!/usr/bin/env bash
# Respaldo de SEDEA: base de datos (pg_dump) + fotos/documentos (volumen media).
# Corre en el VPS (host de Docker/EasyPanel). Ver docs/RESPALDOS.md.
#
# Variables (todas opcionales salvo donde se indica):
#   PG_CONTAINER   nombre (o parte del nombre) del contenedor de Postgres   [obligatoria]
#   MEDIA_CONTAINER nombre (o parte) del contenedor del backend (tiene /app/media) [obligatoria]
#   PG_USER / PG_DB    usuario y base (default: sedea / sedea)
#   DESTINO_LOCAL      carpeta local de respaldos (default: /var/backups/sedea)
#   RETENCION_DIAS     dias de dumps locales a conservar (default: 14)
#   RCLONE_REMOTO      remoto rclone externo, ej. "r2:sedea-respaldos" (si se omite, solo local)
#   RETENCION_REMOTA_DIAS dias de dumps de BD a conservar en el remoto (default: 60)
#   AVISO_URL          URL a la que hacer GET si el respaldo TERMINA BIEN (healthchecks.io, etc.)
set -euo pipefail

: "${PG_CONTAINER:?Falta PG_CONTAINER}"
: "${MEDIA_CONTAINER:?Falta MEDIA_CONTAINER}"
PG_USER="${PG_USER:-sedea}"
PG_DB="${PG_DB:-sedea}"
DESTINO_LOCAL="${DESTINO_LOCAL:-/var/backups/sedea}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"

sello="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DESTINO_LOCAL/db" "$DESTINO_LOCAL/media"

buscar() { docker ps --format '{{.Names}}' | grep -m1 "$1" || { echo "No encuentro contenedor con '$1'" >&2; exit 1; }; }
PG="$(buscar "$PG_CONTAINER")"
BK="$(buscar "$MEDIA_CONTAINER")"

# 1) Base de datos: formato custom (comprimido, restaurable por partes).
archivo_db="$DESTINO_LOCAL/db/sedea_${sello}.dump"
docker exec "$PG" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$archivo_db.tmp"
# Verifica que el dump sea legible ANTES de darlo por bueno.
docker exec -i "$PG" pg_restore --list < "$archivo_db.tmp" > /dev/null
mv "$archivo_db.tmp" "$archivo_db"
echo "DB ok: $archivo_db ($(du -h "$archivo_db" | cut -f1))"

# 2) Fotos/documentos: espejo incremental (no se duplica todo cada dia).
docker cp "$BK:/app/media/." "$DESTINO_LOCAL/media/" 2>/dev/null || true
echo "Media ok: $(du -sh "$DESTINO_LOCAL/media" | cut -f1)"

# 3) Copia fuera del VPS (lo que de verdad protege si el servidor se pierde).
if [ -n "${RCLONE_REMOTO:-}" ]; then
  rclone copy "$DESTINO_LOCAL/db" "$RCLONE_REMOTO/db" --min-age 1m
  # `copy` y NO `sync` a proposito: `sync` replica tambien los BORRADOS. Si el
  # volumen media se pierde o queda vacio (justo el desastre que el respaldo
  # cubre), un `sync` borraria tambien la copia buena del destino.
  rclone copy "$DESTINO_LOCAL/media" "$RCLONE_REMOTO/media"
  # Retencion remota de dumps de BD (las fotos nunca se borran solas).
  rclone delete "$RCLONE_REMOTO/db" --min-age "${RETENCION_REMOTA_DIAS:-60}d"
  echo "Copia externa ok: $RCLONE_REMOTO"
else
  echo "AVISO: sin RCLONE_REMOTO, el respaldo queda SOLO en este servidor." >&2
fi

# 4) Retencion local de dumps.
find "$DESTINO_LOCAL/db" -name 'sedea_*.dump' -mtime +"$RETENCION_DIAS" -delete

# 5) Latido de exito: si esto deja de llegar, el servicio de avisos alerta.
[ -n "${AVISO_URL:-}" ] && curl -fsS -m 10 "$AVISO_URL" > /dev/null || true
echo "Respaldo terminado $sello"
