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
