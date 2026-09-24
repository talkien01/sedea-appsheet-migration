# Respaldos de SEDEA

Qué se respalda y por qué:

| Qué | Dónde vive | Cómo se respalda |
|---|---|---|
| Base de datos | Postgres (volumen `pgdata`) | `pg_dump` formato custom, verificado con `pg_restore --list` |
| Fotos y documentos | Volumen `media` del backend (`/app/media`) | Espejo incremental (`docker cp` + `rclone sync`) |
| Variables de entorno / `JWT_SECRET` | EasyPanel | **Manual**: exportarlas y guardarlas en un gestor de contraseñas |
| Código | GitHub | Ya cubierto |

**Las fotos son la evidencia de las entregas.** Un respaldo solo de la base deja URLs sin archivo.

Scripts: `scripts/respaldos/` (`respaldo.sh`, `restaurar.sh`, `probar_restauracion.sh`).
Probados en local: respaldo → restauración en base temporal → comparación de conteos (EXITOSA).

## Puesta en marcha en el VPS

1. **Elegir destino fuera del VPS** (si el servidor se pierde, un respaldo en él se pierde también).
   Opciones baratas: Cloudflare R2, Backblaze B2, o un S3 institucional.
2. Instalar `rclone` en el host y configurar el remoto: `rclone config` (nombre sugerido: `sedea`).
3. Copiar `scripts/respaldos/` al VPS (por ejemplo `/opt/sedea-respaldos/`).
4. Ver nombres de contenedores: `docker ps --format '{{.Names}}'`
   (en EasyPanel suelen tener el nombre del servicio como prefijo o parte).
5. **Probar a mano una vez** (no crea nada en producción, restaura en una base temporal):
   ```bash
   cd /opt/sedea-respaldos
   PG_USER=<usuario> PG_DB=<base> ./probar_restauracion.sh <contenedor_postgres> <contenedor_backend>
   ```
   Debe terminar en `PRUEBA DE RESTAURACION: EXITOSA`.
6. **Programar** (cron del host, ejemplo diario 02:30 y a mediodía para tolerar 12 h de pérdida):
   ```cron
   30 2,13 * * * PG_CONTAINER=<postgres> MEDIA_CONTAINER=<backend> PG_USER=<u> PG_DB=<db> RCLONE_REMOTO=sedea:respaldos AVISO_URL=<url_latido> /opt/sedea-respaldos/respaldo.sh >> /var/log/sedea-respaldo.log 2>&1
   ```
   Si EasyPanel ofrece tareas programadas para el servicio, puede usarse en lugar del cron del host,
   siempre que el comando tenga acceso a `docker`.
7. **Aviso si falla:** crear un check en healthchecks.io (o similar) con periodo de 1 día y poner su URL
   en `AVISO_URL`. Si el respaldo deja de llegar, avisa por correo.

Alternativa para la BD: si en EasyPanel la base corre como servicio Postgres nativo, su pestaña de
backups programados a S3 puede reemplazar el paso de `pg_dump` (el de `media` sigue siendo necesario).

## Restaurar

Nunca sobre la base viva. Restaurar en una base nueva, verificar, y luego apuntar la app a ella:

```bash
./restaurar.sh /var/backups/sedea/db/sedea_YYYYMMDD_HHMMSS.dump <contenedor_postgres> sedea_restaurada
```

Fotos: `rclone copy sedea:respaldos/media <ruta_del_volumen_media>` (o `docker cp` al contenedor backend).

## Reglas

- Retención local: 14 días (`RETENCION_DIAS`). En el remoto, configurar retención/versionado en el bucket.
- Repetir `probar_restauracion.sh` cada mes y **siempre** después de cambiar de versión de Postgres.
- Cerrar el puerto 5432 en producción (el compose lo expone solo para desarrollo).
- Guardar las credenciales de rclone y las variables de entorno fuera del repositorio.
