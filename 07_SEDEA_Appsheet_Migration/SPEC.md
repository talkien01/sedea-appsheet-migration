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

> **Nota de la extensión (§8):** a partir del build de staging, los criterios 13–15 se evalúan contra `staging_beneficiarios` en lugar de `beneficiarios` (ver criterios 69–80, que los sustituyen operativamente). Se conservan aquí por trazabilidad histórica.

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

**Definición de "terminado" (build 1):** los 60 criterios pasan. ✔ verificado en `FINDINGS.md` (pass 1, 60/60).

---
---

# 8. EXTENSIÓN — Subsistema de depuración / staging de datos (build 2)

> Esta sección **se agrega** al SPEC original; nada de las secciones 1–7 se renegocia. Todo lo aquí descrito vive dentro del mismo monorepo, mismo `docker-compose.yml`, mismo backend y misma PWA. No se crea un segundo servicio ni un deploy separado.

## 8.1 Objetivo de la extensión

Interponer una capa de **staging revisable por humanos** entre la importación del padrón real y las tablas de producción, de forma que ningún registro sucio o duplicado del archivo de origen llegue al capturista de campo sin que una persona con rol `editor_datos` lo haya aprobado, descartado o fusionado explícitamente.

## 8.2 Motivación (hallazgos sobre los archivos reales de origen)

Estos hallazgos son contexto de diseño; **los archivos reales NO se commitean, NO se copian a `scripts/datos-ejemplo/` y NO se usan como fixtures de prueba** (contienen PII). Permanecen en la raíz del proyecto, cubiertos por `.gitignore`.

- `[PROYECTESTRATORG] Base general.xlsx` no es un padrón plano: es la bitácora del flujo completo del programa (solicitud → dictamen → autorización → pago → seguimiento), **2325 filas × 176 columnas**.
- ~**101 folios duplicados** y ~**113 CURP duplicadas** (~4–5 % del archivo).
- **1594 filas (68 %) sin Colonia**; **126 filas (5.4 %) sin coordenadas de proyecto**.
- `[PROYECTESTRATORG] CATALOGOS.xlsx` trae dos catálogos de conceptos divergentes: hoja `APOYO` (152 conceptos) y hoja `Copia de APOYO` (173), con solo 9 en común.
- La hoja `REGION` confirma **4 Direcciones Regionales**: Cadereyta, Jalpan, Querétaro, San Juan del Río (el SPEC original asumía 3).
- El importador actual escribe directo a `beneficiarios`/`catalogos`: con datos de esta calidad, un capturista vería duplicados y basura sin depurar.

## 8.3 Decisiones de producto (ya acordadas con el usuario — implementar tal cual)

- **D1. Catálogo vigente**: la hoja `APOYO` (152 conceptos) es el catálogo base de conceptos de apoyo. La hoja `Copia de APOYO` **no se usa** ni se importa.
- **D2. Un beneficiario puede recibir legítimamente 2+ apoyos distintos** (p. ej. maquinaria **y** semilla/fertilizante) si califica para cada uno. Por lo tanto:
  - Misma CURP + **concepto distinto** ⇒ probablemente legítimo, pero **NO se auto-aprueba**: pasa por staging para confirmación humana (alerta de nivel `media`).
  - Mismo **folio**, o misma CURP + **mismo concepto** ⇒ probable captura duplicada real: alerta de nivel `alta`.
- **D3. El importador NUNCA auto-fusiona ni auto-descarta.** Toda fila importada nace en `estado_revision='pendiente'`. La promoción a producción es siempre una acción humana explícita.
- **D4. Rol nuevo `editor_datos`**: acceso **exclusivo** a las pantallas y endpoints de staging. Sin acceso a captura de campo (`/beneficiarios*`) ni al panel de auditoría (`/auditoria*`). `admin` conserva acceso a todo, staging incluido.
- **D5. Alcance de la fusión**: la acción "fusionar" existe **solo para `staging_beneficiarios`**. Para `staging_catalogos` bastan aprobar/descartar (una clave duplicada se resuelve aprobando una y descartando la otra).
- **D6. 4 Regionales reales** sustituyen a las 3 ficticias del seed original.

## 8.4 Modelo de datos nuevo

Migraciones nuevas, **aditivas**. No se altera ninguna columna existente de `beneficiarios`, `capturas`, `usuarios`, `auditoria_log`, `catalogos`, `tipos_apoyo`, `municipios`, `direcciones_regionales`, `importaciones` (salvo el CHECK de rol descrito en 8.4.1).

### 8.4.1 `db/migrations/007_rol_editor_datos.sql`

```sql
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('capturista','auditor','admin','editor_datos'));
```

### 8.4.2 `db/migrations/008_staging.sql` → tabla `staging_beneficiarios`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| importacion_id | BIGINT REFERENCES importaciones(id) | corrida que la generó |
| archivo | TEXT NOT NULL | nombre base del archivo de origen |
| fila_origen | INTEGER NOT NULL | número de fila en el archivo (1 = primera fila de datos) |
| folio | TEXT | tal como viene (puede repetirse o ser NULL) |
| curp | TEXT | |
| nombre_completo | TEXT | |
| regional_texto | TEXT | valor crudo del archivo |
| regional_id | BIGINT REFERENCES direcciones_regionales(id) | resuelto por normalización; NULL si no resoluble |
| municipio_texto | TEXT | |
| municipio_id | BIGINT REFERENCES municipios(id) | |
| colonia | TEXT | |
| seccion | TEXT | |
| localidad | TEXT | |
| domicilio | TEXT | |
| telefono | TEXT | |
| tipo_apoyo_texto | TEXT | concepto tal como viene |
| tipo_apoyo_id | BIGINT REFERENCES tipos_apoyo(id) | NULL si no reconocido |
| cantidad_asignada | NUMERIC(14,3) | |
| lat_proyecto | DOUBLE PRECISION | coordenada del proyecto en el archivo |
| lng_proyecto | DOUBLE PRECISION | |
| datos_extra | JSONB NOT NULL DEFAULT '{}' | **todas** las columnas no mapeadas |
| **folio_duplicado** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| **curp_duplicada_mismo_concepto** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| **curp_duplicada_concepto_distinto** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| **sin_coordenadas** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| **sin_colonia** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| **concepto_no_reconocido** | BOOLEAN NOT NULL DEFAULT FALSE | flag de diagnóstico |
| nivel_alerta | TEXT NOT NULL DEFAULT 'ninguna' CHECK (nivel_alerta IN ('alta','media','ninguna')) | derivado, ver 8.5.2 |
| **estado_revision** | TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente','aprobado','descartado','fusionado')) | |
| **revisado_por** | BIGINT REFERENCES usuarios(id) | NULL mientras esté pendiente |
| **revisado_en** | TIMESTAMPTZ | NULL mientras esté pendiente |
| motivo_revision | TEXT | comentario libre del revisor (máx. 500) |
| promovido_beneficiario_id | BIGINT REFERENCES beneficiarios(id) | se llena al aprobar |
| fusionado_en_id | BIGINT REFERENCES staging_beneficiarios(id) | fila principal, si `estado_revision='fusionado'` |
| creado_en / actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Restricciones e índices:
- `UNIQUE (archivo, fila_origen)` — hace idempotente la reimportación del mismo archivo.
- `idx_stgb_estado (estado_revision)`, `idx_stgb_folio (folio)`, `idx_stgb_curp (curp)`, `idx_stgb_nivel (nivel_alerta)`, `idx_stgb_import (importacion_id)`.

### 8.4.3 `db/migrations/008_staging.sql` → tabla `staging_catalogos`

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| importacion_id | BIGINT REFERENCES importaciones(id) | |
| archivo | TEXT NOT NULL | |
| fila_origen | INTEGER NOT NULL | |
| grupo / clave / valor / padre_grupo / padre_clave | TEXT | igual que `catalogos` |
| orden | INTEGER NOT NULL DEFAULT 0 | |
| datos_extra | JSONB NOT NULL DEFAULT '{}' | |
| **clave_duplicada** | BOOLEAN NOT NULL DEFAULT FALSE | misma (grupo,clave) ≥2 veces en staging o ya en `catalogos` |
| **valor_duplicado** | BOOLEAN NOT NULL DEFAULT FALSE | mismo (grupo, valor normalizado) con claves distintas |
| **concepto_no_reconocido** | BOOLEAN NOT NULL DEFAULT FALSE | solo aplica si `grupo='concepto_apoyo'`: el valor no existe en `tipos_apoyo` vigente |
| nivel_alerta | TEXT NOT NULL DEFAULT 'ninguna' CHECK (nivel_alerta IN ('alta','media','ninguna')) | `alta` si `clave_duplicada`; `media` si otro flag |
| **estado_revision** | TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente','aprobado','descartado','fusionado')) | `fusionado` no se usa aquí (ver D5) |
| **revisado_por** | BIGINT REFERENCES usuarios(id) | |
| **revisado_en** | TIMESTAMPTZ | |
| motivo_revision | TEXT | |
| promovido_catalogo_id | BIGINT REFERENCES catalogos(id) | |
| creado_en / actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Restricciones: `UNIQUE (archivo, fila_origen)`; índices por `estado_revision`, `grupo`, `nivel_alerta`.

### 8.4.4 Acciones nuevas en `auditoria_log`

Se agregan (solo como valores de la columna `accion`, sin cambiar el esquema): `staging_import`, `staging_aprobado`, `staging_descartado`, `staging_fusionado`. `entidad` = `staging_beneficiario` | `staging_catalogo`; `entidad_id` = id de la fila; `detalle` incluye flags, estado anterior y nuevo, e ids involucrados en la fusión.

## 8.5 Importador CLI actualizado (`scripts/importar.ts`)

### 8.5.1 Comportamiento

- **Compatibilidad obligatoria**: se conservan exactamente los flags `--tipo <padron|catalogo>`, `--archivo`, `--mapeo`, `--dry-run`, `--help|-h`, el mismo formato de mapeo JSON (5.6) y la misma salida de totales.
- **Destino nuevo**: `--tipo padron` escribe en `staging_beneficiarios`; `--tipo catalogo` escribe en `staging_catalogos`. **Ya no escribe nunca en `beneficiarios`/`catalogos`.** La única vía a producción es la aprobación humana (8.6).
- El mapeo de padrón admite dos claves nuevas opcionales: `"lat_proyecto"` y `"lng_proyecto"`.
- UPSERT por `(archivo, fila_origen)`: reimportar el mismo archivo **actualiza** las filas que siguen en `pendiente` y **no toca** (ni duplica) las que ya estén en `aprobado`/`descartado`/`fusionado`; esas se reportan como `filas_omitidas`.
- `--dry-run` calcula y muestra el resumen de flags sin escribir nada.
- Cada corrida crea una fila en `importaciones` (tipo `padron`|`catalogo`) y una entrada `staging_import` en `auditoria_log` con `{archivo, filas_leidas, filas_insertadas, filas_actualizadas, filas_omitidas, filas_error, conteo_por_flag}`.
- Salida en consola (además de los totales existentes): bloque "Alertas detectadas" con el conteo de cada uno de los 6 flags y de `nivel_alerta`.
- La resolución de Regional/Municipio/Concepto usa normalización (trim, mayúsculas, sin acentos, espacios colapsados). Si la Regional no resuelve, la fila se guarda igual con `regional_id=NULL` (no se descarta) y se marca en `motivo_revision`.

### 8.5.2 Cálculo de flags (determinista, evaluado sobre staging pendiente ∪ producción)

Sea `norm(x)` = trim + mayúsculas + sin acentos + espacios colapsados; los valores vacíos no participan en comparaciones de duplicidad.

| Flag | Regla |
|---|---|
| `folio_duplicado` | `norm(folio)` no vacío y aparece ≥2 veces entre las filas pendientes del staging, **o** ya existe en `beneficiarios.folio`. |
| `curp_duplicada_mismo_concepto` | Existe otra fila (staging pendiente o `beneficiarios`) con el mismo `norm(curp)` **y** el mismo concepto (`tipo_apoyo_id` si resolvió, si no `norm(tipo_apoyo_texto)`). |
| `curp_duplicada_concepto_distinto` | Existe otra fila con el mismo `norm(curp)` pero **distinto** concepto. |
| `sin_coordenadas` | `lat_proyecto` o `lng_proyecto` NULL/no numérica/fuera de rango (`lat∉[-90,90]`, `lng∉[-180,180]`) o ambas = 0. |
| `sin_colonia` | `norm(colonia)` vacío. |
| `concepto_no_reconocido` | `norm(tipo_apoyo_texto)` no coincide con ningún `norm(tipos_apoyo.nombre)` activo (o el campo viene vacío). |

`nivel_alerta` = `alta` si `folio_duplicado` **o** `curp_duplicada_mismo_concepto`; si no, `media` si cualquier otro flag es verdadero; si no, `ninguna`.

Una fila puede tener varios flags a la vez. **Ningún flag provoca acción automática.**

### 8.5.3 Fixtures sintéticos para pruebas (obligatorios, sin PII)

`scripts/datos-ejemplo/padron.staging.ejemplo.csv` — **exactamente 12 filas de datos**, nombres y CURP inventados (patrón `PRUEBA <letra>` / `XXXX000000HQTXXX0N`), construidas para disparar cada flag:

| Fila | Escenario | Flags esperados |
|---|---|---|
| 1 | limpia, concepto real A | ninguno (`nivel_alerta='ninguna'`) |
| 2 | limpia, concepto real B | ninguno (`nivel_alerta='ninguna'`) |
| 3 | folio `STG-003` | `folio_duplicado` |
| 4 | folio `STG-003` (repetido) | `folio_duplicado` |
| 5 | CURP `X5`, concepto A, folio distinto | `curp_duplicada_mismo_concepto` |
| 6 | CURP `X5`, concepto A, folio distinto | `curp_duplicada_mismo_concepto` |
| 7 | CURP `X7`, concepto A | `curp_duplicada_concepto_distinto` |
| 8 | CURP `X7`, concepto B | `curp_duplicada_concepto_distinto` |
| 9 | colonia vacía | `sin_colonia` |
| 10 | lat/lng vacías | `sin_coordenadas` |
| 11 | concepto `APOYO INEXISTENTE PARA PRUEBA` | `concepto_no_reconocido` |
| 12 | colonia vacía **y** lat/lng vacías | `sin_colonia` + `sin_coordenadas` |

Conteos esperados tras importar el fixture (usados por el rubric): `folio_duplicado=2`, `curp_duplicada_mismo_concepto=2`, `curp_duplicada_concepto_distinto=2`, `sin_colonia=2`, `sin_coordenadas=2`, `concepto_no_reconocido=1`, `nivel_alerta='ninguna'` = 2, total filas = 12, todas en `estado_revision='pendiente'`.

Los "conceptos reales A y B" son **dos nombres copiados textualmente del seed de 152 conceptos** (8.7); el Generator los elige y los documenta en `scripts/datos-ejemplo/README.md`. Las filas 1–10 y 12 usan A o B (reconocidos); solo la 11 usa el concepto inexistente. Todas las filas traen ≥2 columnas fuera del mapeo (ej. `ETAPA DEL TRAMITE`, `OBSERVACIONES DE GABINETE`) para verificar `datos_extra`.

`scripts/datos-ejemplo/catalogo.staging.ejemplo.csv` — 6 filas, de las cuales 2 comparten `(grupo, clave)` ⇒ `clave_duplicada=true` en ambas.

Mapeos correspondientes: `scripts/mapeos/padron.staging.ejemplo.json` (incluye `lat_proyecto`/`lng_proyecto`) y `scripts/mapeos/catalogo.staging.ejemplo.json`.

## 8.6 Endpoints nuevos (backend)

Todos bajo `/api/staging`, protegidos por `requiereRol(['editor_datos','admin'])`. Cualquier otro rol autenticado recibe **403**; sin token, **401**. Errores con el formato existente `{"error":{"codigo","mensaje"}}`. Archivo: `backend/src/rutas/staging.ts`.

| # | Método | Ruta | Descripción / Respuesta |
|---|---|---|---|
| E16 | GET | `/api/staging/resumen` | `200 {beneficiarios:{total, por_estado:{pendiente,aprobado,descartado,fusionado}, por_alerta:{folio_duplicado,curp_duplicada_mismo_concepto,curp_duplicada_concepto_distinto,sin_coordenadas,sin_colonia,concepto_no_reconocido}, por_nivel:{alta,media,ninguna}}, catalogos:{...}}` |
| E17 | GET | `/api/staging/beneficiarios` | query `estado` (default `pendiente`, admite `todos`), `alerta` (uno de los 6 flags, `ninguna`, o vacío), `nivel` (`alta\|media\|ninguna`), `q` (folio/CURP/nombre), `importacion_id`, `page` (1), `page_size` (≤200, default 50) → `200 {data:[fila+flags+nivel_alerta+estado_revision], page, page_size, total, has_more}` |
| E18 | GET | `/api/staging/beneficiarios/:id` | `200 {fila, relacionadas:{staging:[filas con mismo folio o misma CURP, excluyendo la propia, con su motivo_relacion:'folio'\|'curp_mismo_concepto'\|'curp_concepto_distinto'], produccion:[beneficiarios con mismo folio o CURP]}}`; `404` si no existe. |
| E19 | POST | `/api/staging/beneficiarios/:id/aprobar` | body `{motivo?}`. Promueve a `beneficiarios` (UPSERT por `folio`; `lat_proyecto`/`lng_proyecto` y `datos_extra` de staging se guardan en `beneficiarios.datos_extra`). Marca `estado_revision='aprobado'`, `revisado_por`, `revisado_en`, `promovido_beneficiario_id`. → `200 {ok:true, beneficiario_id}`. `409` si la fila no está en `pendiente`. `422` si falta `nombre_completo` o `regional_id` no resuelto. Registra `staging_aprobado`. |
| E20 | POST | `/api/staging/beneficiarios/:id/descartar` | body `{motivo?}` → `200 {ok:true}`, `estado_revision='descartado'`, **no** escribe en producción. `409` si no está en `pendiente`. Registra `staging_descartado`. |
| E21 | POST | `/api/staging/beneficiarios/fusionar` | body `{principal_id:number, secundarios_ids:number[] (≥1), campos?:{<columna>:<valor>}, promover?:boolean (default false), motivo?}`. Aplica `campos` sobre la fila principal (solo columnas de datos, nunca flags ni estado), marca cada secundaria `estado_revision='fusionado'` con `fusionado_en_id=principal_id`, recalcula flags de la principal, y si `promover:true` ejecuta la misma promoción de E19. → `200 {ok:true, principal_id, fusionados:[ids], beneficiario_id: number|null}`. `422` si `principal_id ∈ secundarios_ids`, si algún id no existe o si alguna fila no está en `pendiente`. Registra `staging_fusionado`. |
| E22 | GET | `/api/staging/catalogos` | mismos filtros que E17 (`estado`, `alerta` ∈ `clave_duplicada\|valor_duplicado\|concepto_no_reconocido\|ninguna`, `grupo`, `q`, paginación). |
| E23 | GET | `/api/staging/catalogos/:id` | `200 {fila, relacionadas:{staging:[misma (grupo,clave)], produccion:[catalogos con misma (grupo,clave)]}}` |
| E24 | POST | `/api/staging/catalogos/:id/aprobar` | Promueve a `catalogos` (UPSERT por `(grupo,clave,padre_clave)`) → `200 {ok:true, catalogo_id}`; `409` si no está pendiente. |
| E25 | POST | `/api/staging/catalogos/:id/descartar` | `200 {ok:true}`. |

Reglas transversales:
- Toda mutación es **transaccional** (promoción + cambio de estado + bitácora en una sola transacción).
- **Aislamiento por Regional**: si el usuario `editor_datos` tiene `regional_id` no nulo, las consultas y mutaciones de staging se limitan a filas con ese `regional_id` (o `regional_id IS NULL`, que cualquiera puede revisar); `admin` y `editor_datos` sin regional ven todo.
- `capturista` y `auditor` reciben 403 en **todas** las rutas `/api/staging/*`.
- Las rutas existentes (`/api/beneficiarios`, `/api/capturas`, `/api/auditoria/*`) **rechazan con 403** al rol `editor_datos`.

## 8.7 Semilla del catálogo real y Regionales

- `scripts/extraer-catalogo-apoyo.ts`: utilidad CLI (`--archivo <ruta xlsx> --hoja APOYO --salida db/seeds/004_tipos_apoyo_apoyo.sql`) que lee **solo la columna de nombre de concepto** de la hoja `APOYO` y genera el seed SQL. No lee ni emite ninguna columna de beneficiarios. El **archivo xlsx no se copia ni se commitea**; solo se commitea el SQL generado (los nombres de conceptos de apoyo no son PII).
- `db/seeds/004_tipos_apoyo_apoyo.sql`: **exactamente 152 filas** en `tipos_apoyo` con `clave` `AP-001` … `AP-152` (orden de aparición en la hoja), `nombre` = texto real del concepto, `categoria='otro'`, `activo=TRUE`, idempotente (`ON CONFLICT (clave) DO UPDATE`). Encabezado del archivo con comentario: origen (`CATALOGOS.xlsx`, hoja `APOYO`), fecha de extracción y nota de que `Copia de APOYO` se descarta por decisión D1.
- `db/seeds/002_catalogos_demo.sql` se actualiza para que `direcciones_regionales` contenga **exactamente 4** filas: `REG-01 Cadereyta`, `REG-02 Jalpan`, `REG-03 Querétaro`, `REG-04 San Juan del Río`. Los municipios y beneficiarios demo se reasignan a estas 4 claves; `capturista1` sigue en `REG-01`.
- `db/seeds/001_usuarios_demo.sql` agrega el usuario demo **`editor1`** (rol `editor_datos`, `regional_id=NULL`, password desde `SEED_EDITOR_PASSWORD`, con fallback a `SEED_ADMIN_PASSWORD`). Se documenta en el README junto con la advertencia de cambiarlo en producción. Nueva variable en `.env.example`: `SEED_EDITOR_PASSWORD=cambiame123`.

## 8.8 Pantallas nuevas en la PWA

Rutas nuevas en `pwa/src/rutas.tsx`, envueltas en `<RutaProtegida roles={['editor_datos','admin']}>`. **Son online-only**: no se cachean en IndexedDB ni se registran en la cola de sync (si no hay red, muestran "Esta sección requiere conexión a internet."). Componentes en `pwa/src/pantallas/` y `pwa/src/componentes/`.

### 8.8.1 `/depuracion` — Lista de staging de padrón (`Depuracion.tsx`)

- Encabezado "Depuración de datos — Padrón" + tarjetas de resumen (E16): Pendientes, Aprobados, Descartados, Fusionados y conteo por nivel de alerta.
- Filtros (todos con `data-testid`): `select-estado` (Pendiente/Aprobado/Descartado/Fusionado/Todos), `select-alerta` (Todas / Folio duplicado / CURP duplicada mismo concepto / CURP duplicada concepto distinto / Sin coordenadas / Sin colonia / Concepto no reconocido / Sin alertas), `input-busqueda` (folio, CURP o nombre).
- Tabla `data-testid="tabla-staging"` con filas `data-testid="fila-staging"`; columnas: Folio, CURP, Nombre, Regional, Municipio, Concepto de apoyo, **Alertas** (badges), Estado, acción "Revisar" → `/depuracion/beneficiarios/:id`.
- Badges de alerta (`data-testid="badge-alerta"`), texto en español y color por nivel: rojo `alta`, ámbar `media`, verde "Sin alertas".
- Vacío: mensaje "Sin resultados".

### 8.8.2 `/depuracion/beneficiarios/:id` — Detalle y comparación (`DepuracionDetalle.tsx`)

- Panel superior: todos los campos de la fila + sus badges + `datos_extra` en tabla colapsable.
- **Comparación lado a lado** (`data-testid="comparador"`): tarjetas/columnas —una por candidato— con la fila actual marcada "Esta fila" y cada relacionada (staging y producción) con su motivo (`Mismo folio`, `Misma CURP · mismo concepto`, `Misma CURP · concepto distinto`) y origen (`Staging` / `Ya en producción`). Los campos cuyo valor difiere entre candidatos se resaltan visualmente.
- Aviso fijo en pantalla cuando hay relacionadas por CURP con concepto distinto: "Un beneficiario puede recibir apoyos distintos. Confirma antes de descartar."
- Acciones: `btn-aprobar` ("Aprobar y promover a producción", con diálogo de confirmación), `btn-descartar` ("Descartar", pide motivo opcional), `btn-fusionar` ("Fusionar seleccionadas") habilitado solo si hay ≥1 candidata de staging seleccionada mediante checkbox `chk-candidata`; el diálogo de fusión permite elegir la fila principal y marcar "Promover a producción tras fusionar".
- Tras cada acción: toast en español, refresco de la fila y del resumen; el estado mostrado cambia a Aprobado / Descartado / Fusionado. Si el backend responde 409, se muestra "Esta fila ya fue revisada."

### 8.8.3 `/depuracion/catalogos` — Lista de staging de catálogos (`DepuracionCatalogos.tsx`)

Misma mecánica reducida: filtros por estado/alerta/grupo, tabla con badges y botones Aprobar/Descartar por fila.

### 8.8.4 Navegación y control de acceso

- Tras login, el redirect por rol es: `capturista` → `/sync` o `/beneficiarios` (sin cambio); `auditor` → `/auditoria`; **`editor_datos` → `/depuracion`**; `admin` → `/beneficiarios`.
- La barra de estado muestra un enlace "Depuración" solo para `editor_datos` y `admin`.
- `RutaProtegida` se endurece: `/beneficiarios*` y `/sync` pasan a `roles={['capturista','admin']}`; `/auditoria*` sigue en `['auditor','admin']`; `/depuracion*` en `['editor_datos','admin']`. Cualquier rol fuera de la lista ve la pantalla "No tienes permiso para ver esta sección."

## 8.9 Estructura de archivos nuevos (delta)

```
db/migrations/007_rol_editor_datos.sql
db/migrations/008_staging.sql
db/seeds/004_tipos_apoyo_apoyo.sql          # 152 conceptos reales (generado, commiteado)
backend/src/rutas/staging.ts
backend/src/db/queries/staging.ts
backend/src/servicios/promocion.ts          # promover staging -> produccion (transaccional)
packages/shared/src/staging.ts              # tipos + Zod de staging compartidos
pwa/src/pantallas/Depuracion.tsx
pwa/src/pantallas/DepuracionDetalle.tsx
pwa/src/pantallas/DepuracionCatalogos.tsx
pwa/src/componentes/BadgeAlerta.tsx
pwa/src/componentes/ComparadorDuplicados.tsx
scripts/extraer-catalogo-apoyo.ts
scripts/mapeos/padron.staging.ejemplo.json
scripts/mapeos/catalogo.staging.ejemplo.json
scripts/datos-ejemplo/padron.staging.ejemplo.csv
scripts/datos-ejemplo/catalogo.staging.ejemplo.csv
scripts/datos-ejemplo/README.md             # documenta los conceptos A y B usados y que todo es sintético
```

Comandos nuevos:

| Acción | Comando |
|---|---|
| Importar padrón a staging | `npm run importar -- --tipo padron --archivo scripts/datos-ejemplo/padron.staging.ejemplo.csv --mapeo scripts/mapeos/padron.staging.ejemplo.json` |
| Importar catálogo a staging | `npm run importar -- --tipo catalogo --archivo scripts/datos-ejemplo/catalogo.staging.ejemplo.csv --mapeo scripts/mapeos/catalogo.staging.ejemplo.json` |
| Regenerar seed de conceptos | `npm run extraer-catalogo -- --archivo "[PROYECTESTRATORG] CATALOGOS.xlsx" --hoja APOYO --salida db/seeds/004_tipos_apoyo_apoyo.sql` |

## 8.10 Assumptions de la extensión

18. **Staging vive en el mismo esquema `public`** de la misma base (no un esquema `staging` aparte) para que las consultas de duplicidad contra producción sean triviales y transaccionales.
19. **Idempotencia del importador** por `(archivo, fila_origen)`, no por hash de contenido: así dos filas idénticas del archivo real siguen visibles como duplicados a revisar en vez de colapsarse silenciosamente.
20. **Los flags se recalculan en cada importación** para las filas pendientes de ese archivo; las filas ya revisadas conservan sus flags históricos.
21. **La promoción usa UPSERT por `folio`** (misma clave que el build 1). Si la fila aprobada no trae folio, se genera `IMP-<staging_id>`.
22. **`beneficiarios` no gana columnas nuevas**: `lat_proyecto`/`lng_proyecto` del staging se promueven dentro de `beneficiarios.datos_extra` como `{"lat_proyecto":..., "lng_proyecto":...}`.
23. **Fusionar solo aplica a `staging_beneficiarios`** (D5); en catálogos se resuelve con aprobar + descartar.
24. **La fusión no borra filas**: las secundarias quedan con `estado_revision='fusionado'` y `fusionado_en_id`, preservando la trazabilidad completa hacia el archivo de origen.
25. **`editor_datos` sin regional** (`regional_id NULL`) es lo normal: es un perfil de gabinete central. Si se le asigna regional, ve solo esa.
26. **Las pantallas de depuración son online-only** y no se registran en el service worker para datos (sí en el app-shell); no hay depuración offline.
27. **Los 152 conceptos de la hoja `APOYO` no son PII** (son nombres de conceptos de apoyo), por eso el seed generado sí se commitea; los archivos xlsx de origen no.
28. **El Evaluator no necesita los archivos reales**: todo el rubric 61–110 se verifica con los fixtures sintéticos y el seed commiteado.
29. **No se migra el histórico**: las filas ya presentes en `beneficiarios` por el build 1 se quedan; el staging solo aplica a importaciones nuevas.
30. **La hoja `Copia de APOYO` se ignora por completo** y se documenta el motivo en `db/seeds/004_tipos_apoyo_apoyo.sql` y en el README.

---

## 8.11 Rubric extendido (criterios 61–110)

Continúa la numeración del rubric original. Base: `API`, `APP` como en §7. Tokens: `T_ADMIN`, `T_CAP` (capturista1), `T_AUD` (auditor1), `T_EDIT` (editor1).

### Base de datos y migraciones (61–68)

61. Existen `db/migrations/007_*.sql` y `db/migrations/008_*.sql`, y `information_schema.tables` contiene `staging_beneficiarios` y `staging_catalogos`.
62. `staging_beneficiarios` contiene **todas** estas columnas: `folio_duplicado`, `curp_duplicada_mismo_concepto`, `curp_duplicada_concepto_distinto`, `sin_coordenadas`, `sin_colonia`, `concepto_no_reconocido`, `estado_revision`, `revisado_por`, `revisado_en`, `datos_extra` (verificable en `information_schema.columns`); los 6 primeros son `boolean` y `datos_extra` es `jsonb`.
63. El CHECK de `staging_beneficiarios.estado_revision` acepta exactamente `pendiente,aprobado,descartado,fusionado` y el default de la columna es `pendiente` (verificable en `information_schema.columns.column_default` + `pg_constraint`).
64. `INSERT INTO usuarios (...) VALUES (..., 'editor_datos', ...)` no viola el CHECK (o `pg_get_constraintdef` de `usuarios_rol_check` contiene `editor_datos`).
65. Las tablas `beneficiarios`, `capturas`, `usuarios` y `auditoria_log` conservan todas las columnas listadas en §4 (ninguna eliminada ni renombrada).
66. `SELECT count(*) FROM tipos_apoyo WHERE clave LIKE 'AP-%'` devuelve exactamente **152**, y `db/seeds/004_tipos_apoyo_apoyo.sql` existe y menciona la hoja `APOYO`.
67. `SELECT nombre FROM direcciones_regionales ORDER BY clave` devuelve exactamente 4 filas: `Cadereyta`, `Jalpan`, `Querétaro`, `San Juan del Río`.
68. `POST /api/auth/login` con el usuario demo `editor1` devuelve 200 y `usuario.rol === 'editor_datos'`.

### Importador a staging (69–80)

