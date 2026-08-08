# SPEC.md — SEDEA AppSheet Migration App

> Especificación cerrada de construcción. El Generator NO debe tomar decisiones de producto: todo lo ambiguo ya está resuelto aquí o documentado en **Assumptions**.

---

## 1. Objetivo

Construir un monorepo funcional (PostgreSQL+PostGIS, API REST y PWA offline-first) que reemplace el flujo AppSheet+Google Sheets de SEDEA Querétaro, permitiendo a personal de las Direcciones Regionales capturar en campo y sin señal la evidencia fotográfica y geolocalizada de la entrega de apoyos agropecuarios, sincronizarla de forma idempotente y auditarla desde un panel web con mapa y exportación de expedientes.

---

## 2. Scope

### SÍ incluye (lista cerrada)

| # | Entregable |
|---|---|
| S1 | Base de datos PostgreSQL 16 + PostGIS 3.4 con migraciones SQL versionadas y numeradas. |
| S2 | Seed de datos de ejemplo (usuarios de prueba, catálogos, ~30 beneficiarios ficticios). |
| S3 | Backend Node 20 + TypeScript + Fastify 4 con JWT, RBAC y aislamiento por Regional. |
| S4 | Almacenamiento de fotos en filesystem del contenedor (volumen), servido por la API. |
| S5 | Script CLI de importación de padrón y catálogo desde CSV/XLSX con mapeo de columnas configurable por archivo JSON. |
| S6 | PWA React 18 + Vite 5 + TypeScript, instalable, service worker (Workbox via `vite-plugin-pwa`), IndexedDB (Dexie) y cola de sincronización. |
| S7 | Captura de foto (input capture de cámara) + GPS con precisión en metros y reintento. |
| S8 | Panel de auditoría (ruta protegida por rol) con tabla, filtros, mapa Leaflet + tiles OSM, y exportación de expediente por beneficiario a PDF y CSV. |
| S9 | `docker-compose.yml` (db + backend + pwa vía Nginx), `.env.example`, `README.md` con despliegue Hostinger/EasyPanel + Cloudflare Tunnel y sección de protección de datos. |
| S10 | Bitácora `auditoria_log` escrita por el backend en login, sync de padrón, alta de captura y exportaciones. |

### NO incluye (explícitamente fuera)

- Autenticación con terceros (Google/OAuth/SSO), MFA, recuperación de contraseña por correo.
- Dark mode, i18n (solo español), theming configurable.
- Apps nativas iOS/Android (solo PWA instalable).
- Servicios de mapas de pago (ArcGIS, Mapbox, Google Maps). Solo Leaflet + tiles OSM públicos.
- Pre-caché de tiles de mapa (opcional en el brief ⇒ **NO se implementa**; la captura no requiere mapa).
- Buckets S3/R2 (se deja `STORAGE_DRIVER=local` como único driver implementado; la variable existe para futuro).
- Notificaciones push, background sync API del navegador (la sync es manual + automática por evento `online`).
- CI/CD, tests e2e automatizados con Playwright dentro del repo (el Evaluator los ejecuta externamente).
- Edición o borrado de beneficiarios desde la PWA (el padrón es de solo lectura; se actualiza por importación).

---

## 3. User flows

Roles: `capturista` (campo), `auditor` (panel, ve todas las Regionales o la suya según asignación), `admin` (todo + gestión de usuarios básica de solo lectura en esta versión).

### 3.1 Flujo capturista (campo, offline-first)

1. **Login** (`/login`)
   - Inputs: `usuario` (texto), `password` (texto).
   - Acción: `POST /api/auth/login`.
   - Output OK: token JWT + perfil (id, nombre, rol, regional_id, regional_nombre) guardados en IndexedDB (tabla `sesion`) y en memoria. Redirige a `/sync` si el padrón local está vacío, si no a `/beneficiarios`.
   - Output error: mensaje "Usuario o contraseña incorrectos." (HTTP 401).
   - Offline sin sesión previa: mensaje "Necesitas conexión para iniciar sesión por primera vez." Si ya hay sesión válida en IndexedDB y el token no ha expirado, se permite entrar sin red.

2. **Sincronización inicial** (`/sync`)
   - Botón "Descargar padrón y catálogos".
   - Acción: `GET /api/catalogos` + `GET /api/beneficiarios?since=<ISO|vacío>` (paginado 500/página, `page`, `page_size`).
   - Output: barra de progreso con "X de Y beneficiarios descargados", guarda en IndexedDB (`beneficiarios`, `catalogos`), registra `ultima_sincronizacion` (ISO 8601).
   - Muestra siempre: total local de beneficiarios, fecha de última sync, capturas pendientes.

3. **Listado de beneficiarios** (`/beneficiarios`)
   - Inputs: buscador de texto libre (nombre, CURP, folio; case/acento-insensible), y selects encadenados **Regional → Municipio → Colonia → Sección**. La Regional viene fijada y deshabilitada al valor del usuario si su rol es `capturista`.
   - Filtro adicional (chips): `Todos` | `Pendientes` | `Capturados`.
   - Output: lista virtualizada; cada renglón muestra nombre, CURP, municipio, tipo de apoyo y un badge verde "Capturado" si existe captura local o remota, gris "Pendiente" si no.
   - Todo se resuelve contra IndexedDB (funciona 100% offline).

