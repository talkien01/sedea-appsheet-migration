# SEDEA — Migración de AppSheet a PWA offline-first

Reemplazo del flujo **AppSheet + Google Sheets** de la Secretaría de Desarrollo
Agropecuario de Querétaro (SEDEA) por una solución propia:

- **PWA instalable** que funciona **sin señal** en campo (foto + GPS + padrón local).
- **API REST** con JWT, control de acceso por Dirección Regional y bitácora de auditoría.
- **PostgreSQL 16 + PostGIS 3.4** para almacenar las coordenadas como geometría real.
- **Panel de auditoría** con tabla, mapa Leaflet/OpenStreetMap y exportación de
  expedientes a PDF y CSV.

---

## Arranque rápido (todo en Docker)

```bash
cp .env.example .env      # ajusta JWT_SECRET y contraseñas
docker compose up --build
```

Cuando los tres contenedores estén arriba:

| Servicio | URL |
|---|---|
| PWA | http://localhost:8080 |
| API | http://localhost:3000/api/health |
| PostgreSQL | localhost:5432 |

El contenedor `backend` aplica las migraciones y siembra los datos demo
automáticamente al arrancar (solo si la base está vacía).

### Comando exacto para levantar la aplicación

```bash
docker compose up --build
```

---

## Desarrollo sin Docker

Requiere Node 20+ y un PostgreSQL con PostGIS accesible.

```bash
npm install                 # instala todos los workspaces
npm run build:shared        # compila @sedea/shared (tipos y validadores Zod)
npm run migrate             # aplica db/migrations en orden
npm run seed                # datos demo (usa SEED_ADMIN_PASSWORD)
npm run dev:backend         # API en http://localhost:3000
npm run dev:pwa             # PWA en http://localhost:5173 (proxy /api -> 3000)
```

| Acción | Comando |
|---|---|
| Instalar | `npm install` |
| Dev backend | `npm run dev -w backend` |
| Dev PWA | `npm run dev -w pwa` |
| Migrar | `npm run migrate` |
| Seed | `npm run seed` |
| Importar padrón | ver abajo |
| Levantar todo | `docker compose up --build` |

---

## Importación del padrón y catálogos

El importador **no tiene ningún nombre de columna escrito en el código**: el mapeo
vive en un JSON externo, por lo que se adapta a cualquier hoja que entregue la
Secretaría. Las columnas no mapeadas se conservan íntegras en
`beneficiarios.datos_extra` (JSONB).

```bash
# Padrón (CSV o XLSX)
npm run importar -- --tipo padron \
  --archivo scripts/datos-ejemplo/padron.ejemplo.csv \
  --mapeo scripts/mapeos/padron.ejemplo.json

# Catálogos
npm run importar -- --tipo catalogo \
  --archivo scripts/datos-ejemplo/catalogo.ejemplo.csv \
  --mapeo scripts/mapeos/catalogo.ejemplo.json

# Ensayo sin escribir en la base
npm run importar -- --tipo padron --archivo <ruta> --mapeo <ruta> --dry-run

# Ayuda
npm run importar -- --help
```

Reglas del importador:

- Los encabezados se normalizan (sin acentos, mayúsculas, espacios colapsados)
  antes de compararse con el mapeo.
- La clave de upsert es el **folio** (`clave_upsert`); reejecutar la misma
  importación **no duplica** beneficiarios.
- Si el CSV no trae folio se genera `IMP-<n>`.
- Filas sin nombre o sin Regional resoluble se registran en
  `importaciones.errores` y **no abortan** el proceso.
- Cada corrida escribe una fila en `importaciones` y una entrada
  `import_padron` en `auditoria_log`.

---

## Usuarios demo

Se crean con `npm run seed` usando la contraseña de la variable
`SEED_ADMIN_PASSWORD` (por defecto `cambiame123` en `.env.example`).

| Usuario | Rol | Alcance |
|---|---|---|
| `admin` | admin | Todas las Regionales + bitácora |
| `capturista1` | capturista | Solo Regional Centro (`REG-01`) |
| `auditor1` | auditor | Todas las Regionales (sin regional asignada) |

> **Advertencia:** estos usuarios existen únicamente para pruebas.
> **Cámbialos o elimínalos antes de operar en producción**, y define un
> `SEED_ADMIN_PASSWORD` propio. Ninguna contraseña está escrita en el código
> fuente ni en los archivos SQL: el seeder genera los hashes bcrypt en tiempo de
> ejecución a partir del entorno.

---

## Flujo de trabajo en campo