69. `npm run importar -- --help` sale con código 0 y sigue mostrando `--tipo`, `--archivo`, `--mapeo`, `--dry-run` (compatibilidad con el build 1).
70. Importar `padron.staging.ejemplo.csv` con su mapeo sale con código 0; después `SELECT count(*) FROM staging_beneficiarios` = **12** y el `count(*)` de `beneficiarios` **no cambió**.
71. `SELECT count(*) FROM staging_beneficiarios WHERE folio_duplicado` = **2**.
72. `SELECT count(*) FROM staging_beneficiarios WHERE curp_duplicada_mismo_concepto` = **2**.
73. `SELECT count(*) FROM staging_beneficiarios WHERE curp_duplicada_concepto_distinto` = **2**.
74. `SELECT count(*) FROM staging_beneficiarios WHERE sin_colonia` = **2** y `... WHERE sin_coordenadas` = **2**.
75. `SELECT count(*) FROM staging_beneficiarios WHERE concepto_no_reconocido` = **1**.
76. `SELECT count(*) FROM staging_beneficiarios WHERE nivel_alerta='ninguna'` = **2**.
77. Tras la importación, `SELECT count(*) FROM staging_beneficiarios WHERE estado_revision='pendiente'` = **12** y `... WHERE estado_revision <> 'pendiente'` = **0** (el importador no auto-aprueba, no auto-descarta y no auto-fusiona).
78. Reejecutar exactamente la misma importación sale 0 y `count(*)` de `staging_beneficiarios` sigue siendo **12** (idempotencia por `archivo, fila_origen`).
79. `npm run importar -- ... --dry-run` sobre un archivo nuevo sale 0 y no cambia el `count(*)` de `staging_beneficiarios`.
80. Una columna del CSV no declarada en el mapeo aparece dentro de `staging_beneficiarios.datos_extra`, y `auditoria_log` contiene al menos una entrada con `accion='staging_import'`.

### API de staging — acceso (81–86)

81. `GET $API/api/staging/beneficiarios` sin header `Authorization` devuelve **401**.
82. `GET $API/api/staging/beneficiarios` con `T_CAP` devuelve **403**.
83. `GET $API/api/staging/beneficiarios` con `T_AUD` devuelve **403**.
84. `GET $API/api/staging/beneficiarios` con `T_EDIT` devuelve **200** con `data` array y campos `page`, `total`, `has_more`.
85. `GET $API/api/staging/beneficiarios` con `T_ADMIN` devuelve **200**.
86. `GET $API/api/beneficiarios` y `GET $API/api/auditoria/capturas` con `T_EDIT` devuelven **403** en ambos casos (el editor de datos no accede a campo ni a auditoría).

### API de staging — consulta (87–90)

87. `GET /api/staging/beneficiarios?alerta=folio_duplicado` con `T_EDIT` devuelve 200 con `total=2` y todos los elementos con `folio_duplicado:true`.
88. `GET /api/staging/beneficiarios?alerta=curp_duplicada_concepto_distinto` devuelve `total=2` y todos con `curp_duplicada_concepto_distinto:true`.
89. `GET /api/staging/beneficiarios/:id` de una de las filas con folio duplicado devuelve 200 y `relacionadas.staging` con ≥1 elemento cuyo `folio` es idéntico al de la fila consultada y cuyo `motivo_relacion` es `folio`.
90. `GET /api/staging/resumen` con `T_EDIT` devuelve 200 con `beneficiarios.por_estado.pendiente` = 12 y las 6 llaves de `por_alerta` presentes.

### API de staging — acciones (91–99)

91. `POST /api/staging/beneficiarios/<id_limpia>/aprobar` con `T_EDIT` devuelve 200 con `beneficiario_id`; en BD esa fila queda `estado_revision='aprobado'` con `revisado_por` y `revisado_en` no nulos, y `count(*)` de `beneficiarios` aumentó exactamente en 1.
92. Repetir el mismo `aprobar` sobre la misma fila devuelve **409** y `count(*)` de `beneficiarios` **no** vuelve a aumentar.
93. `POST /api/staging/beneficiarios/<otro_id>/descartar` devuelve 200; la fila queda `estado_revision='descartado'` y `count(*)` de `beneficiarios` no cambia.
94. `POST /api/staging/beneficiarios/fusionar` con `{principal_id, secundarios_ids:[id2], promover:false}` sobre las dos filas de folio duplicado devuelve 200; en BD `id2` queda `estado_revision='fusionado'` con `fusionado_en_id = principal_id`, la principal sigue `pendiente` y `count(*)` de `beneficiarios` no cambia.
95. `POST /api/staging/beneficiarios/fusionar` con `{principal_id, secundarios_ids:[principal_id]}` devuelve **422**; con un `secundarios_ids` inexistente devuelve **422** o **404**.
96. `POST /api/staging/beneficiarios/<id>/aprobar` con `T_AUD` devuelve **403**, y con `T_CAP` devuelve **403**.
97. `GET /api/auditoria/log` con `T_ADMIN` contiene entradas con `accion='staging_aprobado'`, `accion='staging_descartado'` y `accion='staging_fusionado'`.
98. Importar `catalogo.staging.ejemplo.csv` deja filas en `staging_catalogos` sin aumentar el `count(*)` de `catalogos`; `GET /api/staging/catalogos?alerta=clave_duplicada` con `T_EDIT` devuelve 200 con `total=2`.
99. `POST /api/staging/catalogos/<id>/aprobar` con `T_EDIT` devuelve 200 y `count(*)` de `catalogos` aumenta en 1; `POST /api/staging/catalogos/<otro_id>/descartar` devuelve 200 sin aumentar `catalogos`.

### PWA — pantallas de depuración (100–108)

100. Playwright: login con `editor1` navega fuera de `/login` y la URL resultante es `/depuracion`.
101. Playwright: `/depuracion` muestra `[data-testid="tabla-staging"]` con ≥10 filas `[data-testid="fila-staging"]` y al menos un `[data-testid="badge-alerta"]` visible con texto en español.
102. Playwright: en `/depuracion`, seleccionar "Folio duplicado" en `[data-testid="select-alerta"]` deja exactamente 2 filas en la tabla; seleccionar una alerta sin coincidencias muestra "Sin resultados".
103. Playwright: `/depuracion` muestra tarjetas de resumen con los conteos de Pendientes / Aprobados / Descartados / Fusionados.
104. Playwright: en el detalle de una fila con duplicado, existe `[data-testid="comparador"]` con ≥2 tarjetas de candidato mostrando sus campos, y son visibles los botones "Aprobar", "Descartar" y "Fusionar".
105. Playwright: pulsar "Aprobar" y confirmar cambia el estado mostrado de la fila a "Aprobado" y aparece un mensaje de éxito en español; al recargar `/depuracion` con filtro Estado=Pendiente esa fila ya no aparece.
106. Playwright: pulsar "Descartar" en otra fila deja su estado en "Descartado" tras recargar.
107. Playwright: seleccionar una candidata con `[data-testid="chk-candidata"]` y confirmar "Fusionar" deja la candidata en estado "Fusionada" al filtrar por Estado=Fusionado.
108. Playwright: `capturista1` en `/depuracion` ve "No tienes permiso para ver esta sección." (no la tabla); `editor1` en `/beneficiarios` y en `/auditoria` también ve "No tienes permiso"; `admin` puede abrir `/depuracion`, `/beneficiarios` y `/auditoria` sin ver esa pantalla.

### Documentación y protección de datos (109–110)

109. `git ls-files` no lista ningún archivo `.xlsx`, `scripts/datos-ejemplo/` no contiene archivos `.xlsx`, y `.gitignore` incluye un patrón que cubre `*.xlsx` o los dos archivos `[PROYECTESTRATORG] *.xlsx`.
110. `README.md` documenta en una sección propia: el rol `editor_datos` y el usuario demo `editor1`, que el importador ahora escribe en `staging_beneficiarios`/`staging_catalogos` y **nunca** directo a producción, los 6 flags de diagnóstico, las acciones aprobar/descartar/fusionar, y la regla de negocio de que un beneficiario puede recibir apoyos distintos (por eso ningún duplicado se auto-descarta).

**Definición de "terminado" (build 2):** los 110 criterios pasan (60 del build original + 50 de esta extensión).

---
---

# 9. EXTENSIÓN — Edición correctiva en producción + Dashboard de estadísticas (build 3)

> Esta sección **se agrega**; nada de las secciones 1–8 se renegocia ni se reescribe. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios, mismo backend y misma PWA. **No se crea ningún servicio nuevo.** Toda regla de las secciones anteriores sigue vigente salvo las dos excepciones explícitas y acotadas que se declaran en 9.3.1.

## 9.1 Objetivo de la extensión

Dos capacidades independientes:

1. **Edición correctiva**: permitir que un `editor_datos` (o `admin`) corrija **datos de contacto y ubicación** de un beneficiario que **ya está en producción** (tabla `beneficiarios`), cuando en campo o gabinete se detecta un dato desactualizado o mal capturado, dejando traza completa del valor anterior y el nuevo en `auditoria_log`.
2. **Dashboard de estadísticas**: una pantalla de gestión (`/dashboard`) con 4 métricas agregadas —cobertura de captura, distribución por tipo de apoyo, avance en el tiempo y estado del staging— renderizadas con Chart.js.

## 9.2 Decisiones de producto (ya acordadas con el usuario — implementar tal cual)

- **D7. Lista blanca de campos editables** en producción: `colonia`, `domicilio`, `telefono`, `seccion`, `municipio_id`. Ningún otro campo es editable por esta vía.
- **D8. `curp` y `folio` están BLOQUEADOS permanentemente.** Son la identidad legal del expediente; cambiarlos rompe la trazabilidad de auditoría. Si están mal, el caso se resuelve corrigiendo el padrón de origen y reimportando vía staging (§8), **nunca** editando en caliente. El backend **rechaza** la petición si el payload los incluye, aunque el valor enviado sea idéntico al actual.
- **D9. Roles con permiso de edición**: `editor_datos` y `admin`. `capturista` y `auditor` **no** pueden editar (403); el capturista conserva solo lectura de la ficha + su botón "Capturar apoyo".
- **D10. Toda edición se registra en `auditoria_log`** con `accion='beneficiario_editado'` y el detalle campo por campo (`{campo, anterior, nuevo}`), reutilizando el patrón de bitácora del build 1.
- **D11. NO se agrega alta manual de beneficiarios.** Todo beneficiario debe originarse por importación de padrón oficial vía staging. No existe `POST /api/beneficiarios`, ni `DELETE /api/beneficiarios/:id`, ni botón "Nuevo beneficiario" en la PWA. Descartado explícitamente por el usuario.
- **D12. Acceso al dashboard**: `admin`, `auditor` y `editor_datos`. El `capturista` **no** lo ve (es información agregada de gestión, no de campo).
- **D13. Librería de gráficas aprobada: Chart.js** (MIT, sin costo, sin servicios externos), **única dependencia nueva** de la PWA en este build, exclusivamente para las gráficas del dashboard.
- **D14. Los endpoints de estadísticas son de solo lectura** y se resuelven con agregaciones SQL (`COUNT`, `GROUP BY`) sobre `beneficiarios`, `capturas` y `staging_beneficiarios`/`staging_catalogos`. **No se crean tablas de métricas precalculadas** (ver Assumption 38).

## 9.3 Modelo de datos

**No hay tablas nuevas ni columnas nuevas.** `beneficiarios`, `capturas`, `usuarios`, `auditoria_log`, `catalogos`, `tipos_apoyo`, `municipios`, `direcciones_regionales`, `importaciones`, `staging_beneficiarios` y `staging_catalogos` conservan exactamente el esquema de §4 y §8.4.

Única migración de este build, **puramente aditiva de índices** (no toca columnas):

`db/migrations/009_indices_estadisticas.sql`
```sql
-- Índices de apoyo para las agregaciones del dashboard (no cambian el esquema lógico).
CREATE INDEX IF NOT EXISTS idx_capturas_tipo_apoyo ON capturas (tipo_apoyo_id);
CREATE INDEX IF NOT EXISTS idx_benef_tipo_apoyo    ON beneficiarios (tipo_apoyo_id);
```

Valores nuevos admitidos en `auditoria_log.accion` (la columna es TEXT libre, no cambia el esquema): **`beneficiario_editado`**. Con `entidad='beneficiario'`, `entidad_id=<id>` y:

```json
{
  "cambios": [
    {"campo":"colonia","anterior":"El Cerrito","nuevo":"Barrio de la Cruz"},
    {"campo":"telefono","anterior":null,"nuevo":"4421234567"}
  ],
  "motivo": "Actualizado en visita de campo",
  "rol": "editor_datos"
}
```

## 9.3.1 Excepciones acotadas a reglas previas (declaradas, no contradicciones)

La regla de §8.6 "las rutas existentes `/api/beneficiarios` … rechazan con 403 al rol `editor_datos`" **se mantiene íntegra para la colección `GET /api/beneficiarios`** (criterio 86 sigue pasando). Este build añade dos excepciones puntuales y solo esas:

1. **`PATCH /api/beneficiarios/:id`** (ruta nueva) admite `editor_datos` y `admin`; rechaza con 403 a `capturista` y `auditor`.
2. Para que el editor pueda **buscar y ver** la ficha que va a corregir sin debilitar la regla anterior, la lectura vive en un espacio propio: **`/api/correcciones/*`** (roles `editor_datos`, `admin`).

En la PWA, la regla de §8.8.4 (`/beneficiarios*` protegido a `['capturista','admin']`) **no cambia**: el editor accede a la ficha por la ruta nueva `/correcciones/beneficiarios/:id`, que monta **el mismo componente** `FichaBeneficiario.tsx` en modo online.

## 9.4 Contrato del endpoint de edición correctiva

### E26 — `PATCH /api/beneficiarios/:id`

- **Auth**: `Authorization: Bearer <jwt>` obligatorio. Roles permitidos: `editor_datos`, `admin`. Sin token → **401**. `capturista` o `auditor` → **403** `{"error":{"codigo":"rol_no_autorizado","mensaje":"Tu rol no puede editar datos de beneficiarios."}}`.
- **Content-Type**: `application/json`.
- **Body** (todas las claves de datos son opcionales; se envía solo lo que cambia):

```jsonc
{
  "colonia": "Barrio de la Cruz",   // string | null, máx. 120
  "domicilio": "Calle Hidalgo 45",  // string | null, máx. 200
  "telefono": "4421234567",         // string | null, 10 dígitos tras normalizar
  "seccion": "0345",                // string | null, máx. 20
  "municipio_id": 12,               // number (BIGINT existente y activo)
  "motivo": "Corregido en visita"   // metadato opcional, máx. 500 — NO es un campo de datos
}
```

- **Lista blanca estricta** (`packages/shared/src/correcciones.ts`, Zod `.strict()`): solo `colonia`, `domicilio`, `telefono`, `seccion`, `municipio_id` y el metadato `motivo`. **Cualquier otra clave** en el payload (`curp`, `folio`, `nombre_completo`, `regional_id`, `tipo_apoyo_id`, `cantidad_asignada`, `datos_extra`, `localidad`, `id`, `creado_en`, …) provoca **422** y **ninguna** escritura (rechazo atómico, no se aplica el resto del payload):

```json
{"error":{"codigo":"campo_no_editable","mensaje":"Los campos curp, folio no son editables. CURP y Folio son la identidad legal del expediente; corrígelos en el padrón de origen y reimporta vía staging."}}
```

- **Validaciones de valor** (todas responden **422** con `codigo` propio y sin escribir nada):

| Caso | `codigo` | Mensaje |
|---|---|---|
| Body sin ninguna clave de datos (`{}` o solo `motivo`) | `sin_cambios` | "No se envió ningún campo editable." |
| `telefono` que tras quitar espacios, `-`, `(`, `)` y `+52` no queda en exactamente 10 dígitos | `telefono_invalido` | "El teléfono debe tener 10 dígitos." |
| `colonia`/`domicilio`/`seccion` que exceden su longitud máxima | `longitud_excedida` | "El campo <x> excede la longitud máxima." |
| `municipio_id` inexistente o `activo=false` | `municipio_invalido` | "El municipio seleccionado no existe o está inactivo." |
| `municipio_id` no numérico | `payload_invalido` | "Datos inválidos." |

- **Normalización aplicada antes de guardar**: `trim` en todos los textos; cadena vacía `""` se guarda como `NULL` (permite limpiar un dato); `telefono` se guarda **solo con los 10 dígitos**.
- **Regla derivada de Regional**: si cambia `municipio_id`, el backend **actualiza también `beneficiarios.regional_id`** al `regional_id` de ese municipio (dato derivado, no aceptado en el payload). Ese cambio derivado aparece también en la lista de `cambios` del log como `campo:"regional_id"`.
- **Aislamiento por Regional**: un `editor_datos` con `regional_id` no nulo solo puede editar beneficiarios de su Regional (si no, **403** `regional_no_permitida`) y no puede mover un beneficiario a un municipio de otra Regional (**403** `regional_no_permitida`). `admin` y `editor_datos` sin regional no tienen esa restricción.
- **404** si el `id` no existe.
- **Éxito — 200**:

```json
{
  "ok": true,
  "beneficiario": {
    "id": 42, "folio": "STG-001", "curp": "XXXX000000HQTXXX0N",
    "nombre_completo": "PRUEBA A", "regional_id": 1, "regional": "Cadereyta",
    "municipio_id": 12, "municipio": "Cadereyta de Montes",
    "colonia": "Barrio de la Cruz", "seccion": "0345",
    "domicilio": "Calle Hidalgo 45", "telefono": "4421234567",
    "actualizado_en": "2026-08-08T18:04:11.000Z"
  },
  "cambios": [
    {"campo":"colonia","anterior":"El Cerrito","nuevo":"Barrio de la Cruz"}
  ]
}
```

- **No-op**: si todos los valores enviados son idénticos a los actuales, responde **200** con `"cambios": []`, no toca `actualizado_en` y **no** escribe en `auditoria_log`.
- **Transaccionalidad**: `UPDATE` + `INSERT` en `auditoria_log` en una sola transacción. `actualizado_en = now()`.
- **Concurrencia**: último en escribir gana; no hay control optimista (ver Assumption 34).
- Implementación: `backend/src/rutas/beneficiarios.ts` (handler `PATCH`) + `backend/src/servicios/correcciones.ts` (validación de lista blanca, diff y bitácora).

### Endpoints de lectura para corrección (roles `editor_datos`, `admin`)

| # | Método | Ruta | Descripción / Respuesta |
|---|---|---|---|
| E27 | GET | `/api/correcciones/beneficiarios` | query `q` (folio, CURP o nombre; ≥2 caracteres), `municipio_id`, `regional_id` (solo admin), `page` (1), `page_size` (≤100, default 25) → `200 {data:[{id,folio,curp,nombre_completo,regional,municipio_id,municipio,colonia,seccion,domicilio,telefono,capturas:<count>}], page, page_size, total, has_more}`. Sin token 401; `capturista`/`auditor` 403. Aplica aislamiento por Regional igual que E26. |
| E28 | GET | `/api/correcciones/beneficiarios/:id` | `200` con el beneficiario completo (incluye `curp` y `folio`, en modo lectura) + `municipios_disponibles:[{id,nombre,regional_id}]` para poblar el select. `404` si no existe; `403` fuera de su Regional. |
| E29 | GET | `/api/correcciones/beneficiarios/:id/historial` | `200 {data:[{fecha, usuario, rol, motivo, cambios:[{campo,anterior,nuevo}]}]}` leyendo `auditoria_log` filtrado por `accion='beneficiario_editado' AND entidad='beneficiario' AND entidad_id=:id`, orden descendente, máx. 50. Array vacío si nunca se editó. |

## 9.5 Endpoints de estadísticas (solo lectura)

Todos bajo `/api/estadisticas`, en `backend/src/rutas/estadisticas.ts` con SQL en `backend/src/db/queries/estadisticas.ts`.

- **Roles permitidos**: `admin`, `auditor`, `editor_datos`. Sin token → **401**. `capturista` → **403** `{"error":{"codigo":"rol_no_autorizado","mensaje":"No tienes permiso para ver las estadísticas."}}`.
- **Aislamiento por Regional**: si el usuario (`auditor` o `editor_datos`) tiene `regional_id` no nulo, todas las agregaciones se restringen a esa Regional y el parámetro `regional_id` de query se ignora. `admin` y usuarios sin regional ven todo y pueden filtrar con `regional_id`.
- **Filtros comunes opcionales**: `regional_id`, `municipio_id`, `desde` (`YYYY-MM-DD`), `hasta` (`YYYY-MM-DD`). `desde`/`hasta` aplican sobre `capturas.capturado_en`; nunca excluyen beneficiarios del denominador de cobertura (ver Assumption 36). Fecha con formato inválido → **422** `parametro_invalido`.
- **Zona horaria**: el bucketing por día/semana usa `capturado_en AT TIME ZONE 'America/Mexico_City'`.

| # | Método | Ruta | Respuesta |
|---|---|---|---|
| E30 | GET | `/api/estadisticas/cobertura` | `200 {global:{total_beneficiarios,con_captura,sin_captura,porcentaje}, por_regional:[{regional_id,regional,total_beneficiarios,con_captura,sin_captura,porcentaje}], por_municipio:[{municipio_id,municipio,regional,total_beneficiarios,con_captura,sin_captura,porcentaje}]}`. `porcentaje` = `con_captura/total*100` redondeado a 1 decimal (0 si `total=0`). `con_captura` = beneficiarios con ≥1 fila en `capturas`. `por_regional` ordenado por `regional`; `por_municipio` por `porcentaje` ascendente (los más rezagados primero). |
| E31 | GET | `/api/estadisticas/apoyos` | query `limite` (default 15, máx. 50), `agrupar` (`concepto` default). `200 {total_capturas, total_beneficiarios, data:[{tipo_apoyo_id,clave,nombre,capturas,beneficiarios}], otros:{conceptos,capturas,beneficiarios}|null}`. `data` = top `limite` conceptos ordenados por `capturas` desc (desempate por `nombre`); el resto se agrega en `otros` (etiqueta de UI: "Otros (N conceptos)"). Si hay ≤ `limite` conceptos con datos, `otros` es `null`. Las capturas sin `tipo_apoyo_id` se agrupan bajo `{tipo_apoyo_id:null, nombre:"Sin concepto"}`. |
| E32 | GET | `/api/estadisticas/avance` | query `agrupacion` (`dia`\|`semana`, default `dia`), `desde`, `hasta`. Defaults: `dia` → últimos 30 días; `semana` → últimas 12 semanas (lunes como inicio, `date_trunc('week',…)`). `200 {agrupacion, desde, hasta, total_capturas, data:[{periodo:"YYYY-MM-DD", capturas, beneficiarios, acumulado}]}`. **Zero-fill obligatorio**: todo periodo del rango aparece aunque valga 0; `periodo` ascendente; `acumulado` = suma corrida (nunca decrece). `agrupacion` distinta de `dia`/`semana` → **422** `parametro_invalido`. |
| E33 | GET | `/api/estadisticas/staging` | `200 {beneficiarios:{pendiente,aprobado,descartado,fusionado,total}, catalogos:{pendiente,aprobado,descartado,fusionado,total}}` sobre `staging_beneficiarios` / `staging_catalogos` (`GROUP BY estado_revision`, las 4 llaves siempre presentes aunque valgan 0). Reutiliza las queries de §8.6/E16; no duplica lógica. |

## 9.6 Pantallas de la PWA

### 9.6.1 Ficha de beneficiario con modo edición (`FichaBeneficiario.tsx`, reutilizada)

El mismo componente se monta en dos rutas:

| Ruta | Roles (`RutaProtegida`) | Fuente de datos | Botón "Capturar apoyo" | Panel de edición |
|---|---|---|---|---|
| `/beneficiarios/:id` (existente) | `['capturista','admin']` | IndexedDB (offline-first, sin cambios) | Sí | Solo si `rol ∈ {editor_datos, admin}` ⇒ en la práctica, solo `admin` |
| `/correcciones/beneficiarios/:id` (nueva) | `['editor_datos','admin']` | API (E28), online-only | No | Sí |

- El botón `data-testid="btn-editar-datos"` con texto **"Editar datos de contacto/ubicación"** se renderiza **solo** si `rol ∈ {editor_datos, admin}`. Un `capturista` **nunca** lo ve (ni deshabilitado: no se renderiza).
- Al pulsarlo aparece `data-testid="form-edicion"` con:
  - `input-colonia` (texto, máx. 120), `input-domicilio` (texto, máx. 200), `input-telefono` (`inputMode="tel"`, máx. 20), `input-seccion` (texto, máx. 20), `select-municipio` (opciones de `municipios_disponibles`, muestra "Municipio — Regional").
  - Bloque **"Campos no editables"** con `input-curp` e `input-folio` renderizados con `readonly` **y** `disabled`, más la leyenda fija: *"CURP y Folio no son editables: son la identidad legal del expediente. Si están mal, corrige el padrón de origen y reimporta desde Depuración."*
  - Campo opcional `input-motivo` ("Motivo del cambio (opcional)", máx. 500).
  - Botones `btn-guardar-edicion` ("Guardar cambios") y `btn-cancelar-edicion` ("Cancelar").
- **Validación en cliente antes de enviar** (mensajes en español bajo el campo, `data-testid="error-telefono"` etc.): teléfono de 10 dígitos, longitudes máximas. Si falla, **no** se llama a la API.
- Al guardar: `PATCH /api/beneficiarios/:id` con **solo** los campos modificados. Éxito → toast `data-testid="toast-exito"` "Datos actualizados." + cierre del formulario + refresco de la ficha. Si el beneficiario existe en IndexedDB local (caso `admin`), se actualiza también el registro local para no dejar la caché desfasada.
- Errores del backend: se muestra `error.mensaje` tal cual en `data-testid="error-edicion"` (422/403), y "El beneficiario ya no existe." en 404.
- Bloque **"Historial de correcciones"** (`data-testid="historial-correcciones"`), alimentado por E29: fecha, usuario y lista "campo: anterior → nuevo". Si no hay ediciones: "Sin correcciones registradas."
- **Sin conexión** en `/correcciones/*`: "Esta sección requiere conexión a internet."

### 9.6.2 `/correcciones` — Buscador de beneficiarios a corregir (`Correcciones.tsx`)

- Roles `['editor_datos','admin']`. Encabezado "Corrección de datos — Beneficiarios en producción".
- Aviso permanente: *"Aquí se corrigen datos de contacto y ubicación de beneficiarios ya promovidos. CURP y Folio no se editan. Para altas de beneficiarios usa la importación de padrón (Depuración)."*
- `input-busqueda-correcciones` (folio, CURP o nombre, mínimo 2 caracteres, debounce 300 ms) → E27.
- Tabla `data-testid="tabla-correcciones"` con filas `data-testid="fila-correccion"`: Folio, CURP, Nombre, Regional, Municipio, Colonia, Teléfono, acción "Corregir" → `/correcciones/beneficiarios/:id`.
- Vacío: "Sin resultados". **No existe** ningún botón de alta ("Nuevo beneficiario") en esta ni en ninguna otra pantalla (D11).

### 9.6.3 `/dashboard` — Dashboard de revisión y estadísticas (`Dashboard.tsx`)

- Roles `['admin','auditor','editor_datos']` (D12). Online-only. Encabezado "Dashboard de seguimiento".
- **Filtros globales** (afectan a las 3 primeras métricas): `select-regional-dashboard` (todas las Regionales; fijo y deshabilitado si el usuario tiene Regional asignada), `input-desde`, `input-hasta`, y `select-agrupacion` (Día / Semana, solo afecta a la gráfica de avance). Botón "Aplicar filtros". Los datos se recargan sin recargar la página.
- **Métrica 1 — Cobertura de captura** (E30):
  - 4 tarjetas: `tarjeta-total-beneficiarios` ("Beneficiarios"), `tarjeta-con-captura` ("Con evidencia"), `tarjeta-sin-captura` ("Pendientes"), `tarjeta-porcentaje` ("% de cobertura", formato `NN.N %`).
  - Gráfica `canvas[data-testid="grafica-cobertura"]`: **barras horizontales apiladas por Regional** (serie "Con evidencia" verde + serie "Pendientes" gris), `indexAxis:'y'`, `stacked:true`.
  - Tabla `data-testid="tabla-cobertura-municipio"` con filas `data-testid="fila-cobertura"`: Municipio, Regional, Beneficiarios, Con evidencia, Pendientes, % (ordenada por % ascendente).
- **Métrica 2 — Distribución por tipo de apoyo** (E31):
  - Gráfica `canvas[data-testid="grafica-apoyos"]`: **barras horizontales**, top 15 conceptos + barra final "Otros (N conceptos)". Etiquetas recortadas a 40 caracteres con tooltip completo.
  - Texto `data-testid="resumen-apoyos"`: "Mostrando los 15 conceptos con más capturas de un total de N."
- **Métrica 3 — Avance en el tiempo** (E32):
  - Gráfica `canvas[data-testid="grafica-avance"]`: **línea** con dos datasets — "Capturas por periodo" (línea sólida) y "Acumulado" (línea punteada, eje Y secundario). Eje X con las etiquetas de `periodo` formateadas `DD/MM` (día) o `Sem. DD/MM` (semana).
  - Texto `data-testid="resumen-avance"`: "N periodos · M capturas".
  - Si `total_capturas === 0`: mensaje "Sin datos para el filtro seleccionado." en lugar de la gráfica.
- **Métrica 4 — Estado del staging** (E33):
  - Gráfica `canvas[data-testid="grafica-staging"]`: **dona (doughnut)** con 4 segmentos —Pendientes, Aprobadas, Descartadas, Fusionadas— del staging de padrón, colores fijos (ámbar/verde/gris/azul) y leyenda en español.
  - Tarjetas `tarjeta-staging-pendiente`, `tarjeta-staging-aprobado`, `tarjeta-staging-descartado`, `tarjeta-staging-fusionado` + línea "Catálogos: P pendientes / A aprobados".
  - Enlace "Ir a Depuración" → `/depuracion`, visible solo para `editor_datos` y `admin`.
- **Estados de carga/error**: skeleton "Cargando estadísticas…" por bloque; si un endpoint falla, ese bloque muestra "No se pudieron cargar los datos." sin tumbar el resto del dashboard.

### 9.6.4 Integración de Chart.js

- Dependencia única nueva en `pwa/package.json`: **`chart.js` ^4.4**. **No** se agrega `react-chartjs-2` ni ninguna otra librería de gráficas, ni scripts por CDN (todo se sirve desde el bundle, sin llamadas externas).
- Wrapper propio `pwa/src/componentes/Grafica.tsx`: componente React con `useRef` sobre un `<canvas>` + `useEffect` que crea la instancia `new Chart(ctx, config)`, la destruye en el cleanup y la recrea al cambiar `datos`/`opciones`. Props: `tipo` (`'bar'|'line'|'doughnut'`), `datos`, `opciones`, `testId`, `altura`.
- Registro selectivo en `pwa/src/componentes/chartSetup.ts`: `Chart.register(BarController, BarElement, LineController, LineElement, PointElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Title)`. `responsive:true`, `maintainAspectRatio:false`.
- Todas las etiquetas, leyendas y tooltips **en español**.

### 9.6.5 Navegación y control de acceso (delta sobre §8.8.4)

- `RutaProtegida` gana dos entradas: `/dashboard` → `['admin','auditor','editor_datos']`; `/correcciones*` → `['editor_datos','admin']`. Todo lo demás de §8.8.4 **se mantiene idéntico**.
- La barra de estado muestra el enlace **"Dashboard"** (`data-testid="nav-dashboard"`) solo para `admin`, `auditor` y `editor_datos`, y el enlace **"Correcciones"** (`data-testid="nav-correcciones"`) solo para `editor_datos` y `admin`. El `capturista` no ve ninguno de los dos.
- Los redirects de login **no cambian** (`capturista` → `/sync`|`/beneficiarios`, `auditor` → `/auditoria`, `editor_datos` → `/depuracion`, `admin` → `/beneficiarios`).
- Un rol no autorizado que navegue directo a `/dashboard` o `/correcciones` ve "No tienes permiso para ver esta sección."

## 9.7 Estructura de archivos nuevos (delta build 3)

```
db/migrations/009_indices_estadisticas.sql
backend/src/rutas/estadisticas.ts
backend/src/rutas/correcciones.ts              # E27, E28, E29
backend/src/db/queries/estadisticas.ts
backend/src/servicios/correcciones.ts          # lista blanca, diff, bitácora (transaccional)
packages/shared/src/correcciones.ts            # Zod .strict() de la lista blanca + tipos de estadísticas
pwa/src/pantallas/Dashboard.tsx
pwa/src/pantallas/Correcciones.tsx
pwa/src/componentes/Grafica.tsx                # wrapper Chart.js
pwa/src/componentes/chartSetup.ts
pwa/src/componentes/FormEdicionBeneficiario.tsx
pwa/src/componentes/TarjetaMetrica.tsx
```

Archivos modificados: `backend/src/rutas/beneficiarios.ts` (handler `PATCH`), `backend/src/server.ts` (registro de rutas), `pwa/src/rutas.tsx`, `pwa/src/componentes/BarraEstado.tsx`, `pwa/src/pantallas/FichaBeneficiario.tsx`, `pwa/src/api/cliente.ts`, `pwa/package.json`, `README.md`.

Sin comandos nuevos de npm: todo corre con `docker compose up --build` y los scripts ya existentes.

## 9.8 Assumptions de la extensión (continúa la numeración)