4. **Ficha del beneficiario** (`/beneficiarios/:id`)
   - Output: todos los campos del beneficiario + historial de capturas locales asociadas (miniatura, fecha, estado de sync).
   - Botón principal "Capturar apoyo" → `/beneficiarios/:id/captura`.

5. **Captura de evidencia** (`/beneficiarios/:id/captura`)
   - Paso A — Foto: `<input type="file" accept="image/*" capture="environment">`. Se comprime en cliente a máx. 1600 px lado mayor, JPEG calidad 0.75, y se guarda como `Blob` en IndexedDB. Vista previa + botón "Tomar otra".
   - Paso B — GPS: al montar se llama `navigator.geolocation.getCurrentPosition` con `{enableHighAccuracy:true, timeout:20000, maximumAge:0}`.
     - Output visible: latitud, longitud (6 decimales) y **"Precisión: ±N m"**.
     - Semáforo: verde `≤ 20 m`, ámbar `21–50 m`, rojo `> 50 m`.
     - Botón "Reintentar ubicación" siempre disponible. Si precisión > 50 m se exige confirmar checkbox "Guardar con baja precisión".
     - Error de permiso: "Activa el permiso de ubicación del navegador para continuar."
   - Paso C — Datos: `observaciones` (textarea, opcional, máx. 500), `tipo_apoyo_id` (select precargado del catálogo, default = el del beneficiario), `cantidad_entregada` (numérico, opcional).
   - Botón "Guardar captura" (habilitado solo con foto + coordenadas): genera `uuid` v4 en cliente, inserta en IndexedDB `capturas` con `estado='pendiente'`, encola en `cola_sync`. Toast "Captura guardada localmente. Pendiente de sincronizar."
   - **No requiere red en ningún paso.**

6. **Barra de estado global** (siempre visible en el layout)
   - Indicador `En línea` / `Sin conexión` (evento `online`/`offline` + ping ligero a `GET /api/health` cada 60 s cuando el navegador se declara online).
   - Contador "Pendientes: N".
   - Botón "Sincronizar ahora" (deshabilitado si offline o N=0).

7. **Sincronización de capturas**
   - Automática al disparar evento `online` y al abrir la app si hay pendientes y hay red.
   - Por cada captura pendiente: `POST /api/capturas` como `multipart/form-data` con campos `uuid, beneficiario_id, lat, lng, precision_m, capturado_en, tipo_apoyo_id, observaciones, cantidad_entregada, foto`.
   - Idempotencia: el backend hace UPSERT por `uuid`; si ya existe responde `200` con `{"duplicado": true}` en lugar de crear otro registro.
   - Reintentos: hasta 5 con backoff 2^n segundos; tras el 5º marca `estado='error'` con `error_msg` visible en la ficha y botón "Reintentar".
   - Al éxito: `estado='sincronizada'`, se borra el Blob de la foto de IndexedDB para liberar espacio y se guarda `foto_url`.

### 3.2 Flujo auditor / admin (panel web, requiere red)

8. **Panel de auditoría** (`/auditoria`, roles `auditor` y `admin`; un `capturista` que entre recibe 403 y pantalla "No tienes permiso para ver esta sección.")
   - Filtros: Regional (select), Municipio (select dependiente), fecha desde / fecha hasta (date), texto (nombre/CURP).
   - Output: tabla paginada con columnas: Foto (miniatura clicable), Beneficiario, CURP, Regional, Municipio, Colonia, Sección, Lat/Lng, Precisión (m), Fecha de captura, Capturista.
   - Mapa Leaflet con tiles `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` y atribución OSM obligatoria; un marcador por captura filtrada; click en marcador → popup con foto miniatura, beneficiario y fecha; click en renglón de la tabla centra el mapa.
   - Botón "Exportar CSV" (todas las filas del filtro actual) → `GET /api/auditoria/export.csv?...`.

9. **Expediente por beneficiario** (`/auditoria/beneficiario/:id`)
   - Output: ficha con datos del beneficiario, todas sus capturas (foto grande, coordenadas, precisión, fecha, capturista) y mini-mapa.
   - Botón "Descargar expediente PDF" → `GET /api/auditoria/expediente/:beneficiarioId.pdf`: PDF A4 con encabezado "SEDEA — Expediente de evidencia de entrega", datos del beneficiario (nombre, CURP, Regional, Municipio, Colonia, Sección, tipo de apoyo), y por cada captura: foto embebida, lat/lng, precisión, fecha/hora y capturista. Pie con fecha de generación y usuario que exportó.
   - Botón "Descargar expediente CSV" → `GET /api/auditoria/expediente/:beneficiarioId.csv`.

---

## 4. Modelo de datos

PostgreSQL 16, esquema `public`, extensión `postgis`. Todos los timestamps `TIMESTAMPTZ` en UTC. IDs de negocio en `BIGSERIAL` salvo `capturas` que usa `uuid` como clave natural de idempotencia.

### 4.1 `usuarios`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| usuario | TEXT UNIQUE NOT NULL | login |
| nombre_completo | TEXT NOT NULL | |
| password_hash | TEXT NOT NULL | bcrypt cost 10 |
| rol | TEXT NOT NULL CHECK (rol IN ('capturista','auditor','admin')) | |
| regional_id | BIGINT REFERENCES direcciones_regionales(id) | NULL solo si rol='admin' |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |
| creado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 4.2 `direcciones_regionales`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | ej. `REG-01` |
| nombre | TEXT NOT NULL | ej. `Regional Centro` |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

