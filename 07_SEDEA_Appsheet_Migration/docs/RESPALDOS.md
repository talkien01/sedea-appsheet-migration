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

1. **Destino elegido: Google Drive institucional** (`programas.sedea@queretaro.gob.mx`). Es una cuenta de la
   SEDEA, no personal, y solo los administradores del Workspace de GEQ IT pueden darla de baja.
2. Instalar `rclone` en el VPS y configurar el remoto `sedea` de tipo `drive`. El VPS no tiene navegador,
   asi que se autoriza desde una PC:
   - En el VPS: `rclone config` -> `n` (nuevo) -> nombre `sedea` -> tipo `drive`.
     Deja `client_id`/`client_secret` vacios la primera vez (ver "Limites de Drive" abajo).
     **Scope: `drive.file`** (rclone solo vera lo que el mismo cree; no toca el resto del Drive).
     Cuando pregunte "Use web browser to automatically authenticate?" responde **n**.
   - En una PC con navegador y rclone instalado: `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"`
     e iniciar sesion con `programas.sedea@queretaro.gob.mx`. Copiar el token que imprime y pegarlo en el VPS.
   - Probar: `rclone mkdir sedea:SEDEA-Respaldos && rclone lsd sedea:` y usar `RCLONE_REMOTO=sedea:SEDEA-Respaldos`.
   - **Compartir esa carpeta solo con los administradores**: contiene CURPs y fotos de beneficiarios.
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
   30 2,13 * * * PG_CONTAINER=<postgres> MEDIA_CONTAINER=<backend> PG_USER=<u> PG_DB=<db> RCLONE_REMOTO=sedea:SEDEA-Respaldos AVISO_URL=<url_latido> /opt/sedea-respaldos/respaldo.sh >> /var/log/sedea-respaldo.log 2>&1
   ```
7. **Aviso si falla:** crear un check en healthchecks.io (o similar) con periodo de 1 día y poner su URL
   en `AVISO_URL`. Si el respaldo deja de llegar, avisa por correo.

**Nota sobre EasyPanel (proyecto `sedea`):** los servicios `db`, `backend` y `pwa` estan desplegados como
tipo *app*. La base es la imagen `postgis` corriendo como app, NO el servicio Postgres nativo de EasyPanel,
asi que su pestaña de backups nativos no aplica: se usa `pg_dump` (este script). Los contenedores se
llaman `sedea_db` y `sedea_backend` (verificar con `docker ps`). Las tareas programadas de una *app* de
EasyPanel corren DENTRO de su contenedor y no tienen acceso a `docker`, por eso el cron va en el host del VPS.

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

## Limites de Drive (leer antes de depender de esto)

- **Token que caduca:** si el cliente OAuth de rclone queda como app externa en modo "prueba", Google
  vence el token cada 7 dias y los respaldos empiezan a fallar en silencio (por eso existe `AVISO_URL`).
  Solucion estable: pedir a GEQ IT que cree un cliente OAuth **de tipo interno** en el Workspace y usar su
  `client_id`/`client_secret` en `rclone config`. Tambien evita el limite de cuota compartida del cliente
  por defecto de rclone.
- Si GEQ IT bloquea apps de terceros, tienen que permitir ese cliente OAuth o crear una cuenta de servicio.
- Cuota: revisar el espacio libre del Drive. Las fotos crecen con cada entrega; la BD es pequeña.
- Las fotos se suben con `rclone copy` (nunca borra en el destino). La retencion remota aplica solo a
  los dumps de BD (`RETENCION_REMOTA_DIAS`, 60 por defecto).
- Diagnostico rapido si dejan de llegar respaldos: `rclone lsd sedea:` (si pide reautorizar, es el token).