31. **`localidad` NO es editable** por esta vía: el usuario cerró la lista en Colonia, Domicilio, Teléfono, Sección y Municipio. Se corrige por reimportación como CURP/folio.
32. **Rechazo estricto, no silencioso**: enviar `curp`/`folio` (o cualquier campo fuera de la lista blanca) devuelve 422 y no aplica ningún cambio del payload. Se prefiere el fallo ruidoso al descarte silencioso, porque hace la restricción auditable y comprobable.
33. **`regional_id` es derivado, no editable directamente**: solo cambia como consecuencia de cambiar `municipio_id` (un municipio pertenece a una sola Regional, §4.3/Assumption 7).
34. **Sin bloqueo optimista** (`If-Match`/`version`): el volumen de correcciones es bajo y concurrente-improbable; gana el último y la bitácora conserva la secuencia completa de cambios.
35. **La edición es online-only.** No se encola en la cola de sync ni se permite editar offline: corregir un dato maestro sin red abriría conflictos de mezcla que este proyecto no resuelve.
36. **Denominador de cobertura**: los filtros de fecha aplican a las **capturas**, nunca al padrón. `total_beneficiarios` es el universo del filtro geográfico (Regional/Municipio), de modo que el porcentaje siempre responde "de mi padrón, cuánto llevo capturado (en este periodo)".
37. **"Con evidencia" = ≥1 captura**, coherente con el badge "Capturado" del build 1 (Assumption 9). No se distingue por `estado_sync`.
38. **Sin tablas de métricas precalculadas.** Con el orden de magnitud real (~2 300 beneficiarios, capturas del mismo orden) las agregaciones `GROUP BY` con los índices existentes + los dos de la migración 009 responden en milisegundos. Si en el futuro el padrón superara ~500 000 filas, la decisión a revisar sería una vista materializada refrescada por cron; **no** se implementa ahora.
39. **Agrupación de conceptos**: top 15 + "Otros" es el criterio de legibilidad fijado (152 conceptos no caben en una gráfica). El parámetro `limite` existe para ajustar, con default 15.
40. **Semana = lunes a domingo** (`date_trunc('week')` de Postgres), etiquetada por su fecha de inicio.
41. **El dashboard es online-only** y no se cachea en IndexedDB (solo el app-shell por el service worker).
42. **`auditor` puede ver el bloque de staging del dashboard**: son conteos agregados de gestión, sin PII; no obtiene acceso a las pantallas ni endpoints de `/api/staging/*`, que siguen en 403 para él.
43. **Chart.js es la única dependencia nueva** del build 3 (D13); no se agregan wrappers de React, ni plugins de fecha (las etiquetas de tiempo se formatean en el propio código con `Intl.DateTimeFormat('es-MX')`).
44. **No hay exportación CSV del dashboard** en este build (las exportaciones siguen siendo las del panel de auditoría, §5.7 E11–E13).
45. **La ficha del capturista no cambia en absoluto** salvo por la ausencia del botón de edición: sigue siendo offline-first sobre IndexedDB.

---

## 9.9 Rubric extendido (criterios 111–159)