### 4.3 `municipios`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT NOT NULL | clave INEGI o del catálogo |
| nombre | TEXT NOT NULL | |
| regional_id | BIGINT NOT NULL REFERENCES direcciones_regionales(id) | |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |
| UNIQUE (clave, regional_id) | | |

### 4.4 `tipos_apoyo`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | |
| nombre | TEXT NOT NULL | |
| categoria | TEXT | `agricola`, `pecuario`, `maquinaria`, `infraestructura`, `otro` |
| unidad_medida | TEXT | ej. `kg`, `pieza`, `ha` |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

### 4.5 `catalogos` (catálogo genérico clave/valor para parámetros no normalizados)

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| grupo | TEXT NOT NULL | ej. `colonia`, `seccion`, `estatus_entrega` |
| clave | TEXT NOT NULL | |
| valor | TEXT NOT NULL | etiqueta mostrada |
| padre_grupo | TEXT | para dependencias (ej. colonia depende de municipio) |
| padre_clave | TEXT | |
| orden | INTEGER NOT NULL DEFAULT 0 | |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |
| UNIQUE (grupo, clave, COALESCE(padre_clave,'')) vía índice único | | |

### 4.6 `beneficiarios`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| folio | TEXT UNIQUE NOT NULL | identificador de origen; si el CSV no lo trae, se genera `IMP-<n>` |
| curp | TEXT | índice no único (puede repetirse/venir vacío) |
| nombre_completo | TEXT NOT NULL | |
| regional_id | BIGINT NOT NULL REFERENCES direcciones_regionales(id) | |
| municipio_id | BIGINT REFERENCES municipios(id) | |
| colonia | TEXT | |
| seccion | TEXT | |
| localidad | TEXT | |
| domicilio | TEXT | |
| telefono | TEXT | |
| tipo_apoyo_id | BIGINT REFERENCES tipos_apoyo(id) | apoyo asignado |
| cantidad_asignada | NUMERIC(14,3) | |
| datos_extra | JSONB NOT NULL DEFAULT '{}' | **todas** las columnas del CSV no mapeadas se guardan aquí |
| origen_import_id | BIGINT REFERENCES importaciones(id) | |
| creado_en / actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Índices: `idx_benef_regional (regional_id)`, `idx_benef_municipio (municipio_id)`, `idx_benef_curp (curp)`, `idx_benef_busqueda` GIN sobre `to_tsvector('spanish', nombre_completo || ' ' || coalesce(curp,'') || ' ' || folio)`.

### 4.7 `capturas`

| Columna | Tipo | Notas |
|---|---|---|
| uuid | UUID PK | **generado en el cliente**, clave de idempotencia |
| beneficiario_id | BIGINT NOT NULL REFERENCES beneficiarios(id) | |
| usuario_id | BIGINT NOT NULL REFERENCES usuarios(id) | capturista |
| foto_url | TEXT NOT NULL | ruta relativa, ej. `/media/2026/08/<uuid>.jpg` |
| foto_hash | TEXT | sha256 del archivo |
| geom | geometry(Point,4326) NOT NULL | `ST_SetSRID(ST_MakePoint(lng,lat),4326)` |
| lat | DOUBLE PRECISION NOT NULL | redundante para lectura simple |
| lng | DOUBLE PRECISION NOT NULL | |
| precision_m | REAL NOT NULL | precisión GPS en metros |
| tipo_apoyo_id | BIGINT REFERENCES tipos_apoyo(id) | |
| cantidad_entregada | NUMERIC(14,3) | |
| observaciones | TEXT | |
| capturado_en | TIMESTAMPTZ NOT NULL | timestamp del dispositivo en campo |
| sincronizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | timestamp del servidor |
| estado_sync | TEXT NOT NULL DEFAULT 'sincronizada' CHECK (estado_sync IN ('sincronizada','revisada','rechazada')) | |
| dispositivo | TEXT | user-agent recortado a 200 chars |
| creado_en / actualizado_en | TIMESTAMPTZ | |

Índices: `idx_capturas_geom` GIST(geom), `idx_capturas_benef (beneficiario_id)`, `idx_capturas_usuario (usuario_id)`, `idx_capturas_fecha (capturado_en)`.

### 4.8 `auditoria_log`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| usuario_id | BIGINT REFERENCES usuarios(id) | NULL en logins fallidos |
| accion | TEXT NOT NULL | `login`, `login_fallido`, `sync_padron`, `captura_creada`, `captura_duplicada`, `export_csv`, `export_pdf`, `import_padron` |
| entidad | TEXT | `beneficiario`, `captura`, `usuario` |
| entidad_id | TEXT | |
| detalle | JSONB NOT NULL DEFAULT '{}' | |
| ip | INET | |
| user_agent | TEXT | |
| creado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 4.9 `importaciones`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| archivo | TEXT NOT NULL | |
| tipo | TEXT NOT NULL CHECK (tipo IN ('padron','catalogo')) | |
| mapeo | JSONB NOT NULL | mapeo de columnas usado |
| filas_leidas / filas_insertadas / filas_actualizadas / filas_error | INTEGER NOT NULL DEFAULT 0 | |
| errores | JSONB NOT NULL DEFAULT '[]' | máx. 200 entradas `{fila, motivo}` |
| ejecutado_por | TEXT | usuario del CLI |
| creado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 4.10 Esquema IndexedDB (Dexie, DB `sedea_campo`, versión 1)