1. **Login** con conexión la primera vez. Después la sesión vive 12 h en
   IndexedDB y la app abre sin red.
2. **Sincronización**: "Descargar padrón y catálogos" (paginado de 500 en 500).
3. **Padrón**: buscador tolerante a acentos y selects encadenados
   Regional → Municipio → Colonia → Sección. Para un `capturista` la Regional
   queda fija a la suya.
4. **Captura**: foto desde la cámara (comprimida a 1600 px / JPEG 0.75) + GPS con
   semáforo de precisión (verde ≤20 m, ámbar 21–50 m, rojo >50 m) + datos de
   entrega. Todo se guarda en IndexedDB con estado `pendiente`.
5. **Sincronización de capturas**: automática al recuperar conexión, al abrir la
   app y con el botón "Sincronizar ahora". Cada captura lleva un **UUID v4
   generado en el cliente**: el backend hace UPSERT por ese uuid, así que
   reenviar la misma captura **nunca** crea duplicados (responde
   `{"duplicado": true}`). Hasta 5 reintentos con backoff exponencial.

---

## Panel de auditoría

Rutas `/auditoria` y `/auditoria/beneficiario/:id`, accesibles solo para los roles
`auditor` y `admin`. Un `capturista` recibe **403** de la API y la pantalla
"No tienes permiso para ver esta sección.".

- Filtros: Regional, Municipio (dependiente), fecha desde/hasta y texto.
- Tabla con miniatura, beneficiario, CURP, Regional, Municipio, Colonia, Sección,
  coordenadas, precisión, fecha y capturista.
- Mapa **Leaflet** con tiles públicos de **OpenStreetMap** y su atribución
  obligatoria. Sin servicios de mapas de pago.
- Exportaciones: `Exportar CSV` del filtro actual, y por beneficiario
  `Descargar expediente PDF` y `Descargar expediente CSV`.

---

