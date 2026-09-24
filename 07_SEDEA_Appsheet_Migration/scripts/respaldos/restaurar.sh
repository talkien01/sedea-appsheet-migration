#!/usr/bin/env bash
# Restaura un dump de SEDEA en una base NUEVA (nunca sobre la de produccion).
# Uso: ./restaurar.sh <archivo.dump> <contenedor_postgres> [base_destino=sedea_restaurada]
# Para reemplazar produccion de verdad: restaura aqui, VERIFICA, y luego cambia la
# conexion de la app (o renombra bases) -- ver docs/RESPALDOS.md.
set -euo pipefail
dump="${1:?Falta el archivo .dump}"; cont="${2:?Falta el contenedor de Postgres}"
destino="${3:-sedea_restaurada}"; usuario="${PG_USER:-sedea}"
docker exec "$cont" psql -U "$usuario" -d postgres -c "DROP DATABASE IF EXISTS \"$destino\";"
docker exec "$cont" psql -U "$usuario" -d postgres -c "CREATE DATABASE \"$destino\";"
docker exec "$cont" psql -U "$usuario" -d "$destino" -c "CREATE EXTENSION IF NOT EXISTS postgis;" || true
docker exec -i "$cont" pg_restore -U "$usuario" -d "$destino" --no-owner < "$dump"
echo "Restaurado en la base '$destino'."