- `sesion` (key `id`=1): token, perfil, expiracion, ultima_sincronizacion.
- `beneficiarios` (pk `id`; índices `regional_id`, `municipio_id`, `colonia`, `seccion`, `curp`, `nombre_completo`).
- `catalogos` (pk `++id`; índices `grupo`, `clave`, `padre_clave`).
- `capturas` (pk `uuid`; índices `beneficiario_id`, `estado`, `capturado_en`). Campos: uuid, beneficiario_id, foto (Blob), foto_url, lat, lng, precision_m, tipo_apoyo_id, cantidad_entregada, observaciones, capturado_en, estado ('pendiente'|'sincronizando'|'sincronizada'|'error'), intentos, error_msg.

---

## 5. Stack y decisiones técnicas

### 5.1 Elección de backend: **Node 20 + TypeScript + Fastify 4**

Justificación (motivo técnico de peso): el corazón del proyecto es la **sincronización offline** entre PWA e API. Con Node+TS se comparte un paquete `packages/shared` con los **tipos y validadores Zod idénticos** en cliente y servidor (payload de captura, DTOs de padrón y catálogos), eliminando la clase de bug más probable —desalineación de contratos entre la cola de sync y el endpoint de upsert—. Además unifica toolchain (un solo `node_modules`, un solo linter, un solo build) para un proyecto urgente, y produce imágenes Docker más pequeñas que un stack mixto Python+Node. PostGIS se usa vía SQL crudo (`pg`), por lo que no se pierde nada frente a GeoAlchemy.

### 5.2 Versiones fijadas

| Componente | Versión |
|---|---|
| Node | 20 LTS (imagen `node:20-alpine`) |
| PostgreSQL + PostGIS | imagen `postgis/postgis:16-3.4` |
| Fastify | ^4.26 |
| pg (node-postgres) | ^8.11 |
| node-pg-migrate | ^7.4 (migraciones SQL versionadas) |
| zod | ^3.23 |
| @fastify/jwt, @fastify/cors, @fastify/multipart, @fastify/static, @fastify/rate-limit | ^8 / ^9 / ^8 / ^7 / ^9 |
| bcryptjs | ^2.4 |
| pdfkit | ^0.15 (generación de PDF del expediente) |
| sharp | ^0.33 (miniaturas y normalización de fotos en servidor) |
| xlsx (SheetJS) + csv-parse | ^0.20 / ^5.5 (script de importación) |
| React | ^18.3 |
| Vite | ^5.4 |
| vite-plugin-pwa (Workbox) | ^0.20 |
| dexie + dexie-react-hooks | ^4.0 |
| react-router-dom | ^6.26 |
| leaflet + react-leaflet | ^1.9 / ^4.2 |
| Nginx (sirve la PWA) | `nginx:1.27-alpine` |

Estilos: CSS plano con variables en `src/styles/`. **Sin** Tailwind ni librería de componentes.

### 5.3 Estructura del monorepo

```
07_SEDEA_Appsheet_Migration/
├── SPEC.md
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json                  # npm workspaces: backend, pwa, shared, scripts
├── db/
│   ├── migrations/
│   │   ├── 001_extensiones.sql            # CREATE EXTENSION IF NOT EXISTS postgis
│   │   ├── 002_catalogos.sql              # direcciones_regionales, municipios, tipos_apoyo, catalogos
│   │   ├── 003_usuarios.sql
│   │   ├── 004_beneficiarios.sql          # + importaciones
│   │   ├── 005_capturas.sql
│   │   └── 006_auditoria_log.sql
│   ├── seeds/
│   │   ├── 001_usuarios_demo.sql
│   │   ├── 002_catalogos_demo.sql
│   │   └── 003_beneficiarios_demo.sql
│   └── README.md
├── packages/
│   └── shared/                   # @sedea/shared: tipos + esquemas Zod compartidos
│       ├── package.json
│       └── src/{index.ts,dto.ts,schemas.ts}
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── src/
│       ├── server.ts             # bootstrap Fastify
│       ├── config.ts             # lectura y validación de env con Zod
│       ├── db/{pool.ts,queries/*.ts}
│       ├── plugins/{auth.ts,rbac.ts,auditoria.ts,errores.ts}
│       ├── rutas/{auth.ts,catalogos.ts,beneficiarios.ts,capturas.ts,auditoria.ts,salud.ts}
│       ├── servicios/{almacenamiento.ts,pdf.ts,csv.ts}
│       └── tipos/
├── pwa/
│   ├── package.json
│   ├── vite.config.ts            # vite-plugin-pwa, proxy /api -> backend en dev
│   ├── index.html
│   ├── Dockerfile                # build multi-stage -> nginx
│   ├── nginx.conf
│   ├── public/{icon-192.png,icon-512.png}
│   └── src/
│       ├── main.tsx, App.tsx, rutas.tsx
│       ├── db/{indexeddb.ts,repositorios.ts}
│       ├── sync/{cola.ts,motor.ts,estadoRed.ts}
│       ├── api/cliente.ts
│       ├── componentes/{BarraEstado.tsx,ListaBeneficiarios.tsx,CapturaGPS.tsx,CapturaFoto.tsx,MapaCapturas.tsx,RutaProtegida.tsx}
│       ├── pantallas/{Login.tsx,Sync.tsx,Beneficiarios.tsx,FichaBeneficiario.tsx,NuevaCaptura.tsx,Auditoria.tsx,Expediente.tsx,SinPermiso.tsx}
│       └── styles/
├── scripts/
│   ├── importar.ts               # CLI de importación padrón/catálogo
│   ├── mapeos/{padron.ejemplo.json,catalogo.ejemplo.json}
│   └── datos-ejemplo/{padron.ejemplo.csv,catalogo.ejemplo.csv}
└── infra/
    ├── easypanel/README.md
    ├── cloudflare/tunnel.ejemplo.yml
    └── nginx/  (config de referencia)
```

