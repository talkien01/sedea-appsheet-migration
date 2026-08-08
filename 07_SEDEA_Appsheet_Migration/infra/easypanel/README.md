# Despliegue en EasyPanel (VPS Hostinger)

Guia operativa para publicar la aplicacion en un VPS de Hostinger administrado con
EasyPanel. El objetivo es dejar tres servicios corriendo: `db` (PostGIS), `backend`
(API) y `pwa` (Nginx).

## 1. Preparar el VPS

1. Contrata un VPS en Hostinger (minimo 2 vCPU / 4 GB RAM para PostGIS + build).
2. Instala EasyPanel:
   ```bash
   curl -sSL https://get.easypanel.io | sh
   ```
3. Entra al panel en `https://<ip-del-vps>:3000` y crea tu usuario administrador.

## 2. Crear el proyecto

1. **Project → Create**: nombre `sedea`.
2. Sube el repositorio a Git (GitHub/GitLab) o usa **App → Source: Git**.

## 3. Servicio `db`

- Tipo: **Postgres** (o **App** con imagen `postgis/postgis:16-3.4`).
- Importante: la imagen **debe** ser PostGIS, no `postgres` normal.
- Variables: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Volumen persistente montado en `/var/lib/postgresql/data`.
- No publiques el puerto 5432 hacia internet.

## 4. Servicio `backend`

- Tipo: **App** → Source: Git → Build: **Dockerfile** con ruta `backend/Dockerfile`
  y contexto la raiz del repositorio.
- Variables de entorno (ver `.env.example`):
  - `DATABASE_URL=postgres://<user>:<password>@sedea_db:5432/<db>`
  - `JWT_SECRET` (genera uno largo: `openssl rand -base64 48`)
  - `CORS_ORIGIN=https://campo.tu-dominio.mx`
  - `MEDIA_DIR=/app/media`
- **Volumen persistente** montado en `/app/media`: ahi viven las fotografias.
  Sin este volumen se pierden las evidencias en cada redeploy.
- Puerto interno: 3000.

## 5. Servicio `pwa`

- Tipo: **App** → Build: **Dockerfile** con ruta `pwa/Dockerfile`, contexto la raiz.
- Build args: `VITE_API_URL=/api`.
- Puerto interno: 80.
- Dominio: asigna `campo.tu-dominio.mx` y activa **HTTPS (Let's Encrypt)**.

> El `nginx.conf` de la PWA hace proxy de `/api` y `/media` hacia el servicio
> `backend`. Si en EasyPanel el servicio tiene otro nombre de host interno,
> ajusta `proxy_pass` en `pwa/nginx.conf`.

## 6. Primer arranque

El contenedor del backend ejecuta migraciones y siembra datos demo si la base esta
vacia. Revisa los logs del servicio: debe aparecer `Migraciones completadas`.

Despues del primer acceso:

1. Cambia la contrasena de los usuarios demo o borralos.
2. Importa el padron real con el CLI (`npm run importar`).

## 7. Respaldos

```bash
# Base de datos
docker exec sedea_db pg_dump -U sedea sedea | gzip > respaldo_$(date +%F).sql.gz
# Fotografias
docker run --rm -v sedea_media:/media -v $(pwd):/backup alpine \
  tar czf /backup/media_$(date +%F).tar.gz -C /media .
```