Continúa la numeración de §7 y §8.11. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_CAP` (capturista1), `T_AUD` (auditor1), `T_EDIT` (editor1). `BID` = id de un beneficiario existente en producción (de la Regional de `editor1` si aplica).

### Base de datos e integridad del esquema (111–113)

111. Existe `db/migrations/009_*.sql` y `pg_indexes` contiene `idx_capturas_tipo_apoyo` e `idx_benef_tipo_apoyo`.
112. `beneficiarios` conserva **exactamente** el conjunto de columnas de §4.6 (ninguna añadida, eliminada ni renombrada), y `capturas`, `usuarios` y `auditoria_log` conservan las suyas de §4.7/§4.1/§4.8.
113. `information_schema.tables` **no** contiene ninguna tabla nueva de métricas precalculadas (no existe tabla cuyo nombre empiece por `estadisticas_`, `metricas_` o `dashboard_`).

### API — PATCH de edición correctiva (114–127)

114. `PATCH $API/api/beneficiarios/$BID` sin header `Authorization` devuelve **401**.
115. `PATCH $API/api/beneficiarios/$BID` con `T_CAP` devuelve **403**, y con `T_AUD` devuelve **403**; en ambos casos la fila en BD queda sin cambios.
116. `PATCH` con `T_EDIT` y body `{"colonia":"Colonia Corregida QA"}` devuelve **200** con `ok:true` y `cambios` conteniendo `{campo:"colonia", anterior:<previo>, nuevo:"Colonia Corregida QA"}`; `SELECT colonia FROM beneficiarios WHERE id=$BID` devuelve el valor nuevo.
117. `PATCH` con `T_ADMIN` y body `{"domicilio":"Calle QA 100","telefono":"(442) 123-4567"}` devuelve **200** y en BD `telefono` queda normalizado a `4421234567`.
118. `PATCH` con `T_EDIT` y body `{"curp":"AAAA000000HQTAAA0N"}` devuelve **422** con `error.codigo === "campo_no_editable"` y mensaje que menciona `curp`; `SELECT curp` en BD **no cambió**.
119. `PATCH` con body `{"folio":"HACK-001"}` devuelve **422** `campo_no_editable`; `SELECT folio` en BD **no cambió**.
120. `PATCH` con body `{"colonia":"Intento Mixto","curp":"AAAA000000HQTAAA0N"}` devuelve **422** y `colonia` en BD **tampoco** cambió (rechazo atómico del payload completo).
121. `PATCH` con `{"nombre_completo":"OTRO"}`, con `{"tipo_apoyo_id":1}` y con `{"regional_id":2}` devuelve **422** en los tres casos y ninguno de esos campos cambia en BD.
122. `PATCH` con `{"telefono":"12"}` devuelve **422** `telefono_invalido` y el teléfono en BD no cambia.
123. `PATCH` con `{"municipio_id":999999}` devuelve **422** `municipio_invalido`.
124. `PATCH` con `T_ADMIN` y `{"municipio_id":<id válido de otra Regional>}` devuelve **200** y en BD `beneficiarios.regional_id` quedó igual al `regional_id` de ese municipio (Regional derivada automáticamente).
125. `PATCH` sobre un `id` inexistente devuelve **404**; `PATCH` con body `{}` devuelve **422** `sin_cambios`.
126. Tras los PATCH anteriores, `GET /api/auditoria/log` con `T_ADMIN` contiene ≥1 entrada con `accion='beneficiario_editado'`, `entidad='beneficiario'`, `entidad_id` = `$BID` y `detalle.cambios` como array de objetos con `campo`, `anterior` y `nuevo`.
127. `POST $API/api/beneficiarios` con `T_ADMIN` devuelve **404** o **405** (no existe alta manual), y `DELETE $API/api/beneficiarios/$BID` con `T_ADMIN` devuelve **404** o **405**.

### API — lectura para corrección (128–131)

128. `GET $API/api/correcciones/beneficiarios?q=<fragmento de un nombre existente>` con `T_EDIT` devuelve **200** con `data` array (≥1 elemento) y campos `page`, `total`, `has_more`; sin token devuelve **401** y con `T_CAP` devuelve **403**.
129. `GET $API/api/correcciones/beneficiarios/$BID` con `T_EDIT` devuelve **200** incluyendo `curp`, `folio`, los 5 campos editables y `municipios_disponibles` como array no vacío.
130. `GET $API/api/correcciones/beneficiarios/$BID/historial` con `T_EDIT` devuelve **200** con `data` conteniendo ≥1 entrada (tras el criterio 116) con `fecha`, `usuario` y `cambios[].campo`.
131. `GET $API/api/beneficiarios` (colección) con `T_EDIT` sigue devolviendo **403** (la excepción del build 3 no debilitó la regla del build 2, criterio 86).

### API — estadísticas (132–141)

132. `GET $API/api/estadisticas/cobertura` sin token devuelve **401**; con `T_CAP` devuelve **403**.
133. `GET $API/api/estadisticas/cobertura` devuelve **200** con `T_AUD`, con `T_ADMIN` y con `T_EDIT`, y el JSON contiene `global` (con `total_beneficiarios`, `con_captura`, `sin_captura`, `porcentaje`), `por_regional` (array) y `por_municipio` (array).
134. En esa respuesta se cumple `global.con_captura + global.sin_captura === global.total_beneficiarios`, y la misma igualdad se cumple en **todos** los elementos de `por_regional`.
135. `global.total_beneficiarios` con `T_ADMIN` (sin filtros) es igual a `SELECT count(*) FROM beneficiarios`.
136. `global.con_captura` con `T_ADMIN` (sin filtros de fecha) es igual a `SELECT count(DISTINCT beneficiario_id) FROM capturas`.
137. `por_regional` con `T_ADMIN` contiene exactamente 4 elementos, con los nombres `Cadereyta`, `Jalpan`, `Querétaro` y `San Juan del Río`.
138. `GET $API/api/estadisticas/apoyos` con `T_AUD` devuelve **200** con `data` de longitud ≤ 15, ordenado de mayor a menor por `capturas`, cada elemento con `nombre`, `capturas` y `beneficiarios`, y la clave `otros` presente (objeto o `null`).
139. En `apoyos`, la suma de `data[].capturas` más `otros.capturas` (0 si `otros` es `null`) es igual a `total_capturas`, y `total_capturas` es igual a `SELECT count(*) FROM capturas`.
140. `GET $API/api/estadisticas/avance?agrupacion=dia&desde=<hoy-6d>&hasta=<hoy>` devuelve **200** con `data.length === 7` (zero-fill), `periodo` en formato `YYYY-MM-DD` y ascendente, `acumulado` no decreciente; `?agrupacion=semana` devuelve 200 con periodos semanales; `?agrupacion=mes` devuelve **422**.
141. `GET $API/api/estadisticas/staging` con `T_EDIT` devuelve **200** con `beneficiarios.pendiente/aprobado/descartado/fusionado/total` y `catalogos.*` presentes, y `beneficiarios.pendiente` coincide con `SELECT count(*) FROM staging_beneficiarios WHERE estado_revision='pendiente'`.

### PWA — dashboard (142–150)

142. `pwa/package.json` lista `chart.js` en `dependencies`; **no** lista `react-chartjs-2`, `recharts`, `apexcharts`, `d3` ni `highcharts`, y `grep` en `pwa/src` + `pwa/index.html` no encuentra ninguna URL de CDN de gráficas.
143. Playwright: con `admin`, existe `[data-testid="nav-dashboard"]` y al pulsarlo la URL es `/dashboard`; con `capturista1` ese enlace **no** existe y navegar directo a `/dashboard` muestra "No tienes permiso para ver esta sección."
144. Playwright: `auditor1` y `editor1` pueden abrir `/dashboard` y ven el encabezado "Dashboard de seguimiento" (no la pantalla de sin permiso).
145. Playwright: `/dashboard` contiene los 4 canvas `[data-testid="grafica-cobertura"]`, `[data-testid="grafica-apoyos"]`, `[data-testid="grafica-avance"]` y `[data-testid="grafica-staging"]`, todos visibles y con `boundingBox().width > 0` (renderizados por Chart.js).
146. Playwright: existen las tarjetas `tarjeta-total-beneficiarios`, `tarjeta-con-captura`, `tarjeta-sin-captura` y `tarjeta-porcentaje`, con contenido numérico (la de porcentaje termina en `%`).
147. Playwright: `[data-testid="tabla-cobertura-municipio"]` existe con ≥1 fila `[data-testid="fila-cobertura"]`, y cada fila muestra Municipio, Beneficiarios, Con evidencia y %.
148. Playwright: cambiar `[data-testid="select-regional-dashboard"]` a una Regional concreta y aplicar filtros modifica los datos mostrados (el valor de `tarjeta-total-beneficiarios` cambia o las filas de `tabla-cobertura-municipio` se reducen) sin recargar la página.
149. Playwright: existe `[data-testid="select-agrupacion"]` con opciones Día y Semana; al cambiar de Día a Semana el texto de `[data-testid="resumen-avance"]` cambia (distinto número de periodos).
150. Playwright: aplicar un rango de fechas imposible (p. ej. `desde=2000-01-01`, `hasta=2000-01-07`) muestra "Sin datos para el filtro seleccionado." en el bloque de avance.

### PWA — edición correctiva (151–157)

151. Playwright: `capturista1` en `/beneficiarios/:id` **no** ve `[data-testid="btn-editar-datos"]` (0 elementos) pero sí ve el botón "Capturar apoyo".
152. Playwright: `editor1` en `/correcciones` busca por nombre, ve `[data-testid="tabla-correcciones"]` con ≥1 `[data-testid="fila-correccion"]`, pulsa "Corregir" y llega a la ficha donde `[data-testid="btn-editar-datos"]` es visible.
153. Playwright: al pulsar "Editar datos de contacto/ubicación" aparece `[data-testid="form-edicion"]` con `input-colonia`, `input-domicilio`, `input-telefono`, `input-seccion` y `select-municipio`; `input-curp` e `input-folio` están **deshabilitados o de solo lectura** y es visible la leyenda que explica que CURP y Folio no son editables.
154. Playwright: cambiar la colonia a un valor nuevo y pulsar "Guardar cambios" muestra un mensaje de éxito en español; tras recargar la ficha se muestra el valor nuevo y `GET /api/correcciones/beneficiarios/:id` lo confirma.
155. Playwright: escribir `12` en el teléfono y guardar muestra un mensaje de error visible en español y el teléfono en BD **no** cambia.
156. Playwright: `admin` en `/beneficiarios/:id` ve `[data-testid="btn-editar-datos"]`, edita el domicilio y el cambio persiste tras recargar.
157. Playwright + `grep`: en toda la PWA no existe ningún control de alta de beneficiarios (no hay elemento con texto "Nuevo beneficiario", "Agregar beneficiario" ni "Alta de beneficiario" en `/beneficiarios`, `/correcciones` ni `/depuracion`, ni aparecen esas cadenas en `pwa/src`).

### Documentación (158–159)

158. `README.md` incluye una sección de corrección de datos en producción que documenta: los 5 campos editables (`colonia`, `domicilio`, `telefono`, `seccion`, `municipio`), que **CURP y Folio nunca son editables** y por qué (identidad legal del expediente; se corrigen reimportando vía staging), los roles `editor_datos`/`admin` como únicos autorizados, y que cada edición queda en `auditoria_log` con valor anterior y nuevo.
159. `README.md` incluye una sección del dashboard que documenta las 4 métricas (cobertura, distribución por tipo de apoyo, avance en el tiempo, estado del staging), los roles con acceso (`admin`, `auditor`, `editor_datos`; el capturista no), que **Chart.js** es la única dependencia nueva y es open source sin servicios externos, y que **no existe alta manual de beneficiarios** (todo entra por importación de padrón).

**Definición de "terminado" (build 3):** los 159 criterios pasan (60 del build original + 50 del staging + 49 de esta extensión).

# 10. EXTENSIÓN — Administración de usuarios reales + cambio de contraseña obligatorio (build 4)

> **CONTINUACIÓN LITERAL DE `SPEC.md`.** Esta sección se **agrega al final** de `SPEC.md` (después de la línea "Definición de terminado (build 3)"). Nada de las secciones 1–9 se renegocia, se reescribe ni se deroga. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios (`db`, `backend`, `pwa`), mismo backend y misma PWA. **No se crea ningún servicio nuevo.** El proyecto ya está desplegado en producción (Hostinger + EasyPanel): toda migración debe ser **aditiva e idempotente** y no debe romper a los 4 usuarios demo/operativos ya sembrados.

## 10.1 Objetivo de la extensión

Sustituir la administración manual de cuentas por SQL directo por una **pantalla de administración de usuarios dentro de la app**, donde un `admin` o un `editor_datos` pueda dar de alta capturistas reales de las Direcciones Regionales, asignarles su Regional, editarlos, resetear su contraseña y darlos de baja (desactivar, nunca borrar), con **contraseña temporal de un solo uso** y **cambio de contraseña obligatorio en el primer inicio de sesión**.

## 10.2 Decisiones de producto (ya acordadas con el usuario — implementar tal cual)

- **D15. Acceso a la administración de usuarios: `admin` **y** `editor_datos`.** Ambos roles ven la pantalla `/usuarios` y pueden operar los endpoints `/api/usuarios/*`. `capturista` y `auditor` reciben **403** en la API y "No tienes permiso para ver esta sección." en la PWA.
- **D16. Baja = desactivar, NUNCA borrar.** Dar de baja pone `activo = false`. La fila permanece intacta para que `capturas.usuario_id`, `staging_beneficiarios.revisado_por` y `auditoria_log.usuario_id` conserven nombre e historial. **No se implementa `DELETE /api/usuarios/:id` en ningún caso**, ni botón de eliminar en la UI. Un usuario inactivo no puede iniciar sesión y sus tokens vigentes dejan de servir.
- **D17. Contraseña temporal + cambio obligatorio en el primer login.** Al **crear** un usuario o **resetear** su contraseña, el sistema genera una contraseña temporal aleatoria criptográficamente segura. Se muestra **una sola vez** en pantalla a quien la generó, para que se la comunique al usuario por el canal que corresponda. **Nunca** se envía por correo, **nunca** se guarda en claro y **nunca** se puede volver a consultar (ni por API, ni en BD, ni en la bitácora). El usuario queda con `debe_cambiar_password = true`.
- **D18. El flag bloquea todo salvo el cambio de contraseña.** Mientras `debe_cambiar_password = true`, el login sigue devolviendo token (para poder autenticar el cambio), pero **cualquier otra ruta protegida responde 403** con `codigo:"cambio_password_requerido"`. Aplica a **los 4 roles**, no solo a los usuarios nuevos.
- **D19. Cambio voluntario siempre disponible.** El endpoint de cambio de la propia contraseña funciona también cuando el flag está en `false`, para que cualquier usuario pueda cambiarla cuando quiera desde el menú de usuario.
- **D20. Los 4 usuarios ya operativos (`admin`, `capturista1`, `auditor1`, `editor1`) NO se ven afectados**: la migración crea `debe_cambiar_password` con `DEFAULT FALSE`, por lo que las filas existentes quedan en `false` y siguen entrando exactamente como hoy. No hay cambio retroactivo forzado.
- **D21. El nombre de login (`usuarios.usuario`) es inmutable una vez creado.** Es la clave con la que se lee la trazabilidad histórica; si está mal, se desactiva la cuenta y se crea otra. El backend rechaza el campo en la edición.
- **D22. Regional obligatoria solo para `capturista`.** Los roles `admin`, `auditor` y `editor_datos` se crean con `regional_id = NULL` (igual que el seed vigente). Enviar Regional para esos roles es un error de validación.
- **D23. `editor_datos` no puede crear ni tocar cuentas `admin`.** Puede administrar `capturista`, `auditor` y `editor_datos`. Cualquier operación de creación/edición/reset/activación sobre un usuario con rol `admin`, o que asigne el rol `admin`, se rechaza con **403** `rol_no_asignable`. `admin` puede con todo. (Evita escalada de privilegios desde el perfil de gabinete.)
- **D24. Sin autoservicio de recuperación.** No hay "olvidé mi contraseña" por correo (sigue fuera de scope, §2). La vía de recuperación es: el usuario le pide a un `admin`/`editor_datos` que le resetee la contraseña.

## 10.3 Modelo de datos

### 10.3.1 Estado actual relevante (NO se duplica)

`usuarios` (§4.1) **ya tiene** `id`, `usuario` (UNIQUE), `nombre_completo`, `password_hash`, `rol` (CHECK con los 4 roles tras §8.4.1), `regional_id`, **`activo BOOLEAN NOT NULL DEFAULT TRUE`**, `creado_en`, `actualizado_en`. **La columna `activo` ya existe: no se vuelve a crear.**

### 10.3.2 `db/migrations/010_usuarios_admin.sql` (única migración de este build)

Puramente aditiva e idempotente (la BD de producción ya tiene datos):

```sql
-- Cambio de contraseña obligatorio (build 4).
-- DEFAULT FALSE: las filas existentes NO quedan forzadas a cambiar contraseña.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Marca de la última vez que el usuario cambió su propia contraseña (informativa, puede ser NULL).
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS password_actualizado_en TIMESTAMPTZ;

-- Índices de apoyo para el listado filtrado de /api/usuarios.
CREATE INDEX IF NOT EXISTS idx_usuarios_rol      ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo   ON usuarios (activo);
CREATE INDEX IF NOT EXISTS idx_usuarios_regional ON usuarios (regional_id);
```

No se crean tablas nuevas. **Jamás** se crea una columna que guarde la contraseña temporal en claro: la única representación persistida es `password_hash` (bcrypt cost 10). El criterio 112 (§9.9) sigue vigente: no se elimina ni renombra ninguna columna existente.

### 10.3.3 Valores nuevos de `auditoria_log.accion` (la columna es TEXT libre, el esquema no cambia)

| `accion` | `entidad` | `entidad_id` | `detalle` (JSONB) |
|---|---|---|---|
| `usuario_creado` | `usuario` | id del creado | `{usuario, rol, regional_id, creado_por_rol}` |
| `usuario_editado` | `usuario` | id | `{cambios:[{campo,anterior,nuevo}], editado_por_rol}` |
| `usuario_password_reset` | `usuario` | id | `{usuario, motivo?, reseteado_por_rol}` |
| `usuario_activado` | `usuario` | id | `{usuario, anterior:false, nuevo:true}` |
| `usuario_desactivado` | `usuario` | id | `{usuario, anterior:true, nuevo:false, motivo?}` |
| `password_cambiado` | `usuario` | id del propio usuario | `{obligatorio: true\|false}` |

**El `detalle` NUNCA contiene la contraseña temporal ni la nueva contraseña, ni en claro ni hasheada.**

## 10.4 Generación de la contraseña temporal

`backend/src/servicios/passwords.ts`:

- Alfabeto **sin caracteres ambiguos**: `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789` (excluye `I`, `l`, `O`, `0`, `1`) y **sin símbolos** (para que sea trivial de dictar y copiar).
- Longitud fija **14 caracteres**.
- Generación con `crypto.randomBytes` y **rechazo de sesgo** (descartar bytes ≥ `256 - (256 % alfabeto.length)`), nunca `Math.random`.
- Se **regenera** hasta que contenga al menos una letra y al menos un dígito, de modo que la temporal cumpla la propia política de contraseñas (10.5).
- Se hashea con bcrypt cost 10 antes de guardar. **La cadena en claro solo existe en memoria durante la petición y en el cuerpo de la respuesta HTTP de creación/reset.**

## 10.5 Política de contraseñas (aplica al cambio propio)

Validación compartida en `packages/shared/src/usuarios.ts` (Zod), reutilizada en cliente y servidor:

| Regla | Código de error | Mensaje |
|---|---|---|
| Longitud entre 10 y 128 caracteres | `password_debil` | "La contraseña debe tener al menos 10 caracteres." |
| Debe contener al menos una letra y un dígito | `password_debil` | "La contraseña debe incluir al menos una letra y un número." |
| No puede ser igual a la contraseña actual | `password_repetida` | "La nueva contraseña debe ser distinta de la actual." |
| `password_actual` no coincide con el hash | `password_actual_incorrecta` | "La contraseña actual no es correcta." |

Todas responden **422** (no 401, para no disparar el cierre de sesión automático del cliente).

## 10.6 Cambios en autenticación y middleware (backend)

### 10.6.1 Verificación por petición contra BD (`backend/src/plugins/auth.ts`)

El plugin de autenticación, además de verificar la firma del JWT, **lee la fila del usuario** (`SELECT id, usuario, nombre_completo, rol, regional_id, activo, debe_cambiar_password FROM usuarios WHERE id = $1`) y la deja en `request.usuario`. Consecuencias (deseadas y verificables):

1. **Cuenta desactivada ⇒ token inservible de inmediato.** Si `activo = false`, cualquier ruta protegida responde **401** `{"error":{"codigo":"cuenta_desactivada","mensaje":"Tu cuenta está desactivada. Contacta al administrador."}}`. No hace falta esperar a que expire el JWT.
2. **Usuario borrado** (no ocurre por D16, pero se contempla): 401 `token_invalido`.
3. El flag `debe_cambiar_password` se lee **de BD, no del token**: en cuanto el usuario cambia su contraseña, el mismo token vuelve a servir para todo.

Esta lectura no requiere caché (una query por petición sobre PK, con el orden de magnitud del proyecto).

### 10.6.2 Guarda global de cambio de contraseña (`backend/src/plugins/cambioPassword.ts`)

Hook `preHandler` global, **después** de la autenticación. Si `request.usuario.debe_cambiar_password === true` y la ruta **no** está en la lista blanca, responde:

```json
{"error":{"codigo":"cambio_password_requerido","mensaje":"Debes cambiar tu contraseña antes de continuar."}}
```
con HTTP **403**.

**Lista blanca (únicas rutas permitidas con el flag activo):**
- `GET /api/health` (pública)
- `POST /api/auth/login` (pública)
- `GET /api/auth/me`
- `PATCH /api/mi-cuenta/password`

Todo lo demás (`/api/beneficiarios*`, `/api/catalogos`, `/api/capturas*`, `/api/auditoria/*`, `/api/staging/*`, `/api/correcciones/*`, `/api/estadisticas/*`, `/api/usuarios*`, `/media/*`) responde 403 mientras el flag siga en `true`.

### 10.6.3 Cambios en `POST /api/auth/login` (E2) y `GET /api/auth/me` (E3) — **aditivos**

- El login **sigue devolviendo 200 con `token`** exactamente como hoy (no cambia el contrato existente). El objeto `usuario` gana dos claves: **`debe_cambiar_password` (boolean)** y **`activo` (boolean, siempre `true` en un login exitoso)**.
- Un usuario con `activo = false` que intenta iniciar sesión recibe **401** con el mismo mensaje genérico que una credencial inválida (`{"error":{"codigo":"credenciales_invalidas","mensaje":"Usuario o contraseña incorrectos."}}`) — no se filtra el estado de la cuenta. Se registra en `auditoria_log` como `login_fallido` con `detalle.motivo = "cuenta_desactivada"`.
- `GET /api/auth/me` devuelve el perfil con `debe_cambiar_password` incluido (es de lista blanca, funciona con el flag activo).

## 10.7 Endpoints nuevos

Archivo `backend/src/rutas/usuarios.ts` (E34–E38) y `backend/src/rutas/miCuenta.ts` (E39). SQL en `backend/src/db/queries/usuarios.ts`; lógica en `backend/src/servicios/usuarios.ts`. Formato de error existente `{"error":{"codigo","mensaje"}}`.

**Reglas transversales de `/api/usuarios/*`:**
- `requiereRol(['admin','editor_datos'])`. Sin token → **401**; `capturista`/`auditor` → **403** `rol_no_autorizado`.
- `password_hash` **nunca** aparece en ninguna respuesta.
- Regla D23: si el actor es `editor_datos` y el usuario objetivo tiene `rol='admin'`, o el payload pide `rol='admin'` → **403** `rol_no_asignable` ("Tu rol no puede administrar cuentas de administrador.").
- Toda mutación es **transaccional**: `UPDATE`/`INSERT` en `usuarios` + `INSERT` en `auditoria_log` en la misma transacción.
- Validación del campo `usuario`: 3–32 caracteres, patrón `^[a-z0-9._-]+$`; se normaliza a minúsculas y `trim` antes de guardar; unicidad **case-insensitive**.
- `nombre_completo`: 3–120 caracteres tras `trim`.
- `rol` ∈ `capturista | auditor | admin | editor_datos`.

| # | Método | Ruta | Descripción / Respuesta |
|---|---|---|---|
| **E34** | GET | `/api/usuarios` | Query: `rol`, `regional_id`, `activo` (`true`\|`false`), `q` (usuario o nombre, ≥2 chars, sin acentos), `page` (1), `page_size` (≤100, default 25). → `200 {data:[{id,usuario,nombre_completo,rol,regional_id,regional,activo,debe_cambiar_password,creado_en,actualizado_en,password_actualizado_en,capturas:<count>}], page, page_size, total, has_more}`. Orden: `activo DESC, nombre_completo ASC`. Sin filtro `activo`, devuelve activos **e** inactivos. |
| **E35** | POST | `/api/usuarios` | Body **estricto** `{usuario, nombre_completo, rol, regional_id?}`. Genera la temporal (10.4), hashea, inserta con `activo=true` y `debe_cambiar_password=true`. → **201** `{ok:true, usuario:{id,usuario,nombre_completo,rol,regional_id,regional,activo:true,debe_cambiar_password:true,creado_en}, password_temporal:"<14 chars>", aviso:"Cópiala ahora: no se volverá a mostrar."}`. Registra `usuario_creado`. |
| **E36** | PATCH | `/api/usuarios/:id` | Body **estricto** `{nombre_completo?, rol?, regional_id?, motivo?}`. Solo esos 3 campos de datos son editables. → `200 {ok:true, usuario:{...}, cambios:[{campo,anterior,nuevo}]}`. Sin cambios reales ⇒ `200` con `cambios:[]`, sin tocar `actualizado_en` ni bitácora. Registra `usuario_editado`. |
| **E37** | POST | `/api/usuarios/:id/reset-password` | Body `{motivo?}`. Genera **nueva** temporal, actualiza `password_hash`, pone `debe_cambiar_password=true` y `password_actualizado_en=NULL`. → `200 {ok:true, usuario_id, usuario, password_temporal:"<14 chars>", aviso:"Cópiala ahora: no se volverá a mostrar."}`. Registra `usuario_password_reset`. |
| **E38** | PATCH | `/api/usuarios/:id/activo` | Body `{activo:boolean, motivo?}`. → `200 {ok:true, usuario:{id,usuario,activo}}`. Idempotente: si ya estaba en ese valor, `200` sin bitácora. Registra `usuario_activado` / `usuario_desactivado`. |
| **E39** | PATCH | `/api/mi-cuenta/password` | **Cualquier rol autenticado** (lista blanca de 10.6.2). Body `{password_actual, password_nueva}`. Valida 10.5, actualiza `password_hash`, pone `debe_cambiar_password=false` y `password_actualizado_en=now()`. → `200 {ok:true, debe_cambiar_password:false}`. Registra `password_cambiado` con `{obligatorio:<valor previo del flag>}`. **El token vigente sigue siendo válido** tras el cambio (no se invalida la sesión en curso). |

### 10.7.1 Códigos de error específicos

| Caso | HTTP | `codigo` | Mensaje |
|---|---|---|---|
| `usuario` ya existe (case-insensitive) | **409** | `usuario_duplicado` | "Ya existe un usuario con ese nombre de acceso." |
| `rol='capturista'` sin `regional_id` | **422** | `regional_requerida` | "Los capturistas deben tener una Dirección Regional asignada." |
| `regional_id` no nulo con rol distinto de `capturista` | **422** | `regional_no_aplica` | "Solo los capturistas llevan Dirección Regional." |
| `regional_id` inexistente o `activo=false` | **422** | `regional_invalida` | "La Dirección Regional seleccionada no existe o está inactiva." |
| Clave fuera de la lista blanca en E35/E36 (`usuario` en E36, `password`, `password_hash`, `activo`, `debe_cambiar_password`, `id`, `creado_en`, …) | **422** | `campo_no_editable` | "Los campos &lt;x&gt; no se pueden modificar por esta vía." |
| Body de E36 sin ninguna clave de datos | **422** | `sin_cambios` | "No se envió ningún campo editable." |
| `usuario`/`nombre_completo`/`rol` con formato inválido | **422** | `payload_invalido` | "Datos inválidos." |
| Admin intentando desactivarse a sí mismo | **409** | `auto_desactivacion` | "No puedes desactivar tu propia cuenta." |
| Desactivar (o cambiar de rol) al **último `admin` activo** | **409** | `ultimo_admin` | "Debe quedar al menos un administrador activo." |
| `editor_datos` sobre cuenta/rol `admin` (D23) | **403** | `rol_no_asignable` | "Tu rol no puede administrar cuentas de administrador." |
| `id` inexistente | **404** | `no_encontrado` | "El usuario no existe." |
| `DELETE /api/usuarios/:id` | **404/405** | — | La ruta **no se implementa** (D16). |

## 10.8 Pantallas nuevas en la PWA

Todas **online-only** (no se cachean datos en IndexedDB; sin red muestran "Esta sección requiere conexión a internet."). Textos y validaciones en español.

### 10.8.1 `/usuarios` — Administración de usuarios (`Usuarios.tsx`)

`<RutaProtegida roles={['admin','editor_datos']}>`. Encabezado **"Administración de usuarios"** + aviso permanente: *"Las bajas se hacen desactivando la cuenta: el historial de capturas y auditoría se conserva. Ningún usuario se elimina."*

- **Filtros** (recargan la tabla sin recargar la página): `select-filtro-rol` (Todos / Capturista / Auditor / Editor de datos / Administrador), `select-filtro-regional` (Todas + las 4 Regionales), `select-filtro-activo` (Todos / Activos / Inactivos), `input-busqueda-usuarios` (usuario o nombre, debounce 300 ms).
- **Botón** `btn-nuevo-usuario` — "Nuevo usuario".
- **Tabla** `data-testid="tabla-usuarios"`, filas `data-testid="fila-usuario"`. Columnas: Usuario, Nombre completo, Rol (etiqueta en español), Regional (`—` si no aplica), Estado (`badge-estado-usuario`: verde "Activo" / gris "Inactivo"), Contraseña (`badge-password-pendiente`: "Cambio pendiente" si `debe_cambiar_password`), Capturas, Acciones.
- **Acciones por fila**: `btn-editar-usuario` ("Editar"), `btn-reset-password` ("Resetear contraseña", con confirmación "Se generará una contraseña temporal y el usuario deberá cambiarla al entrar. ¿Continuar?"), `btn-toggle-activo` ("Desactivar" / "Activar", con confirmación). **No existe ningún botón de eliminar/borrar.**
- Vacío: "Sin resultados". Errores del backend: se muestra `error.mensaje` tal cual en `data-testid="error-usuarios"`.

### 10.8.2 Formulario de alta/edición (`FormUsuario.tsx`, `data-testid="form-usuario"`)

Modal. Campos: `input-usuario` (solo en alta; en edición se renderiza `readonly` **y** `disabled` con la leyenda *"El nombre de acceso no se puede cambiar: es la clave del historial de capturas y auditoría."*), `input-nombre-completo`, `select-rol`, `select-regional`.

- `select-regional` está **habilitado y obligatorio solo si `select-rol` = Capturista**; con cualquier otro rol se deshabilita, se vacía y muestra "No aplica".
- Si el actor es `editor_datos`, la opción "Administrador" **no se renderiza** en `select-rol` (D23).
- Validación en cliente antes de enviar (mensajes bajo el campo, `data-testid="error-usuario"`, `error-nombre`, `error-regional`): patrón y longitud de `usuario`, longitud de nombre, Regional requerida para capturista. Si falla, **no** se llama a la API.
- Botones `btn-guardar-usuario` ("Guardar") y `btn-cancelar-usuario` ("Cancelar").

### 10.8.3 Modal de contraseña temporal (`ModalPasswordTemporal.tsx`)

Se abre **automáticamente** tras un alta (E35) o un reset (E37) exitosos. `data-testid="modal-password-temporal"`.

- Título "Contraseña temporal generada".
- Aviso destacado: **"Cópiala ahora: no se volverá a mostrar. Entrégasela al usuario por un canal seguro; deberá cambiarla al iniciar sesión."**
- La contraseña en `data-testid="texto-password-temporal"`, en fuente monoespaciada y seleccionable.
- `btn-copiar-password` ("Copiar") usando `navigator.clipboard.writeText` con fallback a selección manual; al copiar muestra "Copiada al portapapeles".
- `btn-cerrar-modal-password` ("Ya la copié, cerrar"). **Al cerrar, la contraseña se borra del estado de React**: no queda en el DOM, no se guarda en `localStorage`/IndexedDB y no se puede volver a abrir el modal para esa contraseña.

### 10.8.4 `/cambiar-password` — Cambio de contraseña (`CambiarPassword.tsx`)

Accesible para **cualquier usuario autenticado** (los 4 roles). Dos modos, mismo componente:

| Modo | Cómo se entra | Comportamiento |
|---|---|---|
| **Obligatorio** | `debe_cambiar_password === true` | Se muestra `data-testid="aviso-cambio-obligatorio"` con "Por seguridad, debes cambiar tu contraseña temporal antes de usar el sistema." La navegación queda **bloqueada**: la barra de estado oculta todos los enlaces salvo "Cerrar sesión", y cualquier intento de ir a otra ruta protegida redirige aquí. |
| **Voluntario** | Menú de usuario → "Cambiar mi contraseña" | Sin aviso de obligatoriedad; hay botón "Cancelar" que regresa a la pantalla anterior. |

- `data-testid="form-cambio-password"` con `input-password-actual`, `input-password-nueva`, `input-password-confirmar` (todos `type="password"`), botón `btn-cambiar-password` ("Cambiar contraseña").
- Validación en cliente (mensaje en `data-testid="error-password"`, sin llamar a la API): mínimo 10 caracteres, al menos una letra y un número, confirmación idéntica, nueva distinta de la actual.
- Éxito: toast `data-testid="toast-exito"` "Contraseña actualizada." + refresco del perfil (`GET /api/auth/me`) + redirect **según rol** (§8.8.4/§9.6.5): `capturista` → `/sync` si el padrón local está vacío, si no `/beneficiarios`; `auditor` → `/auditoria`; `editor_datos` → `/depuracion`; `admin` → `/beneficiarios`. En modo voluntario, regresa a la pantalla anterior.
- Error del backend: se muestra `error.mensaje` en `error-password`.

### 10.8.5 Menú de usuario y navegación (delta sobre §8.8.4 y §9.6.5)

- La barra de estado gana un **menú de usuario** `data-testid="menu-usuario"` (botón con el nombre del usuario) con: "Cambiar mi contraseña" (`nav-cambiar-password`, **visible para todos los roles**) y "Cerrar sesión" (`nav-cerrar-sesion`).
- Enlace **"Usuarios"** (`data-testid="nav-usuarios"`) visible **solo** para `admin` y `editor_datos`. `capturista` y `auditor` no lo ven.
- `RutaProtegida` gana: `/usuarios` → `['admin','editor_datos']`; `/cambiar-password` → cualquier rol autenticado. Todo lo demás de §8.8.4 y §9.6.5 **se mantiene idéntico**.
- **Guarda global en la PWA**: (a) tras el login, si `usuario.debe_cambiar_password === true` se navega a `/cambiar-password` ignorando el redirect por rol; (b) `RutaProtegida` redirige a `/cambiar-password` mientras el flag esté activo; (c) `pwa/src/api/cliente.ts` intercepta cualquier respuesta **403 con `codigo === "cambio_password_requerido"`** y fuerza la navegación a `/cambiar-password`; (d) intercepta **401 con `codigo === "cuenta_desactivada"`**, borra la sesión de IndexedDB y manda a `/login` con el mensaje "Tu cuenta está desactivada. Contacta al administrador."

## 10.9 Estructura de archivos nuevos (delta build 4)

```
db/migrations/010_usuarios_admin.sql
backend/src/rutas/usuarios.ts                   # E34–E38
backend/src/rutas/miCuenta.ts                   # E39
backend/src/db/queries/usuarios.ts
backend/src/servicios/usuarios.ts               # validaciones, diff, bitácora (transaccional)
backend/src/servicios/passwords.ts              # generador crypto-seguro de temporales
backend/src/plugins/cambioPassword.ts           # guarda global del flag
packages/shared/src/usuarios.ts                 # Zod .strict() + tipos compartidos + política de password
pwa/src/pantallas/Usuarios.tsx
pwa/src/pantallas/CambiarPassword.tsx
pwa/src/componentes/FormUsuario.tsx
pwa/src/componentes/ModalPasswordTemporal.tsx
pwa/src/componentes/MenuUsuario.tsx
```

Archivos modificados: `backend/src/plugins/auth.ts` (lectura de la fila del usuario por petición), `backend/src/rutas/auth.ts` (login/me con `debe_cambiar_password`, rechazo de cuenta inactiva), `backend/src/server.ts` (registro de rutas y del plugin de guarda), `pwa/src/rutas.tsx`, `pwa/src/componentes/BarraEstado.tsx`, `pwa/src/componentes/RutaProtegida.tsx`, `pwa/src/api/cliente.ts`, `README.md`.

**Sin dependencias npm nuevas** (se usan `crypto` de Node, `bcryptjs` y `zod`, ya presentes). **Sin variables de entorno nuevas.** **Sin comandos npm nuevos**: todo corre con `docker compose up --build` y los scripts existentes; la migración `010` se aplica sola en el arranque del backend (§5.5).

## 10.10 Assumptions de la extensión (continúa la numeración)

46. **`activo` ya existía** en `usuarios` (§4.1): la migración 010 **no** la vuelve a crear; solo agrega `debe_cambiar_password` y `password_actualizado_en`.
47. **La verificación de `activo`/`debe_cambiar_password` se hace contra BD en cada petición**, no desde claims del JWT. Cuesta una query por PK y a cambio hace que desactivar una cuenta surta efecto inmediato y que el cambio de contraseña desbloquee el token vigente sin re-login.
48. **No se invalidan tokens al cambiar la contraseña** (no hay lista de revocación ni versión de credenciales): la sesión activa continúa. Aceptable dado el alcance y la expiración de 12 h.
49. **La contraseña temporal viaja una sola vez en el cuerpo HTTPS de la respuesta de creación/reset.** No se persiste en claro, no se registra en `auditoria_log`, no se envía por correo (fuera de scope, §2) y no hay endpoint para reconsultarla. Si se pierde, se hace otro reset.
50. **Longitud 14 y alfabeto sin ambiguos** (10.4): prioriza copiar/dictar sin errores por encima de memorizar; no se exigen símbolos porque complican el dictado y el teclado móvil.
51. **`editor_datos` no administra cuentas `admin`** (D23). Es una restricción de seguridad decidida aquí ante la ambigüedad del brief: el brief da acceso a ambos roles, pero permitir que un perfil de gabinete cree administradores sería una escalada de privilegios trivial.
52. **Protección del último administrador**: además de la prohibición de auto-desactivarse, se bloquea desactivar o degradar de rol al último `admin` activo. Evita dejar el sistema sin quien lo administre.
53. **Regional solo para capturistas** (D22). La lógica ya existente de "auditor con regional asignada ve solo la suya" (§5.7 E5) **no se elimina** del backend; simplemente esta pantalla no permite asignarle Regional a un auditor.
54. **El nombre de login es inmutable** (D21) y **no hay borrado** (D16): ambas decisiones existen para que `capturas.usuario_id`, `staging_beneficiarios.revisado_por` y `auditoria_log.usuario_id` nunca queden huérfanos ni cambien de significado.
55. **Cuenta desactivada ⇒ 401 en rutas protegidas y 401 genérico en login** (sin revelar que la cuenta existe pero está inactiva). El mensaje explicativo solo se muestra a quien ya tenía sesión abierta.
56. **La pantalla de usuarios es online-only** y no se registra en IndexedDB ni en la cola de sync (coherente con §8/§9: solo el app-shell se cachea).
57. **`debe_cambiar_password` no se puede editar por API** salvo como efecto de crear/resetear (lo pone en `true`) o de cambiar la propia contraseña (lo pone en `false`). No existe forma de que un admin lo apague a mano.
58. **Sin auditoría de intentos fallidos de cambio de contraseña** más allá del `login_fallido` ya existente: se consideró ruido innecesario para el volumen del proyecto.
59. **Los 4 usuarios demo siguen documentados y funcionando** (D20). El README añade la instrucción de que, en producción, el primer paso operativo es crear los usuarios reales desde `/usuarios` y **desactivar** (no borrar) las cuentas demo que no se vayan a usar.

---

## 10.11 Rubric extendido (criterios 160–210)

Continúa la numeración de §7, §8.11 y §9.9. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_CAP` (capturista1), `T_AUD` (auditor1), `T_EDIT` (editor1). `U_QA` = usuario creado durante la evaluación (`qa_capturista`).

### Base de datos y migración (160–163)

160. Existe `db/migrations/010_*.sql` y `information_schema.columns` muestra `usuarios.debe_cambiar_password` de tipo `boolean`, `is_nullable='NO'` y `column_default` que contiene `false`.
161. `usuarios` conserva la columna `activo` (boolean, default true) y todas las columnas de §4.1; ninguna fue eliminada ni renombrada.
162. `SELECT count(*) FROM usuarios WHERE usuario IN ('admin','capturista1','auditor1','editor1') AND debe_cambiar_password = false` devuelve **4** (la migración no forzó el cambio a los usuarios ya existentes).
163. No existe ninguna columna en `usuarios` que almacene la contraseña en claro: en `information_schema.columns` para la tabla `usuarios`, ninguna columna cuyo nombre contenga `temporal`, `plano`, `claro` o `clave_temp`; la única columna de credencial es `password_hash`.

### API — acceso a `/api/usuarios` (164–168)

164. `GET $API/api/usuarios` sin header `Authorization` devuelve **401**.
165. `GET $API/api/usuarios` con `T_CAP` devuelve **403** y con `T_AUD` devuelve **403**.
166. `GET $API/api/usuarios` con `T_ADMIN` devuelve **200** con `data` array (≥4 elementos) y las claves `page`, `page_size`, `total`, `has_more`.
167. En esa respuesta **ningún** elemento contiene la clave `password_hash` (ni `password`), y cada elemento sí trae `usuario`, `rol`, `activo` y `debe_cambiar_password`.
168. `GET $API/api/usuarios` con `T_EDIT` devuelve **200** (el editor de datos también administra usuarios).

### API — creación de usuarios (169–176)

169. `POST $API/api/usuarios` con `T_ADMIN` y body `{"usuario":"qa_capturista","nombre_completo":"QA Capturista Prueba","rol":"capturista","regional_id":<id de REG-01>}` devuelve **201** con `ok:true`, `usuario.id` numérico y `password_temporal` de longitud ≥ 12.
170. La `password_temporal` devuelta **no** contiene ninguno de los caracteres `0`, `O`, `1`, `l`, `I`, y contiene al menos una letra y al menos un dígito.
171. En BD, `SELECT activo, debe_cambiar_password FROM usuarios WHERE usuario='qa_capturista'` devuelve `activo=true` y `debe_cambiar_password=true`.
172. `POST /api/auth/login` con `qa_capturista` + su `password_temporal` devuelve **200** con `token` no vacío y `usuario.debe_cambiar_password === true`.
173. Repetir el mismo `POST /api/usuarios` con `usuario:"qa_capturista"` devuelve **409** con `error.codigo === "usuario_duplicado"` y el `count(*)` de `usuarios` **no** aumenta.
174. `POST /api/usuarios` con `{"rol":"capturista"}` y **sin** `regional_id` devuelve **422** `regional_requerida`; con `{"rol":"auditor","regional_id":<id válido>}` devuelve **422** `regional_no_aplica`.
175. `POST /api/usuarios` con `T_EDIT` y `rol:"admin"` devuelve **403** `rol_no_asignable`; con `T_EDIT` y `rol:"capturista"` (usuario nuevo, con Regional) devuelve **201**.
176. `POST /api/usuarios` con `T_CAP` devuelve **403** y con `T_AUD` devuelve **403**; en ambos casos el `count(*)` de `usuarios` no cambia.

### API — bloqueo por `debe_cambiar_password` (177–182)

177. Con el token de `qa_capturista` (flag en `true`), `GET $API/api/catalogos` devuelve **403** con `error.codigo === "cambio_password_requerido"`, y `GET $API/api/beneficiarios` devuelve **403** con el mismo código.
178. Con ese mismo token, `GET $API/api/auth/me` devuelve **200** e incluye `debe_cambiar_password: true` (ruta de lista blanca).
179. `PATCH $API/api/mi-cuenta/password` con ese token y `{"password_actual":"<temporal>","password_nueva":"QaSegura2026"}` devuelve **200** con `ok:true`; en BD `debe_cambiar_password` queda en **false** y `password_actualizado_en` no es NULL.
180. Con el **mismo token de antes** (sin volver a iniciar sesión), `GET $API/api/catalogos` ahora devuelve **200**.
181. `POST /api/auth/login` con `qa_capturista` + `QaSegura2026` devuelve **200**; con la contraseña temporal anterior devuelve **401** sin `token`.
182. `PATCH /api/mi-cuenta/password` con `password_actual` incorrecta devuelve **422** `password_actual_incorrecta`; con `password_nueva":"abc"` devuelve **422** `password_debil`; con `password_nueva` igual a la actual devuelve **422** `password_repetida`. En los tres casos el hash en BD no cambia.

### API — edición, reset y activación (183–191)

183. `PATCH $API/api/usuarios/<id de U_QA>` con `T_ADMIN` y `{"nombre_completo":"QA Capturista Editado"}` devuelve **200** con `cambios` conteniendo `{campo:"nombre_completo",...}`; en BD el nombre cambió.
184. `PATCH $API/api/usuarios/<id de U_QA>` con `{"usuario":"otro_login"}` devuelve **422** `campo_no_editable` y `SELECT usuario` en BD **no** cambió.
185. `PATCH $API/api/usuarios/<id>` con `{"password":"x"}`, con `{"debe_cambiar_password":false}` y con `{"activo":false}` devuelve **422** `campo_no_editable` en los tres casos; `PATCH` con body `{}` devuelve **422** `sin_cambios`.
186. `POST $API/api/usuarios/<id de U_QA>/reset-password` con `T_ADMIN` devuelve **200** con una `password_temporal` **distinta** de la generada en el criterio 169; en BD `debe_cambiar_password` vuelve a **true** y el `password_hash` cambió.
187. Iniciar sesión con `qa_capturista` + la nueva temporal devuelve **200** con `usuario.debe_cambiar_password === true`, y con la contraseña `QaSegura2026` devuelve **401**.
188. `PATCH $API/api/usuarios/<id de U_QA>/activo` con `{"activo":false}` y `T_ADMIN` devuelve **200**; en BD `activo=false`, y `POST /api/auth/login` de ese usuario devuelve **401** sin `token`.
189. Con un token de `U_QA` emitido **antes** de la desactivación, `GET $API/api/auth/me` devuelve **401** con `error.codigo === "cuenta_desactivada"`.
190. `PATCH $API/api/usuarios/<id del propio admin>/activo` con `{"activo":false}` y `T_ADMIN` devuelve **409** `auto_desactivacion`, y en BD ese admin sigue con `activo=true`.
191. `PATCH $API/api/usuarios/<id de U_QA>/activo` con `{"activo":true}` devuelve **200**, y tras ello ese usuario vuelve a poder iniciar sesión (200 con token).

### API — trazabilidad y no-borrado (192–196)

192. `DELETE $API/api/usuarios/<id de U_QA>` con `T_ADMIN` devuelve **404** o **405**, y `SELECT count(*) FROM usuarios` **no** disminuye.
193. `SELECT count(*) FROM usuarios` al final de la batería es **mayor o igual** que al inicio (ninguna fila se eliminó en ningún momento) y `SELECT usuario FROM usuarios WHERE usuario='qa_capturista'` sigue devolviendo 1 fila.
194. `GET $API/api/auditoria/log` con `T_ADMIN` contiene al menos una entrada con cada una de estas acciones: `usuario_creado`, `usuario_editado`, `usuario_password_reset`, `usuario_desactivado`, `usuario_activado` y `password_cambiado`.
195. `SELECT count(*) FROM auditoria_log WHERE detalle::text ILIKE '%<password_temporal generada>%'` devuelve **0** (la contraseña temporal nunca se registra en la bitácora).
196. `GET $API/api/usuarios?rol=capturista` con `T_ADMIN` devuelve 200 y **todos** los elementos tienen `rol === "capturista"`; `GET /api/usuarios?activo=false` devuelve solo elementos con `activo === false`; `GET /api/usuarios?q=<fragmento del nombre de U_QA>` devuelve ≥1 elemento y todos coinciden con el fragmento.

### PWA — pantalla de administración de usuarios (197–205)

197. Playwright con `admin`: existe `[data-testid="nav-usuarios"]`; al pulsarlo la URL es `/usuarios` y se muestra `[data-testid="tabla-usuarios"]` con ≥4 filas `[data-testid="fila-usuario"]`.
198. Playwright: `editor1` puede abrir `/usuarios` y ve la tabla; `capturista1` y `auditor1` **no** ven `[data-testid="nav-usuarios"]` (0 elementos) y al navegar directo a `/usuarios` ven "No tienes permiso para ver esta sección."
199. Playwright: pulsar `[data-testid="btn-nuevo-usuario"]` abre `[data-testid="form-usuario"]` con `input-usuario`, `input-nombre-completo`, `select-rol` y `select-regional`; al elegir rol "Capturista" el `select-regional` queda habilitado y al elegir "Auditor" queda deshabilitado o vacío/"No aplica".
200. Playwright: completar el formulario con un usuario nuevo (rol Capturista + Regional) y guardar muestra `[data-testid="modal-password-temporal"]` con `[data-testid="texto-password-temporal"]` no vacío, un texto visible que advierte que no se volverá a mostrar, y un botón `[data-testid="btn-copiar-password"]`.
201. Playwright: cerrar el modal y recargar `/usuarios` — la cadena de la contraseña temporal **no** aparece en ninguna parte del DOM de la página, y el usuario nuevo sí aparece como fila en la tabla con estado "Activo".
202. Playwright: intentar crear un usuario con un nombre de acceso ya existente muestra un mensaje de error visible en español y no agrega una fila nueva a la tabla.
203. Playwright: pulsar `[data-testid="btn-reset-password"]` en la fila del usuario de prueba y confirmar abre de nuevo `[data-testid="modal-password-temporal"]` con un valor **distinto** al del criterio 200.
204. Playwright: pulsar `[data-testid="btn-toggle-activo"]` y confirmar deja el `[data-testid="badge-estado-usuario"]` de esa fila en "Inactivo" tras recargar; volver a pulsarlo lo deja en "Activo".
205. Playwright + `grep`: en `/usuarios` no existe ningún control de borrado (0 elementos con texto "Eliminar", "Borrar" o "Eliminar usuario" dentro de la tabla) y `grep -ri` en `pwa/src` no encuentra ninguna llamada a un endpoint `DELETE` de `/api/usuarios`.

### PWA — cambio de contraseña obligatorio y voluntario (206–210)

206. Playwright: iniciar sesión con el usuario de prueba usando su contraseña temporal redirige a `/cambiar-password`, muestra `[data-testid="aviso-cambio-obligatorio"]` y `[data-testid="form-cambio-password"]` con `input-password-actual`, `input-password-nueva` e `input-password-confirmar`.
207. Playwright: con ese usuario en estado obligatorio, navegar directamente a `/beneficiarios` (o `/sync`) devuelve a `/cambiar-password` y **no** muestra la lista de beneficiarios.
208. Playwright: completar el cambio con una contraseña válida muestra un mensaje de éxito en español y redirige fuera de `/cambiar-password` a la pantalla propia del rol (`/sync` o `/beneficiarios` para capturista); recargando, el aviso de cambio obligatorio ya no aparece.
209. Playwright: escribir una contraseña nueva de 4 caracteres, o una confirmación distinta de la nueva, muestra un mensaje de error visible en español en `[data-testid="error-password"]` y la contraseña en BD **no** cambia.
210. Playwright: con `auditor1` (flag en `false`), el menú de usuario `[data-testid="menu-usuario"]` contiene la opción "Cambiar mi contraseña" (`[data-testid="nav-cambiar-password"]`) que abre `/cambiar-password` **sin** el aviso de obligatoriedad (0 elementos `[data-testid="aviso-cambio-obligatorio"]`) y con un botón "Cancelar" visible; el mismo enlace existe también para `capturista1`.

### Documentación (211)

211. `README.md` incluye una sección de administración de usuarios que documenta: los roles con acceso (`admin` y `editor_datos`, y que `capturista`/`auditor` no entran), que **las bajas se hacen desactivando y nunca borrando** y por qué (trazabilidad de `capturas` y `auditoria_log`), que la contraseña temporal **se muestra una sola vez** y no se puede reconsultar, el **cambio obligatorio en el primer inicio de sesión** aplicable a todos los roles, que el nombre de acceso es inmutable, y la recomendación de crear los usuarios reales y **desactivar** las cuentas demo al pasar a producción.

**Definición de "terminado" (build 4):** los **211** criterios pasan (60 del build original + 50 del staging + 49 de corrección/dashboard + 52 de esta extensión).

# 11. EXTENSIÓN — Simplificación del cambio de contraseña obligatorio + contraseña manual asignada por el admin (build 5)

> **CONTINUACIÓN LITERAL DE `SPEC.md`.** Esta sección se **agrega al final** de `SPEC.md` (después de la línea "Definición de 'terminado' (build 4)"). Nada de las secciones 1–10 se reescribe. Esta sección **ajusta** dos comportamientos concretos descritos en §10 (el endpoint de cambio de la propia contraseña y los formularios de alta/reset de `/usuarios`); donde §11 contradiga a §10, **manda §11**. Todo lo demás de §10 sigue vigente palabra por palabra. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios (`db`, `backend`, `pwa`). **No se crea ningún servicio nuevo, ninguna tabla nueva, ninguna migración nueva, ninguna dependencia npm nueva y ninguna variable de entorno nueva.**

## 11.1 Objetivo de la extensión

Quitar la fricción del primer inicio de sesión para personal de campo no técnico —dejando de pedir la contraseña temporal que el usuario **acaba de escribir** para autenticarse— y permitir que `admin` / `editor_datos` **asignen ellos mismos** la contraseña inicial de un usuario (al crearlo o al resetearlo), en lugar de estar obligados a usar siempre una temporal aleatoria.

## 11.2 Decisiones de producto (ya acordadas con el usuario tras probar en producción — implementar tal cual)

- **D25. El cambio de contraseña OBLIGATORIO ya no pide la contraseña actual.** Cuando el usuario autenticado tiene `debe_cambiar_password = true`, el endpoint de cambio de la propia contraseña **no exige** `password_actual`: el usuario ya demostró conocerla al iniciar sesión y obtener el token con el que llama a este endpoint, así que el backend confía en el token recién emitido. Si el cliente envía `password_actual` de todas formas, el backend **la ignora en silencio** (no la valida contra el hash, no devuelve error por ella).
- **D26. El cambio de contraseña VOLUNTARIO no cambia en absoluto.** Cuando `debe_cambiar_password = false`, `password_actual` **sigue siendo obligatoria** y se sigue validando contra el hash (422 `password_actual_incorrecta` si no coincide). Es la protección contra que alguien que encuentre un dispositivo con la sesión abierta cambie la contraseña sin conocer la actual. Ninguna otra validación de §10.5 se relaja.
- **D27. `admin` y `editor_datos` pueden asignar la contraseña manualmente.** En "Crear usuario" y en "Resetear contraseña" hay un selector de **modo de contraseña** con dos opciones:
  - `automatica` (**default**, comportamiento actual): el backend genera la temporal aleatoria de 14 caracteres según §10.4.
  - `manual`: el actor escribe la contraseña; el backend la usa tal cual (tras validarla) como contraseña inicial.
- **D28. La política de "cambio obligatorio en el primer login" NO cambia.** Tanto en modo `automatica` como en modo `manual`, el usuario creado/reseteado queda con **`debe_cambiar_password = true`**. Lo único que cambia es **quién elige el valor inicial**, no la obligación de cambiarlo. No existe forma de crear/resetear un usuario dejándolo exento del cambio obligatorio.
- **D29. La contraseña se sigue mostrando UNA SOLA VEZ** en el mismo `ModalPasswordTemporal` (§10.8.3), sea generada o escrita a mano, con el mismo aviso "Cópiala ahora: no se volverá a mostrar." Mostrar también la manual es intencional: confirma al actor exactamente lo que quedó guardado antes de comunicárselo al usuario.
- **D30. La contraseña manual se valida con la MISMA política del cambio propio (§10.5):** mínimo **10** caracteres (máximo 128), al menos una letra y al menos un dígito. No se exigen símbolos ni el alfabeto sin ambiguos de §10.4 (esa restricción aplica solo al generador automático).
- **D31. Compatibilidad total con producción.** Los usuarios que **ya** tienen `debe_cambiar_password = true` pendiente de un reset anterior completan su cambio con el nuevo flujo simplificado sin ninguna migración de datos, sin re-login y sin intervención del admin. **No hay migración `011`.**

## 11.3 Modelo de datos

**Sin cambios.** No se agregan, eliminan ni renombran columnas, tablas ni índices. `debe_cambiar_password`, `password_actualizado_en` y `password_hash` conservan exactamente el significado de §10.3. **No se persiste jamás la contraseña en claro** (tampoco la manual): la única representación guardada sigue siendo `password_hash` (bcrypt cost 10), y `auditoria_log.detalle` sigue sin contener nunca la contraseña.

Los valores de `auditoria_log.accion` de §10.3.3 se mantienen; solo se enriquece el `detalle` (la columna es JSONB libre, el esquema no cambia):

| `accion` | `detalle` (delta build 5) |
|---|---|
| `usuario_creado` | gana `modo_password: "automatica" \| "manual"` |
| `usuario_password_reset` | gana `modo_password: "automatica" \| "manual"` |
| `password_cambiado` | gana `sin_password_actual: true \| false` (true cuando se aceptó por token en flujo obligatorio) |

## 11.4 Contrato actualizado — `PATCH /api/mi-cuenta/password` (E39, reemplaza la fila E39 de §10.7)

Ruta, método, autenticación y pertenencia a la lista blanca de §10.6.2: **idénticos**. Cambia solo la validación del payload, que pasa a ser **condicional según `debe_cambiar_password` del usuario autenticado leído de BD** (§10.6.1), nunca según un campo del body ni un claim del token.

**Body:** `{ password_actual?: string, password_nueva: string }` (Zod `.strict()`: cualquier otra clave → 422 `payload_invalido`).

| Estado del usuario autenticado | `password_actual` | Comportamiento |
|---|---|---|
| `debe_cambiar_password = true` (**obligatorio**) | **Opcional; ignorada si viene** | No se compara contra el hash. No puede producir `password_actual_incorrecta` ni `password_actual_requerida`. |
| `debe_cambiar_password = false` (**voluntario**) | **Obligatoria** | Se valida contra el hash exactamente como en §10.5. |

**Validaciones que se mantienen SIEMPRE (ambos modos):**

| Regla | HTTP | `codigo` | Mensaje |
|---|---|---|---|
| `password_nueva` entre 10 y 128 caracteres | 422 | `password_debil` | "La contraseña debe tener al menos 10 caracteres." |
| `password_nueva` con al menos una letra y un dígito | 422 | `password_debil` | "La contraseña debe incluir al menos una letra y un número." |
| `password_nueva` distinta de la contraseña vigente (comparada **contra el hash**, no contra el body) | 422 | `password_repetida` | "La nueva contraseña debe ser distinta de la actual." |
| `password_actual` faltante **en modo voluntario** | 422 | `password_actual_requerida` | "Debes escribir tu contraseña actual." |
| `password_actual` incorrecta **en modo voluntario** | 422 | `password_actual_incorrecta` | "La contraseña actual no es correcta." |

> Nota: `password_repetida` se sigue evaluando en ambos modos comparando `password_nueva` con `password_hash` mediante `bcrypt.compare`, así que también funciona cuando no se envió `password_actual`.

**Efectos y respuesta (sin cambios respecto de §10.7):** actualiza `password_hash`, pone `debe_cambiar_password = false` y `password_actualizado_en = now()`; devuelve `200 {ok:true, debe_cambiar_password:false}`; el token vigente sigue siendo válido; registra `password_cambiado` con `{obligatorio:<valor previo del flag>, sin_password_actual:<bool>}`.

## 11.5 Contrato actualizado — creación y reset con modo de contraseña

Se agregan **dos claves** al body de E35 y E37. Ambas siguen siendo `.strict()`: cualquier otra clave sigue dando 422 `campo_no_editable`/`payload_invalido` como en §10.7.1.

```ts
// packages/shared/src/usuarios.ts
modo_password: z.enum(['automatica', 'manual']).optional().default('automatica')
password_manual: z.string().optional()   // solo se lee si modo_password === 'manual'
```

### 11.5.1 `POST /api/usuarios` (E35, delta)

Body: `{usuario, nombre_completo, rol, regional_id?, modo_password?, password_manual?}`.

- `modo_password` ausente ⇒ `automatica` (retrocompatible: los clientes/scripts que ya llamaban a E35 con el body de §10.7 siguen funcionando **igual**, sin cambio de comportamiento).
- `automatica`: se genera la temporal con §10.4 y **se ignora `password_manual` si viene** (no es error).
- `manual`: `password_manual` es obligatoria y se valida con la política de §10.5 / D30.
- En **ambos** modos: `activo = true`, `debe_cambiar_password = true`, hash bcrypt cost 10.

**Respuesta 201 (misma forma que §10.7, con una clave añadida):**

```json
{
  "ok": true,
  "usuario": { "id": 12, "usuario": "qa_manual", "nombre_completo": "...", "rol": "capturista",
               "regional_id": 1, "regional": "...", "activo": true,
               "debe_cambiar_password": true, "creado_en": "..." },
  "password_temporal": "<la generada o la escrita por el actor>",
  "modo_password": "manual",
  "aviso": "Cópiala ahora: no se volverá a mostrar."
}
```

La clave sigue llamándose **`password_temporal`** (no se renombra, para no romper §10 ni el cliente existente): en modo `manual` contiene la contraseña que escribió el actor.

### 11.5.2 `POST /api/usuarios/:id/reset-password` (E37, delta)

Body: `{motivo?, modo_password?, password_manual?}`. Mismas reglas que 11.5.1. Efectos sin cambios: nuevo `password_hash`, `debe_cambiar_password = true`, `password_actualizado_en = NULL`. Respuesta `200 {ok:true, usuario_id, usuario, password_temporal, modo_password, aviso}`.

### 11.5.3 Códigos de error nuevos (se suman a §10.7.1)

| Caso | HTTP | `codigo` | Mensaje |
|---|---|---|---|
| `modo_password:"manual"` sin `password_manual` (o vacía) | **422** | `password_manual_requerida` | "Escribe la contraseña que quieres asignar." |
| `password_manual` < 10 o > 128 caracteres, o sin letra y número | **422** | `password_debil` | "La contraseña debe tener al menos 10 caracteres e incluir una letra y un número." |
| `modo_password` con un valor distinto de `automatica`/`manual` | **422** | `payload_invalido` | "Datos inválidos." |

**Todas las reglas de §10.7 se mantienen intactas** y se evalúan **antes** que el modo de contraseña: solo `admin`/`editor_datos` (401/403 en otro caso), D23 `rol_no_asignable`, `usuario_duplicado` (409), `regional_requerida`/`regional_no_aplica`/`regional_invalida`, inmutabilidad del login, sin `DELETE`, auto-desactivación y último admin activo.

## 11.6 Pantallas afectadas (delta sobre §10.8)

### 11.6.1 `/cambiar-password` — `CambiarPassword.tsx` (reemplaza el diseño de §10.8.4 en lo relativo a `input-password-actual`)

Sigue habiendo un solo componente con dos modos, entrada y redirecciones **idénticas** a §10.8.4. Único cambio: la visibilidad del campo de contraseña actual.

| Modo | `input-password-actual` | Resto |
|---|---|---|
| **Obligatorio** (`debe_cambiar_password === true`) | **NO se renderiza** (0 elementos en el DOM). El body enviado **no** incluye `password_actual`. | Se muestra `[data-testid="aviso-cambio-obligatorio"]` con el texto: *"Por seguridad, define tu nueva contraseña para empezar a usar el sistema."* Navegación bloqueada igual que en §10.8.4 (solo "Cerrar sesión"). Sin botón "Cancelar". |
| **Voluntario** (`debe_cambiar_password === false`) | **Se renderiza y es obligatorio** (`type="password"`), igual que hoy. | Sin aviso de obligatoriedad; con botón "Cancelar". Sin cambios respecto de §10.8.4. |

- Campos en modo obligatorio: `input-password-nueva` + `input-password-confirmar` + `btn-cambiar-password` ("Cambiar contraseña"), dentro de `[data-testid="form-cambio-password"]`.
- Validación en cliente (sin llamar a la API), mensaje en `[data-testid="error-password"]`: mínimo 10 caracteres, al menos una letra y un número, `nueva === confirmar`. La regla "distinta de la actual" solo se valida en cliente en modo voluntario (en obligatorio la valida el backend contra el hash y se muestra `error.mensaje`).
- Éxito, refresco de perfil y redirect por rol: **exactamente** como §10.8.4.

### 11.6.2 `FormUsuario.tsx` — bloque de modo de contraseña (solo en alta)

Debajo de `select-regional`, en el formulario de **alta**, se agrega:

- `[data-testid="select-modo-password"]` con dos opciones: **"Generar automática"** (`value="automatica"`, **seleccionada por defecto**) y **"Escribir yo mismo"** (`value="manual"`).
- Al elegir `manual` aparece `[data-testid="input-password-manual"]` (`type="password"`) con la etiqueta "Contraseña para el usuario" y la ayuda *"Mínimo 10 caracteres, con al menos una letra y un número. El usuario deberá cambiarla en su primer inicio de sesión."*
- Al elegir `automatica` el campo **se oculta y se limpia**, y el body enviado **no** incluye `password_manual`.
- Validación en cliente antes de llamar a la API: si el modo es `manual` y la contraseña está vacía o no cumple la política, se muestra `[data-testid="error-password-manual"]` en español y **no** se llama a la API.
- En **edición** de un usuario existente este bloque **no se renderiza** (la contraseña se cambia solo por "Resetear contraseña"), coherente con §10.7.1 `campo_no_editable`.

### 11.6.3 Reset de contraseña — `ModalResetPassword.tsx` (nuevo, reemplaza el `confirm()` simple de §10.8.1)

`btn-reset-password` de la fila ya no abre una confirmación de texto plano, sino un modal `[data-testid="modal-reset-password"]` con:

- Título "Resetear contraseña de &lt;usuario&gt;" y el aviso *"Se asignará una contraseña nueva y el usuario deberá cambiarla al entrar."*
- `[data-testid="select-modo-password-reset"]` con las mismas dos opciones (`automatica` por defecto) y, en modo manual, `[data-testid="input-password-manual-reset"]` con la misma validación y `[data-testid="error-password-manual"]`.
- Botones `[data-testid="btn-confirmar-reset"]` ("Resetear contraseña") y `[data-testid="btn-cancelar-reset"]` ("Cancelar").
- Al confirmar con éxito se cierra y se abre `[data-testid="modal-password-temporal"]` (§10.8.3) **sin cambios**: mismo aviso de "no se volverá a mostrar", `[data-testid="texto-password-temporal"]`, `btn-copiar-password` y `btn-cerrar-modal-password`; al cerrar, la contraseña se borra del estado de React y no queda en el DOM ni en almacenamiento local. Cuando el modo fue `manual`, el título del modal es **"Contraseña asignada"** en lugar de "Contraseña temporal generada" (el resto del contenido y los `data-testid` no cambian).

### 11.6.4 Resto de la PWA

Sin cambios: `/usuarios` (filtros, tabla, badges, toggle activo, ausencia total de borrado), menú de usuario, `RutaProtegida`, y los interceptores de `cambio_password_requerido` (403) y `cuenta_desactivada` (401) de §10.8.5 quedan **idénticos**.

## 11.7 Archivos

**Nuevo:** `pwa/src/componentes/ModalResetPassword.tsx`.

**Modificados:** `backend/src/rutas/miCuenta.ts` (validación condicional), `backend/src/rutas/usuarios.ts` (modo de contraseña en E35/E37), `backend/src/servicios/usuarios.ts`, `packages/shared/src/usuarios.ts` (esquemas Zod y política reutilizada), `pwa/src/pantallas/CambiarPassword.tsx`, `pwa/src/componentes/FormUsuario.tsx`, `pwa/src/pantallas/Usuarios.tsx`, `pwa/src/componentes/ModalPasswordTemporal.tsx` (título condicional), `README.md`.

**Sin migración nueva, sin dependencias npm nuevas, sin variables de entorno nuevas, sin comandos nuevos**: todo sigue corriendo con `docker compose up --build`. Código comentado en español, UI en español.

## 11.8 Criterios de §10 que quedan MODIFICADOS por esta sección

El texto original de §10 **no se toca**; esta lista le dice al Evaluator qué comportamiento viejo **ya no aplica**. Todo criterio de §10 no listado aquí sigue vigente sin cambios.

| Criterio §10 | Qué cambia | Cómo se evalúa ahora |
|---|---|---|
| **179** | Sigue pasando tal cual (enviar `password_actual` correcta con el flag en `true` sigue devolviendo 200), pero **ya no es la única forma válida**: el mismo `PATCH` **sin** `password_actual` también debe devolver 200. Se evalúa como aprobado si cualquiera de las dos variantes funciona; la variante sin `password_actual` es obligatoria y se verifica en el criterio 213. |
| **182** | Los sub-casos `password_actual_incorrecta` y el rechazo por contraseña actual **solo aplican en modo voluntario** (`debe_cambiar_password = false`). Con el flag en `true`, una `password_actual` incorrecta **NO** debe producir error. Los sub-casos `password_debil` y `password_repetida` siguen aplicando en ambos modos. |
| **206** | **MODIFICADO.** Ya **no** debe existir `input-password-actual` en el flujo obligatorio: el criterio se considera aprobado si tras iniciar sesión con la contraseña temporal se llega a `/cambiar-password` con `[data-testid="aviso-cambio-obligatorio"]` y `[data-testid="form-cambio-password"]` conteniendo **solo** `input-password-nueva` e `input-password-confirmar`. La presencia de `input-password-actual` en este modo es **fallo** (ver criterio 212). |
| **199 / 200** | El formulario de alta gana el bloque `select-modo-password`. Ambos criterios siguen aplicando tal cual (con el modo por defecto `automatica` el flujo es idéntico al de §10). |
| **203** | El reset ahora pasa por `[data-testid="modal-reset-password"]` antes de abrir el modal de contraseña. El criterio sigue aplicando: el resultado final debe ser un `[data-testid="texto-password-temporal"]` con valor distinto al anterior. |

---

## 11.9 Rubric extendido (criterios 212–237)

Continúa la numeración de §7, §8.11, §9.9 y §10.11. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_CAP`, `T_AUD`, `T_EDIT`.

### API — cambio de contraseña obligatorio sin contraseña actual (212–217)

212. Preparación: `POST $API/api/usuarios` con `T_ADMIN` crea `qa_simple` (rol `capturista`, con Regional) y devuelve **201** con `password_temporal`; `POST /api/auth/login` con esa temporal devuelve **200** con `token` (`T_SIMPLE`) y `usuario.debe_cambiar_password === true`.
213. `PATCH $API/api/mi-cuenta/password` con `T_SIMPLE` y body **`{"password_nueva":"NuevaClave2026"}`** (sin `password_actual`) devuelve **200** con `ok:true` y `debe_cambiar_password:false`; en BD `debe_cambiar_password = false` y `password_actualizado_en IS NOT NULL`.
214. Tras 213, `POST /api/auth/login` con `qa_simple` + `NuevaClave2026` devuelve **200** con `token`, y con la temporal anterior devuelve **401** sin `token`.
215. Con un usuario en flujo obligatorio (crear `qa_simple2` y loguear con su temporal), `PATCH /api/mi-cuenta/password` con `{"password_actual":"ESTO_ES_INCORRECTO","password_nueva":"OtraClave2026"}` devuelve **200** (la `password_actual` se ignora cuando el flag está en `true`), y el login posterior con `OtraClave2026` devuelve **200**.
216. Con un usuario en flujo obligatorio, `PATCH /api/mi-cuenta/password` con `{"password_nueva":"abc"}` devuelve **422** `password_debil`, y con `password_nueva` igual a su contraseña temporal vigente devuelve **422** `password_repetida`; en ambos casos `debe_cambiar_password` en BD sigue en **true**.
217. Tras un cambio obligatorio exitoso, el **mismo token** usado en 213 (sin volver a iniciar sesión) permite `GET $API/api/catalogos` con **200**.

### API — el flujo voluntario NO se relaja (218–221)

218. Con `T_AUD` (usuario `auditor1`, `debe_cambiar_password = false`), `PATCH $API/api/mi-cuenta/password` con **`{"password_nueva":"IntentoSinActual1"}`** (sin `password_actual`) devuelve **422** con `error.codigo === "password_actual_requerida"`, y el `password_hash` de `auditor1` en BD **no** cambia.
219. Con `T_AUD`, `PATCH /api/mi-cuenta/password` con `{"password_actual":"INCORRECTA","password_nueva":"IntentoValido1"}` devuelve **422** `password_actual_incorrecta` y el `password_hash` en BD **no** cambia.
220. Con `T_AUD` y la contraseña actual correcta + `password_nueva` válida, `PATCH /api/mi-cuenta/password` devuelve **200**; el login con la nueva contraseña devuelve **200** y `usuario.debe_cambiar_password === false` (el cambio voluntario no activa el flag).
221. `PATCH /api/mi-cuenta/password` sin header `Authorization` devuelve **401**, y con un body que incluya una clave extra (p. ej. `{"password_nueva":"Valida12345","rol":"admin"}`) devuelve **422** y el rol del usuario en BD no cambia.

### API — contraseña manual en creación y reset (222–229)

222. `POST $API/api/usuarios` con `T_ADMIN` y `{"usuario":"qa_manual","nombre_completo":"QA Manual","rol":"capturista","regional_id":<válido>,"modo_password":"manual","password_manual":"ClaveManual2026"}` devuelve **201** con `ok:true`, `modo_password:"manual"` y `password_temporal === "ClaveManual2026"`.
223. `POST /api/auth/login` con `qa_manual` + `ClaveManual2026` devuelve **200** con `token` y `usuario.debe_cambiar_password === true`; en BD `SELECT activo, debe_cambiar_password FROM usuarios WHERE usuario='qa_manual'` devuelve `true, true`.
224. `POST /api/usuarios` con `modo_password:"manual"` y **sin** `password_manual` devuelve **422** `password_manual_requerida`; con `"password_manual":"abc"` devuelve **422** `password_debil`; con `"password_manual":"solosinnumeros"` devuelve **422** `password_debil`. En los tres casos `SELECT count(*) FROM usuarios` **no** aumenta.
225. `POST /api/usuarios` con `modo_password:"automatica"` y `password_manual:"ClaveIgnorada2026"` devuelve **201** y la `password_temporal` devuelta **no** es `"ClaveIgnorada2026"` (mide 14 caracteres y respeta el alfabeto sin ambiguos de §10.4); el login con `ClaveIgnorada2026` para ese usuario devuelve **401**.
226. `POST /api/usuarios` **sin** la clave `modo_password` (body exacto de §10.7) sigue devolviendo **201** con una `password_temporal` de 14 caracteres (retrocompatibilidad).
227. `POST $API/api/usuarios/<id de qa_manual>/reset-password` con `T_ADMIN` y `{"modo_password":"manual","password_manual":"ResetManual2026"}` devuelve **200** con `password_temporal === "ResetManual2026"` y `modo_password:"manual"`; en BD `debe_cambiar_password` vuelve a **true** y el `password_hash` cambió; el login con `ResetManual2026` devuelve **200** y con `ClaveManual2026` devuelve **401**.
228. `POST /api/usuarios/<id>/reset-password` con `{"modo_password":"manual","password_manual":"corta1"}` devuelve **422** `password_debil` y el `password_hash` en BD **no** cambia; el mismo endpoint sin `modo_password` sigue devolviendo **200** con una temporal de 14 caracteres.
229. `POST /api/usuarios` y `POST /api/usuarios/:id/reset-password` con `modo_password:"manual"` usando `T_CAP` o `T_AUD` devuelven **403**; con `T_EDIT` sobre un usuario de rol `admin` devuelven **403** `rol_no_asignable`. Ninguna de las restricciones de §10.7 se relajó.

### Seguridad y bitácora (230–232)

230. `SELECT count(*) FROM auditoria_log WHERE detalle::text ILIKE '%ClaveManual2026%' OR detalle::text ILIKE '%ResetManual2026%' OR detalle::text ILIKE '%NuevaClave2026%'` devuelve **0** (ninguna contraseña, ni manual ni nueva, se registra en la bitácora).
231. `information_schema.columns` para `usuarios` sigue sin ninguna columna que guarde contraseña en claro (única columna de credencial: `password_hash`) y no se agregó ni eliminó ninguna columna respecto del build 4; **no existe** ningún archivo `db/migrations/011_*.sql`.
232. `GET $API/api/auditoria/log` con `T_ADMIN` contiene al menos una entrada `usuario_creado` con `detalle.modo_password === "manual"` y al menos una entrada `password_cambiado` con `detalle.sin_password_actual === true`.

### PWA — cambio obligatorio simplificado (233–235)

233. Playwright: iniciar sesión con un usuario recién creado usando su contraseña inicial lleva a `/cambiar-password`, muestra `[data-testid="aviso-cambio-obligatorio"]` y `[data-testid="form-cambio-password"]`, y el conteo de `[data-testid="input-password-actual"]` en la página es **0**.
234. Playwright: en ese estado, llenar `input-password-nueva` e `input-password-confirmar` con `NuevaClavePwa2026` y pulsar `btn-cambiar-password` muestra un mensaje de éxito en español, saca al usuario de `/cambiar-password` a la pantalla de su rol, y al recargar ya no aparece `[data-testid="aviso-cambio-obligatorio"]`.
235. Playwright: con `capturista1` (flag en `false`), abrir "Cambiar mi contraseña" desde `[data-testid="menu-usuario"]` muestra `/cambiar-password` **con** `[data-testid="input-password-actual"]` visible (1 elemento) y **sin** `[data-testid="aviso-cambio-obligatorio"]`; enviar el formulario dejando vacía la contraseña actual muestra un error visible en español y no cambia la contraseña en BD.

### PWA — contraseña manual desde `/usuarios` (236–239)

236. Playwright con `admin` en `/usuarios`: pulsar `[data-testid="btn-nuevo-usuario"]` muestra `[data-testid="select-modo-password"]` con valor inicial `automatica` y **sin** `[data-testid="input-password-manual"]` visible; al seleccionar "Escribir yo mismo" aparece `[data-testid="input-password-manual"]`.
237. Playwright: con modo manual y una contraseña de 4 caracteres, pulsar "Guardar" muestra `[data-testid="error-password-manual"]` con mensaje en español y **no** crea el usuario (no aparece fila nueva en `[data-testid="tabla-usuarios"]` tras recargar).
238. Playwright: crear un usuario en modo manual con `ClavePwaManual2026` abre `[data-testid="modal-password-temporal"]` cuyo `[data-testid="texto-password-temporal"]` es exactamente `ClavePwaManual2026` y que muestra el aviso de que no se volverá a mostrar; tras cerrar el modal y recargar `/usuarios`, esa cadena **no** aparece en el DOM y el usuario sí aparece en la tabla como "Activo" con el badge "Cambio pendiente".
239. Playwright: pulsar `[data-testid="btn-reset-password"]` en esa fila abre `[data-testid="modal-reset-password"]` con `[data-testid="select-modo-password-reset"]`; elegir "Escribir yo mismo", escribir `ClaveReset2026`, confirmar con `[data-testid="btn-confirmar-reset"]` abre `[data-testid="modal-password-temporal"]` mostrando exactamente `ClaveReset2026`; con la opción por defecto (`automatica`) el valor mostrado es una cadena de 14 caracteres distinta.

### Documentación (240)

240. `README.md` documenta, en la sección de administración de usuarios: (a) que en el **primer inicio de sesión obligatorio no se pide la contraseña actual** y por qué (el usuario ya se autenticó con ella); (b) que el **cambio voluntario sí la sigue pidiendo**; (c) que `admin`/`editor_datos` pueden elegir entre **"Generar automática"** y **"Escribir yo mismo"** al crear o resetear; (d) que en **ambos** modos el usuario queda obligado a cambiar la contraseña en su primer acceso; y (e) que la contraseña se sigue mostrando **una sola vez** y no se puede reconsultar.

**Definición de "terminado" (build 5):** los **240** criterios pasan (211 acumulados de los builds 1–4, con las excepciones de §11.8 evaluadas según el comportamiento nuevo, + 29 de esta extensión).

# 12. EXTENSIÓN — Módulo de captura de Solicitud de Apoyo en ventanilla (build 6)

> **CONTINUACIÓN LITERAL DE `SPEC.md`.** Esta sección se **agrega al final** de `SPEC.md` (después de la línea "Definición de 'terminado' (build 5)"). **Nada de las secciones 1–11 se reescribe ni se renegocia**: todas sus reglas siguen vigentes palabra por palabra. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios (`db`, `backend`, `pwa`). **No se crea ningún servicio nuevo**, no se toca `pwa/nginx.conf.template` ni el mecanismo `BACKEND_HOST`/`BACKEND_PORT`, y **no se agrega ninguna dependencia npm nueva** (ver §12.12). Código comentado en español, UI en español.

## 12.1 Objetivo de la extensión

Agregar un **módulo de ventanilla/oficina** que permita a personal de las Direcciones Regionales y de SEDEA central **recibir y capturar en vivo una Solicitud de Apoyo nueva** (el alta de beneficiario que existía en AppSheet), replicando la estructura de los dos formularios oficiales en papel del programa, generando el **folio oficial** (`PEO-SJR-AME-0001-26`), calculando dinámicamente la **lista de documentos requeridos** según Componente / Tipo de persona / Proyecto / Concepto, y creando automáticamente los **beneficiarios de producción** que quedan disponibles para el flujo de captura de campo ya existente.

Hasta el build 5 la única forma de dar de alta beneficiarios era la **importación masiva** de un padrón vía staging (§8). Este build agrega la vía **uno por uno, dirigida, en línea**.

## 12.2 Decisiones de producto (ya acordadas con el usuario — implementar tal cual, no preguntar)

- **D32. Pantalla de oficina, EN LÍNEA. No es offline-first.** Las pantallas de solicitudes son `online-only`, igual que `/depuracion` (§8.8) y `/dashboard` (§9.6): **no** usan Dexie/IndexedDB, **no** se registran en la cola de sync (`pwa/src/sync/*`), **no** se toca el service worker más allá del app-shell ya existente. Sin red muestran "Esta sección requiere conexión a internet." **Ni una línea de `pwa/src/sync/` ni de `pwa/src/db/indexeddb.ts` se modifica en este build.**
- **D33. La solicitud entra DIRECTO a producción.** No pasa por `staging_beneficiarios` ni por aprobación humana. Es captura dirigida por personal capacitado, una a una. Esto **no** contradice §8.6 (el importador CLI sigue escribiendo únicamente en staging) ni D11 de §9.2 (sigue sin existir `POST /api/beneficiarios`: los beneficiarios de este build nacen **derivados** de una solicitud, nunca por alta manual suelta).
- **D34. Rol nuevo `ventanilla`**, con acceso **exclusivo** al módulo de solicitudes. No ve `/depuracion`, `/correcciones`, `/usuarios`, `/dashboard`, `/auditoria`, `/beneficiarios`, `/sync` ni `/api/auditoria/*`. `admin` también usa el módulo, **sin restricción de alcance**.
- **D35. Alcance granular por usuario `ventanilla`** mediante dos tablas de relación muchos-a-muchos: `usuario_municipios` y `usuario_componentes`. Un usuario puede tener **"todos"** (sin restricción, equivalente al valor `ADMIN` de las columnas `MUNICIPIOS`/`COMPONENTES` del Excel real de AppSheet) o una lista concreta (equivalente a `18 / 12 / 17 / 15`).
- **D36. El alcance se aplica en el BACKEND, no solo en la UI.** Al crear una solicitud, el `municipio_id` de la Ubicación del apoyo (§12.6 sección 4.1) y el `componente_id` elegidos deben estar dentro del alcance del usuario autenticado. Si no, **403**. La UI además filtra los selects, pero eso es cosmético.
- **D37. La columna `DICTAMINAR` del Excel real de usuarios NO se modela.** La etapa de dictamen / autorización / pago sigue **fuera de alcance** del sistema completo (decisión original del proyecto: este sistema es de captura + auditoría, no de gestión del flujo de aprobación). `solicitudes` no tiene estado de dictamen, ni flujo de aprobación, ni montos autorizados.
- **D38. `solicitudes` es una tabla NUEVA.** Sus columnas **no** se fusionan dentro de `beneficiarios` (evita inflar la tabla que el capturista de campo descarga a IndexedDB con sexo, fecha de nacimiento, correo, actividad económica, montos y declaraciones). `beneficiarios` gana **una sola** columna nueva: `solicitud_id` (nullable, FK).
- **D39. Un beneficiario por concepto solicitado.** Al guardar una solicitud, el backend crea **una fila en `beneficiarios` por cada fila de `solicitud_conceptos`** (mismo patrón multi-concepto ya usado en §8: multi-concepto = múltiples beneficiarios/capturas separadas, nunca una fila con dos apoyos).
- **D40. La ubicación del apoyo (§12.6 sección 4.1) es la que alimenta `beneficiarios`**, NO el domicilio particular del solicitante (sección 2.2). Son dos domicilios distintos y **no se fusionan jamás**: el capturista de campo debe ir al predio del proyecto, no a la casa del solicitante.
- **D41. El folio lo genera el backend.** El usuario **nunca** lo escribe. Es de solo lectura en la UI y se muestra al confirmar el guardado.
- **D42. Sin geolocalización del navegador en esta pantalla.** Las coordenadas de la sección 4.1 son un **campo de texto libre** (lo que el productor declara en papel). La coordenada real y verificada del predio se captura después en campo con la app existente (§3.1). **No se llama a `navigator.geolocation` en ninguna pantalla de este build.**
- **D43. Los adjuntos de documentos reutilizan la infraestructura de almacenamiento de fotos** (`backend/src/servicios/almacenamiento.ts`, driver `local`, `MEDIA_DIR`, servido por `GET /media/*` = E15). Solo cambian la subcarpeta y la tabla. **No se agrega ningún driver ni variable de entorno nueva.**
- **D44. Sin edición ni borrado de solicitudes en este build.** Se crea y se consulta. No hay `PATCH /api/solicitudes/:id` ni `DELETE`. Lo único mutable después del alta es el checklist de documentos (marcar recibido / adjuntar archivo). Corregir datos del beneficiario derivado se sigue haciendo por §9.4 (`PATCH /api/beneficiarios/:id`, roles `editor_datos`/`admin`).

## 12.3 Modelo de datos

Todo **aditivo e idempotente** (la BD de producción ya tiene datos). Ninguna columna existente se elimina, renombra ni cambia de tipo — el criterio 112 de §9.9 y el 231 de §11.9 siguen pasando.

> **Numeración de migraciones:** el criterio **231** de §11.9 afirma que **no existe** ningún archivo `db/migrations/011_*.sql`. Para no invalidarlo, este build usa **`012_`** y **`013_`**. El hueco en el 011 es intencional y se documenta con un comentario en `db/README.md`. **No se crea ningún archivo `011_*.sql`.**

### 12.3.1 `db/migrations/012_ventanilla_catalogos.sql`

```sql
-- Rol nuevo 'ventanilla' (build 6). Se conservan los 4 roles anteriores.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('capturista','auditor','admin','editor_datos','ventanilla'));

-- Siglas de 3 letras del municipio para el folio oficial (ej. AME = Amealco).
-- Nullable a propósito: se llenan por catálogo/admin; hay fallback determinista (§12.5).
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS siglas_folio TEXT;

-- Clave de 3 letras de la Regional para el folio oficial (SJR/CAD/JAL/QRO).
ALTER TABLE direcciones_regionales ADD COLUMN IF NOT EXISTS clave_folio TEXT;
```

Más las 6 tablas de catálogo de este build:

**`programas`**

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | |
| nombre | TEXT NOT NULL | |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

**`subprogramas`**

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| programa_id | BIGINT NOT NULL REFERENCES programas(id) | |
| clave | TEXT NOT NULL | |
| nombre | TEXT NOT NULL | |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |
| UNIQUE (programa_id, clave) | | |

**`componentes`** — exactamente 3 filas (§12.4).

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | `TR`, `CAA`, `DIN` |
| nombre | TEXT NOT NULL | |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

**`proyectos`**

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | |
| nombre | TEXT NOT NULL | |
| prefijo_folio | TEXT NOT NULL | 2–5 letras mayúsculas, ej. `PEO` |
| componente_id | BIGINT REFERENCES componentes(id) | **NULLABLE a propósito** (Assumption 45) |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

**`ventanillas`** — las 5 ventanillas receptoras.

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| clave | TEXT UNIQUE NOT NULL | |
| nombre | TEXT NOT NULL | |
| regional_id | BIGINT NOT NULL REFERENCES direcciones_regionales(id) | Regional que hereda el beneficiario |
| clave_folio | TEXT NOT NULL | segmento regional del folio |
| es_central | BOOLEAN NOT NULL DEFAULT FALSE | TRUE solo para SEDEA |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

**`documentos_requeridos`** — reglas de documentación (§12.7).

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| requisito | TEXT NOT NULL | texto del documento |
| componentes | TEXT[] | claves de `componentes`; `NULL`/`{}` = aplica a todos |
| tipos_persona | TEXT[] | `fisica`/`moral`/`grupo`; `NULL`/`{}` = aplica a todos |
| proyecto_id | BIGINT REFERENCES proyectos(id) | NULL = no depende de proyecto |
| apoyo_id | BIGINT REFERENCES tipos_apoyo(id) | regla específica de un concepto exacto |
| apoyo_etiquetas | TEXT[] | etiquetas crudas del Excel real cuando no hay `tipos_apoyo` exacto (ej. `{'PROYECTOS PECUARIOS'}`) |
| apoyo_excluir_id | BIGINT REFERENCES tipos_apoyo(id) | excepción por concepto exacto |
| apoyo_excluir_etiquetas | TEXT[] | excepciones por etiqueta (ej. `{'FERTILIZANTES','SEMILLA'}`) |
| orden | INTEGER NOT NULL DEFAULT 0 | orden de presentación |
| activo | BOOLEAN NOT NULL DEFAULT TRUE | |

Índices: `idx_docsreq_activo (activo)`, GIN sobre `componentes` y `tipos_persona`.

### 12.3.2 `db/migrations/013_solicitudes.sql`

**`solicitudes`**

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| folio | TEXT UNIQUE NOT NULL | generado por §12.5 |
| recibida_en | TIMESTAMPTZ NOT NULL DEFAULT now() | fecha de recepción |
| capturado_por | BIGINT NOT NULL REFERENCES usuarios(id) | |
| programa_id | BIGINT NOT NULL REFERENCES programas(id) | |
| subprograma_id | BIGINT REFERENCES subprogramas(id) | nullable |
| componente_id | BIGINT NOT NULL REFERENCES componentes(id) | selección única |
| proyecto_id | BIGINT NOT NULL REFERENCES proyectos(id) | aporta el prefijo del folio |
| ventanilla_id | BIGINT NOT NULL REFERENCES ventanillas(id) | |
| regional_id | BIGINT NOT NULL REFERENCES direcciones_regionales(id) | derivado de la ventanilla |
| **— Sección 2.1 Datos personales —** | | |
| tipo_persona | TEXT NOT NULL CHECK (tipo_persona IN ('fisica','moral','grupo')) | |
| nombre_solicitante | TEXT NOT NULL | solicitante / representante de grupo / representante legal |
| sexo | TEXT CHECK (sexo IN ('H','M')) | |
| fecha_nacimiento | DATE | |
| correo | TEXT | |
| telefono | TEXT | 10 dígitos normalizados |
| curp | TEXT | |
| razon_social | TEXT | obligatoria si `tipo_persona` ∈ (`moral`,`grupo`) |
| num_integrantes | INTEGER | obligatorio si `tipo_persona` ∈ (`moral`,`grupo`) |
| **— Sección 2.2 Domicilio particular del solicitante —** | | |
| dom_municipio_id | BIGINT REFERENCES municipios(id) | |
| dom_localidad | TEXT | |
| dom_delegacion | TEXT | |
| dom_cp | TEXT | |
| dom_tipo_asentamiento | TEXT CHECK (… IN ('colonia','fraccionamiento','ejido','pueblo','rancho')) | |
| dom_asentamiento | TEXT | nombre del asentamiento |
| dom_tipo_vialidad | TEXT CHECK (… IN ('avenida','boulevard','calzada','calle','privada','otra')) | |
| dom_vialidad | TEXT | nombre de la vialidad y número |
| **— Sección 3 Actividad económica —** | | |
| act_agricola | BOOLEAN NOT NULL DEFAULT FALSE | |
| agr_superficie_total_ha / agr_superficie_siembra_ha / agr_temporal_ha / agr_riego_ha | NUMERIC(12,3) | |
| agr_cultivo_principal | TEXT | |
| act_ganadera | BOOLEAN NOT NULL DEFAULT FALSE | |
| gan_tipo_ganado | TEXT | |
| gan_num_cabezas | INTEGER | cabezas o colmenas |
| gan_superficie_agostadero_ha | NUMERIC(12,3) | |
| gan_produccion | TEXT CHECK (… IN ('intensiva','traspatio','extensiva')) | |
| act_acuicola | BOOLEAN NOT NULL DEFAULT FALSE | |
| acu_especies | TEXT | |
| act_pesca | BOOLEAN NOT NULL DEFAULT FALSE | |
| pes_especies | TEXT | |
| **— Sección 4 Datos del apoyo —** | | |
| descripcion_proyecto | TEXT | texto largo |
| ben_hombres_total / ben_hombres_discapacidad / ben_hombres_lengua_indigena | INTEGER NOT NULL DEFAULT 0 | |
| ben_mujeres_total / ben_mujeres_discapacidad / ben_mujeres_lengua_indigena | INTEGER NOT NULL DEFAULT 0 | |
| **— Sección 4.1 Ubicación del apoyo (alimenta `beneficiarios`) —** | | |
| ubi_municipio_id | BIGINT NOT NULL REFERENCES municipios(id) | |
| ubi_localidad | TEXT | |
| ubi_ejido | TEXT | |
| ubi_coordenadas | TEXT | **texto libre**, sin `navigator.geolocation` (D42) |
| **— Sección 6 Declaraciones —** | | |
| declaracion_aceptada | BOOLEAN NOT NULL | debe ser TRUE para guardar |
| declaracion_version | TEXT NOT NULL DEFAULT 'v1-2026' | versión del texto legal aceptado |
| observaciones | TEXT | |
| origen | TEXT NOT NULL DEFAULT 'solicitud_ventanilla' | |
| datos_extra | JSONB NOT NULL DEFAULT '{}' | |
| creado_en / actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Índices: `idx_sol_folio (folio)`, `idx_sol_regional (regional_id)`, `idx_sol_ubi_municipio (ubi_municipio_id)`, `idx_sol_componente (componente_id)`, `idx_sol_capturado_por (capturado_por)`, `idx_sol_recibida (recibida_en)`.

**`solicitud_conceptos`** (mínimo 1 fila por solicitud, sin máximo)

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| solicitud_id | BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE | |
| orden | INTEGER NOT NULL | 1..N, orden de captura |
| tipo_apoyo_id | BIGINT NOT NULL REFERENCES tipos_apoyo(id) | catálogo existente (152 conceptos, §8.7) |
| descripcion | TEXT | |
| cantidad | NUMERIC(14,3) NOT NULL | |
| unidad_medida | TEXT | |
| monto_estatal | NUMERIC(14,2) NOT NULL DEFAULT 0 | apoyo estatal $ |
| monto_productor | NUMERIC(14,2) NOT NULL DEFAULT 0 | aportación del productor $ |
| monto_total | NUMERIC(14,2) NOT NULL DEFAULT 0 | inversión total $ (editable, §12.6) |
| beneficiario_id | BIGINT REFERENCES beneficiarios(id) | el beneficiario creado por D39 |
| creado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| UNIQUE (solicitud_id, orden) | | |

**`solicitud_documentos`** (checklist materializado al crear la solicitud)

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGSERIAL PK | |
| solicitud_id | BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE | |
| documento_requerido_id | BIGINT REFERENCES documentos_requeridos(id) | NULL si fue agregado a mano |
| requisito | TEXT NOT NULL | copia del texto al momento del alta (histórico inmutable) |
| recibido | BOOLEAN NOT NULL DEFAULT FALSE | |
| archivo_url | TEXT | `/media/solicitudes/YYYY/MM/<uuid>.<ext>` |
| archivo_hash | TEXT | sha256 |
| archivo_nombre | TEXT | nombre original recortado a 200 chars |
| observaciones | TEXT | |
| actualizado_por | BIGINT REFERENCES usuarios(id) | |
| creado_en / actualizado_en | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| UNIQUE (solicitud_id, requisito) | | evita duplicar el mismo requisito |

**`solicitud_folios`** (contador atómico del consecutivo, §12.5)

| Columna | Tipo | Notas |
|---|---|---|
| prefijo | TEXT NOT NULL | prefijo del proyecto |
| clave_regional | TEXT NOT NULL | |
| siglas_municipio | TEXT NOT NULL | |
| anio | SMALLINT NOT NULL | año a 2 dígitos |
| consecutivo | INTEGER NOT NULL DEFAULT 0 | último usado |
| PRIMARY KEY (prefijo, clave_regional, siglas_municipio, anio) | | |

**`usuario_municipios`**

| Columna | Tipo | Notas |
|---|---|---|
| usuario_id | BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE | |
| municipio_id | BIGINT NOT NULL REFERENCES municipios(id) | |
| PRIMARY KEY (usuario_id, municipio_id) | | |

**`usuario_componentes`**

| Columna | Tipo | Notas |
|---|---|---|
| usuario_id | BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE | |
| componente_id | BIGINT NOT NULL REFERENCES componentes(id) | |
| PRIMARY KEY (usuario_id, componente_id) | | |

Semántica del alcance (D35): **cero filas = "todos"** (sin restricción). ≥1 fila = restringido a esa lista. Se documenta como Assumption 44.

**Columna nueva en `beneficiarios`** (única alteración de una tabla existente en este build):

```sql
ALTER TABLE beneficiarios ADD COLUMN IF NOT EXISTS solicitud_id BIGINT REFERENCES solicitudes(id);
CREATE INDEX IF NOT EXISTS idx_benef_solicitud ON beneficiarios (solicitud_id);
```

### 12.3.3 Valores nuevos de `auditoria_log.accion` (columna TEXT libre; el esquema no cambia)

| `accion` | `entidad` | `entidad_id` | `detalle` (JSONB) |
|---|---|---|---|
| `solicitud_creada` | `solicitud` | id de la solicitud | `{folio, origen:"solicitud_ventanilla", componente:"TR", proyecto:"PEO", ventanilla:"VEN-SJR", tipo_persona, municipio_id, conceptos:N, beneficiarios_creados:[{id,folio}], documentos_requeridos:N}` |
| `solicitud_documento_actualizado` | `solicitud_documento` | id de la fila | `{solicitud_id, requisito, recibido_anterior, recibido_nuevo}` |
| `solicitud_documento_adjuntado` | `solicitud_documento` | id de la fila | `{solicitud_id, requisito, archivo_url, bytes, mimetype}` |
| `alcance_usuario_actualizado` | `usuario` | id del usuario | `{municipios_anterior:[…], municipios_nuevo:[…], componentes_anterior:[…], componentes_nuevo:[…]}` |

`detalle` **nunca** contiene CURP completa ni contraseñas (se registra `municipio_id`, no el domicilio).

## 12.4 Semillas (`db/seeds/`)

Idempotentes (`ON CONFLICT … DO UPDATE`), en archivos nuevos. No se modifica ningún seed anterior salvo `005_ventanilla_demo.sql`, que **agrega** usuarios demo sin tocar los existentes.

`db/seeds/005_ventanilla_catalogos.sql`:

- `programas`: **1 fila** — `PRG-2026` / "Apoyo al Campo Queretano 2026".
- `subprogramas`: **1 fila** — `SUB-IP` / "Impulso a la Productividad", ligada a `PRG-2026`.
- `componentes`: **exactamente 3 filas** —

  | clave | nombre |
  |---|---|
  | `TR` | Tecnificación del Riego |
  | `CAA` | Captación y Almacenamiento de Agua |
  | `DIN` | Dinamismo Agroalimentario |

- `proyectos`: **1 fila** — clave `PEO`, nombre "Proyectos Estratégicos para el Fortalecimiento Organizativo", `prefijo_folio='PEO'`, `componente_id = NULL` (Assumption 45).
- `direcciones_regionales.clave_folio` se actualiza: `REG-01`→`CAD`, `REG-02`→`JAL`, `REG-03`→`QRO`, `REG-04`→`SJR`.
- `ventanillas`: **exactamente 5 filas** —

  | clave | nombre | regional | clave_folio | es_central |
  |---|---|---|---|---|
  | `VEN-QRO` | Regional Querétaro | REG-03 | `QRO` | false |
  | `VEN-SJR` | Regional San Juan del Río | REG-04 | `SJR` | false |
  | `VEN-CAD` | Regional Cadereyta | REG-01 | `CAD` | false |
  | `VEN-JAL` | Regional Jalpan | REG-02 | `JAL` | false |
  | `VEN-SED` | SEDEA (Central) | REG-03 | `SED` | **true** |

- `municipios.siglas_folio`: se llena para los municipios demo con el **fallback determinista** de §12.5 (`UPDATE municipios SET siglas_folio = <fallback> WHERE siglas_folio IS NULL`), salvo `Amealco de Bonfil` que se siembra explícitamente como `AME` (es el caso del folio de ejemplo real).
- `documentos_requeridos`: **exactamente 42 filas** — las 34 reglas reales de la hoja `DOCUMENTACIÓN` (§12.7.1) + las 8 reglas del anexo PEO (§12.7.2).

`db/seeds/006_usuarios_ventanilla_demo.sql`:

- `ventanilla1`: rol `ventanilla`, `regional_id = REG-04` (San Juan del Río), alcance **restringido**: 2 municipios de esa Regional en `usuario_municipios` y **1** componente (`TR`) en `usuario_componentes`. Contraseña desde `SEED_VENTANILLA_PASSWORD` con fallback a `SEED_ADMIN_PASSWORD`, `debe_cambiar_password = FALSE` (igual que el resto de usuarios demo, para que el Evaluator pueda entrar directo).
- `ventanilla2`: rol `ventanilla`, `regional_id = NULL`, **sin filas** en `usuario_municipios` ni `usuario_componentes` ⇒ alcance **"todos"** (perfil SEDEA central).

Variable nueva en `.env.example`: `SEED_VENTANILLA_PASSWORD=cambiame123`. **Es la única variable nueva del build** y tiene fallback, así que un `.env` viejo sigue arrancando.

## 12.5 Algoritmo del folio (`backend/src/servicios/folios.ts`)

Formato exacto, replicando el ejemplo real `PEO-SJR-AME-0001-26`:

```
{prefijo_proyecto}-{clave_regional}-{siglas_municipio}-{consecutivo 4 dígitos}-{año 2 dígitos}
```

1. **`prefijo_proyecto`** = `proyectos.prefijo_folio` del proyecto elegido (mayúsculas).
2. **`clave_regional`** = `ventanillas.clave_folio` de la ventanilla receptora elegida (`SJR`/`CAD`/`JAL`/`QRO`/`SED`). Se toma de la ventanilla, no del municipio, porque el folio identifica **quién recibió** la solicitud.
3. **`siglas_municipio`** = `municipios.siglas_folio` del municipio de la **Ubicación del apoyo** (§4.1). Si es `NULL` o vacío, **fallback determinista**: tomar `municipios.nombre`, normalizar Unicode NFD y quitar diacríticos, pasar a mayúsculas, eliminar todo carácter que no sea `A-Z`, y tomar los **primeros 3** caracteres; si quedan menos de 3, rellenar a la derecha con `X`. Ejemplos: `Amealco de Bonfil`→`AME`, `San Juan del Río`→`SAN`, `El Marqués`→`ELM`.
4. **`año`** = últimos 2 dígitos del año de `recibida_en` en zona `America/Mexico_City`.
5. **`consecutivo`** = 4 dígitos con ceros a la izquierda, **autoincremental por la combinación (prefijo, clave_regional, siglas_municipio, año)**, empezando en `0001`. Se obtiene **dentro de la misma transacción** del alta con una operación atómica:

```sql
INSERT INTO solicitud_folios (prefijo, clave_regional, siglas_municipio, anio, consecutivo)
VALUES ($1,$2,$3,$4,1)
ON CONFLICT (prefijo, clave_regional, siglas_municipio, anio)
DO UPDATE SET consecutivo = solicitud_folios.consecutivo + 1
RETURNING consecutivo;
```

6. Si al insertar en `solicitudes` el `folio` chocara con el índice único (caso patológico de datos migrados), el backend reintenta **hasta 3 veces** tomando el siguiente consecutivo; al 4º fallo responde **500** `folio_no_generado`. El consecutivo **nunca** se reutiliza aunque la transacción falle después (comportamiento aceptado y documentado, Assumption 47).
7. El folio se calcula **siempre en el backend**; cualquier `folio` presente en el body se rechaza con **422** `campo_no_editable`.

## 12.6 Contrato de endpoints

Prefijo `/api/solicitudes` salvo el de alcance. Archivo `backend/src/rutas/solicitudes.ts` (+ `backend/src/rutas/alcance.ts` para E47/E48). Formato de error existente: `{"error":{"codigo":"…","mensaje":"…"}}`. Todos requieren `Authorization: Bearer <jwt>`; sin token → **401**.

**Roles:** `ventanilla` y `admin` en E40–E46. `capturista`, `auditor` y `editor_datos` → **403** `rol_no_autorizado` ("Tu rol no puede capturar solicitudes de apoyo."). E47/E48 son **solo `admin`**.

| # | Método | Ruta | Roles | Descripción |
|---|---|---|---|---|
| E40 | GET | `/api/solicitudes/catalogos` | `ventanilla`,`admin` | Catálogos + alcance del usuario autenticado |
| E41 | POST | `/api/solicitudes/documentos-requeridos` | `ventanilla`,`admin` | Cálculo dinámico del checklist |
| E42 | POST | `/api/solicitudes` | `ventanilla`,`admin` | Alta de solicitud (transaccional) |
| E43 | GET | `/api/solicitudes` | `ventanilla`,`admin` | Listado paginado |
| E44 | GET | `/api/solicitudes/:id` | `ventanilla`,`admin` | Detalle completo |
| E45 | PATCH | `/api/solicitudes/:id/documentos/:docId` | `ventanilla`,`admin` | Marcar recibido / observaciones |
| E46 | POST | `/api/solicitudes/:id/documentos/:docId/archivo` | `ventanilla`,`admin` | Subir adjunto (`multipart/form-data`) |
| E47 | GET | `/api/usuarios/:id/alcance` | `admin` | Leer alcance |
| E48 | PUT | `/api/usuarios/:id/alcance` | `admin` | Reemplazar alcance |

### 12.6.1 E40 — `GET /api/solicitudes/catalogos`

`200`:

```json
{
  "programas": [{"id":1,"clave":"PRG-2026","nombre":"Apoyo al Campo Queretano 2026"}],
  "subprogramas": [{"id":1,"programa_id":1,"clave":"SUB-IP","nombre":"Impulso a la Productividad"}],
  "componentes": [{"id":1,"clave":"TR","nombre":"Tecnificación del Riego"}],
  "proyectos": [{"id":1,"clave":"PEO","nombre":"…","prefijo_folio":"PEO","componente_id":null}],
  "ventanillas": [{"id":2,"clave":"VEN-SJR","nombre":"Regional San Juan del Río","regional_id":4,"clave_folio":"SJR","es_central":false}],
  "municipios": [{"id":7,"nombre":"Amealco de Bonfil","regional_id":3,"siglas_folio":"AME"}],
  "tipos_apoyo": [{"id":12,"clave":"AP-012","nombre":"…","unidad_medida":"pieza"}],
  "tipos_persona": [{"clave":"fisica","nombre":"Persona física"},{"clave":"moral","nombre":"Persona moral sin fines de lucro"},{"clave":"grupo","nombre":"Grupo de productores"}],
  "alcance": {"municipios":"todos"|[7,8], "componentes":"todos"|[1], "ventanillas_permitidas":[2]}
}
```

- **`componentes`, `municipios` y `ventanillas` vienen ya filtrados al alcance** del usuario `ventanilla`; para `admin` vienen completos y `alcance` es `{"municipios":"todos","componentes":"todos","ventanillas_permitidas":<todas>}`.
- `ventanillas_permitidas` para un `ventanilla`: la ventanilla cuya `regional_id` coincide con la Regional del usuario, más `VEN-SED` **solo si** su alcance de municipios es "todos". Si el usuario no tiene `regional_id` y su alcance es "todos", se permiten las 5.
- Solo filas con `activo = true`.

### 12.6.2 E41 — `POST /api/solicitudes/documentos-requeridos`

Body (Zod `.strict()`):

```json
{"componente_id": 1, "tipo_persona": "grupo", "proyecto_id": 1, "tipos_apoyo_ids": [12, 40]}
```

`componente_id` y `tipo_persona` **obligatorios**; `proyecto_id` y `tipos_apoyo_ids` opcionales (default `null` / `[]`).

**Algoritmo de coincidencia** (determinista, `backend/src/servicios/documentos.ts`), evaluado sobre `documentos_requeridos` con `activo = true`:

Una regla **aplica** si se cumplen las 4 condiciones:

1. `componentes IS NULL OR componentes = '{}' OR <clave del componente> = ANY(componentes)`.
2. `tipos_persona IS NULL OR tipos_persona = '{}' OR <tipo_persona> = ANY(tipos_persona)`.
3. `proyecto_id IS NULL OR proyecto_id = <proyecto_id enviado>` (una regla ligada a proyecto **no** aplica si no se envió ese proyecto).
4. **Regla de concepto**:
   - Si `apoyo_id IS NULL AND (apoyo_etiquetas IS NULL OR = '{}')` ⇒ condición cumplida (regla general).
   - Si no ⇒ se exige que **al menos uno** de los `tipos_apoyo_ids` enviados coincida: por `id = apoyo_id`, o porque el `nombre` normalizado del `tipo_apoyo` **contenga** alguna de las `apoyo_etiquetas` normalizadas.

Y además **no se excluye**:

5. Si `apoyo_excluir_id` o `apoyo_excluir_etiquetas` tienen valor y `tipos_apoyo_ids` no está vacío, la regla **se descarta** cuando **todos** los conceptos enviados coinciden con alguna exclusión. (Ej.: "Cotizaciones" no se pide si el único concepto es Fertilizantes; si hay un segundo concepto no excluido, la cotización **sí** se pide.)

**Normalización** para comparar etiquetas y nombres: `trim`, mayúsculas, sin acentos (NFD + quitar diacríticos), espacios colapsados. Es la misma función ya usada por el importador (§8.5.1), reutilizada, no reescrita.

`200`:

```json
{"documentos":[{"documento_requerido_id":32,"requisito":"Solicitud en original","origen":"regla"}],"total":9}
```

Ordenado por `orden`, luego `requisito` alfabético. Sin duplicados por texto de `requisito` (si dos reglas producen el mismo texto, se devuelve una sola entrada con el `documento_requerido_id` menor). `422` `payload_invalido` si falta `componente_id` o `tipo_persona`, o si `tipo_persona` no está en el enum. `422` `componente_invalido` si el componente no existe o está inactivo. **No** aplica restricción de alcance aquí (es solo consulta de catálogo).

### 12.6.3 E42 — `POST /api/solicitudes`

`Content-Type: application/json`. Body Zod `.strict()` en `packages/shared/src/solicitudes.ts`:

```jsonc
{
  "programa_id": 1, "subprograma_id": 1, "componente_id": 1, "proyecto_id": 1, "ventanilla_id": 2,
  "tipo_persona": "grupo",
  "nombre_solicitante": "JUAN PEREZ LOPEZ",
  "sexo": "H", "fecha_nacimiento": "1980-05-12",
  "correo": "juan@example.com", "telefono": "4271234567", "curp": "PELJ800512HQTRPN04",
  "razon_social": "Grupo El Progreso", "num_integrantes": 8,
  "domicilio": {
    "municipio_id": 7, "localidad": "San Miguel", "delegacion": "Centro", "cp": "76750",
    "tipo_asentamiento": "ejido", "asentamiento": "El Progreso",
    "tipo_vialidad": "calle", "vialidad": "Hidalgo 45"
  },
  "actividad": {
    "agricola": true, "agr_superficie_total_ha": 12.5, "agr_superficie_siembra_ha": 10,
    "agr_temporal_ha": 6, "agr_riego_ha": 4, "agr_cultivo_principal": "Maíz",
    "ganadera": false, "acuicola": false, "pesca": false
  },
  "apoyo": {
    "descripcion_proyecto": "Sistema de riego por goteo…",
    "ben_hombres_total": 5, "ben_hombres_discapacidad": 0, "ben_hombres_lengua_indigena": 1,
    "ben_mujeres_total": 3, "ben_mujeres_discapacidad": 1, "ben_mujeres_lengua_indigena": 0,
    "ubicacion": {"municipio_id": 7, "localidad": "San Miguel", "ejido": "El Progreso",
                  "coordenadas": "20.185, -100.145"}
  },
  "conceptos": [
    {"tipo_apoyo_id": 12, "descripcion": "Cintilla de riego", "cantidad": 500,
     "unidad_medida": "metro", "monto_estatal": 30000, "monto_productor": 10000, "monto_total": 40000}
  ],
  "documentos": [{"documento_requerido_id": 32, "requisito": "Solicitud en original", "recibido": true}],
  "observaciones": "…",
  "declaracion_aceptada": true
}
```

**Validaciones (todas responden sin escribir nada, transacción abortada):**

| Caso | HTTP | `codigo` | Mensaje |
|---|---|---|---|
| Claves fuera del esquema (`folio`, `id`, `regional_id`, `recibida_en`, `capturado_por`…) | 422 | `campo_no_editable` | "El campo folio no se captura: lo genera el sistema." |
| Falta `nombre_solicitante` o queda vacío tras `trim` | 422 | `payload_invalido` | "Escribe el nombre del solicitante." |
| `tipo_persona` fuera de `fisica\|moral\|grupo` | 422 | `payload_invalido` | "Datos inválidos." |
| `tipo_persona` ∈ (`moral`,`grupo`) y falta `razon_social` o `num_integrantes` (<1) | 422 | `datos_persona_moral_requeridos` | "Para persona moral o grupo debes capturar la razón social y el número de integrantes." |
| `conceptos` vacío o ausente | 422 | `conceptos_requeridos` | "Agrega al menos un concepto de apoyo." |
| Algún concepto con `tipo_apoyo_id` inexistente/inactivo | 422 | `tipo_apoyo_invalido` | "El concepto de apoyo seleccionado no existe." |
| Algún concepto con `cantidad <= 0`, o algún monto negativo | 422 | `montos_invalidos` | "Las cantidades y montos deben ser mayores o iguales a cero." |
| `declaracion_aceptada` distinto de `true` | 422 | `declaracion_requerida` | "Debes aceptar las declaraciones del solicitante." |
| `curp` presente y no cumple el patrón de 18 caracteres `[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d` | 422 | `curp_invalida` | "La CURP no tiene el formato correcto." |
| `correo` presente y sin formato de correo | 422 | `correo_invalido` | "El correo electrónico no es válido." |
| `telefono` presente y que tras normalizar (quitar espacios, `-`, `(`, `)`, `+52`) no queda en 10 dígitos | 422 | `telefono_invalido` | "El teléfono debe tener 10 dígitos." |
| `ubicacion.municipio_id` inexistente/inactivo | 422 | `municipio_invalido` | "El municipio seleccionado no existe o está inactivo." |
| `ventanilla_id` / `componente_id` / `proyecto_id` / `programa_id` inexistentes o inactivos | 422 | `catalogo_invalido` | "Uno de los catálogos seleccionados no existe o está inactivo." |
| **Alcance**: `ubicacion.municipio_id` fuera de `usuario_municipios` (cuando hay restricción) | **403** | `municipio_fuera_de_alcance` | "No tienes asignado este municipio." |
| **Alcance**: `componente_id` fuera de `usuario_componentes` (cuando hay restricción) | **403** | `componente_fuera_de_alcance` | "No tienes asignado este componente." |
| **Alcance**: `ventanilla_id` fuera de `ventanillas_permitidas` (E40) | **403** | `ventanilla_fuera_de_alcance` | "No puedes registrar en esta ventanilla." |

Reglas adicionales:

- `admin` **nunca** recibe 403 por alcance (D34).
- `monto_total` se **sugiere** en el cliente como `monto_estatal + monto_productor` pero se guarda **tal como lo envía el usuario** (D-formulario). Si `monto_total` no viene, el backend lo calcula como la suma. **No** se valida que la suma cuadre (Assumption 48).
- Normalización previa a guardar: `trim` en todos los textos; `""` → `NULL`; `curp`, `nombre_solicitante` y `razon_social` en MAYÚSCULAS; `telefono` guardado con los 10 dígitos.
- Los subcampos de una actividad **no marcada** se guardan como `NULL` (si `actividad.ganadera=false`, `gan_*` se ignoran aunque vengan en el body).
- Si `documentos` no viene, el backend **calcula el checklist con el algoritmo de E41** y lo materializa con `recibido=false`. Si viene, se materializa lo enviado (permite que el capturista agregue una fila manual con `documento_requerido_id:null` y un `requisito` de texto libre ≤ 300 chars).

**Efectos (una sola transacción):**

1. Reserva del consecutivo y generación del `folio` (§12.5).
2. `INSERT` en `solicitudes` (`capturado_por` = usuario del token, `regional_id` = `ventanillas.regional_id`, `recibida_en = now()`, `origen='solicitud_ventanilla'`).
3. `INSERT` de N filas en `solicitud_conceptos` con `orden` 1..N en el orden del array.
4. `INSERT` de M filas en `solicitud_documentos`.
5. **Por cada concepto**, `INSERT` en `beneficiarios` (D39) con:
   - `folio` = `<folio de la solicitud>` si hay **un solo** concepto; `<folio>-C1`, `<folio>-C2`, … si hay **más de uno**.
   - `nombre_completo` = `razon_social` si `tipo_persona` ∈ (`moral`,`grupo`), si no `nombre_solicitante`.
   - `curp` = `solicitudes.curp`; `telefono` = `solicitudes.telefono`.
   - `regional_id` = de la **ventanilla**; `municipio_id`, `colonia` (= `ubi_localidad`), `localidad` (= `ubi_localidad`), `domicilio` (= `ubi_ejido`) desde la **Ubicación del apoyo** (D40). **Nunca** desde `domicilio.*`.
   - `tipo_apoyo_id` = del concepto; `cantidad_asignada` = `cantidad` del concepto.
   - `solicitud_id` = id de la solicitud; `origen_import_id = NULL`.
   - `datos_extra` = `{"origen":"solicitud_ventanilla","solicitud_folio":"…","concepto_orden":N,"coordenadas_declaradas":"…"}`.
   - Se guarda el `beneficiario_id` resultante en la fila de `solicitud_conceptos`.
6. `INSERT` en `auditoria_log` con `accion='solicitud_creada'`.

**Respuesta 201:**

```json
{
  "ok": true,
  "solicitud": {"id": 5, "folio": "PEO-SJR-AME-0001-26", "recibida_en": "2026-08-17T18:00:00.000Z",
                "componente": "TR", "proyecto": "PEO", "ventanilla": "VEN-SJR", "regional_id": 4,
                "tipo_persona": "grupo", "nombre_solicitante": "JUAN PEREZ LOPEZ"},
  "conceptos": [{"id": 9, "orden": 1, "tipo_apoyo_id": 12, "beneficiario_id": 210}],
  "beneficiarios_creados": [{"id": 210, "folio": "PEO-SJR-AME-0001-26"}],
  "documentos": [{"id": 31, "requisito": "Solicitud en original", "recibido": true, "archivo_url": null}]
}
```

### 12.6.4 E43 — `GET /api/solicitudes`

Query: `q` (folio, nombre del solicitante o CURP), `componente_id`, `municipio_id`, `ventanilla_id`, `desde`, `hasta` (ISO, sobre `recibida_en`), `page` (1), `page_size` (≤200, default 50).

`200 {data:[{id, folio, recibida_en, nombre_solicitante, tipo_persona, componente, proyecto, ventanilla, municipio, conceptos:N, monto_total, documentos_recibidos:"3/9"}], page, page_size, total, has_more}`.

**Aislamiento:** un usuario `ventanilla` ve **solo** las solicitudes cuyo `ubi_municipio_id` esté en su alcance de municipios y cuyo `componente_id` esté en su alcance de componentes (si "todos", sin filtro). `admin` ve todas. El filtro se aplica **en SQL**, nunca en el cliente.

### 12.6.5 E44 — `GET /api/solicitudes/:id`

`200 {solicitud:{…todos los campos…}, conceptos:[…], documentos:[{id, requisito, recibido, archivo_url, archivo_nombre}], beneficiarios:[{id, folio, tipo_apoyo, municipio}]}`. `404` si no existe. **403** `fuera_de_alcance` si el usuario `ventanilla` no la tiene en su alcance.

### 12.6.6 E45 — `PATCH /api/solicitudes/:id/documentos/:docId`

Body `.strict()`: `{recibido?: boolean, observaciones?: string (≤300)}`. `200 {ok:true, documento:{…}}`. `404` si el documento no pertenece a esa solicitud. `422` `sin_cambios` si el body queda vacío. Registra `solicitud_documento_actualizado`. Aplica el mismo aislamiento de alcance.

### 12.6.7 E46 — `POST /api/solicitudes/:id/documentos/:docId/archivo`

`multipart/form-data` con un solo campo `archivo`. Reutiliza `@fastify/multipart` y `backend/src/servicios/almacenamiento.ts` (D43).

- Tipos aceptados: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Otro ⇒ **422** `tipo_archivo_no_permitido` ("Solo se aceptan imágenes JPG/PNG/WEBP o PDF.").
- Tamaño máximo: `MAX_UPLOAD_MB` (variable existente). Excedido ⇒ **413** `archivo_muy_grande`.
- Ruta: `/media/solicitudes/YYYY/MM/<uuid v4>.<ext>`; se guardan `archivo_url`, `archivo_hash` (sha256) y `archivo_nombre`. Subir de nuevo **reemplaza** la referencia (el archivo anterior no se borra del disco, se conserva por trazabilidad).
- Al subir con éxito se pone `recibido = true` automáticamente.
- `201 {ok:true, documento:{id, requisito, recibido:true, archivo_url, archivo_nombre}}`. Registra `solicitud_documento_adjuntado`.
- La descarga se sirve por **E15** (`GET /media/*`, ya existente, con token). **No se crea ninguna ruta de estáticos nueva.**

### 12.6.8 E47 / E48 — Alcance de usuarios (solo `admin`)

- **E47 `GET /api/usuarios/:id/alcance`** → `200 {usuario_id, rol, municipios:"todos"|[{id,nombre}], componentes:"todos"|[{id,clave,nombre}]}`. `404` si el usuario no existe.
- **E48 `PUT /api/usuarios/:id/alcance`** → body `.strict()` `{municipios: "todos" | number[], componentes: "todos" | number[]}`. Reemplaza por completo ambas listas (`DELETE` + `INSERT` en una transacción). `"todos"` ⇒ **cero filas** en la tabla correspondiente. `422` `payload_invalido` si un id no existe o está inactivo; `422` `rol_sin_alcance` si el usuario objetivo no es de rol `ventanilla` ("El alcance solo aplica a usuarios de ventanilla."). `200 {ok:true, municipios:…, componentes:…}`. Registra `alcance_usuario_actualizado`.
- Estas rutas **no** relajan ninguna regla de §10.7: siguen sin existir `DELETE /api/usuarios/:id`, el login sigue siendo inmutable y `usuarios` no gana columnas.

## 12.7 Semilla de `documentos_requeridos`

Mapeo de claves usadas en el Excel real → catálogo de este build: **`SRT` (Sistemas de Riego Tecnificado) ⇒ componente `TR`**; `DIN` ⇒ `DIN`; `CAA` ⇒ `CAA`. Tipos de persona: `FISICA` ⇒ `fisica`, `MORAL` ⇒ `moral`, `GRUPO DE PRODUCTORES` ⇒ `grupo`.

### 12.7.1 Las 34 reglas de la hoja `DOCUMENTACIÓN`

| # | requisito | componentes | tipos_persona | apoyo_etiquetas | apoyo_excluir_etiquetas |
|---|---|---|---|---|---|
| 1 | Acreditar pertenencia a grupo de productores | `{DIN}` | `{grupo}` | `{TRACTORES,PESCA}` | — |
| 2 | Acta constitutiva | `{DIN,TR}` | `{moral}` | — | — |
| 3 | Acta que acredite al representante legal con facultades vigentes | `{DIN,TR}` | `{moral}` | — | — |
| 4 | CURP | `{DIN,CAA,TR}` | `{fisica}` | — | — |
| 5 | CURP del representante de grupo de productores | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 6 | CURP del representante legal | `{DIN,TR}` | `{moral}` | — | — |
| 7 | Comprobante de domicilio (vigencia no mayor a 3 meses) | `{DIN,CAA,TR}` | `{fisica}` | — | — |
| 8 | Comprobante de domicilio de la persona moral y/o representante legal | `{DIN,TR}` | `{moral}` | — | — |
| 9 | Comprobante de domicilio del representante de grupo de productores | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 10 | Constancia de situación fiscal | `{DIN,CAA,TR}` | `{fisica}` | — | — |
| 11 | Constancia de situación fiscal de la persona moral | `{DIN,TR}` | `{moral}` | — | — |
| 12 | Constancia de situación fiscal del representante de grupo de productores | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 13 | Constancia Unidad de Producción Pecuaria (UPP) | `{DIN}` | `{fisica,grupo,moral}` | `{PROYECTOS PECUARIOS}` | — |
| 14 | Copia del título de concesión de derechos de agua vigente o resolución positiva | `{TR}` | `{fisica,grupo,moral}` | — | — |
| 15 | Cotizaciones | `{DIN,TR,CAA}` | `{fisica,moral,grupo}` | — | `{FERTILIZANTES,MATERIAL VEGETATIVO,SEMILLA,PAQUETE TECNOLOGICO}` |
| 16 | Croquis de localización del predio con referencias | `{DIN}` | `{fisica,moral,grupo}` | — | — |
| 17 | Dictámenes zoosanitarios | `{DIN}` | `{fisica,grupo,moral}` | `{PROYECTOS PECUARIOS}` | — |
| 18 | Documento que acredite la integración del grupo de productores, con representante designado | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 19 | Evidencia fotográfica | `{DIN}` | `{fisica,grupo,moral}` | `{REHABILITACION DE INVERNADEROS}` | — |
| 20 | Factura del insumo | `{DIN}` | `{fisica,grupo,moral}` | `{FERTILIZANTES,MATERIAL VEGETATIVO,SEMILLA,PAQUETE TECNOLOGICO}` | — |
| 21 | Fotografías de la fuente de abastecimiento de agua / medidor volumétrico | `{TR}` | `{fisica,grupo,moral}` | — | — |
| 22 | Identificación oficial vigente con fotografía | `{DIN,CAA,TR}` | `{fisica}` | — | — |
| 23 | Identificación oficial vigente del representante del grupo de productores | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 24 | Identificación oficial vigente del representante legal | `{DIN,TR}` | `{moral}` | — | — |
| 25 | Instrumento público que acredite propiedad/usufructo/posesión del predio | `{DIN,CAA,TR}` | `{fisica,grupo}` | — | `{PESCA,APICULTURA}` |
| 26 | Instrumento público que acredite propiedad/usufructo/posesión del predio (grupo) | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 27 | Listado de integrantes del grupo de productores | `{CAA}` | `{grupo}` | — | — |
| 28 | Permiso de pesca vigente | `{DIN}` | `{fisica,grupo,moral}` | `{PESCA}` | — |
| 29 | Proyecto Ejecutivo | `{TR,CAA}` | `{fisica,grupo,moral}` | — | — |
| 30 | Relación de beneficiarios directos de la persona moral, con documentos de cada uno | `{DIN,TR}` | `{moral}` | — | — |
| 31 | Relación de beneficiarios directos del grupo de productores, con documentos de cada uno | `{DIN,TR,CAA}` | `{grupo}` | — | — |
| 32 | Solicitud en original | `{DIN,CAA,TR}` | `{fisica}` | — | — |
| 33 | Solicitud en original | `{DIN,TR}` | `{moral}` | — | — |
| 34 | Solicitud en original | `{DIN,TR,CAA}` | `{grupo}` | — | — |

> La fila 26 lleva el sufijo "(grupo)" **solo en el seed** para no chocar con la 25 en la deduplicación por texto; en la UI se muestra el texto completo tal cual queda en la columna `requisito`. Las filas 32–34 comparten texto a propósito: la deduplicación de E41 garantiza que el solicitante ve **una sola** "Solicitud en original".

### 12.7.2 Las 8 reglas del anexo PEO (ligadas a `proyecto_id`)

Todas con `proyecto_id = <id de PEO>`, `tipos_persona = {grupo}`, `componentes = NULL` (aplican con cualquier componente):

1. Solicitud mediante escrito libre dirigida al Titular de la Secretaría
2. Ficha técnica
3. Acta de integración del grupo de productores
4. Identificación oficial vigente con fotografía del representante
5. CURP del representante
6. Constancia de Situación Fiscal del representante
7. Comprobante de domicilio del representante
8. Relación de beneficiarios directos

## 12.8 Pantallas nuevas en la PWA

Rutas nuevas en `pwa/src/rutas.tsx`, envueltas en `<RutaProtegida roles={['ventanilla','admin']}>`. **Online-only** (D32). Estilos CSS plano, sin librerías nuevas.

- Redirect por rol tras login: `ventanilla` → **`/solicitudes`**. Los demás roles no cambian (§8.8.4).
- La barra de estado muestra el enlace `[data-testid="nav-solicitudes"]` ("Solicitudes") **solo** para `ventanilla` y `admin`.
- Un usuario `ventanilla` que navegue a `/beneficiarios`, `/sync`, `/auditoria`, `/depuracion`, `/correcciones`, `/dashboard` o `/usuarios` ve "No tienes permiso para ver esta sección."

### 12.8.1 `/solicitudes` — `Solicitudes.tsx`

Encabezado "Solicitudes de apoyo" + botón `[data-testid="btn-nueva-solicitud"]` ("Nueva solicitud") → `/solicitudes/nueva`.
Filtros: `input-busqueda` (folio/nombre/CURP), `select-componente`, `select-municipio`, `input-desde`, `input-hasta`.
Tabla `[data-testid="tabla-solicitudes"]` con filas `[data-testid="fila-solicitud"]`: Folio, Fecha, Solicitante, Tipo de persona, Componente, Municipio, Conceptos, Documentos (`3/9`), acción "Ver". Vacío: "Sin resultados".

### 12.8.2 `/solicitudes/nueva` — `NuevaSolicitud.tsx`

Formulario **multi-sección** en una sola página con navegación por pasos (`[data-testid="paso-N"]`, N=1..6) y un resumen lateral. Todos los campos con `data-testid`. Guardado **solo** al final.

**Paso 1 — Encabezado** (`seccion-encabezado`)
`Folio`: campo de solo lectura con el texto "Se generará al guardar" (`[data-testid="folio-pendiente"]`), **sin input editable**. `select-programa`, `select-subprograma` (dependiente del programa), **`grupo-componente`** con 3 opciones de **selección única** (`radio-componente-TR|CAA|DIN`, presentadas como casillas igual que en el papel), `select-proyecto`, `select-ventanilla`. Los selects de componente, municipio y ventanilla se **pueblan desde E40** ya filtrados al alcance; si el alcance deja una sola opción, queda **preseleccionada**.

**Paso 2 — Datos del solicitante** (`seccion-solicitante`)
`select-tipo-persona` (Persona física / Persona moral sin fines de lucro / Grupo de productores). Al elegir `moral` o `grupo` aparecen `input-razon-social` e `input-num-integrantes` (**obligatorios**); con `fisica` **no se renderizan**. Campos: `input-nombre-solicitante` (etiqueta dinámica: "Nombre del solicitante" / "Nombre del representante legal" / "Nombre del representante del grupo"), `select-sexo`, `input-fecha-nacimiento`, `input-correo`, `input-telefono`, `input-curp`.
Sub-bloque **2.2 Domicilio particular** (`seccion-domicilio`), con el aviso visible *"Domicilio del solicitante. La ubicación del predio se captura en la sección 4."*: `select-dom-municipio`, `input-dom-localidad`, `input-dom-delegacion`, `input-dom-cp`, `select-dom-tipo-asentamiento`, `input-dom-asentamiento`, `select-dom-tipo-vialidad`, `input-dom-vialidad`.

**Paso 3 — Actividad económica** (`seccion-actividad`)
4 checkboxes independientes: `chk-agricola`, `chk-ganadera`, `chk-acuicola`, `chk-pesca`. Los subcampos de cada una **solo se renderizan si su checkbox está marcado**:
- Agrícola: `input-agr-superficie-total`, `input-agr-superficie-siembra`, `input-agr-temporal`, `input-agr-riego`, `input-agr-cultivo`.
- Ganadera: `input-gan-tipo-ganado`, `input-gan-cabezas`, `input-gan-agostadero`, `select-gan-produccion` (Intensiva/Traspatio/Extensiva).
- Acuícola: `input-acu-especies`. Pesca: `input-pes-especies`.

**Paso 4 — Datos del apoyo** (`seccion-apoyo`)
`textarea-descripcion-proyecto`; rejilla 2×3 de beneficiarios directos (`input-ben-h-total`, `input-ben-h-discapacidad`, `input-ben-h-indigena`, `input-ben-m-total`, `input-ben-m-discapacidad`, `input-ben-m-indigena`).
Sub-bloque **4.1 Ubicación del apoyo** (`seccion-ubicacion`) con el aviso *"Ubicación del predio o proyecto. Es la dirección que visitará el capturista de campo."*: `select-ubi-municipio`, `input-ubi-localidad`, `input-ubi-ejido`, `input-ubi-coordenadas` (texto libre, placeholder `20.185, -100.145`). **Sin botón de "usar mi ubicación"** (D42).

**Paso 5 — Conceptos de apoyo** (`seccion-conceptos`)
Tabla repetible `[data-testid="tabla-conceptos"]` con filas `[data-testid="fila-concepto"]`; arranca con **1 fila**. `btn-agregar-concepto` agrega filas (sin límite); `btn-quitar-concepto` elimina, **deshabilitado cuando solo queda una fila**. Por fila: `select-concepto` (tipos_apoyo), `input-concepto-descripcion`, `input-concepto-cantidad`, `input-concepto-unidad` (se autocompleta con `tipos_apoyo.unidad_medida` y es editable), `input-concepto-estatal`, `input-concepto-productor`, `input-concepto-total` (**se autocalcula** como estatal+productor cada vez que cambia uno de los dos, pero el usuario puede sobrescribirlo; una vez editado a mano deja de autocalcularse en esa fila). Pie con `[data-testid="totales-conceptos"]` sumando las tres columnas de dinero. `textarea-observaciones` opcional.

**Paso 6 — Documentos y declaraciones** (`seccion-documentos`)
- `[data-testid="lista-documentos"]` con ítems `[data-testid="item-documento"]`, recalculada llamando a **E41** cada vez que cambian Componente, Tipo de persona, Proyecto o los conceptos seleccionados (con `debounce` de 300 ms). Cada ítem: texto del requisito + `chk-documento-recibido`. Contador `[data-testid="contador-documentos"]` "Recibidos: X de Y". Los adjuntos se suben **después de guardar**, desde el detalle (E46).
- `[data-testid="texto-declaraciones"]` con los **7 incisos fijos** (§12.9), no editables.
- `[data-testid="chk-declaracion"]` "Acepto las declaraciones anteriores" — **obligatorio**.
- `[data-testid="btn-guardar-solicitud"]` **deshabilitado** mientras la declaración no esté aceptada o falte algún campo obligatorio. Al guardar con éxito: `[data-testid="modal-folio-generado"]` con `[data-testid="texto-folio"]` (el folio real), el listado de beneficiarios creados y el botón "Ver solicitud" → `/solicitudes/:id`.
- Errores del backend se muestran en `[data-testid="error-solicitud"]` con el `mensaje` en español tal como llega.

### 12.8.3 `/solicitudes/:id` — `DetalleSolicitud.tsx`

Solo lectura de todas las secciones + `[data-testid="detalle-folio"]`, tabla de conceptos, tabla de beneficiarios creados (`[data-testid="tabla-beneficiarios-creados"]`) y checklist de documentos con, por ítem: `chk-documento-recibido` (llama a E45) y `input-archivo-documento` (`<input type="file">` que llama a E46) + enlace `[data-testid="enlace-archivo"]` cuando ya hay adjunto. Sin botones de editar ni borrar la solicitud (D44).

### 12.8.4 `/usuarios` — bloque de alcance (delta sobre §10.8 y §11.6)

En el formulario de usuario, al elegir rol **"Ventanilla"** aparece `[data-testid="bloque-alcance"]` con `[data-testid="chk-municipios-todos"]` + lista de casillas `chk-municipio-<id>`, y `[data-testid="chk-componentes-todos"]` + `chk-componente-<clave>`. Marcar "Todos" deshabilita y limpia la lista correspondiente. Se persiste con **E48** después de crear/guardar el usuario. Para cualquier otro rol el bloque **no se renderiza**. Nada más de §10/§11 cambia.

## 12.9 Texto fijo de las declaraciones (`packages/shared/src/declaraciones.ts`, versión `v1-2026`)

> **Declaro bajo protesta de decir verdad que:**
> **a)** No realizo actividades ilícitas ni relacionadas con recursos de procedencia ilícita.
> **b)** No tengo procesos, adeudos ni asuntos pendientes de resolver con la Secretaría de Desarrollo Agropecuario.
> **c)** Aplicaré los apoyos que en su caso me sean otorgados única y exclusivamente para los fines autorizados.
> **d)** Los datos e información que asiento en esta solicitud y los documentos que la acompañan son verídicos.
> **e)** Me comprometo a ejecutar las inversiones y acciones del proyecto en los términos y plazos autorizados.
> **f)** Proporcionaré la información y facilitaré el acceso al predio que se me requiera para efectos de supervisión, seguimiento y auditoría.
> **g)** Entiendo que la presentación de esta solicitud **no implica la autorización del apoyo ni compromiso de pago alguno** por parte de la Secretaría.

Se renderiza tal cual, íntegro, en el paso 6 y se reproduce en el detalle de la solicitud. La constante `DECLARACIONES_VERSION = 'v1-2026'` se guarda en `solicitudes.declaracion_version`.

## 12.10 Estructura de archivos nuevos (delta build 6)

```
db/migrations/012_ventanilla_catalogos.sql
db/migrations/013_solicitudes.sql
db/seeds/005_ventanilla_catalogos.sql          # programas, subprogramas, componentes, proyectos, ventanillas, 42 reglas
db/seeds/006_usuarios_ventanilla_demo.sql      # ventanilla1 (restringido), ventanilla2 (todos)
packages/shared/src/solicitudes.ts             # tipos + Zod compartidos
packages/shared/src/declaraciones.ts           # texto legal fijo + versión
backend/src/rutas/solicitudes.ts
backend/src/rutas/alcance.ts
backend/src/db/queries/solicitudes.ts
backend/src/servicios/folios.ts                # generación atómica del folio
backend/src/servicios/documentos.ts            # cálculo de documentos requeridos
backend/src/servicios/alcance.ts               # lectura y verificación del alcance del usuario
pwa/src/pantallas/Solicitudes.tsx
pwa/src/pantallas/NuevaSolicitud.tsx
pwa/src/pantallas/DetalleSolicitud.tsx
pwa/src/componentes/SeccionSolicitante.tsx
pwa/src/componentes/SeccionActividad.tsx
pwa/src/componentes/TablaConceptos.tsx
pwa/src/componentes/ChecklistDocumentos.tsx
pwa/src/componentes/BloqueAlcance.tsx
pwa/src/api/solicitudes.ts
```

**Modificados:** `pwa/src/rutas.tsx`, `pwa/src/componentes/BarraEstado.tsx` (enlace nuevo), `pwa/src/componentes/FormUsuario.tsx` (bloque de alcance), `pwa/src/pantallas/Usuarios.tsx`, `backend/src/server.ts` (registro de rutas), `backend/src/servicios/almacenamiento.ts` (subcarpeta `solicitudes/`, sin cambiar el driver), `.env.example`, `db/README.md`, `README.md`.

**No se modifica:** `pwa/src/db/indexeddb.ts`, `pwa/src/sync/*`, `pwa/nginx.conf.template`, `docker-compose.yml`, `scripts/importar.ts`, ninguna ruta de `/api/staging/*`, `/api/auditoria/*`, `/api/capturas`.

## 12.11 Assumptions de la extensión (continúa la numeración de §10.10)

44. **Alcance vacío = acceso total.** Cero filas en `usuario_municipios`/`usuario_componentes` significa "todos" (equivalente al valor `ADMIN` del Excel de AppSheet). Se eligió así para que los usuarios existentes de la BD de producción no queden bloqueados por la migración.
45. **La jerarquía Programa→Subprograma→Componente→Modalidad→Proyecto no está 100% clara** en los documentos disponibles. Se modela **plana y flexible**: `proyectos.componente_id` es **nullable**, `solicitudes.subprograma_id` es nullable, y todos los catálogos son editables por SQL/seed. No se fuerza ninguna relación que los documentos no confirmen. La entidad "Modalidad" **no se modela** en este build (no aparece en los formularios transcritos).
46. **`municipios.siglas_folio` es nullable** porque el catálogo oficial de siglas no está disponible; hay fallback determinista (§12.5) para que el sistema nunca falle al generar un folio, y la columna se puede llenar después sin migración.
47. **El consecutivo del folio no se reutiliza** si la transacción falla tras reservarlo. Es el comportamiento estándar de un contador y evita bloqueos entre ventanillas concurrentes; puede dejar huecos en la numeración.
48. **`monto_total` no se valida contra la suma** de estatal + productor: el papel permite que la inversión total incluya aportaciones de terceros. El cliente la **sugiere**, el usuario manda.
49. **La ventanilla SEDEA (central) hereda `regional_id` = Querétaro (REG-03)** para los beneficiarios creados, porque `beneficiarios.regional_id` es `NOT NULL`. Su segmento de folio es `SED`, distinguible de `QRO`.
50. **No se valida que el municipio de la ubicación pertenezca a la Regional de la ventanilla**: en la práctica SEDEA central y las regionales reciben solicitudes de municipios vecinos. Se registra tal cual lo que declara el papel.
51. **Las etiquetas de apoyo del Excel** (`PROYECTOS PECUARIOS`, `TRACTORES`, `PESCA`, …) son **categorías**, no conceptos exactos del catálogo de 152 filas; por eso se guardan como `apoyo_etiquetas TEXT[]` y se comparan por contención normalizada, además de admitir `apoyo_id` exacto cuando exista.
52. **La solicitud no se puede editar** después de guardarse (D44): en ventanilla el papel firmado es la fuente de verdad; si un dato del beneficiario derivado está mal, se corrige por §9.4 dejando traza.
53. **El checklist se materializa al crear** (copia del texto en `solicitud_documentos.requisito`), de modo que cambiar las reglas después **no altera** las solicitudes ya recibidas.
54. **Un usuario `ventanilla` con `regional_id` asignado y alcance de municipios "todos"** puede además usar la ventanilla `VEN-SED`; es el perfil de personal central que también atiende una regional.

## 12.12 Dependencias

**Ninguna dependencia npm nueva.** Se reutilizan `@fastify/multipart` (adjuntos), `zod`, `pg` y, en la PWA, React + react-router-dom ya presentes. No se agrega gestor de formularios ni librería de tablas.

---

## 12.13 Rubric extendido (criterios 241–306)

Continúa la numeración de §7, §8.11, §9.9, §10.11 y §11.9. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_CAP` (capturista1), `T_AUD` (auditor1), `T_EDIT` (editor1), **`T_VEN1`** (`ventanilla1`, alcance restringido), **`T_VEN2`** (`ventanilla2`, alcance "todos").

### Base de datos y migraciones (241–250)

241. Existen `db/migrations/012_*.sql` y `db/migrations/013_*.sql`, y **no** existe ningún `db/migrations/011_*.sql` (el criterio 231 sigue pasando).
242. `information_schema.tables` contiene: `programas`, `subprogramas`, `componentes`, `proyectos`, `ventanillas`, `documentos_requeridos`, `solicitudes`, `solicitud_conceptos`, `solicitud_documentos`, `solicitud_folios`, `usuario_municipios`, `usuario_componentes` (12 tablas nuevas).
243. `pg_get_constraintdef` de `usuarios_rol_check` contiene `ventanilla` y sigue conteniendo `capturista`, `auditor`, `admin` y `editor_datos`; `INSERT INTO usuarios (…) VALUES (…,'ventanilla',…)` no viola el CHECK.
244. `information_schema.columns` muestra `municipios.siglas_folio` (`text`, nullable), `direcciones_regionales.clave_folio` (`text`, nullable) y `beneficiarios.solicitud_id` (`bigint`, nullable); `beneficiarios` conserva **todas** las columnas de §4.6 y §9 (ninguna eliminada ni renombrada).
245. `solicitudes` contiene todas estas columnas: `folio`, `tipo_persona`, `razon_social`, `num_integrantes`, `dom_municipio_id`, `dom_tipo_asentamiento`, `dom_tipo_vialidad`, `act_agricola`, `act_ganadera`, `act_acuicola`, `act_pesca`, `gan_produccion`, `ben_hombres_total`, `ben_mujeres_total`, `ubi_municipio_id`, `ubi_coordenadas`, `declaracion_aceptada`, `declaracion_version`, `origen`.
246. El CHECK de `solicitudes.tipo_persona` acepta exactamente `fisica,moral,grupo`; el de `solicitudes.gan_produccion` acepta `intensiva,traspatio,extensiva`; `solicitudes.folio` tiene índice **UNIQUE**.
247. `solicitud_conceptos` tiene FK a `solicitudes` con `ON DELETE CASCADE`, columna `beneficiario_id` referenciando `beneficiarios(id)`, y restricción `UNIQUE (solicitud_id, orden)`.
248. `solicitud_folios` tiene PRIMARY KEY compuesta `(prefijo, clave_regional, siglas_municipio, anio)`; `usuario_municipios` y `usuario_componentes` tienen PK compuesta de sus dos columnas.
249. `SELECT count(*) FROM componentes` devuelve exactamente **3** y `SELECT clave FROM componentes ORDER BY clave` devuelve `CAA, DIN, TR`; `SELECT count(*) FROM ventanillas` devuelve exactamente **5** y existe exactamente una con `es_central = true`.
250. `SELECT count(*) FROM documentos_requeridos WHERE activo` devuelve **42**; `SELECT count(*) FROM programas` y `FROM subprogramas` devuelven **1** cada uno; `SELECT prefijo_folio FROM proyectos WHERE clave='PEO'` devuelve `PEO` y su `componente_id` es **NULL**.

### Catálogos y semillas (251–254)

251. `SELECT clave_folio FROM direcciones_regionales ORDER BY clave` devuelve exactamente `CAD, JAL, QRO, SJR` para `REG-01..REG-04`.
252. `SELECT count(*) FROM municipios WHERE siglas_folio IS NULL OR length(siglas_folio) <> 3` devuelve **0** tras el seed, y el municipio cuyo nombre empieza con `Amealco` tiene `siglas_folio = 'AME'`.
253. `POST $API/api/auth/login` con `ventanilla1` y con `ventanilla2` devuelve **200** con `token` y `usuario.rol === "ventanilla"`; en BD `ventanilla1` tiene ≥1 fila en `usuario_municipios` y exactamente 1 en `usuario_componentes`, y `ventanilla2` tiene **0** filas en ambas.
254. Los usuarios demo previos (`admin`, `capturista1`, `auditor1`, `editor1`) siguen existiendo y pudiendo iniciar sesión con **200** (ninguna semilla anterior se rompió).

### API — RBAC del módulo (255–260)

255. `GET $API/api/solicitudes/catalogos` **sin** header `Authorization` devuelve **401**.
256. `GET $API/api/solicitudes/catalogos` con `T_CAP`, con `T_AUD` y con `T_EDIT` devuelve **403** con `error.codigo === "rol_no_autorizado"` en los tres casos.
257. `GET $API/api/solicitudes/catalogos` con `T_VEN1` devuelve **200** con las claves `programas, subprogramas, componentes, proyectos, ventanillas, municipios, tipos_apoyo, tipos_persona, alcance`; `alcance.componentes` es un array de longitud **1** y `alcance.municipios` es un array (no `"todos"`).
258. `GET $API/api/solicitudes/catalogos` con `T_VEN2` devuelve **200** con `alcance.municipios === "todos"` y `alcance.componentes === "todos"`, y su array `componentes` tiene **3** elementos.
259. Con `T_VEN1`, el array `componentes` de E40 tiene **1** elemento (`TR`) y `municipios` contiene **solo** los municipios asignados en `usuario_municipios`.
260. Con `T_VEN1`, `GET $API/api/auditoria/capturas`, `GET /api/staging/beneficiarios`, `GET /api/usuarios` y `GET /api/dashboard/*` (o su ruta equivalente de §9.5) devuelven **403** o **401**; ninguno devuelve 200.

### API — creación de solicitud y folio (261–272)

261. `POST $API/api/solicitudes` con `T_VEN2` y un payload válido de **1 concepto** (componente `TR`, proyecto `PEO`, ventanilla `VEN-SJR`, municipio de ubicación `Amealco`, `tipo_persona:"fisica"`, `declaracion_aceptada:true`) devuelve **201** con `ok:true` y `solicitud.folio` que **coincide exactamente** con la expresión regular `^PEO-SJR-AME-0001-\d{2}$`.
262. Un segundo `POST /api/solicitudes` idéntico devuelve **201** con folio terminado en `-0002-` + los 2 dígitos del año (el consecutivo avanza), y `SELECT consecutivo FROM solicitud_folios WHERE prefijo='PEO' AND clave_regional='SJR' AND siglas_municipio='AME'` devuelve **2**.
263. Un `POST /api/solicitudes` con la ventanilla `VEN-CAD` (o con otro municipio) devuelve un folio cuyo consecutivo vuelve a ser `0001` (el contador es por combinación proyecto+regional+municipio+año).
264. `POST /api/solicitudes` con la clave `"folio":"MANUAL-1"` dentro del body devuelve **422** con `error.codigo === "campo_no_editable"` y `SELECT count(*) FROM solicitudes` no aumenta; lo mismo con `"regional_id"` o `"capturado_por"` en el body.
265. `POST /api/solicitudes` con `declaracion_aceptada:false` devuelve **422** `declaracion_requerida`; con `conceptos: []` devuelve **422** `conceptos_requeridos`; con `tipo_persona:"grupo"` y sin `razon_social` devuelve **422** `datos_persona_moral_requeridos`. En los tres casos `SELECT count(*) FROM solicitudes` no aumenta.
266. `POST /api/solicitudes` con `curp:"XXX"` devuelve **422** `curp_invalida`; con `correo:"no-es-correo"` devuelve **422** `correo_invalido`; con `telefono:"123"` devuelve **422** `telefono_invalido`; con un concepto de `cantidad: 0` devuelve **422** `montos_invalidos`.
267. Tras un alta exitosa de **1 concepto**, `SELECT count(*) FROM beneficiarios WHERE solicitud_id = <id>` devuelve **1**, y ese beneficiario tiene `folio` **igual** al folio de la solicitud, `tipo_apoyo_id` igual al del concepto y `regional_id` igual al `regional_id` de la ventanilla elegida.
268. `POST /api/solicitudes` con **3 conceptos distintos** devuelve **201** con `beneficiarios_creados` de longitud **3**, y en BD sus folios son `<folio>-C1`, `<folio>-C2`, `<folio>-C3` con `tipo_apoyo_id` distintos entre sí; `SELECT count(*) FROM solicitud_conceptos WHERE solicitud_id=<id>` devuelve **3** y las 3 filas tienen `beneficiario_id` no nulo.
269. Los beneficiarios creados toman **la ubicación del apoyo**, no el domicilio del solicitante: enviando `domicilio.municipio_id = A` y `apoyo.ubicacion.municipio_id = B` (distintos), `SELECT municipio_id FROM beneficiarios WHERE solicitud_id=<id>` devuelve **B** en todas las filas.
270. Ninguna solicitud pasa por staging: tras las altas anteriores, `SELECT count(*) FROM staging_beneficiarios` **no** aumentó, y `SELECT origen FROM solicitudes WHERE id=<id>` devuelve `solicitud_ventanilla`.
271. `GET $API/api/auditoria/log` con `T_ADMIN` contiene ≥1 entrada con `accion === "solicitud_creada"`, `entidad === "solicitud"` y `detalle.origen === "solicitud_ventanilla"`, con `detalle.folio` igual al folio devuelto y `detalle.beneficiarios_creados` no vacío.
272. `PATCH $API/api/solicitudes/<id>` y `DELETE $API/api/solicitudes/<id>` con `T_ADMIN` devuelven **404** o **405** (no existe edición ni borrado de solicitudes), y `SELECT count(*) FROM solicitudes` no disminuye.

### API — alcance aplicado en backend (273–279)

273. `POST $API/api/solicitudes` con `T_VEN1` usando un `apoyo.ubicacion.municipio_id` **no asignado** a `ventanilla1` devuelve **403** con `error.codigo === "municipio_fuera_de_alcance"` y no crea ninguna fila.
274. `POST /api/solicitudes` con `T_VEN1` usando un `componente_id` distinto del único asignado devuelve **403** `componente_fuera_de_alcance` y no crea ninguna fila.
275. `POST /api/solicitudes` con `T_VEN1` usando un municipio y un componente **sí** asignados devuelve **201** (el alcance no bloquea lo permitido).
276. `POST /api/solicitudes` con `T_ADMIN` usando **cualquier** municipio y componente devuelve **201** (el admin no tiene restricción de alcance).
277. `GET $API/api/solicitudes` con `T_VEN1` devuelve **200** y **ninguna** de las filas tiene un `componente` distinto del asignado ni un municipio fuera de su alcance, mientras que la misma consulta con `T_ADMIN` devuelve un `total` **estrictamente mayor**.
278. `GET $API/api/solicitudes/<id de una solicitud fuera del alcance de ventanilla1>` con `T_VEN1` devuelve **403** `fuera_de_alcance`, y con `T_ADMIN` devuelve **200**.
279. `GET $API/api/usuarios/<id de ventanilla1>/alcance` con `T_ADMIN` devuelve **200** con `municipios` y `componentes` como arrays; `PUT` del mismo recurso con `{"municipios":"todos","componentes":"todos"}` devuelve **200** y deja `SELECT count(*) FROM usuario_municipios WHERE usuario_id=<id>` en **0**; el mismo `PUT` con `T_VEN1` o `T_EDIT` devuelve **403**, y sobre un usuario de rol `capturista` devuelve **422** `rol_sin_alcance`.

### API — documentos requeridos (280–287)

280. `POST $API/api/solicitudes/documentos-requeridos` con `T_VEN2` y `{"componente_id":<TR>,"tipo_persona":"fisica"}` devuelve **200** con `documentos` no vacío, e incluye los requisitos `CURP`, `Identificación oficial vigente con fotografía`, `Constancia de situación fiscal`, `Proyecto Ejecutivo` y `Solicitud en original`.
281. Con `{"componente_id":<TR>,"tipo_persona":"fisica"}` el resultado **no** incluye ningún requisito exclusivo de moral o grupo (no aparece `Acta constitutiva`, ni `CURP del representante legal`, ni `Listado de integrantes del grupo de productores`).
282. Con `{"componente_id":<DIN>,"tipo_persona":"moral"}` el resultado **sí** incluye `Acta constitutiva`, `CURP del representante legal` y `Relación de beneficiarios directos de la persona moral, con documentos de cada uno`, y **no** incluye `CURP` a secas (regla 4, exclusiva de persona física).
283. Con `{"componente_id":<CAA>,"tipo_persona":"grupo"}` el resultado incluye `Listado de integrantes del grupo de productores`; con `{"componente_id":<DIN>,"tipo_persona":"grupo"}` **no** lo incluye (esa regla es solo de CAA).
284. La deduplicación funciona: en cualquier respuesta de E41, el número de elementos con `requisito === "Solicitud en original"` es exactamente **1**, y no hay dos elementos con el mismo texto de `requisito`.
285. Regla de exclusión: con `{"componente_id":<DIN>,"tipo_persona":"fisica","tipos_apoyo_ids":[<id de un tipo_apoyo cuyo nombre contiene FERTILIZANTE>]}` el resultado **no** incluye `Cotizaciones` pero **sí** incluye `Factura del insumo`; al agregar un segundo `tipo_apoyo_id` **no** excluido, `Cotizaciones` vuelve a aparecer.
286. Regla ligada a proyecto: con `{"componente_id":<DIN>,"tipo_persona":"grupo","proyecto_id":<PEO>}` el resultado incluye `Ficha técnica` y `Solicitud mediante escrito libre dirigida al Titular de la Secretaría`; **sin** `proyecto_id` esos dos requisitos **no** aparecen.
287. `POST /api/solicitudes/documentos-requeridos` sin `componente_id` o con `tipo_persona:"otro"` devuelve **422** `payload_invalido`; con `componente_id` inexistente devuelve **422** `componente_invalido`; sin token devuelve **401**.

### API — checklist, adjuntos y detalle (288–293)

288. Tras crear una solicitud **sin** enviar `documentos`, `SELECT count(*) FROM solicitud_documentos WHERE solicitud_id=<id>` es **igual** al `total` que devuelve E41 con ese mismo componente/tipo de persona/proyecto/conceptos, y todas las filas tienen `recibido = false`.
289. `GET $API/api/solicitudes/<id>` con `T_VEN2` devuelve **200** con las claves `solicitud`, `conceptos`, `documentos` y `beneficiarios`, y `solicitud.folio` coincide con el devuelto al crear.
290. `PATCH $API/api/solicitudes/<id>/documentos/<docId>` con `{"recibido":true}` devuelve **200** y en BD `recibido = true`; con body `{}` devuelve **422** `sin_cambios`; con un `docId` de otra solicitud devuelve **404**.
291. `POST $API/api/solicitudes/<id>/documentos/<docId>/archivo` con un JPG pequeño (`multipart/form-data`, campo `archivo`) devuelve **201** con `documento.archivo_url` que empieza con `/media/solicitudes/`; en BD `archivo_hash` no es nulo y `recibido` quedó en **true**.
292. `GET $API<archivo_url>` con el token del usuario devuelve **200** con `content-type` de imagen; el mismo archivo subido con `content-type: text/plain` devuelve **422** `tipo_archivo_no_permitido` y no cambia `archivo_url` en BD.
293. `GET $API/api/auditoria/log` con `T_ADMIN` contiene ≥1 entrada `solicitud_documento_adjuntado` y ≥1 entrada `solicitud_documento_actualizado`, y ≥1 entrada `alcance_usuario_actualizado`.

### Integración con el flujo existente (294–296)

294. Los beneficiarios creados por solicitud son visibles para el capturista de esa Regional: `GET $API/api/beneficiarios` con un token de capturista de la Regional de la ventanilla usada devuelve **200** e incluye un elemento con el `folio` del beneficiario creado.
295. `POST $API/api/capturas` (E7) sobre uno de esos beneficiarios, con el token de ese capturista, devuelve **201** — el flujo de captura de campo funciona sin cambios sobre un beneficiario nacido en ventanilla.
296. Regresión: `GET /api/health`, `POST /api/auth/login` (admin), `GET /api/catalogos`, `GET /api/staging/resumen` (con `T_EDIT`), `GET /api/auditoria/capturas` (con `T_AUD`) y `PATCH /api/beneficiarios/:id` (con `T_EDIT`) siguen respondiendo exactamente como en los builds 1–5 (200 en todos los casos válidos).

### PWA — pantalla de ventanilla (297–304)

297. Playwright: iniciar sesión con `ventanilla2` redirige a `/solicitudes`, se ve `[data-testid="nav-solicitudes"]` y `[data-testid="tabla-solicitudes"]`; con `capturista1`, `auditor1` y `editor1` el conteo de `[data-testid="nav-solicitudes"]` es **0** y navegar a `/solicitudes` muestra "No tienes permiso para ver esta sección."
298. Playwright con `ventanilla2`: pulsar `[data-testid="btn-nueva-solicitud"]` abre `/solicitudes/nueva`, se ven los 6 pasos (`paso-1`…`paso-6`), existe `[data-testid="folio-pendiente"]` y **no** existe ningún input editable de folio (0 elementos `input[name="folio"]`).
299. Playwright: en el paso 2, con `select-tipo-persona = "fisica"` el conteo de `[data-testid="input-razon-social"]` es **0**; al cambiar a "Grupo de productores" aparecen `input-razon-social` e `input-num-integrantes`; la etiqueta de `input-nombre-solicitante` cambia a la del representante del grupo.
300. Playwright: en el paso 3, con `chk-ganadera` sin marcar el conteo de `[data-testid="select-gan-produccion"]` es **0**; al marcarlo aparecen `input-gan-tipo-ganado`, `input-gan-cabezas`, `input-gan-agostadero` y `select-gan-produccion`; lo mismo para agrícola, acuícola y pesca con sus subcampos.
301. Playwright: en el paso 5 hay **1** `[data-testid="fila-concepto"]` inicial y `btn-quitar-concepto` está deshabilitado; pulsar `btn-agregar-concepto` deja **2** filas y habilita el de quitar; escribir 30000 en `input-concepto-estatal` y 10000 en `input-concepto-productor` deja `input-concepto-total` en **40000** sin intervención del usuario.
302. Playwright: en el paso 6, cambiar `select-tipo-persona` de "fisica" a "Grupo de productores" cambia el número de `[data-testid="item-documento"]` (la lista se recalcula contra E41) y `[data-testid="contador-documentos"]` refleja "Recibidos: 0 de N"; el `[data-testid="texto-declaraciones"]` contiene los 7 incisos (texto que incluye "no implica la autorización del apoyo").
303. Playwright: con la declaración **sin** marcar, `[data-testid="btn-guardar-solicitud"]` está deshabilitado; al marcar `[data-testid="chk-declaracion"]` y con el formulario completo, guardar muestra `[data-testid="modal-folio-generado"]` con `[data-testid="texto-folio"]` que cumple `^[A-Z]{2,5}-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$`, y "Ver solicitud" lleva a `/solicitudes/:id` donde `[data-testid="detalle-folio"]` muestra ese mismo folio.
304. Playwright: en `/solicitudes/:id` existe `[data-testid="tabla-beneficiarios-creados"]` con al menos una fila, la lista de documentos permite marcar `chk-documento-recibido` (persiste tras recargar) y subir un archivo por `input-archivo-documento` deja visible `[data-testid="enlace-archivo"]`; no existe ningún botón de "Editar solicitud" ni "Eliminar solicitud".

### Sin regresiones offline y documentación (305–306)

305. `grep -r` en `pwa/src/pantallas/Solicitudes.tsx`, `NuevaSolicitud.tsx`, `DetalleSolicitud.tsx` y `pwa/src/api/solicitudes.ts` **no** encuentra `navigator.geolocation`, `dexie`, `indexeddb` ni `cola_sync` (mayúsculas/minúsculas indiferentes); `git diff` no muestra cambios en `pwa/src/db/indexeddb.ts`, `pwa/src/sync/*` ni `pwa/nginx.conf.template`; el flujo offline del capturista (criterios 41–50 de §7) sigue pasando.
306. `README.md` documenta el módulo de ventanilla: (a) qué es el rol `ventanilla` y a qué accede y a qué no; (b) cómo se asigna el **alcance** por municipios y componentes y que **vacío = todos**; (c) el **esquema del folio** con su ejemplo `PEO-SJR-AME-0001-26` y el fallback de `siglas_folio`; (d) que la solicitud **entra directo a producción sin pasar por staging** y crea **un beneficiario por concepto**; (e) que el **domicilio del solicitante y la ubicación del apoyo son distintos** y que el beneficiario hereda la ubicación del apoyo; y (f) que la solicitud **no se edita** después de guardada y las correcciones van por `/correcciones`.

**Definición de "terminado" (build 6):** los **306** criterios pasan (240 acumulados de los builds 1–5, con las excepciones ya declaradas en §11.8, + **66** de esta extensión).

# 13. EXTENSIÓN — Build 7: Casas Ejidales y mejoras de ventanilla

> **CONTINUACIÓN LITERAL DE `SPEC.md`.** Esta sección se **agrega al final** de `SPEC.md` (después de la línea "Definición de 'terminado' (build 6)"). **Nada de las secciones 1–12 se reescribe ni se renegocia**: todas sus reglas siguen vigentes palabra por palabra. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios (`db`, `backend`, `pwa`). **No se agrega ninguna dependencia npm nueva** (§12.12 sigue vigente). Código comentado en español, UI en español.

## 13.1 Objetivo de la extensión

Dos tipos de entregable en un solo build: (a) dar de alta el **proyecto Casas Ejidales** (`CEJ`) con sus 8 documentos requeridos en la BD y en el módulo de ventanilla existente, sin crear ningún programa, subprograma ni componente nuevo; y (b) cuatro **mejoras de UX** en las pantallas de ventanilla — visor inline de PDF en el detalle de documentos, redirección automática post-guardado con banner de confirmación, zona de drag & drop en el checklist de documentos, y carátula imprimible del expediente — todas sin dependencias npm nuevas ni cambios de esquema.

## 13.2 Decisiones de producto (implementar tal cual, no preguntar)

- **D45. Casas Ejidales es un PROYECTO nuevo, no un programa nuevo.** Se modela como una fila en `proyectos` (clave `CEJ`, nombre "Casas Ejidales", `prefijo_folio='CEJ'`, `componente_id=NULL`, igual que PEO). La jerarquía Programa → Subprograma sigue siendo la misma existente: "Apoyo al Campo Queretano 2026" → "Impulso a la Productividad". **No se crea ningún registro en `programas`, `subprogramas` ni `componentes`.**
- **D46. Los 8 documentos requeridos de Casas Ejidales son propios del proyecto CEJ.** Se insertan como 8 filas nuevas en `documentos_requeridos` con `proyecto_id = <id de CEJ>`, `tipos_persona = '{grupo}'`, `componentes = NULL` (aplican con cualquier componente). El texto de cada documento se toma literalmente del PDF `CamScanner 17-08-2026 10.27.pdf`. No se reutilizan las 8 filas del anexo PEO (§12.7.2): son entidades separadas con su propio `proyecto_id`.
- **D47. El folio CEJ sigue el mismo esquema.** `CEJ-{clave_regional}-{siglas_municipio}-{consecutivo 4 dígitos}-{año 2 dígitos}`. El generador de folios ya lo soporta: solo necesita la nueva fila en `proyectos` con `prefijo_folio='CEJ'`.
- **D48. No se restringe `tipo_persona` en el backend para CEJ.** La documentación del PDF lista requisitos solo para "Grupos de productores", pero la validación a nivel API no cambia (E42 sigue aceptando `fisica`, `moral`, `grupo` con cualquier proyecto). El algoritmo de E41 devolverá solo los 8 documentos CEJ cuando `tipo_persona='grupo'`; para otros tipos el checklist vendrá de las reglas generales (§12.7.1) sin los CEJ-específicos.
- **D49. Visor inline: tipo de archivo determinado por extensión del `archivo_nombre`.** La tabla `solicitud_documentos` no guarda `content-type`, pero sí `archivo_nombre`. Si termina en `.pdf` → `<iframe>`; si termina en `.jpg`, `.jpeg`, `.png` o `.webp` → `<img>`. Si la extensión es desconocida o nula, se muestra solo el `<a>` enlace sin viewer inline. El enlace `<a data-testid="enlace-archivo">` se mantiene en todos los casos como descarga de respaldo.
- **D50. Redirección post-guardado: timer cancelable.** El contador de 4 s inicia al montar el modal `modal-folio-generado`. Si el usuario pulsa "Ver solicitud" antes de los 4 s, la navegación es inmediata y el timer se cancela (`clearTimeout`). La URL destino incluye `?nuevo=1`. En `DetalleSolicitud.tsx`, `useSearchParams` detecta el param, muestra el banner, y reemplaza la URL con `navigate(location.pathname, {replace:true})` para que al recargar o al volver con "atrás" no aparezca de nuevo.
- **D51. Drag & drop: solo el primer archivo de la lista.** Si el usuario suelta varios archivos, se procesa `event.dataTransfer.files[0]` y se ignoran los demás. Sin validación de MIME en cliente antes de enviar (la validación ya existe en E46). La zona usa los eventos `dragover`, `dragleave`, `drop` del DOM nativo; sin librería.
- **D52. Carátula imprimible: `window.print()` en la misma pestaña.** No se abre ventana nueva. Se aplica `@media print` dentro del mismo archivo TSX: oculta todo el layout excepto `[data-testid="caratula-imprimible"]`. Las casillas de documentos se renderizan como `<input type="checkbox" disabled>` (no marcadas) para que el papel impreso muestre cuadros vacíos para check manual.

## 13.3 Modelo de datos — `db/migrations/014_casas_ejidales.sql`

Esta migración es **100 % aditiva e idempotente**. No toca ninguna tabla, columna ni índice existente. El script `db/migrar.ts` ya existente la ejecuta sin modificación.

```sql
-- Proyecto nuevo: Casas Ejidales (CEJ)
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, activo)
VALUES ('CEJ', 'Casas Ejidales', 'CEJ', NULL, TRUE)
ON CONFLICT (clave) DO NOTHING;

-- 8 documentos requeridos para Casas Ejidales (solo grupos de productores).
-- componentes = NULL => aplica con cualquier componente.
-- Para idempotencia se usa WHERE NOT EXISTS verificando (requisito, proyecto_id).
INSERT INTO documentos_requeridos (requisito, componentes, tipos_persona, proyecto_id, orden, activo)
SELECT req, NULL, '{grupo}', proy.id, ord, TRUE
FROM (VALUES
  ('Solicitud mediante escrito libre dirigida al Titular de la Secretaría', 1),
  ('Ficha técnica', 2),
  ('Acta integración del grupo de productores', 3),
  ('Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores', 4),
  ('CURP del representante del grupo de productores', 5),
  ('Constancia de Situación Fiscal del representante del grupo de productores', 6),
  ('Comprobante de domicilio del representante de grupo de productores', 7),
  ('Relación de beneficiarios directos del grupo de productores', 8)
) AS docs(req, ord)
CROSS JOIN (SELECT id FROM proyectos WHERE clave = 'CEJ') AS proy
WHERE NOT EXISTS (
  SELECT 1 FROM documentos_requeridos dr
  WHERE dr.requisito = docs.req
    AND dr.proyecto_id = proy.id
);
```

> **Nota de implementación:** si el Generator prefiere añadir un índice único parcial `CREATE UNIQUE INDEX IF NOT EXISTS idx_docsreq_req_proyecto ON documentos_requeridos (requisito, proyecto_id) WHERE proyecto_id IS NOT NULL;` como parte de la misma migración, puede hacerlo y sustituir el `WHERE NOT EXISTS` por `ON CONFLICT (requisito, proyecto_id) WHERE proyecto_id IS NOT NULL DO NOTHING`. Cualquiera de las dos estrategias es válida; lo que no se permite es que la migración ejecutada dos veces duplique filas.

**Fallback de `siglas_folio`:** la migración 014 no toca `municipios.siglas_folio`; el seed 005 ya las llenó en Build 6 (criterio 252). Si hay municipios nuevos sin siglas, el fallback determinista de §12.5 los cubre.

## 13.4 Pantallas afectadas (delta sobre §12.8)

### 13.4.1 `pwa/src/pantallas/DetalleSolicitud.tsx`

Cuatro cambios independientes en el mismo archivo, sin romper ningún `data-testid` existente:

**1. Visor inline (B7-A):** en el bloque de cada documento, donde hoy existe solo `<a data-testid="enlace-archivo">`, agregar encima un viewer condicional basado en la extensión de `archivo_nombre`: si termina en `.pdf` → `<iframe data-testid="visor-pdf-documento" src={url} width="100%" height="400px" title="Documento adjunto" />`; si termina en `.jpg`, `.jpeg`, `.png` o `.webp` → `<img data-testid="visor-imagen-documento" src={url} alt="Documento adjunto" style={{maxWidth:'100%'}} />`. El `<a>` sigue presente en ambos casos.

**2. Banner post-guardado (B7-C):** al montar, leer `useSearchParams()`. Si existe `nuevo=1`, mostrar `<div data-testid="banner-nuevo" role="status">Solicitud {folio} registrada. Adjunta los documentos requeridos.</div>` y llamar `navigate(location.pathname, {replace:true})` para quitar el param del historial. El banner se desmonta al hacer clic (`onClick`) o tras `setTimeout(10000)`.

**3. Drag & drop (B7-D):** encima de cada `<input type="file" data-testid="input-archivo-documento">`, agregar `<div data-testid="zona-drop-documento" className="zona-drop" onDragOver={e => {e.preventDefault(); e.currentTarget.classList.add('zona-drop--activa');}} onDragLeave={e => e.currentTarget.classList.remove('zona-drop--activa')} onDrop={e => {e.preventDefault(); e.currentTarget.classList.remove('zona-drop--activa'); void adjuntar(docId, e.dataTransfer.files[0] ?? null);}}>Arrastra aquí el archivo</div>`.

**4. Carátula imprimible (B7-E):** botón `<button data-testid="btn-imprimir-caratula" onClick={() => window.print()}>Imprimir carátula</button>` en la tarjeta superior. Sección `<div data-testid="caratula-imprimible" className="caratula">` siempre presente en el DOM, oculta en pantalla normal (`display:none` en CSS), visible solo en `@media print`. Contiene: `[data-testid="caratula-folio"]`, `[data-testid="caratula-solicitante"]` (nombre o razón social según tipo_persona), `[data-testid="caratula-municipio"]`, `[data-testid="caratula-programa"]`, `[data-testid="caratula-fecha"]` (fecha en formato `toLocaleDateString('es-MX')`), `[data-testid="caratula-conceptos"]` (tabla con filas `caratula-fila-concepto`), `[data-testid="caratula-lista-documentos"]` (lista de ítems `caratula-item-documento` cada uno con `<input type="checkbox" disabled />`). CSS `@media print` oculta `.tarjeta` y `.modal-fondo` para que solo la carátula se imprima.

### 13.4.2 `pwa/src/pantallas/NuevaSolicitud.tsx`

**Redirección automática (B7-C):** en el bloque del modal `modal-folio-generado`, al montar (cuando `resultado !== null`), iniciar `const timer = setTimeout(() => navegar(`/solicitudes/${resultado.solicitud.id}?nuevo=1`), 4000)` guardado en una `ref`. El botón `btn-ver-solicitud` cancela el timer y navega inmediatamente a `/solicitudes/${resultado.solicitud.id}?nuevo=1`. El modal desaparece en ambos casos al navegar.

## 13.5 Assumptions nuevas (continúa la numeración de §12.11)

55. **El PDF CamScanner 17-08-2026 10.27.pdf muestra cabeceras de PEO**, no de un programa independiente "Casas Ejidales". El usuario indicó que ese PDF corresponde a los requisitos de Casas Ejidales. Se resuelve modelando "Casas Ejidales" como un PROYECTO nuevo (`CEJ`) dentro del programa y subprograma ya existentes, con los 8 documentos listados en el PDF tomados verbatim. No se crea programa, subprograma ni componente nuevo.
56. **Prefijo de folio `CEJ`** (3 letras, "Casas EJidales"). Consistente con PEO (3 letras). Alternativas descartadas: `CE` (2 letras, rompe la consistencia visual), `CASEJ` (5 letras, más largo sin necesidad).
57. **El backend no restringe `tipo_persona` para el proyecto CEJ.** La restricción "solo grupos de productores" es documental. El algoritmo E41 la hace efectiva naturalmente: los 8 documentos CEJ tienen `tipos_persona='{grupo}'` y no aparecen en el checklist de `fisica`/`moral`. Forzar la restricción en E42 requeriría columna nueva y agrega complejidad sin beneficio real.
58. **El visor inline determina el tipo de archivo por extensión de `archivo_nombre`** (ya almacenado en `solicitud_documentos`). Si la extensión es nula o desconocida, solo se muestra el `<a>`. No se añade columna `content_type` (evita migración extra).
59. **La URL con `?nuevo=1` produce el banner una sola vez.** `DetalleSolicitud.tsx` llama a `navigate(location.pathname, {replace:true})` en el primer render con el param presente, eliminándolo del historial. Recargar la página, botón "atrás" o enlace directo sin el param no muestran el banner.
60. **Idempotencia de la migración 014 con `WHERE NOT EXISTS`.** Si en el futuro el Generator prefiere un índice único parcial sobre `(requisito, proyecto_id)`, puede añadirlo en la misma migración 014 sin romper nada: ese índice no existía antes, es aditivo.

## 13.6 Dependencias y archivos

**Sin dependencias npm nuevas.** Los cuatro cambios de UX usan únicamente React, DOM nativo y CSS.

**Archivos nuevos:**

```
db/migrations/014_casas_ejidales.sql
```

**Archivos modificados:**

```
pwa/src/pantallas/DetalleSolicitud.tsx   (visor inline, banner, drag & drop, carátula)
pwa/src/pantallas/NuevaSolicitud.tsx     (timer de redirección en modal)
README.md                                (documentar proyecto CEJ y mejoras de UX)
```

**No se modifica:** ningún archivo de backend, ningún seed existente, `docker-compose.yml`, `packages/shared/src/*`, `pwa/src/sync/*`, `pwa/src/db/indexeddb.ts`, ni ninguna ruta API.

---

## 13.7 Rubric extendido (criterios 307–343)

Continúa la numeración de §7, §8.11, §9.9, §10.11, §11.9 y §12.13. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_VEN2` (`ventanilla2`, alcance "todos"). **Nota de actualización:** el criterio 250 documentó el estado de Build 6 con 42 documentos activos; tras Build 7 el valor correcto es 50 (se verifica en criterio 342).

### Base de datos — migración 014 (307–312)

La migración 014 es pura inserción; no altera columnas, tablas ni índices existentes. Los criterios de BD de §12.13 (241–250) deben seguir pasando íntegramente.

307. Existe `db/migrations/014_casas_ejidales.sql` y sigue **sin existir** `db/migrations/011_*.sql` (criterio 231 intacto); ejecutar el script `db/migrar.ts` sobre una BD de Build 6 ya poblada sale con código 0 y sin error.
308. `SELECT clave, prefijo_folio, componente_id FROM proyectos WHERE clave = 'CEJ'` devuelve exactamente **1 fila** con `prefijo_folio = 'CEJ'` y `componente_id IS NULL`; `SELECT count(*) FROM proyectos` devuelve ≥ **2**.
309. `SELECT count(*) FROM documentos_requeridos WHERE activo = TRUE AND proyecto_id = (SELECT id FROM proyectos WHERE clave = 'CEJ')` devuelve exactamente **8**.
310. Las 8 filas CEJ tienen `tipos_persona` igual a `{grupo}` (o `'{grupo}'` en notación de array de PostgreSQL) y `componentes IS NULL`; sus textos de `requisito` incluyen exactamente: `Solicitud mediante escrito libre dirigida al Titular de la Secretaría`, `Ficha técnica`, `Acta integración del grupo de productores`, `Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores`, `CURP del representante del grupo de productores`, `Constancia de Situación Fiscal del representante del grupo de productores`, `Comprobante de domicilio del representante de grupo de productores` y `Relación de beneficiarios directos del grupo de productores`.
311. La migración 014 es **idempotente**: ejecutarla una segunda vez no produce error y `SELECT count(*) FROM proyectos WHERE clave = 'CEJ'` sigue siendo **1** y `SELECT count(*) FROM documentos_requeridos WHERE proyecto_id = (SELECT id FROM proyectos WHERE clave='CEJ')` sigue siendo **8**.
312. La migración 014 no altera catálogos existentes: `SELECT count(*) FROM componentes` devuelve **3** (sin cambio), `SELECT count(*) FROM ventanillas` devuelve **5** (sin cambio), `SELECT count(*) FROM programas` devuelve **1** (sin cambio), `SELECT count(*) FROM subprogramas` devuelve **1** (sin cambio).

### API — Casas Ejidales en el módulo de ventanilla (313–319)

El proyecto CEJ se integra de forma transparente en los endpoints existentes (E40, E41, E42). No hay endpoints nuevos, ni cambios de RBAC ni de esquema de validación en el backend.

313. `GET $API/api/solicitudes/catalogos` con `T_VEN2` devuelve en `proyectos` un array con ≥ **2** elementos; uno de ellos tiene `clave:'CEJ'` y `prefijo_folio:'CEJ'`.
314. `POST $API/api/solicitudes/documentos-requeridos` con `T_VEN2` y `{"componente_id":<id de cualquier componente válido>,"tipo_persona":"grupo","proyecto_id":<id de CEJ>}` devuelve **200** con `documentos` que incluye `Ficha técnica` y `Relación de beneficiarios directos del grupo de productores`; el mismo cuerpo **sin** `proyecto_id` **no** incluye esos dos requisitos (son exclusivos del proyecto CEJ).
315. `POST $API/api/solicitudes` con `T_VEN2` y payload válido (`tipo_persona:'grupo'`, `proyecto_id:<id CEJ>`, 1 concepto, `declaracion_aceptada:true`, municipio y componente dentro del alcance de `ventanilla2`) devuelve **201** con `solicitud.folio` que cumple `^CEJ-[A-Z]{3}-[A-Z]{3}-0001-\d{2}$` y `SELECT origen FROM solicitudes WHERE id=<id>` devuelve `solicitud_ventanilla`.
316. El contador de folios CEJ es **independiente** del de PEO: tras el criterio 315, `SELECT consecutivo FROM solicitud_folios WHERE prefijo='CEJ'` devuelve **1** y `SELECT consecutivo FROM solicitud_folios WHERE prefijo='PEO'` tiene el mismo valor que antes del criterio 315 (no aumentó).
317. `POST $API/api/solicitudes` con proyecto `CEJ` y `tipo_persona:'fisica'` devuelve **201** (no hay restricción de tipo de persona a nivel API); la lista de documentos calculada por E41 para ese alta **no** incluye los 8 documentos CEJ (que tienen `tipos_persona='{grupo}'`).
318. Tras el criterio 315, `SELECT beneficiario_id FROM solicitud_conceptos WHERE solicitud_id=<id CEJ>` devuelve un valor no nulo, y `SELECT folio FROM beneficiarios WHERE id=<beneficiario_id>` devuelve el folio con prefijo `CEJ`.
319. Regresión: `POST $API/api/solicitudes` con proyecto `PEO` sigue devolviendo folio con prefijo `PEO`; el criterio 286 sigue pasando (E41 con `proyecto_id=<PEO>` devuelve `Ficha técnica`); el criterio 261 sigue pasando con PEO.

### PWA — visor inline de PDF en DetalleSolicitud (320–323)

El visor inline no requiere cambios de backend. La URL del `<iframe>` o `<img>` es la misma URL autenticada que ya usa el `<a data-testid="enlace-archivo">`.

320. Playwright: en `/solicitudes/:id`, tras subir un archivo **PDF** mediante `input-archivo-documento` (o directamente con curl hacia E46), el ítem del documento muestra `[data-testid="visor-pdf-documento"]` (elemento `iframe`) con atributo `src` no vacío, y `[data-testid="enlace-archivo"]` sigue presente; el conteo de `[data-testid="visor-imagen-documento"]` en ese mismo ítem es **0**.
321. Playwright: si el archivo adjunto es un **JPG**, el ítem muestra `[data-testid="visor-imagen-documento"]` (elemento `img`) con `src` no vacío; el conteo de `[data-testid="visor-pdf-documento"]` en ese ítem es **0**; el `<a data-testid="enlace-archivo">` sigue presente.
322. `grep -rn` en `pwa/src/pantallas/DetalleSolicitud.tsx` **no** encuentra ningún `import` cuyo especificador contenga `pdf.js`, `react-pdf`, `pdfjs`, `pdfmake` ni `html2pdf`; la implementación del visor se realiza únicamente con la etiqueta `iframe` del DOM nativo.
323. Playwright: el atributo `src` del `[data-testid="visor-pdf-documento"]` es la misma URL que el `href` del `[data-testid="enlace-archivo"]` del mismo ítem (`await locator.getAttribute('src') === await linkLocator.getAttribute('href')`), confirmando que ambos usan la URL autenticada generada por `urlConToken`.

### PWA — redirección automática post-guardado con banner (324–328)

El modal `modal-folio-generado` ya existe (criterio 303). Esta subsección verifica los cambios de B7-C: timer de 4 s, destino con `?nuevo=1` y banner en `DetalleSolicitud.tsx`.

324. Playwright: en `/solicitudes/nueva`, tras guardar una solicitud válida aparece `[data-testid="modal-folio-generado"]` con `[data-testid="texto-folio"]` no vacío y `[data-testid="btn-ver-solicitud"]`; al pulsar el botón la URL cambia a `/solicitudes/<id>?nuevo=1` en menos de 1 s y el modal desaparece.
325. Playwright: sin pulsar "Ver solicitud", `page.waitForURL(/\/solicitudes\/\d+\?nuevo=1/, {timeout: 6000})` resuelve antes de 6 s (el timer de 4 s dispara la navegación automática).
326. Playwright: al llegar a `/solicitudes/<id>?nuevo=1`, existe `[data-testid="banner-nuevo"]` con texto que contiene el folio y la cadena "Adjunta los documentos requeridos"; y la URL en el historial **ya no** contiene `?nuevo=1` (fue reemplazada con `navigate(path, {replace:true})`).
327. Playwright: hacer clic en `[data-testid="banner-nuevo"]` hace que `page.locator('[data-testid="banner-nuevo"]').count()` sea **0** en menos de 1 s.
328. Playwright: esperar 11 s desde la aparición del banner sin hacer clic: `page.locator('[data-testid="banner-nuevo"]').count()` es **0** (el `setTimeout(10000)` lo desmontó); navegar a `/solicitudes/<mismo id>` (sin `?nuevo=1`) confirma que el conteo de `[data-testid="banner-nuevo"]` es **0** en accesos normales.

### PWA — zona de drag & drop en DetalleSolicitud (329–332)

La zona de drop es un añadido visual encima del input file existente; el input sigue siendo el fallback. Sin librería externa.

329. Playwright: en `/solicitudes/:id`, cada `[data-testid="item-documento"]` contiene exactamente **1** elemento `[data-testid="zona-drop-documento"]`; `grep -rn` en `pwa/src/pantallas/DetalleSolicitud.tsx` **no** encuentra ningún `import` de librería de drag & drop (react-dropzone, filepond, uppy, etc.).
330. Playwright: `page.dispatchEvent('[data-testid="zona-drop-documento"]:first-child', 'dragover')` cambia el estado visual de la zona; verificar con `page.locator('[data-testid="zona-drop-documento"]:first-child').evaluate(el => el.classList.contains('zona-drop--activa'))` devuelve `true`; disparar `dragleave` y verificar que devuelve `false`.
331. Playwright: crear un `DataTransfer` con un archivo JPG (`new File([new Uint8Array([0xff,0xd8,0xff])], 'test.jpg', {type:'image/jpeg'})`), despachar `drop` sobre `[data-testid="zona-drop-documento"]:first-child` — tras el drop el servidor responde **201** y aparece `[data-testid="enlace-archivo"]` en ese ítem (mismo resultado que subir por `input-archivo-documento`).
332. Playwright: el `input-archivo-documento` del mismo ítem sigue presente y funcional tras la adición del drag & drop (criterio 304 sigue pasando sin modificación referente a subida de archivos).

### PWA — carátula imprimible del expediente (333–339)

La carátula vive en el mismo `DetalleSolicitud.tsx`, visible solo en `@media print`. El botón llama a `window.print()` nativamente. Sin librería externa.

333. Playwright: en `/solicitudes/:id` existe `[data-testid="btn-imprimir-caratula"]` con texto "Imprimir carátula"; al evaluarlo con `page.evaluate(() => { window._printCalled = false; const orig = window.print.bind(window); window.print = () => { window._printCalled = true; }; })` y luego pulsar el botón, `await page.evaluate(() => window._printCalled)` devuelve `true`.
334. Playwright: `page.locator('[data-testid="caratula-imprimible"]').count()` es **1** (el elemento existe en el DOM); dentro de él existen `[data-testid="caratula-folio"]` con el folio de la solicitud, `[data-testid="caratula-solicitante"]` con el nombre o razón social, `[data-testid="caratula-municipio"]` con el nombre del municipio de la ubicación del apoyo, y `[data-testid="caratula-programa"]` con texto no vacío.
335. Playwright: `[data-testid="caratula-conceptos"]` dentro de `caratula-imprimible` contiene al menos **1** elemento `[data-testid="caratula-fila-concepto"]`; cada fila incluye el nombre del concepto y un valor numérico de monto visible en el DOM.
336. Playwright: `[data-testid="caratula-lista-documentos"]` dentro de `caratula-imprimible` contiene tantos `[data-testid="caratula-item-documento"]` como elementos `[data-testid="item-documento"]` tiene la sección de documentos de esa solicitud; y cada `caratula-item-documento` contiene exactamente **1** elemento `input[type="checkbox"]` con el atributo `disabled` presente y **sin** `checked`.
337. Playwright: `[data-testid="caratula-fecha"]` contiene un texto no vacío que **no** es una cadena ISO 8601 pura (no es solo dígitos, letras y guiones como `2026-08-17T18:00:00.000Z`); incluye al menos un separador legible como `/` o la palabra de un mes en español.
338. `grep -rn` en `pwa/src/pantallas/DetalleSolicitud.tsx` **no** encuentra ningún `import` de librería de generación de PDF (jspdf, html2pdf, pdfmake, etc.); la única llamada relacionada con impresión es `window.print()`.
339. `grep -rn` en `pwa/src/pantallas/DetalleSolicitud.tsx` o en su archivo CSS asociado **sí** encuentra la cadena `@media print`; y dentro de ese bloque existe una regla con `display: none` o `visibility: hidden` aplicada a elementos que no son la carátula (por ejemplo `.tarjeta`, el layout principal, o un selector equivalente).

### Regresiones y documentación (340–343)

340. Los criterios 291, 292 y 304 siguen pasando: subir un archivo JPG por `input-archivo-documento` devuelve **201**, `GET` del `archivo_url` con token devuelve **200** con `content-type` de imagen, en el detalle se puede marcar `chk-documento-recibido` y subir archivos sin error (ninguna regresión introducida por los cambios de drag & drop ni por el visor inline).
341. El criterio 296 (regresión general: `GET /api/health`, login, catálogos, staging, auditoría y correcciones) sigue pasando sin cambios.
342. `SELECT count(*) FROM documentos_requeridos WHERE activo` devuelve **50** tras aplicar la migración 014 (42 de Build 6 + 8 de CEJ); `SELECT count(*) FROM proyectos` devuelve ≥ **2**; y `SELECT count(*) FROM documentos_requeridos WHERE activo AND proyecto_id IS NULL` devuelve el mismo valor que en Build 6 para las reglas generales (ninguna fila existente fue modificada ni eliminada).
343. `README.md` documenta el proyecto Casas Ejidales: (a) que es un **proyecto nuevo** (`CEJ`) bajo el programa "Apoyo al Campo Queretano 2026" y subprograma "Impulso a la Productividad", sin componente asignado; (b) el prefijo de folio `CEJ` y su estructura `CEJ-{regional}-{municipio}-{consecutivo}-{año}`; (c) que los 8 documentos requeridos aplican a **grupos de productores** (listados explícitamente); (d) cómo aplicar la migración 014 sobre una BD de Build 6 existente sin downtime; y (e) que las mejoras de UX (visor PDF, banner post-guardado, drag & drop, carátula imprimible) no requieren variable de entorno nueva ni migración adicional.

**Definición de terminado (build 7):** los **343** criterios pasan (306 acumulados de los builds 1–6 + **37** de esta extensión).