### 5.4 Variables de entorno (`.env.example`, sin secretos reales)

```
# Base de datos
POSTGRES_USER=sedea
POSTGRES_PASSWORD=cambiame
POSTGRES_DB=sedea
POSTGRES_HOST=db
POSTGRES_PORT=5432
DATABASE_URL=postgres://sedea:cambiame@db:5432/sedea

# Backend
PORT=3000
NODE_ENV=production
JWT_SECRET=cambiame-por-un-secreto-largo
JWT_EXPIRES_IN=12h
CORS_ORIGIN=http://localhost:8080
STORAGE_DRIVER=local
MEDIA_DIR=/app/media
MEDIA_PUBLIC_PATH=/media
MAX_UPLOAD_MB=8
RATE_LIMIT_MAX=300

# PWA (build-time)
VITE_API_URL=/api
VITE_APP_NOMBRE=SEDEA Campo
VITE_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

# Seeds demo (solo desarrollo)
SEED_ADMIN_USER=admin
SEED_ADMIN_PASSWORD=cambiame123
```

### 5.5 Comandos

| Acción | Comando |
|---|---|
| Instalar | `npm install` (raíz, workspaces) |
| Dev backend | `npm run dev -w backend` (tsx watch, puerto 3000) |
| Dev PWA | `npm run dev -w pwa` (Vite 5173, proxy `/api` → 3000) |
| Migrar | `npm run migrate` (aplica `db/migrations` en orden) |
| Seed | `npm run seed` |
| Importar padrón | `npm run importar -- --tipo padron --archivo scripts/datos-ejemplo/padron.ejemplo.csv --mapeo scripts/mapeos/padron.ejemplo.json` |
| Importar catálogo | `npm run importar -- --tipo catalogo --archivo ... --mapeo ...` |
| Levantar todo | `docker compose up --build` → PWA en `http://localhost:8080`, API en `http://localhost:3000` |

`docker-compose.yml` ejecuta migraciones + seed automáticamente en el arranque del servicio `backend` (entrypoint: `migrate && seed --si-vacio && node dist/server.js`), con `depends_on: db (healthcheck pg_isready)`.

### 5.6 Formato del mapeo de importación (configurable, NO hardcodeado)

`scripts/mapeos/padron.ejemplo.json`:
```json
{
  "tipo": "padron",
  "delimitador": ",",
  "hoja": "Hoja1",
  "columnas": {
    "folio": "FOLIO",
    "curp": "CURP",
    "nombre_completo": "NOMBRE DEL BENEFICIARIO",
    "regional": "DIRECCION REGIONAL",
    "municipio": "MUNICIPIO",
    "colonia": "COLONIA/BARRIO",
    "seccion": "SECCION",
    "localidad": "LOCALIDAD",
    "domicilio": "DOMICILIO",
    "telefono": "TELEFONO",
    "tipo_apoyo": "TIPO DE APOYO",
    "cantidad_asignada": "CANTIDAD"
  },
  "crear_catalogos_faltantes": true,
  "clave_upsert": "folio",
  "guardar_columnas_no_mapeadas_en": "datos_extra"
}
```
Reglas: nombres de columna se normalizan (trim, mayúsculas, sin acentos) antes de comparar. Columnas no mapeadas → `datos_extra` JSONB. Filas sin `nombre_completo` o sin regional resoluble → error registrado en `importaciones.errores`, no aborta el proceso. `--dry-run` disponible.

### 5.7 Endpoints REST (todos bajo `/api`)

Auth: `Authorization: Bearer <jwt>` salvo indicación. Errores en formato `{"error":{"codigo":"...","mensaje":"..."}}`.