## Endpoints principales

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/health` | pública |
| POST | `/api/auth/login` | pública |
| GET | `/api/auth/me` | autenticado |
| GET | `/api/catalogos` | autenticado |
| GET | `/api/beneficiarios` | autenticado (filtrado por Regional) |
| GET | `/api/beneficiarios/:id` | autenticado (403 si es de otra Regional) |
| POST | `/api/capturas` | `capturista`, `admin` (multipart, idempotente) |
| GET | `/api/capturas` | autenticado |
| GET | `/api/auditoria/capturas` | `auditor`, `admin` |
| GET | `/api/auditoria/geojson` | `auditor`, `admin` |
| GET | `/api/auditoria/export.csv` | `auditor`, `admin` |
| GET | `/api/auditoria/expediente/:id.pdf` | `auditor`, `admin` |
| GET | `/api/auditoria/expediente/:id.csv` | `auditor`, `admin` |
| GET | `/api/auditoria/log` | `admin` |
| GET | `/media/*` | autenticado (header o `?token=`) |

Errores en formato `{"error":{"codigo":"...","mensaje":"..."}}`.

---

## Despliegue en Hostinger + EasyPanel + Cloudflare Tunnel

Guía completa en [`infra/easypanel/README.md`](infra/easypanel/README.md) y
ejemplo de túnel en [`infra/cloudflare/tunnel.ejemplo.yml`](infra/cloudflare/tunnel.ejemplo.yml).

Resumen:

1. **Hostinger**: contrata un VPS (2 vCPU / 4 GB mínimo) e instala **EasyPanel**
   (`curl -sSL https://get.easypanel.io | sh`).
2. **EasyPanel**: crea el proyecto `sedea` con tres servicios:
   - `db`: imagen `postgis/postgis:16-3.4` con volumen en `/var/lib/postgresql/data`.
   - `backend`: build con `backend/Dockerfile` (contexto = raíz) y **volumen
     persistente en `/app/media`** para las fotografías.
   - `pwa`: build con `pwa/Dockerfile`, puerto 80, dominio propio y **HTTPS de
     Let's Encrypt activado**.
3. **Cloudflare Tunnel**: instala `cloudflared` en el VPS, crea el túnel
   (`cloudflared tunnel create sedea-campo`), apunta el DNS
   (`cloudflared tunnel route dns sedea-campo campo.tu-dominio.mx`) y arráncalo
   con el `tunnel.ejemplo.yml` adaptado. Así **no expones ningún puerto** del VPS
   a internet: ni 3000, ni 5432, ni 8080.
4. Verifica `https://campo.tu-dominio.mx/api/health`.

> HTTPS no es opcional: la cámara y `navigator.geolocation` solo funcionan en
> contextos seguros, y una PWA solo es instalable bajo HTTPS.

---

## Protección de datos

El padrón contiene **datos personales** (nombre, CURP, domicilio, teléfono) y las
capturas contienen **fotografías y ubicación precisa** de personas beneficiarias.
Medidas implementadas y obligaciones operativas:

1. **HTTPS obligatorio de extremo a extremo.** El acceso público debe hacerse
   siempre por `https://`, ya sea con el certificado Let's Encrypt de EasyPanel o
   a través de Cloudflare Tunnel. La configuración de referencia
   (`infra/nginx/sedea.conf.ejemplo`) fuerza la redirección 301 de HTTP a HTTPS y
   agrega `Strict-Transport-Security`. Sin HTTPS la aplicación no debe operarse:
   además de exponer datos personales, el navegador bloquea cámara y GPS.
2. **Control de acceso por Dirección Regional.** El aislamiento se aplica en la
   **capa SQL del backend**, nunca en el frontend: toda consulta de beneficiarios
   y capturas añade el filtro `regional_id` derivado del JWT cuando el rol lo
   exige. Un `capturista` solo ve y solo puede capturar en su Regional; si pide
   `?regional_id=<otra>` el parámetro se ignora, y si solicita un beneficiario
   ajeno recibe **403**. El panel de auditoría está reservado a `auditor` y
   `admin`, y la bitácora completa solo a `admin`.
3. **Bitácora `auditoria_log`.** Toda acción sensible queda registrada con
   usuario, IP, user-agent y fecha: `login`, `login_fallido`, `sync_padron`,
   `captura_creada`, `captura_duplicada`, `export_csv`, `export_pdf` e
   `import_padron`. Es la evidencia de quién consultó, exportó o modificó
   información personal, y es consultable en `GET /api/auditoria/log`.
4. **Credenciales.** Contraseñas con bcrypt (coste 10); el hash nunca sale de la
   base. JWT HS256 de 12 h firmado con `JWT_SECRET` (el arranque falla si mide
   menos de 16 caracteres). No hay secretos en el código ni en el repositorio:
   `.env` está en `.gitignore` y `.env.example` solo trae marcadores `cambiame`.
   Limitación de intentos fallidos de login por IP y rate limit global.
5. **Fotografías con acceso autenticado.** `/media/*` exige token válido: las
   evidencias no son públicas aunque se conozca la URL. Se almacenan en un
   volumen persistente, fuera de la imagen del contenedor.
6. **Usuarios demo.** `admin`, `capturista1` y `auditor1` son solo para pruebas.
   **Cámbialos o elimínalos antes de producción** y define un
   `SEED_ADMIN_PASSWORD` propio.
7. **Minimización y respaldos.** Exporta expedientes solo cuando exista una
   justificación de auditoría; los archivos descargados (PDF/CSV) salen del
   control de la aplicación y quedan bajo responsabilidad de quien los descarga.
   Respalda base de datos y volumen de fotografías con cifrado en reposo y
   accesos restringidos.

---

## Estructura del repositorio

```
├── db/migrations/   Migraciones SQL numeradas (001 crea la extensión postgis)
├── db/seeds/        Datos demo (catálogos, usuarios, 30 beneficiarios)
├── packages/shared/ Tipos y validadores Zod compartidos backend <-> PWA
├── backend/         API Fastify 4 + TypeScript
├── pwa/             React 18 + Vite 5 + vite-plugin-pwa + Dexie + Leaflet
├── scripts/         CLI de importación con mapeo configurable
└── infra/           EasyPanel, Cloudflare Tunnel y Nginx de referencia
```

## Decisiones técnicas

- **Node + TypeScript + Fastify** en el backend para compartir un único paquete
  de tipos y validadores Zod con la PWA (`@sedea/shared`). El riesgo principal del
  proyecto es la desalineación de contratos entre la cola de sincronización y el
  endpoint de upsert; compartir el esquema lo elimina de raíz.
- **PostGIS por SQL crudo** (`pg`), sin ORM: las consultas geoespaciales
  (`ST_SetSRID`, `ST_MakePoint`, `ST_AsGeoJSON`) quedan explícitas y auditables.
- **Fotos en filesystem** (`STORAGE_DRIVER=local`) sobre un volumen; en la base
  solo se guarda la ruta relativa y el hash SHA-256.
- **Sin Background Sync API** (soporte inconsistente en iOS): la sincronización se
  dispara por evento `online`, al abrir la app y con el botón manual.
- **Sin pre-caché de tiles** de mapa: el mapa solo se usa en el panel de
  auditoría, que requiere red.