| # | Método | Ruta | Auth | Descripción / Respuesta |
|---|---|---|---|---|
| E1 | GET | `/api/health` | pública | `200 {"ok":true,"db":true,"postgis":"3.x"}` |
| E2 | POST | `/api/auth/login` | pública | body `{usuario,password}` → `200 {token, usuario:{id,nombre_completo,rol,regional_id,regional_nombre}}`; `401` si credenciales inválidas. Rate limit 10/min por IP. |
| E3 | GET | `/api/auth/me` | sí | `200` perfil del token; `401` si token inválido/expirado. |
| E4 | GET | `/api/catalogos` | sí | `200 {regionales:[],municipios:[],tipos_apoyo:[],catalogos:[]}` filtrado a la Regional del usuario si rol=`capturista`. |
| E5 | GET | `/api/beneficiarios` | sí | query `page` (1), `page_size` (≤500, default 200), `municipio_id`, `colonia`, `seccion`, `q`, `since` (ISO). Respuesta `200 {data:[], page, page_size, total, has_more}`. **Siempre** forzado a `regional_id` del usuario si rol=`capturista`; un `auditor` con regional asignada también se limita a la suya; `admin` puede pasar `regional_id`. |
| E6 | GET | `/api/beneficiarios/:id` | sí | `200` beneficiario; `404` si no existe; **`403` si pertenece a otra Regional**. |
| E7 | POST | `/api/capturas` | sí (`capturista`,`admin`) | `multipart/form-data`. Valida uuid v4, lat ∈ [-90,90], lng ∈ [-180,180], precision_m ≥ 0, foto ≤ `MAX_UPLOAD_MB` y mimetype image/*. UPSERT por `uuid` (`ON CONFLICT (uuid) DO NOTHING` + relectura). `201 {uuid, foto_url, duplicado:false}` en alta nueva; `200 {uuid, foto_url, duplicado:true}` si el uuid ya existía. `403` si el beneficiario no es de su Regional. `422` en validación. |
| E8 | GET | `/api/capturas` | sí | query `beneficiario_id`, `desde`, `hasta`, `page`, `page_size`. Filtrado por Regional. |
| E9 | GET | `/api/auditoria/capturas` | `auditor`,`admin` | query `regional_id`, `municipio_id`, `desde`, `hasta`, `q`, `page`, `page_size` → `200 {data:[{uuid,foto_url,lat,lng,precision_m,capturado_en,beneficiario:{...},capturista}], total}`. `403` para `capturista`. |
| E10 | GET | `/api/auditoria/geojson` | `auditor`,`admin` | mismos filtros → `200` FeatureCollection GeoJSON (generado con `ST_AsGeoJSON(geom)`), para pintar en Leaflet. |
| E11 | GET | `/api/auditoria/export.csv` | `auditor`,`admin` | `200` `text/csv; charset=utf-8` con BOM, `Content-Disposition: attachment`. Registra `export_csv` en bitácora. |
| E12 | GET | `/api/auditoria/expediente/:beneficiarioId.pdf` | `auditor`,`admin` | `200 application/pdf`. Registra `export_pdf`. |
| E13 | GET | `/api/auditoria/expediente/:beneficiarioId.csv` | `auditor`,`admin` | `200 text/csv`. |
| E14 | GET | `/api/auditoria/log` | `admin` | bitácora paginada. |
| E15 | GET | `/media/*` | sí (token en header o `?token=`) | sirve las fotos desde `MEDIA_DIR` con `@fastify/static`. |

### 5.8 Seguridad

- JWT HS256, expiración 12 h, secreto de env; falla el arranque si `JWT_SECRET` no está definido o mide < 16 chars.
- Passwords con bcrypt cost 10. Nunca se devuelve `password_hash`.
- **Aislamiento por Regional aplicado en la capa SQL del backend** (todas las queries de beneficiarios/capturas incluyen `AND b.regional_id = $regional` cuando el rol lo exige). Nunca depende del frontend.
- `helmet`-equivalente vía `@fastify/helmet`, CORS restringido a `CORS_ORIGIN`, rate limit global.
- Bitácora obligatoria en: login, login fallido, sync de padrón, captura creada/duplicada, exportaciones, importaciones.

---

## 6. Assumptions (decisiones tomadas ante ambigüedad)

1. **Backend**: Node+TS+Fastify (ver 5.1). No se implementa alternativa en Python.
2. **Esquema real del padrón desconocido** ⇒ se implementa mapeo configurable por JSON + `datos_extra JSONB` para columnas no previstas, y se incluyen `padron.ejemplo.csv` / `catalogo.ejemplo.csv` documentados. No se hardcodea ningún nombre de columna del cliente.
3. **Fotos**: driver único `local` (volumen Docker `media`). Ruta `/media/YYYY/MM/<uuid>.jpg`. Se guarda solo la URL en BD, como pide el brief.
4. **Panel de auditoría** vive dentro de la misma app React, en rutas protegidas por rol, no como app separada.
5. **Autenticación offline**: si el JWT local no ha expirado, la app opera sin red; al expirar exige reconexión. No hay refresh tokens.
6. **CURP no es única ni obligatoria** (los padrones reales suelen traerla incompleta); la clave de upsert de importación es `folio`.
7. **Municipio pertenece a una Regional** (relación 1..N). Si el CSV trae un municipio en dos regionales, se crean dos registros distintos y se registra advertencia.
8. **`capturado_en`** es la hora del dispositivo (puede estar desfasada offline); `sincronizado_en` es la hora del servidor. Ambas se conservan para auditoría.
9. **Múltiples capturas por beneficiario permitidas** (recapturas/correcciones). El badge "Capturado" aparece con ≥1 captura.
10. **Sin pre-caché de tiles** de mapa (opcional en el brief). El mapa solo se usa en el panel de auditoría, que requiere red.
11. **Idioma**: 100 % español (UI, comentarios de código, mensajes de error). Fechas en formato `DD/MM/AAAA HH:mm` (es-MX) en la UI.
12. **Puerto de la PWA en compose**: 8080. Backend: 3000. Postgres: 5432 (expuesto solo en desarrollo).
13. **Usuarios demo del seed** (documentados en README, contraseñas desde env, nunca en código): `admin` (admin, sin regional), `capturista1` (capturista, REG-01), `auditor1` (auditor, sin regional → ve todas).
14. **Background Sync API** no se usa por soporte inconsistente en iOS; la sync se dispara por evento `online`, al abrir la app y con botón manual.
15. **Compresión de foto en cliente** a 1600 px / JPEG 0.75 para que el Blob en IndexedDB y la subida sean viables con mala señal.
16. **`estado_sync` en la tabla `capturas`** representa el estado de revisión del lado servidor (`sincronizada`/`revisada`/`rechazada`); el estado de la cola offline vive solo en IndexedDB.
17. Sin CI, sin tests automatizados en el repo; la verificación es el rubric de la sección 7.

---

## 7. Rubric de evaluación (criterios binarios verificables)

El Evaluator ejecuta estos criterios con `curl` (API) o Playwright (UI). Base: `API=http://localhost:3000`, `APP=http://localhost:8080`.

### Infraestructura y base de datos

1. Existe `docker-compose.yml` en la raíz y `docker compose config` sale con código 0.
2. `docker compose up -d --build` deja los 3 servicios (`db`, `backend`, `pwa`) en estado `running`/`healthy` en ≤180 s.
3. `curl -s $API/api/health` devuelve HTTP 200 y JSON con `ok:true`, `db:true` y `postgis` no vacío.
4. La consulta `SELECT postgis_version();` en el contenedor `db` devuelve una versión sin error.
5. Existen las 9 tablas `usuarios, direcciones_regionales, municipios, tipos_apoyo, catalogos, beneficiarios, capturas, auditoria_log, importaciones` (verificable con `information_schema.tables`).
6. `capturas.geom` tiene tipo `geometry(Point,4326)` (verificable en `geometry_columns`: `type='POINT'`, `srid=4326`).
7. Existe un índice GIST sobre `capturas.geom` (`pg_indexes` contiene `gist`).
8. `db/migrations/` contiene archivos numerados y `001_*.sql` incluye `CREATE EXTENSION IF NOT EXISTS postgis`.
9. `.env.example` existe, contiene `JWT_SECRET`, `DATABASE_URL`, `MEDIA_DIR` y **ningún** valor que parezca secreto real (todos `cambiame*` o placeholders).
10. `grep -ri` sobre `backend/src` y `pwa/src` no encuentra contraseñas o secretos literales (ni `JWT_SECRET=` con valor).

### Importación

11. Existe `scripts/importar.ts` y `npm run importar -- --help` sale con código 0 mostrando las opciones `--tipo`, `--archivo`, `--mapeo`, `--dry-run`.
12. Existen `scripts/mapeos/padron.ejemplo.json` y `scripts/datos-ejemplo/padron.ejemplo.csv`; el mapeo contiene la clave `columnas` con nombres de columna configurables.
13. Ejecutar la importación de ejemplo del padrón sale con código 0 e imprime totales `leidas/insertadas/actualizadas/errores`; se crea una fila en `importaciones`.
14. Reejecutar la misma importación no duplica beneficiarios (el `COUNT(*)` de `beneficiarios` no aumenta).
15. Una columna del CSV de ejemplo no declarada en el mapeo aparece dentro de `beneficiarios.datos_extra`.

### API — autenticación y seguridad por Regional

16. `POST /api/auth/login` con credenciales demo válidas devuelve 200 y un campo `token` no vacío.
17. `POST /api/auth/login` con password incorrecto devuelve 401 y no devuelve `token`.
18. `GET /api/beneficiarios` sin header `Authorization` devuelve 401.
19. `GET /api/beneficiarios` con token de `capturista1` devuelve 200 y **todos** los elementos tienen el mismo `regional_id` que el usuario.
20. `GET /api/beneficiarios?regional_id=<otra>` con token de `capturista1` sigue devolviendo solo su Regional (el parámetro se ignora o responde 403), nunca beneficiarios ajenos.
21. `GET /api/beneficiarios/:id` de un beneficiario de otra Regional con token de `capturista1` devuelve 403.
22. `GET /api/auditoria/capturas` con token de `capturista1` devuelve 403.
23. `GET /api/auditoria/capturas` con token de `auditor1` devuelve 200 con `data` array.
24. `GET /api/catalogos` con token válido devuelve 200 con las claves `regionales`, `municipios`, `tipos_apoyo`.
25. `GET /api/beneficiarios?page=1&page_size=5` devuelve 200 con `data.length ≤ 5` y campos `page`, `total`, `has_more`.

### API — capturas e idempotencia

26. `POST /api/capturas` (multipart con foto JPEG, uuid v4, lat/lng/precision válidos) devuelve 201 con `duplicado:false` y `foto_url` no vacío.
27. Repetir exactamente el mismo `POST /api/capturas` con el **mismo uuid** devuelve 200 con `duplicado:true` y `SELECT count(*) FROM capturas WHERE uuid=...` = 1.
28. `POST /api/capturas` con `lat=999` devuelve 422 y no inserta registro.
29. `POST /api/capturas` sin archivo de foto devuelve 422.
30. Tras la captura, `SELECT ST_X(geom), ST_Y(geom)` coincide con `lng`/`lat` enviados (tolerancia 1e-6).
31. `GET /media/<ruta devuelta>` con token devuelve 200 y `content-type: image/*`.
32. Consulta de auditoría por Municipio: `GET /api/auditoria/capturas?municipio_id=<id>` con token de auditor devuelve 200 y todas las filas corresponden a ese municipio.
33. `GET /api/auditoria/geojson` devuelve 200 con `type:"FeatureCollection"` y features con `geometry.type === "Point"`.
34. Tras un login exitoso y una captura, `GET /api/auditoria/log` con token admin contiene al menos una entrada con `accion='login'` y otra con `accion='captura_creada'`.

### Exportaciones

35. `GET /api/auditoria/export.csv` con token de auditor devuelve 200, `content-type` contiene `text/csv` y cabecera `Content-Disposition: attachment`.
36. El CSV exportado contiene en su primera línea las columnas `beneficiario`, `curp`, `regional`, `municipio`, `colonia`, `seccion`, `lat`, `lng`, `precision_m`, `capturado_en`, `capturista`.
37. `GET /api/auditoria/expediente/<id>.pdf` devuelve 200, `content-type: application/pdf` y el cuerpo empieza con `%PDF`.
38. `GET /api/auditoria/expediente/<id>.csv` devuelve 200 con `text/csv`.

### PWA — instalabilidad y offline

39. `GET $APP/` devuelve 200 con HTML y `GET $APP/manifest.webmanifest` devuelve 200 con `name`, `display:"standalone"` e `icons` con tamaños 192 y 512.
40. Existe un service worker servido en `$APP/sw.js` (o `registerSW.js` que lo registra) y devuelve 200.
41. Playwright: en `/login`, enviar usuario/password demo válidos navega fuera de `/login` (a `/sync` o `/beneficiarios`) y muestra el nombre del usuario.
42. Playwright: en `/login`, credenciales inválidas muestran un mensaje de error visible en español y la URL sigue siendo `/login`.
43. Playwright: en la pantalla de sincronización, al pulsar "Descargar padrón y catálogos" aparece un conteo de beneficiarios descargados > 0 y una fecha de última sincronización.
44. Playwright: la lista `/beneficiarios` muestra ≥1 renglón y al escribir un nombre existente en el buscador la lista se reduce a coincidencias.
45. Playwright: existen selects de Regional, Municipio, Colonia y Sección; para un `capturista` el select de Regional está deshabilitado o fijo a su Regional.
46. Playwright con `context.setOffline(true)` **después** de la sync inicial: recargar `/beneficiarios` sigue mostrando la lista (app-shell + datos desde caché/IndexedDB), sin pantalla de error de red.
47. Playwright offline: la barra de estado muestra el texto "Sin conexión".
48. Playwright offline, en `/beneficiarios/:id/captura` con geolocalización simulada: se muestra la precisión en formato "±N m" y las coordenadas.
49. Playwright: existe un botón "Reintentar ubicación" visible en la pantalla de captura.
50. Playwright offline: tras adjuntar una foto y con GPS obtenido, "Guardar captura" registra la captura y el contador de pendientes de la barra de estado aumenta en 1.
51. Playwright: al volver a `context.setOffline(false)`, el contador de pendientes llega a 0 automáticamente (≤30 s) o tras pulsar "Sincronizar ahora", y la captura existe en la BD con el mismo uuid.
52. Playwright: reintentar la sincronización de la misma captura no crea duplicados (`count(*)` por uuid sigue siendo 1).
53. Playwright: un usuario `capturista` que navega a `/auditoria` ve una pantalla de "No tienes permiso" y no la tabla de auditoría.
54. Playwright: un `auditor1` en `/auditoria` ve una tabla con ≥1 fila y un contenedor Leaflet (`.leaflet-container`) con ≥1 marcador (`.leaflet-marker-icon`).
55. Playwright: el mapa usa tiles de OpenStreetMap (existe un `img.leaflet-tile` con `src` que contiene `tile.openstreetmap.org`) y la atribución OSM es visible.
56. Playwright: en `/auditoria` los filtros de Regional, Municipio y rango de fechas existen y al aplicar un filtro de fecha imposible la tabla queda vacía con mensaje "Sin resultados".
57. Playwright: en el expediente de un beneficiario, el botón "Descargar expediente PDF" dispara una descarga cuyo nombre termina en `.pdf`.
58. `grep` en `pwa/src`: no aparece ninguna referencia a `arcgis`, `mapbox` ni `googleapis/maps`.

### Documentación

59. `README.md` existe y contiene secciones con los términos `EasyPanel`, `Hostinger`, `Cloudflare Tunnel`, `Protección de datos`, y los comandos `docker compose up` y de importación.
60. `README.md` documenta explícitamente HTTPS, control de acceso por Regional y bitácora `auditoria_log` en su sección de protección de datos, y lista los usuarios demo con la advertencia de cambiarlos en producción.

**Definición de "terminado":** los 60 criterios pasan.
