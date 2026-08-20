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

> **CORRECCIÓN DE UN ERROR DE DISEÑO DE BUILD 7 (detectado por el usuario).** La primera redacción de esta sección modeló "Casas Ejidales" como un **proyecto nuevo** con clave `CEJ` y prefijo de folio propio (`CEJ-{regional}-{municipio}-{consecutivo}-{año}`). **Eso era incorrecto.** Al revisar de nuevo los documentos oficiales (`CamScanner 17-08-2026 10.27.pdf` y `CamScanner 17-08-2026 10.28.pdf` — los mismos ya transcritos en §12), el usuario confirmó que esos documentos son del **proyecto PEO ya existente** (mismo folio de ejemplo real `PEO-SJR-AME-0001-26` de §12.5). "Casas Ejidales" **no es un proyecto**: es un **concepto de apoyo** (una fila de `tipos_apoyo`) dentro de PEO, cuya urgencia operativa es poder capturar expedientes de sus beneficiarios en ventanilla. Esta sección 13 queda **corregida en su lugar**: no existe ni existirá el proyecto `CEJ`, ni el prefijo de folio `CEJ`. El Build 7 **no se había desplegado a producción**, así que la corrección se aplica sobre el mismo código y la misma migración `014`, sin migración de reversión. Las cuatro mejoras de UX del Build 7 (visor inline, banner post-guardado, drag & drop, carátula imprimible) **no están afectadas por este error** y quedan exactamente igual.

## 13.1 Objetivo de la extensión

Dos tipos de entregable en un solo build: (a) dar de alta **"Casas Ejidales" como concepto de apoyo del proyecto PEO** (una fila nueva en `tipos_apoyo`) y ligar sus **8 documentos requeridos** a ese concepto mediante el mecanismo `apoyo_id` que **ya existe** en `documentos_requeridos` desde §12.3.1, sin crear ningún programa, subprograma, componente ni proyecto nuevo y sin ninguna columna ni tabla nueva; y (b) cuatro **mejoras de UX** en las pantallas de ventanilla — visor inline de PDF en el detalle de documentos, redirección automática post-guardado con banner de confirmación, zona de drag & drop en el checklist de documentos, y carátula imprimible del expediente — todas sin dependencias npm nuevas ni cambios de esquema.

## 13.2 Decisiones de producto (implementar tal cual, no preguntar)

- **D45. Casas Ejidales es un CONCEPTO DE APOYO (`tipos_apoyo`), no un proyecto ni un programa.** Se modela como **una fila nueva en `tipos_apoyo`**: `clave = 'CASAS-EJIDALES'`, `nombre = 'Casas Ejidales'`, `categoria = 'infraestructura'`, `unidad_medida = 'obra'`, `activo = TRUE`. **No se crea ningún registro en `programas`, `subprogramas`, `componentes` ni `proyectos`.** La jerarquía sigue siendo la ya sembrada en §12.4: programa "Apoyo al Campo Queretano 2026" → subprograma "Impulso a la Productividad" → proyecto **PEO** ("Proyectos Estratégicos para el Fortalecimiento Organizativo"). Los expedientes de casas ejidales son **solicitudes del proyecto PEO** que llevan este concepto en su sección 5 (Conceptos de apoyo solicitados).
- **D46. Los 8 documentos requeridos se ligan al concepto vía `apoyo_id`, con `proyecto_id` = PEO.** Se insertan como 8 filas nuevas en `documentos_requeridos` con `apoyo_id = <id del tipo_apoyo 'CASAS-EJIDALES'>`, `proyecto_id = <id del proyecto PEO ya sembrado en §12.4>`, `tipos_persona = '{grupo}'`, `componentes = NULL` (aplican con cualquier componente). **No se crea ninguna columna ni tabla nueva**: `apoyo_id` ya existe desde §12.3.1 y el algoritmo de E41 (§12.6.2, condición 4) ya sabe evaluarlo. El texto de cada documento se toma literalmente del PDF `CamScanner 17-08-2026 10.27.pdf` (los 8 textos de §13.3 son correctos y no cambian).
- **D47. El folio NO cambia: las solicitudes de Casas Ejidales usan el folio normal de PEO.** `PEO-{clave_regional}-{siglas_municipio}-{consecutivo 4 dígitos}-{año 2 dígitos}`, exactamente el algoritmo de §12.5, con el mismo contador `solicitud_folios` de PEO. **No existe el prefijo `CEJ` en ninguna parte del sistema** (ni en `proyectos.prefijo_folio`, ni en `solicitud_folios`, ni en el código). Un concepto de apoyo no interviene en el folio.
- **D48. No se restringe `tipo_persona` en el backend.** La documentación del PDF lista los requisitos solo para "Grupos de productores", pero la validación a nivel API no cambia (E42 sigue aceptando `fisica`, `moral`, `grupo`). El algoritmo de E41 hace efectiva la restricción de forma natural: las 8 reglas tienen `tipos_persona = '{grupo}'`, así que solo aparecen en el checklist cuando el tipo de persona es "Grupo de productores" **y** el concepto "Casas Ejidales" está seleccionado **y** el proyecto elegido es PEO.
- **D48-bis. Alineación de texto con las 8 reglas del anexo PEO (§12.7.2).** Las 8 reglas del anexo PEO sembradas en Build 6 provienen **del mismo PDF** y su texto quedó abreviado (p. ej. "CURP del representante"). Como ahora conviven con las 8 reglas del concepto (texto verbatim), la migración 014 **actualiza el `requisito` de esas 8 filas del anexo PEO al texto verbatim** para que la deduplicación por texto de E41 (§12.6.2) colapse cada par en un solo ítem y el capturista **nunca** vea el mismo documento dos veces con dos redacciones. Es un `UPDATE` acotado (`apoyo_id IS NULL AND proyecto_id = PEO` y coincidencia exacta del texto viejo), idempotente, que no cambia el número de filas ni ninguna regla de §12.7.1. El seed `005_ventanilla_catalogos.sql` se actualiza con esos mismos textos para que re-ejecutarlo no revierta el cambio (sigue sembrando **exactamente 42 filas**).
- **D49. Visor inline: tipo de archivo determinado por extensión del `archivo_nombre`.** La tabla `solicitud_documentos` no guarda `content-type`, pero sí `archivo_nombre`. Si termina en `.pdf` → `<iframe>`; si termina en `.jpg`, `.jpeg`, `.png` o `.webp` → `<img>`. Si la extensión es desconocida o nula, se muestra solo el `<a>` enlace sin viewer inline. El enlace `<a data-testid="enlace-archivo">` se mantiene en todos los casos como descarga de respaldo.
- **D50. Redirección post-guardado: timer cancelable.** El contador de 4 s inicia al montar el modal `modal-folio-generado`. Si el usuario pulsa "Ver solicitud" antes de los 4 s, la navegación es inmediata y el timer se cancela (`clearTimeout`). La URL destino incluye `?nuevo=1`. En `DetalleSolicitud.tsx`, `useSearchParams` detecta el param, muestra el banner, y reemplaza la URL con `navigate(location.pathname, {replace:true})` para que al recargar o al volver con "atrás" no aparezca de nuevo.
- **D51. Drag & drop: solo el primer archivo de la lista.** Si el usuario suelta varios archivos, se procesa `event.dataTransfer.files[0]` y se ignoran los demás. Sin validación de MIME en cliente antes de enviar (la validación ya existe en E46). La zona usa los eventos `dragover`, `dragleave`, `drop` del DOM nativo; sin librería.
- **D52. Carátula imprimible: `window.print()` en la misma pestaña.** No se abre ventana nueva. Se aplica `@media print` dentro del mismo archivo TSX: oculta todo el layout excepto `[data-testid="caratula-imprimible"]`. Las casillas de documentos se renderizan como `<input type="checkbox" disabled>` (no marcadas) para que el papel impreso muestre cuadros vacíos para check manual.

## 13.3 Modelo de datos — `db/migrations/014_casas_ejidales.sql`

Esta migración es **aditiva e idempotente**. No crea tablas, columnas ni índices; no toca ningún catálogo estructural (`programas`, `subprogramas`, `componentes`, `proyectos`, `ventanillas`). El único `UPDATE` sobre filas existentes es la alineación de texto de D48-bis, acotada a las 8 reglas del anexo PEO. El script `db/migrar.ts` ya existente la ejecuta sin modificación.

```sql
-- 1) Concepto de apoyo nuevo: Casas Ejidales (NO es un proyecto; es una fila de tipos_apoyo).
INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida, activo)
VALUES ('CASAS-EJIDALES', 'Casas Ejidales', 'infraestructura', 'obra', TRUE)
ON CONFLICT (clave) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      categoria = EXCLUDED.categoria,
      unidad_medida = EXCLUDED.unidad_medida,
      activo = TRUE;

-- 2) Alineación de texto (D48-bis): las 8 reglas del anexo PEO (§12.7.2) salen del mismo PDF;
--    se llevan al texto verbatim para que la deduplicación de E41 colapse los pares.
UPDATE documentos_requeridos dr
SET requisito = v.nuevo
FROM (VALUES
  ('Acta de integración del grupo de productores',
   'Acta integración del grupo de productores'),
  ('Identificación oficial vigente con fotografía del representante',
   'Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores'),
  ('CURP del representante',
   'CURP del representante del grupo de productores'),
  ('Constancia de Situación Fiscal del representante',
   'Constancia de Situación Fiscal del representante del grupo de productores'),
  ('Comprobante de domicilio del representante',
   'Comprobante de domicilio del representante de grupo de productores'),
  ('Relación de beneficiarios directos',
   'Relación de beneficiarios directos del grupo de productores')
) AS v(viejo, nuevo)
WHERE dr.requisito = v.viejo
  AND dr.apoyo_id IS NULL
  AND dr.proyecto_id = (SELECT id FROM proyectos WHERE clave = 'PEO');

-- 3) 8 documentos requeridos del concepto Casas Ejidales.
--    apoyo_id = concepto 'CASAS-EJIDALES'; proyecto_id = proyecto PEO ya existente.
--    componentes = NULL => aplica con cualquier componente. tipos_persona = '{grupo}'.
--    Idempotencia por WHERE NOT EXISTS sobre (requisito, apoyo_id).
INSERT INTO documentos_requeridos (requisito, componentes, tipos_persona, proyecto_id, apoyo_id, orden, activo)
SELECT docs.req, NULL, '{grupo}', proy.id, ap.id, docs.ord, TRUE
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
CROSS JOIN (SELECT id FROM proyectos   WHERE clave = 'PEO')            AS proy
CROSS JOIN (SELECT id FROM tipos_apoyo WHERE clave = 'CASAS-EJIDALES') AS ap
WHERE NOT EXISTS (
  SELECT 1 FROM documentos_requeridos dr
  WHERE dr.requisito = docs.req
    AND dr.apoyo_id = ap.id
);
```

> **Nota de implementación:** si el Generator prefiere un índice único parcial `CREATE UNIQUE INDEX IF NOT EXISTS idx_docsreq_req_apoyo ON documentos_requeridos (requisito, apoyo_id) WHERE apoyo_id IS NOT NULL;` como parte de la misma migración y sustituir el `WHERE NOT EXISTS` por `ON CONFLICT … DO NOTHING`, puede hacerlo. Cualquiera de las dos estrategias es válida; lo que no se permite es que la migración ejecutada dos veces duplique filas ni que cree el proyecto `CEJ`.

**Prohibiciones explícitas de esta migración (consecuencia de la corrección):** no debe contener la cadena `CEJ` en ninguna forma; no debe insertar en `proyectos`; no debe insertar en `solicitud_folios`; no debe crear ningún prefijo de folio nuevo.

### 13.3.1 Ajuste al seed `db/seeds/005_ventanilla_catalogos.sql`

Dos cambios mínimos (es el único seed existente que se toca):

1. **Textos verbatim del anexo PEO (D48-bis):** las 8 reglas de §12.7.2 se siembran ya con el texto verbatim (los mismos 8 textos del bloque 3 de la migración 014), de modo que re-ejecutar el seed no revierta el `UPDATE`. **Sigue sembrando exactamente 42 filas** (34 de §12.7.1 + 8 del anexo PEO) y ninguna otra regla cambia.
2. **El seed no desactiva reglas específicas de concepto (fix ya aplicado en Build 7, se conserva con el nuevo criterio):** la cláusula del seed que desactiva reglas que no forman parte de su lista (`UPDATE documentos_requeridos SET activo = FALSE WHERE …`) debe **excluir** toda fila con `apoyo_id IS NOT NULL`. Así, re-ejecutar el seed 005 después de la migración 014 deja las 8 reglas de Casas Ejidales con `activo = TRUE`. (En la versión anterior de esta sección la exclusión se expresaba por `proyecto_id` del proyecto CEJ; ahora la regla específica se identifica por `apoyo_id`.)

**Fallback de `siglas_folio`:** la migración 014 no toca `municipios.siglas_folio`; el seed 005 ya las llenó en Build 6 (criterio 252). Si hay municipios nuevos sin siglas, el fallback determinista de §12.5 los cubre.

## 13.4 Pantallas afectadas (delta sobre §12.8)

**Casas Ejidales no requiere ningún cambio de PWA ni de backend.** El concepto aparece automáticamente en `select-concepto` (paso 5 de `NuevaSolicitud.tsx`) porque E40 ya devuelve todos los `tipos_apoyo` activos, y el checklist del paso 6 ya recalcula E41 cada vez que cambian Componente, Tipo de persona, Proyecto **o los conceptos seleccionados** (§12.8.2), enviando `tipos_apoyo_ids`. Al elegir "Casas Ejidales" con proyecto PEO y tipo de persona "Grupo de productores", los 8 documentos entran solos en `lista-documentos`, además de las reglas generales que apliquen por componente y tipo de persona (§12.7.1). Los cambios de esta subsección son **solo** las mejoras de UX.

### 13.4.1 `pwa/src/pantallas/DetalleSolicitud.tsx`

Cuatro cambios independientes en el mismo archivo, sin romper ningún `data-testid` existente:

**1. Visor inline (B7-A):** en el bloque de cada documento, donde hoy existe solo `<a data-testid="enlace-archivo">`, agregar encima un viewer condicional basado en la extensión de `archivo_nombre`: si termina en `.pdf` → `<iframe data-testid="visor-pdf-documento" src={url} width="100%" height="400px" title="Documento adjunto" />`; si termina en `.jpg`, `.jpeg`, `.png` o `.webp` → `<img data-testid="visor-imagen-documento" src={url} alt="Documento adjunto" style={{maxWidth:'100%'}} />`. El `<a>` sigue presente en ambos casos.

**2. Banner post-guardado (B7-C):** al montar, leer `useSearchParams()`. Si existe `nuevo=1`, mostrar `<div data-testid="banner-nuevo" role="status">Solicitud {folio} registrada. Adjunta los documentos requeridos.</div>` y llamar `navigate(location.pathname, {replace:true})` para quitar el param del historial. El banner se desmonta al hacer clic (`onClick`) o tras `setTimeout(10000)`.

**3. Drag & drop (B7-D):** encima de cada `<input type="file" data-testid="input-archivo-documento">`, agregar `<div data-testid="zona-drop-documento" className="zona-drop" onDragOver={e => {e.preventDefault(); e.currentTarget.classList.add('zona-drop--activa');}} onDragLeave={e => e.currentTarget.classList.remove('zona-drop--activa')} onDrop={e => {e.preventDefault(); e.currentTarget.classList.remove('zona-drop--activa'); void adjuntar(docId, e.dataTransfer.files[0] ?? null);}}>Arrastra aquí el archivo</div>`.

**4. Carátula imprimible (B7-E):** botón `<button data-testid="btn-imprimir-caratula" onClick={() => window.print()}>Imprimir carátula</button>` en la tarjeta superior. Sección `<div data-testid="caratula-imprimible" className="caratula">` siempre presente en el DOM, oculta en pantalla normal (`display:none` en CSS), visible solo en `@media print`. Contiene: `[data-testid="caratula-folio"]`, `[data-testid="caratula-solicitante"]` (nombre o razón social según tipo_persona), `[data-testid="caratula-municipio"]`, `[data-testid="caratula-programa"]`, `[data-testid="caratula-fecha"]` (fecha en formato `toLocaleDateString('es-MX')`), `[data-testid="caratula-conceptos"]` (tabla con filas `caratula-fila-concepto`), `[data-testid="caratula-lista-documentos"]` (lista de ítems `caratula-item-documento` cada uno con `<input type="checkbox" disabled />`). CSS `@media print` oculta `.tarjeta` y `.modal-fondo` para que solo la carátula se imprima.

### 13.4.2 `pwa/src/pantallas/NuevaSolicitud.tsx`

**Redirección automática (B7-C):** en el bloque del modal `modal-folio-generado`, al montar (cuando `resultado !== null`), iniciar `const timer = setTimeout(() => navegar(`/solicitudes/${resultado.solicitud.id}?nuevo=1`), 4000)` guardado en una `ref`. El botón `btn-ver-solicitud` cancela el timer y navega inmediatamente a `/solicitudes/${resultado.solicitud.id}?nuevo=1`. El modal desaparece en ambos casos al navegar.

## 13.5 Assumptions nuevas (continúa la numeración de §12.11)

55. **Los PDFs `CamScanner 17-08-2026 10.27.pdf` y `10.28.pdf` son del proyecto PEO** (llevan sus cabeceras y el folio de ejemplo `PEO-SJR-AME-0001-26`, el mismo transcrito en §12). La primera lectura del Build 7 asumió que describían un programa/proyecto independiente "Casas Ejidales"; el usuario revisó los documentos y confirmó que **no**: Casas Ejidales es un **concepto de apoyo** que se solicita dentro de PEO. Se resuelve dando de alta el concepto en `tipos_apoyo` y ligando los 8 documentos por `apoyo_id`. **No se crea programa, subprograma, componente ni proyecto.**
56. **Clave y atributos del concepto nuevo.** El PDF no da clave de catálogo. Se decide `clave = 'CASAS-EJIDALES'` (legible y estable; no se usa la serie `AP-###` porque esa serie está reservada a los 152 conceptos extraídos de la hoja `APOYO`, §8.7, y renumerarla rompería el seed 004), `categoria = 'infraestructura'` (una casa ejidal es obra civil) y `unidad_medida = 'obra'`. Ambos campos son libres en el esquema (§4.4) y editables después desde catálogos.
57. **No existe el prefijo de folio `CEJ`.** Las solicitudes de Casas Ejidales se folian como cualquier otra solicitud de PEO (`PEO-…`, §12.5) y comparten el mismo contador en `solicitud_folios`. El concepto de apoyo no participa en el folio. Cualquier aparición de `CEJ` en código, migraciones, seeds o README es un defecto de la primera redacción de Build 7 y debe eliminarse.
57-bis. **Coexistencia con el anexo PEO.** Las 8 reglas del anexo PEO (§12.7.2) siguen aplicando a **toda** solicitud PEO de tipo grupo, con o sin el concepto Casas Ejidales; las 8 reglas nuevas aplican **además** cuando el concepto está seleccionado. Como ambos juegos salen del mismo PDF, se alinean sus textos (D48-bis) y la deduplicación por `requisito` de E41 hace que el capturista vea **8 ítems, no 16**. Se prefirió alinear textos a borrar el anexo PEO: borrarlo dejaría sin documentación a las solicitudes PEO de grupo que no sean de casas ejidales.
58. **El visor inline determina el tipo de archivo por extensión de `archivo_nombre`** (ya almacenado en `solicitud_documentos`). Si la extensión es nula o desconocida, solo se muestra el `<a>`. No se añade columna `content_type` (evita migración extra).
59. **La URL con `?nuevo=1` produce el banner una sola vez.** `DetalleSolicitud.tsx` llama a `navigate(location.pathname, {replace:true})` en el primer render con el param presente, eliminándolo del historial. Recargar la página, botón "atrás" o enlace directo sin el param no muestran el banner.
60. **Idempotencia de la migración 014 con `WHERE NOT EXISTS`.** Si en el futuro el Generator prefiere un índice único parcial sobre `(requisito, apoyo_id)`, puede añadirlo en la misma migración 014 sin romper nada: ese índice no existía antes, es aditivo.

## 13.6 Dependencias y archivos

**Sin dependencias npm nuevas.** Los cuatro cambios de UX usan únicamente React, DOM nativo y CSS.

**Archivos nuevos:**

```
db/migrations/014_casas_ejidales.sql
```

**Archivos modificados:**

```
db/seeds/005_ventanilla_catalogos.sql     (textos verbatim del anexo PEO + no desactivar reglas con apoyo_id)
pwa/src/pantallas/DetalleSolicitud.tsx    (visor inline, banner, drag & drop, carátula)
pwa/src/pantallas/NuevaSolicitud.tsx      (timer de redirección en modal)
README.md                                 (documentar el concepto Casas Ejidales y las mejoras de UX)
```

**No se modifica:** ningún archivo de backend, ningún otro seed, `docker-compose.yml`, `packages/shared/src/*`, `pwa/src/sync/*`, `pwa/src/db/indexeddb.ts`, ni ninguna ruta API. **No se crea** ninguna tabla ni columna.

---

## 13.7 Rubric extendido (criterios 307–343)

Continúa la numeración de §7, §8.11, §9.9, §10.11, §11.9 y §12.13. Base: `API=http://localhost:3000`, `APP=http://localhost:8080`. Tokens: `T_ADMIN`, `T_VEN2` (`ventanilla2`, alcance "todos"). **Nota de actualización:** el criterio 250 documentó el estado de Build 6 con 42 documentos activos; tras Build 7 el valor correcto es 50 (se verifica en criterio 342).

### Base de datos — migración 014 (307–312)

La migración 014 no crea tablas, columnas ni índices, ni catálogos estructurales. Los criterios de BD de §12.13 (241–250) deben seguir pasando íntegramente.

307. Existe `db/migrations/014_casas_ejidales.sql` y sigue **sin existir** `db/migrations/011_*.sql` (criterio 231 intacto); ejecutar el script `db/migrar.ts` sobre una BD de Build 6 ya poblada sale con código 0 y sin error.
308. `SELECT clave, nombre, categoria, activo FROM tipos_apoyo WHERE clave = 'CASAS-EJIDALES'` devuelve exactamente **1 fila** con `nombre = 'Casas Ejidales'` y `activo = TRUE`; y `SELECT count(*) FROM tipos_apoyo WHERE clave LIKE 'AP-%'` sigue devolviendo **152** (criterio 66 intacto).
309. **No existe el proyecto ni el prefijo `CEJ`:** `SELECT count(*) FROM proyectos` devuelve **1** (solo `PEO`); `SELECT count(*) FROM proyectos WHERE clave = 'CEJ' OR prefijo_folio = 'CEJ'` devuelve **0**; `SELECT count(*) FROM solicitud_folios WHERE prefijo <> 'PEO'` devuelve **0**; `SELECT count(*) FROM solicitudes WHERE folio LIKE 'CEJ-%'` devuelve **0**; y `grep -rn "CEJ" backend/src db/migrations db/seeds pwa/src` **no** encuentra ninguna coincidencia.
310. `SELECT count(*) FROM documentos_requeridos WHERE activo = TRUE AND apoyo_id = (SELECT id FROM tipos_apoyo WHERE clave = 'CASAS-EJIDALES')` devuelve exactamente **8**, y **todas** esas 8 filas tienen `proyecto_id = (SELECT id FROM proyectos WHERE clave = 'PEO')`, `tipos_persona = '{grupo}'` y `componentes IS NULL`.
311. Los `requisito` de esas 8 filas son exactamente: `Solicitud mediante escrito libre dirigida al Titular de la Secretaría`, `Ficha técnica`, `Acta integración del grupo de productores`, `Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores`, `CURP del representante del grupo de productores`, `Constancia de Situación Fiscal del representante del grupo de productores`, `Comprobante de domicilio del representante de grupo de productores`, `Relación de beneficiarios directos del grupo de productores`. Además (D48-bis) `SELECT count(DISTINCT requisito) FROM documentos_requeridos WHERE activo AND proyecto_id = (SELECT id FROM proyectos WHERE clave='PEO')` devuelve **8** aunque `SELECT count(*)` sobre el mismo filtro devuelve **16** (las 8 del anexo PEO alineadas al mismo texto + las 8 del concepto).
312. **Idempotencia y no-regresión de catálogos:** ejecutar la migración 014 una segunda vez y después re-ejecutar `db/seeds/005_ventanilla_catalogos.sql` no produce error, y tras ambas: `SELECT count(*) FROM documentos_requeridos WHERE activo AND apoyo_id = (SELECT id FROM tipos_apoyo WHERE clave='CASAS-EJIDALES')` sigue siendo **8** (el seed 005 no las desactiva), `SELECT count(*) FROM tipos_apoyo WHERE clave='CASAS-EJIDALES'` sigue siendo **1**, `SELECT count(*) FROM componentes` devuelve **3**, `ventanillas` **5**, `programas` **1**, `subprogramas` **1** y `proyectos` **1** (ningún catálogo estructural cambió).

### API — Casas Ejidales en el módulo de ventanilla (313–319)

El concepto se integra de forma transparente en los endpoints existentes (E40, E41, E42). No hay endpoints nuevos, ni cambios de RBAC, ni de esquema de validación, ni de código de backend.

313. `GET $API/api/solicitudes/catalogos` con `T_VEN2` devuelve **200** y en `tipos_apoyo` existe un elemento con `clave:'CASAS-EJIDALES'` y `nombre:'Casas Ejidales'`; en `proyectos` hay exactamente **1** elemento, con `clave:'PEO'` y `prefijo_folio:'PEO'`, y **ninguno** con clave o prefijo `CEJ`.
314. `POST $API/api/solicitudes/documentos-requeridos` con `T_VEN2` y `{"componente_id":<id de TR>,"tipo_persona":"grupo","proyecto_id":<id de PEO>,"tipos_apoyo_ids":[<id de CASAS-EJIDALES>]}` devuelve **200** y `documentos` incluye los **8** textos exactos del criterio 311.
315. En la respuesta del criterio 314 **no hay duplicados**: el número de valores distintos de `requisito` es igual a la longitud del array `documentos` y a `total`; en particular `Ficha técnica` aparece **una sola vez** (la deduplicación colapsa el par anexo PEO / concepto).
316. `POST $API/api/solicitudes/documentos-requeridos` con `T_VEN2` y `{"componente_id":<id de TR>,"tipo_persona":"fisica","proyecto_id":<id de PEO>,"tipos_apoyo_ids":[<id de CASAS-EJIDALES>]}` devuelve **200** y **no** incluye `Ficha técnica` ni `Relación de beneficiarios directos del grupo de productores` (las 8 reglas son `{grupo}`); y el mismo cuerpo con `tipo_persona:"grupo"` pero **sin** `proyecto_id` tampoco los incluye (siguen ligadas a PEO).
317. `POST $API/api/solicitudes` con `T_VEN2` y payload válido (`tipo_persona:'grupo'`, `proyecto_id:<id de PEO>`, 1 concepto con `tipo_apoyo_id` = id de `CASAS-EJIDALES`, `declaracion_aceptada:true`, municipio, componente y ventanilla dentro del alcance de `ventanilla2`) devuelve **201** con `solicitud.folio` que cumple `^PEO-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$` y **no** empieza con `CEJ`; `SELECT origen FROM solicitudes WHERE id=<id>` devuelve `solicitud_ventanilla`.
318. Tras el criterio 317: el consecutivo de `solicitud_folios` para `(prefijo='PEO', clave_regional, siglas_municipio, anio)` de esa solicitud aumentó exactamente en **1** respecto al valor previo al alta, `SELECT count(*) FROM solicitud_folios WHERE prefijo <> 'PEO'` sigue siendo **0**, y `SELECT count(*) FROM solicitud_conceptos WHERE solicitud_id=<id> AND tipo_apoyo_id=(SELECT id FROM tipos_apoyo WHERE clave='CASAS-EJIDALES')` devuelve **1** con `beneficiario_id` no nulo, cuyo `beneficiarios.folio` empieza con `PEO`.
319. Regresión de §12.13: el criterio 286 sigue pasando (E41 con `{"componente_id":<DIN>,"tipo_persona":"grupo","proyecto_id":<PEO>}` incluye `Ficha técnica` y `Solicitud mediante escrito libre dirigida al Titular de la Secretaría`, y sin `proyecto_id` no los incluye) y los criterios 261, 282 y 285 siguen pasando sin cambios.

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
342. `SELECT count(*) FROM documentos_requeridos WHERE activo` devuelve **50** (42 de Build 6 + 8 del concepto Casas Ejidales); `SELECT count(*) FROM documentos_requeridos WHERE activo AND proyecto_id IS NULL AND apoyo_id IS NULL` devuelve **34** (las reglas generales de §12.7.1, intactas en número); `SELECT count(*) FROM proyectos` devuelve **1**; y `SELECT count(*) FROM tipos_apoyo WHERE activo` devuelve **153** (152 de la hoja `APOYO` + Casas Ejidales).
343. `README.md` documenta Casas Ejidales **como concepto de apoyo, no como proyecto**: (a) que es una fila de `tipos_apoyo` (`CASAS-EJIDALES`) solicitada dentro del proyecto **PEO** ya existente, bajo el programa "Apoyo al Campo Queretano 2026" y el subprograma "Impulso a la Productividad"; (b) que el folio de esas solicitudes es el normal de PEO (`PEO-{regional}-{municipio}-{consecutivo}-{año}`) y que **no existe** ningún prefijo `CEJ` — incluyendo una nota de que la primera versión de Build 7 lo modeló mal como proyecto y que se corrigió antes de desplegar; (c) los 8 documentos requeridos listados explícitamente, que aplican a **grupos de productores** cuando se selecciona el concepto; (d) cómo aplicar la migración 014 y re-ejecutar el seed 005 sobre una BD de Build 6 existente sin downtime; y (e) que las mejoras de UX (visor PDF, banner post-guardado, drag & drop, carátula imprimible) no requieren variable de entorno nueva ni migración adicional. El README **no** contiene la cadena `CEJ`.

**Definición de terminado (build 7):** los **343** criterios pasan (306 acumulados de los builds 1–6 + **37** de esta extensión).

---

## 14. Extensión Build 8 — Jerarquía completa: componente PET y nivel Modalidad

> Esta sección **extiende** el SPEC. No sustituye ni reinterpreta nada de las secciones 1-13.
> Todo lo definido antes sigue vigente tal cual. Los criterios 1-343 siguen siendo obligatorios.

### 14.1 Objetivo

Cerrar el hueco de catálogo detectado en producción: dar de alta el 4º componente **Proyectos Estratégicos Territoriales (PET)** y modelar el nivel intermedio **Modalidad** entre Componente y Proyecto, de forma que una solicitud del proyecto **PEO** (incluidos los expedientes de Casas Ejidales) se capture con su jerarquía real y no forzada a TR/CAA/DIN.

Jerarquía oficial declarada en `CamScanner 17-08-2026 10.27.pdf`:

```
Programa:     Apoyo al Campo Queretano, Ejercicio 2026        -> programas.PRG-2026        (existe)
Subprograma:  Impulso a la Productividad                      -> subprogramas.SUB-IP       (existe)
Componente:   Proyectos Estratégicos Territoriales            -> componentes.PET           (NUEVO)
Modalidad:    Proyectos Estratégicos Productivos y para el
              Fortalecimiento Organizativo                    -> modalidades.MOD-PEPFO     (NUEVO)
Proyecto:     Proyectos Estratégicos para el Fortalecimiento
              Organizativo (PEO)                              -> proyectos.PEO             (existe, se re-liga)
```

### 14.2 Scope

**SÍ incluye:**
1. Migración **015** aditiva e idempotente: tabla `modalidades`, columna `proyectos.modalidad_id`, columna `solicitudes.modalidad_id`, alta del componente `PET`, alta de la modalidad `MOD-PEPFO`, re-ligado de `PEO` a `PET` + `MOD-PEPFO`.
2. Ajustes al **seed 005** para que siga siendo idempotente y coherente.
3. Contrato del endpoint de catálogos de ventanilla (**E40**): devuelve `modalidades[]` y `proyectos[].modalidad_id`.
4. Contrato del alta (**E42**): acepta `modalidad_id` opcional, lo valida/deriva y lo persiste.
5. Contrato del detalle (**E44**): devuelve `modalidad` y `modalidad_nombre`.
6. Selector **Modalidad** encadenado en el formulario de ventanilla (`NuevaSolicitud.tsx`).
7. Funciones puras de encadenamiento en `@sedea/shared` (`modalidadesDeComponente`, `proyectosAplicables`).
8. Rubric extendido (criterios 344-386).

**NO incluye:**
- Modificación a migraciones **012, 013 ó 014** (ya aplicadas en producción).
- Cambio al **folio**: sigue siendo `PEO-{regional}-{municipio}-{consecutivo}-{año}`.
- Proyecto nuevo ni prefijo `CEJ`. Casas Ejidales sigue siendo **concepto de apoyo** dentro de PEO.
- Cambio a reglas de `documentos_requeridos` (el checklist no se indexa por modalidad en este build).
- Cambio al flujo offline de campo.
- Dependencias npm nuevas, cambios a `docker-compose.yml` ni a `pwa/nginx.conf.template`.
- Cambio al listado E43 (`GET /api/solicitudes`).
- Backfill de `solicitudes.modalidad_id` en filas históricas.

### 14.3 Modelo de datos

**Tabla nueva `modalidades`:**
| Columna | Tipo | Reglas |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | |
| `clave` | `TEXT UNIQUE NOT NULL` | patrón corto (`MOD-PEPFO`) |
| `nombre` | `TEXT NOT NULL` | nombre largo oficial |
| `componente_id` | `BIGINT NOT NULL REFERENCES componentes(id)` | una modalidad por componente |
| `activo` | `BOOLEAN NOT NULL DEFAULT TRUE` | nunca se borra, se desactiva |

Índice: `idx_modalidades_componente ON modalidades (componente_id)`.

**Componente nuevo:** `clave='PET'`, `nombre='Proyectos Estratégicos Territoriales'`, `activo=TRUE`.

**Columnas nuevas:**
- `proyectos.modalidad_id BIGINT NULL REFERENCES modalidades(id)` — nullable a propósito.
- `solicitudes.modalidad_id BIGINT NULL REFERENCES modalidades(id)` — nullable, índice `idx_sol_modalidad`.

**Re-ligado de PEO:**
```
proyectos.PEO.componente_id = componentes.PET.id      (antes NULL)
proyectos.PEO.modalidad_id  = modalidades.MOD-PEPFO.id
proyectos.PEO.prefijo_folio = 'PEO'                   (SIN CAMBIO)
```

### 14.4 Migración 015

Archivo: `db/migrations/015_modalidades.sql`. Aditiva, idempotente, ejecutable N veces.

```sql
-- 015_modalidades.sql
-- Build 8: nivel "Modalidad" entre Componente y Proyecto + componente PET.

-- 1. Catálogo nuevo de modalidades.
CREATE TABLE IF NOT EXISTS modalidades (
  id            BIGSERIAL PRIMARY KEY,
  clave         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  componente_id BIGINT NOT NULL REFERENCES componentes(id),
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_modalidades_componente ON modalidades (componente_id);

-- 2. Columnas nuevas, ambas NULLABLE a propósito.
ALTER TABLE proyectos   ADD COLUMN IF NOT EXISTS modalidad_id BIGINT REFERENCES modalidades(id);
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS modalidad_id BIGINT REFERENCES modalidades(id);
CREATE INDEX IF NOT EXISTS idx_sol_modalidad ON solicitudes (modalidad_id);

-- 3. Cuarto componente. Los 3 existentes (TR/CAA/DIN) no se tocan.
INSERT INTO componentes (clave, nombre) VALUES
  ('PET', 'Proyectos Estratégicos Territoriales')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- 4. Modalidad del PDF oficial, ligada a PET.
INSERT INTO modalidades (clave, nombre, componente_id)
SELECT 'MOD-PEPFO', 'Proyectos Estratégicos Productivos y para el Fortalecimiento Organizativo', c.id
  FROM componentes c WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, componente_id = EXCLUDED.componente_id, activo = TRUE;

-- 5. Re-ligado de PEO.
UPDATE proyectos p
   SET componente_id = c.id,
       modalidad_id  = m.id
  FROM componentes c, modalidades m
 WHERE p.clave = 'PEO'
   AND c.clave = 'PET'
   AND m.clave = 'MOD-PEPFO';
```

### 14.5 Ajustes al seed 005

1. **Componentes** — agrega `PET`:
```sql
INSERT INTO componentes (clave, nombre) VALUES
  ('TR',  'Tecnificación del Riego'),
  ('CAA', 'Captación y Almacenamiento de Agua'),
  ('DIN', 'Dinamismo Agroalimentario'),
  ('PET', 'Proyectos Estratégicos Territoriales')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;
```

2. **Modalidades** — bloque nuevo:
```sql
INSERT INTO modalidades (clave, nombre, componente_id)
SELECT 'MOD-PEPFO', 'Proyectos Estratégicos Productivos y para el Fortalecimiento Organizativo', c.id
  FROM componentes c WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, componente_id = EXCLUDED.componente_id, activo = TRUE;
```

3. **Upsert de PEO** — cambia `componente_id = NULL` por ligado real:
```sql
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, modalidad_id)
SELECT 'PEO', 'Proyectos Estratégicos para el Fortalecimiento Organizativo', 'PEO', c.id, m.id
  FROM componentes c
  JOIN modalidades m ON m.clave = 'MOD-PEPFO'
 WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET
  nombre        = EXCLUDED.nombre,
  prefijo_folio = EXCLUDED.prefijo_folio,
  componente_id = EXCLUDED.componente_id,
  modalidad_id  = EXCLUDED.modalidad_id,
  activo        = TRUE;
```

### 14.6 Contrato de API

**E40 — `GET /api/solicitudes/catalogos`:**
- Agrega clave `modalidades`: array con `id`, `clave`, `nombre`, `componente_id`.
- `proyectos[].modalidad_id` (nullable).
- Mismo filtro de alcance que `componentes`.

**E42 — `POST /api/solicitudes`:**
- Body opcional: `modalidad_id: z.number().int().positive().nullable().optional()`.
- Validación: si existe, debe ser activa y del mismo componente; si el proyecto tiene `modalidad_id` y difiere → `422 modalidad_no_corresponde_proyecto`.
- Si componente tiene modalidades y `modalidad_id` es null → `422 modalidad_requerida`.
- Persistencia: `INSERT INTO solicitudes (... , modalidad_id)`.
- Respuesta: `solicitud.modalidad = <clave|null>`.

**E41 — `POST /api/solicitudes/documentos-requeridos`:**
- Tolera `modalidad_id` en el body (no lo usa).

**E44 — `GET /api/solicitudes/:id`:**
- Agrega `modalidad` y `modalidad_nombre` (null en históricas).

**E43 — `GET /api/solicitudes` (listado):**
- Sin cambios.

### 14.7 Encadenamiento (@sedea/shared)

```ts
export interface ModalidadVentanilla extends OpcionCatalogoVentanilla {
  componente_id: number;
}

export function modalidadesDeComponente(
  modalidades: ModalidadVentanilla[],
  componenteId: number | null
): ModalidadVentanilla[];

export function proyectosAplicables(
  proyectos: ProyectoVentanilla[],
  modalidades: ModalidadVentanilla[],
  componenteId: number | null,
  modalidadId: number | null
): ProyectoVentanilla[];
```

**Regla R14-1:** si `mods.length > 0` y `modalidadId` es null → devuelve `[]`; si `base` queda vacía tras filtrar por componente → devuelve **todos** los proyectos (garantiza no regresión para TR/CAA/DIN con PEO).

### 14.8 UI — selector de Modalidad

**Estado nuevo:** `const [modalidadId, setModalidadId] = useState('')`.

**Si componente tiene ≥1 modalidad activa (PET):**
```tsx
<select id="select-modalidad" data-testid="select-modalidad"
        value={modalidadId} onChange={(e) => setModalidadId(e.target.value)}>
  <option value="">Selecciona una modalidad</option>
  {modsDelComponente.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
</select>
```

**Si componente no tiene modalidades (TR/CAA/DIN):**
```tsx
<p className="dato" data-testid="modalidad-no-aplica">No aplica</p>
```

**Comportamiento:**
1. Al cambiar Componente → `setModalidadId('')`; si hay 1 modalidad → preseleccionada.
2. Si `proyectoId` ya no está en `proyectosAplicables` → se limpia.
3. Body a E42: `modalidad_id: modalidadId ? Number(modalidadId) : null`.

**DetalleSolicitud.tsx:** agrega `· Modalidad {s.modalidad_nombre}` si no es null (`[data-testid="dato-modalidad"]`).

### 14.9 Alcance y administración

- `PET` aparece en administración de alcance (`Usuarios.tsx`).
- Usuarios con alcance vacío ("todos") ven PET sin acción.
- Seed 006 no cambia: `ventanilla1` sigue con alcance solo `TR`.

### 14.10 Stack, comandos y archivos

- Sin cambios de stack, versiones ni dependencias.
- Despliegue: `npm run migrar` (aplica 015) → `npm run sembrar` (re-ejecuta seeds).

**Archivos:**
| Archivo | Acción |
|---|---|
| `db/migrations/015_modalidades.sql` | nuevo |
| `db/seeds/005_ventanilla_catalogos.sql` | modificado |
| `packages/shared/src/solicitudes.ts` | tipos + 2 funciones |
| `backend/src/db/queries/solicitudes.ts` | consultas de modalidades |
| `backend/src/rutas/solicitudes.ts` | validación de modalidad_id |
| `pwa/src/pantallas/NuevaSolicitud.tsx` | selector encadenado |
| `pwa/src/pantallas/DetalleSolicitud.tsx` | muestra Modalidad |

### 14.11 Assumptions del Build 8

- **A14-1:** Clave componente: `PET` (2-3 letras mayúsculas).
- **A14-2:** Clave modalidad: `MOD-PEPFO`.
- **A14-3:** Campo "No aplica" visible cuando no hay modalidades.
- **A14-4:** Preselección si hay 1 modalidad.
- **A14-5:** Regla R14-1 (fallback a todos los proyectos).
- **A14-6:** Backend no valida coherencia componente↔proyecto.
- **A14-7:** `solicitudes.modalidad_id` persiste, históricas en `NULL`.
- **A14-8:** Checklist no se indexa por modalidad.
- **A14-9:** Listado E43 no expone modalidad.
- **A14-10:** Sin modalidades para TR/CAA/DIN.

### 14.12 Rubric de evaluación (344-386)

#### Esquema y migración (344-353)

| # | Descripción | Cómo verificar |
|---|---|---|
| 344 | Existe `db/migrations/015_modalidades.sql` y `git diff` sobre `012_*.sql`, `013_*.sql`, `014_*.sql` está vacío. | `ls db/migrations/015*` + `git diff HEAD -- db/migrations/01{2,3,4}_*.sql` sin output. |
| 345 | `\\d modalidades` en psql muestra columnas `id`, `clave`, `nombre`, `componente_id`, `activo` y FK a `componentes(id)`. | `psql -c "\\d modalidades"` |
| 346 | `SELECT clave, nombre, activo FROM componentes WHERE clave='PET'` devuelve 1 fila con `activo=true`. | `psql -c "SELECT clave, nombre, activo FROM componentes WHERE clave='PET'"` |
| 347 | `SELECT count(*) FROM componentes WHERE activo` devuelve `4`; TR/CAA/DIN conservan nombres originales. | `psql -c "SELECT clave, nombre FROM componentes WHERE activo"` |
| 348 | `SELECT m.clave, m.nombre, c.clave FROM modalidades m JOIN componentes c ON c.id=m.componente_id` devuelve 1 fila: `MOD-PEPFO`, `PET`. | `psql` |
| 349 | `proyectos` tiene columna `modalidad_id` con `is_nullable='YES'`. | `information_schema.columns` query |
| 350 | PEO tiene `componente_id=PET.id`, `modalidad_id IS NOT NULL`, `prefijo_folio='PEO'`, `activo=true`. | `psql` |
| 351 | `SELECT count(*) FROM proyectos WHERE clave='CEJ' OR prefijo_folio='CEJ'` devuelve `0`; `tipos_apoyo` con `clave='CASAS-EJIDALES'` tiene `activo=true`. | `psql` |
| 352 | `solicitudes` tiene `modalidad_id` nullable; solicitudes históricas conservan `componente_id` y `proyecto_id` con `modalidad_id IS NULL`. | `psql` |
| 353 | Re-ejecutar migraciones (`npm run migrar`) termina en 0, reporta `015_modalidades.sql (ya aplicada)`, no duplica filas. | Log del migrador. |

#### Idempotencia del seed 005 (354-357)

| # | Descripción | Cómo verificar |
|---|---|---|
| 354 | Ejecutar seeder dos veces termina ambas en 0 sin errores. | `npm run sembrar && npm run sembrar` |
| 355 | Tras re-seed, `SELECT activo FROM componentes WHERE clave='PET'` sigue `true`. | `psql` |
| 356 | Tras re-seed, `SELECT count(*) FROM modalidades` sigue `1`; PEO conserva `componente_id=PET`, `modalidad_id=MOD-PEPFO`. | `psql` |
| 357 | Tras re-seed, `SELECT count(*) FROM documentos_requeridos d JOIN tipos_apoyo t ON t.id=d.apoyo_id WHERE t.clave='CASAS-EJIDALES' AND d.activo` sigue `8`. | `psql` |

#### API (358-370)

| # | Descripción | Cómo verificar |
|---|---|---|
| 358 | `GET /api/solicitudes/catalogos` con alcance total incluye `modalidades[]` con `id`, `clave`, `nombre`, `componente_id`. | `curl -s ... | jq '.modalidades'` |
| 359 | `proyectos[].modalidad_id` existe y PEO lo trae `!= null`. | `curl -s ... | jq '.proyectos[] \| select(.clave=="PEO") \| .modalidad_id'` |
| 360 | `componentes` incluye `PET`. | `curl -s ... | jq '.componentes[] \| select(.clave=="PET")'` |
| 361 | `GET /api/solicitudes/catalogos` con `ventanilla1` (alcance=TR): `componentes` no tiene `PET`, `modalidades=[]`. | `curl` con token ventanilla1 |
| 362 | `POST /api/solicitudes` con `componente_id=PET`, `proyecto_id=PEO`, `modalidad_id=MOD-PEPFO` → `201`, folio `^PEO-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$`. | `curl -X POST ...` |
| 363 | Respuesta 362 incluye `solicitud.modalidad="MOD-PEPFO"` y conserva claves previas. | `jq '.solicitud'` |
| 364 | `GET /api/solicitudes/{id}` de esa solicitud → `200` con `modalidad="MOD-PEPFO"`, `modalidad_nombre="Proyectos..."`. | `curl` |
| 365 | `POST /api/solicitudes` con `modalidad_id=999999` → `422`, `codigo="modalidad_invalida"`. | `curl | jq '.error.codigo'` |
| 366 | `POST /api/solicitudes` con PET+PEO sin `modalidad_id` → `201`, detalle trae `modalidad="MOD-PEPFO"`. | `curl` |
| 367 | No regresión: TR+PEO sin `modalidad_id` → `201`, folio `PEO-`, `modalidad=null`. | `curl` |
| 368 | TR + `modalidad_id=MOD-PEPFO` → `422`, `codigo="modalidad_invalida"`. | `curl` |
| 369 | `POST /api/solicitudes/documentos-requeridos` con/sin `modalidad_id` → mismo `total`, sin `campo_no_editable`. | `curl` |
| 370 | `GET /api/solicitudes` → cada fila conserva campos del Build 6 (sin `modalidad`). | `jq '.[0] \| keys'` |

#### UI Playwright (371-380)

| # | Descripción | Cómo verificar |
|---|---|---|
| 371 | Existe `[data-testid="radio-componente-PET"]` con etiqueta `PET` / `Proyectos Estratégicos Territoriales`. | Playwright |
| 372 | Con TR seleccionado: no existe `[data-testid="select-modalidad"]`, visible `[data-testid="modalidad-no-aplica"]` con `No aplica`. | Playwright |
| 373 | No regresión: con TR, `[data-testid="select-proyecto"]` habilitado, opción PEO presente. | Playwright |
| 374 | Con PET: aparece `[data-testid="select-modalidad"]` con 1 opción preseleccionada (`MOD-PEPFO`). | Playwright |
| 375 | PET + modalidad → `[data-testid="select-proyecto"]` habilitado, ofrece PEO. | Playwright |
| 376 | Cambiar de PET a TR → `select-modalidad` desaparece, vuelve `modalidad-no-aplica`. | Playwright |
| 377 | No regresión E2E: TR completo → `201`, folio `PEO-...`, detalle sin `[data-testid="dato-modalidad"]`. | Playwright + curl |
| 378 | E2E PET: PET + modalidad + PEO → `201`, detalle con `[data-testid="dato-modalidad"]` visible. | Playwright |
| 379 | PET + Grupo + Casas Ejidales → Paso 6 muestra ≥8 documentos, sin `[data-testid="error-solicitud"]`. | Playwright |
| 380 | Durante 377 y 378: ninguna respuesta `422` con `codigo="campo_no_editable"`. | Playwright |

#### Infraestructura y regresión global (381-386)

| # | Descripción | Cómo verificar |
|---|---|---|
| 381 | `npm run build` en `packages/shared`, `backend`, `pwa` → código 0, sin errores TS. | Terminal log. |
| 382 | `git diff` de `dependencies` y `devDependencies` en los 3 `package.json` está vacío. | `git diff HEAD -- '*package.json'` |
| 383 | `git diff` sobre `docker-compose.yml` y `pwa/nginx.conf.template` está vacío. | `git diff` |
| 384 | `GET /api/salud` → `200`. | `curl` |
| 385 | Flujo offline de campo intacto: captura sin red → IndexedDB → sync al reconectar. | Playwright offline test |
| 386 | Criterios 1-343 vuelven a pasar sobre el build desplegado. | Re-run evaluator. |

**Definición de terminado (build 8):** los **43** criterios pasan (343 acumulados de los builds 1-7 + **43** de esta extensión). Total acumulado: **386** criterios.

# 15. EXTENSIÓN — Rediseño visual completo de la PWA: design system, tema dual y layout responsivo (Build 9)

> Esta sección **extiende** el SPEC. No sustituye ni reinterpreta nada de las secciones 1-14.
> Todo lo definido antes sigue vigente tal cual. Los criterios 1-386 siguen siendo obligatorios
> y deben volver a pasar sin modificación alguna de su enunciado.
>
> **Este build es exclusivamente visual.** Cero cambios de lógica de negocio, cero cambios de
> endpoints, cero cambios de esquema de base de datos, cero cambios de contrato de API.

---

## 15.1 Objetivo

Sustituir el lenguaje visual improvisado del build 1 (verde institucional + CSS plano de 758 líneas
+ barra superior única que amontona 8 enlaces) por el **design system de IntechQRO** (naranja/ink,
Space Grotesk/Inter/JetBrains Mono, dos modos completos) aplicado a una **arquitectura de layout de
aplicación** —sidebar en escritorio, barra inferior en móvil— pensada para el capturista de campo que
usa el teléfono con una sola mano y para el analista de gestión que trabaja en escritorio con tablas
densas.

## 15.2 Scope

**SÍ incluye**

1. Reestructuración de `pwa/src/styles/` en 6 archivos: `tokens.css`, `fuentes.css`, `base.css`,
   `componentes.css`, `cascaron.css` y `global.css` (este último solo `@import`).
2. Adopción literal de los tokens de `_referencia_diseno/tokens.css` (bloques `:root`,
   `[data-mode="dark"]` y `[data-mode="light"]`), **más** una capa de tokens semánticos propios
   (éxito / aviso / peligro / info) que la referencia no trae y la app sí necesita.
3. Capa de **alias de compatibilidad**: las variables actuales (`--verde`, `--gris-texto`,
   `--gris-borde`, `--blanco`, `--radio`, `--sombra`…) se conservan como nombres pero se
   redefinen apuntando a los tokens nuevos, para no romper ninguna referencia existente
   (incluidas las de `DetalleSolicitud.tsx`, que usa `var(--verde, #0b6b3a)` inline).
4. Carga de las tres familias tipográficas **sin depender de ninguna CDN externa**
   (`@font-face` con `local()` + archivos servidos por la propia app + fallback a `system-ui`).
5. Componente nuevo de cascarón responsivo (`Cascaron.tsx`) con:
   - `BarraLateral.tsx` (sidebar) en tablet y escritorio, colapsable a rail de íconos.
   - `BarraInferior.tsx` (barra inferior de accesos rápidos) en móvil, con hoja "Más".
   - `FranjaEstado.tsx` — la reconversión de `BarraEstado.tsx` a franja delgada de estado.
6. Componente nuevo `ToggleTema.tsx` + módulo `pwa/src/tema/tema.ts` (hook + persistencia) +
   script inline anti-parpadeo en `pwa/index.html`.
7. Componente nuevo `Iconos.tsx` con SVG inline propios (cero dependencias npm).
8. Aplicación consistente del nuevo lenguaje visual (tarjetas, tipografía, radios, sombras,
   botones, inputs, tablas, badges, modales) a las 17 pantallas existentes.
9. Extracción de la definición de navegación por rol a `pwa/src/navegacion/menu.ts`
   (mismas condiciones de rol que hoy están hardcodeadas en `BarraEstado.tsx`, sin cambiarlas).
10. Colores de las gráficas de `/dashboard` leídos de las variables CSS del tema activo.
11. Rubric extendido (criterios **387-446**).

**NO incluye**

- Ninguna modificación a `backend/`, `db/`, `packages/shared/`, `scripts/`.
- Ninguna modificación a `pwa/nginx.conf.template`, `pwa/Dockerfile`, `pwa/vite.config.ts`
  (Service Worker / `vite-plugin-pwa` intactos), `pwa/src/api/`, `pwa/src/db/`, `pwa/src/sync/`.
- Ninguna dependencia npm nueva. `pwa/package.json` no cambia en `dependencies`
  ni en `devDependencies`.
- Ningún rediseño de **contenido**: no se agrega, quita ni renombra ningún campo de formulario,
  ninguna columna de tabla, ningún texto legal, ningún mensaje de validación, ningún paso de flujo.
- Ningún `data-testid` existente se elimina ni se renombra. Solo se **agregan** los nuevos.
- Ninguna adaptación de la paleta a verde SEDEA (decisión explícita del cliente, ver §15.15 A15-1).
- Ningún reemplazo del logotipo institucional: la marca en el cascarón es tipográfica
  (ver §15.15 A15-3). No se copia el logo de IntechQRO.
- Ningún cambio a los estilos de impresión de la carátula de solicitud
  (`DetalleSolicitud.tsx`, `@media print`): la carátula se sigue imprimiendo en negro sobre blanco
  independientemente del tema activo.

---

## 15.3 Sistema de tokens

### 15.3.1 `pwa/src/styles/tokens.css` — capa 1: primitivos (copia literal de la referencia)

Se copia **tal cual** de `_referencia_diseno/tokens.css` el bloque `:root` completo:

| Grupo | Tokens |
|---|---|
| Marca | `--brand-orange: #FF5A1F`, `--brand-orange-soft: #FF7A47`, `--brand-orange-deep: #E03E00`, `--brand-blue: #1E40FF`, `--brand-blue-soft: #5773FF` |
| Neutros cálidos | `--ink-1000: #0A0A0C`, `--ink-900: #131318`, `--ink-800: #1C1C24`, `--ink-700: #2A2A35`, `--ink-600: #3D3D4A`, `--ink-500: #6E6E7E`, `--ink-400: #9A9AA8`, `--ink-300: #C4C4CC`, `--ink-200: #E4E4E8`, `--ink-100: #F2F2F0`, `--ink-50: #FAFAF7`, `--ink-0: #FFFFFF` |
| Tipografía | `--font-display`, `--font-body`, `--font-mono` |
| Radios | `--r-xs: 4px`, `--r-sm: 8px`, `--r-md: 12px`, `--r-lg: 18px`, `--r-xl: 24px`, `--r-2xl: 32px` |
| Sombra 3D | `--shadow-int: 0.65`, `--shadow-spread: 0.5` |

### 15.3.2 Capa 2: modo oscuro — `[data-mode="dark"]` (copia literal)

| Token | Valor |
|---|---|
| `--bg` | `var(--ink-1000)` → `#0A0A0C` |
| `--bg-elev` | `var(--ink-900)` → `#131318` |
| `--bg-elev-2` | `var(--ink-800)` → `#1C1C24` |
| `--bg-elev-3` | `var(--ink-700)` → `#2A2A35` |
| `--fg` | `var(--ink-50)` → `#FAFAF7` |
| `--fg-muted` | `var(--ink-400)` → `#9A9AA8` |
| `--fg-subtle` | `var(--ink-500)` → `#6E6E7E` |
| `--border` | `rgba(255,255,255,0.08)` |
| `--border-strong` | `rgba(255,255,255,0.16)` |
| `--accent` | `var(--brand-orange)` |
| `--accent-2` | `var(--brand-blue-soft)` |
| `--grid-line` | `rgba(255,255,255,0.04)` |
| `--shadow-card` / `--shadow-pop` / `--shadow-glow` / `--shadow-text` | tal cual la referencia (`--shadow-text: none`) |

### 15.3.3 Capa 2: modo claro — `[data-mode="light"]` (copia literal)

| Token | Valor |
|---|---|
| `--bg` | `#F5F4EE` |
| `--bg-elev` / `--bg-elev-2` / `--bg-elev-3` | `#FFFFFF` |
| `--fg` | `var(--ink-1000)` → `#0A0A0C` |
| `--fg-muted` | `var(--ink-500)` → `#6E6E7E` |
| `--fg-subtle` | `var(--ink-400)` → `#9A9AA8` |
| `--border` | `rgba(10,10,12,0.08)` |
| `--border-strong` | `rgba(10,10,12,0.18)` |
| `--accent` | `var(--brand-orange)` |
| `--accent-2` | `var(--brand-blue)` |
| `--grid-line` | `rgba(10,10,12,0.06)` |
| `--shadow-card` / `--shadow-pop` / `--shadow-glow` / `--shadow-text` | tal cual la referencia (fórmulas `calc()` con `--shadow-int` / `--shadow-spread`) |

> **Diferencia respecto a `bg-elev-2` / `bg-elev-3` en claro:** la referencia los deja los tres en
> `#FFFFFF`. Para una app de gestión eso deja las cabeceras de tabla y los rails sin separación
> visual. Se añade **solo en `[data-mode="light"]`** el token derivado
> `--bg-sunk: #ECEBE4` (fondo hundido: `th`, rail del sidebar, campos deshabilitados).
> En `[data-mode="dark"]`, `--bg-sunk: var(--ink-800)`.

### 15.3.4 Capa 3: tokens semánticos propios (no existen en la referencia)

La app tiene semáforo GPS, badges de alerta, mensajes error/aviso/info/éxito y estado de red.
Esos son colores **semánticos**, no de marca: no se "naranjizan".

| Token | dark | light | Uso |
|---|---|---|---|
| `--exito` | `#4ADE80` | `#15803D` | texto/borde de `.mensaje.exito`, `.badge.capturado`, `.semaforo.verde`, `.badge.alerta-ninguna`, punto verde de "En línea" |
| `--exito-bg` | `rgba(74,222,128,0.12)` | `#E6F4EA` | fondo de los anteriores |
| `--aviso` | `#FBBF24` | `#92400E` | `.mensaje.aviso`, `.semaforo.ambar`, `.badge.alerta-media`, `.campo-difiere` |
| `--aviso-bg` | `rgba(251,191,36,0.12)` | `#FDF3E2` | fondo |
| `--peligro` | `#FCA5A5` | `#B91C1C` | `.mensaje.error`, `.semaforo.rojo`, `.badge.alerta-alta`, `button.peligro`, indicador `.sin-conexion` |
| `--peligro-bg` | `rgba(252,165,165,0.12)` | `#FBE4E2` | fondo |
| `--info` | `var(--brand-blue-soft)` | `var(--brand-blue)` | **único uso del azul de marca**: `.mensaje.info` y badges informativos |
| `--info-bg` | `rgba(87,115,255,0.12)` | `#E8ECFF` | fondo |
| `--sobre-acento` | `var(--ink-1000)` | `var(--ink-1000)` | color de texto sobre fondo `--accent` (ver §15.3.6) |
| `--sobre-peligro` | `var(--ink-1000)` | `var(--ink-0)` | texto sobre `button.peligro` |
| `--bg-sunk` | `var(--ink-800)` | `#ECEBE4` | fondo hundido |

> **`button.peligro` sólido**: en light usa fondo `#B91C1C` con texto blanco (7.0:1);
> en dark usa fondo `#7F1D1D` con texto `#FEE2E2` (8.9:1). Se declaran como
> `--peligro-solido` / `--sobre-peligro`.

### 15.3.5 Capa 4: alias de compatibilidad (obligatoria, no opcional)

Se declaran **dentro de cada bloque de modo**, después de los tokens semánticos, para que los
selectores existentes y los `var(--verde, #0b6b3a)` inline de `DetalleSolicitud.tsx` sigan
resolviendo. Se marcan con el comentario `/* DEPRECADO: usar el token nuevo */`.

| Alias antiguo | Nuevo valor | Nota |
|---|---|---|
| `--verde` | `var(--accent)` | pasa a ser naranja; el nombre queda por compatibilidad |
| `--verde-claro` | `var(--brand-orange-soft)` | hover del botón primario |
| `--verde-suave` | `color-mix(in srgb, var(--accent) 12%, var(--bg-elev))` | fondos teñidos de acento |
| `--gris-texto` | `var(--fg)` | |
| `--gris-medio` | `var(--fg-muted)` | |
| `--gris-borde` | `var(--border)` | |
| `--gris-fondo` | `var(--bg)` | |
| `--blanco` | `var(--bg-elev)` | **crítico**: en dark no puede seguir siendo `#fff` |
| `--ambar` | `var(--aviso)` | |
| `--rojo` | `var(--peligro)` | |
| `--radio` | `var(--r-md)` | 8px → 12px |
| `--sombra` | `var(--shadow-card)` | |

Los literales hex del build 1 (`#0b6b3a`, `#128a4c`, `#e6f2ea`, `#d7dce3`, `#f5f7f9`, `#1f2430`,
`#5b6472`, `#eef1f4`, `#eceff2`, `#e3e8ec`, `#fafcfb`, `#f9fafb`, `#e5e7eb`, `#b3261e`, `#c98600`,
`#7bd88f`, `#ffd0cd`, `#a7b3ad`, `#b6bec9`, `#2b6cb0`, `#fbe4e2`, `#fdf1d9`, `#f2c2be`, `#bfe0cc`,
`#f0dcae`, `#fbe9e7`, `#fdf3e2`) **desaparecen** de `pwa/src/styles/` y de `Dashboard.tsx`.
Única excepción permitida: el bloque `@media print` de `DetalleSolicitud.tsx`, que conserva
`#000` y blanco por ser tinta sobre papel.

### 15.3.6 Contraste — decisiones fijadas

- **Texto sobre naranja**: nunca blanco. `#FFFFFF` sobre `#FF5A1F` da ≈ 3.0:1 (falla AA).
  Se usa `--sobre-acento` = `#0A0A0C`, que da ≈ 6.9:1. Aplica a `button`, `.boton`,
  `.chip.activo`, indicador de ruta activa y `.progreso > div` (esta última sin texto).
- **`--fg-subtle` nunca se usa para texto** en modo claro (`#9A9AA8` sobre `#F5F4EE` ≈ 2.6:1).
  Solo para separadores, iconografía decorativa y placeholders no informativos.
- **`--accent` como color de texto**: permitido sobre `--bg` y `--bg-elev` en ambos modos
  (dark ≈ 5.4:1, light ≈ 3.5:1) **solo a partir de 18px o 14px bold** (AA para texto grande).
  Para texto pequeño de acento se usa `--fg` con peso 600 y el naranja como borde/fondo.

---

## 15.4 Tipografía

### 15.4.1 Verificación de la referencia

`_referencia_diseno/tokens.css` **declara** las familias pero **no** las carga: no contiene
`@import url(...)` ni `@font-face`. Toda la carga es responsabilidad de este build.

### 15.4.2 Estrategia sin CDN (`pwa/src/styles/fuentes.css`)

```css
/* Cada familia se resuelve en 3 escalones: instalada en el sistema -> servida por
   la propia app -> fallback de sistema. La app NUNCA depende de una CDN externa. */
@font-face {
  font-family: 'Space Grotesk';
  src: local('Space Grotesk'), url('/fuentes/SpaceGrotesk-Variable.woff2') format('woff2');
  font-weight: 300 700;
  font-display: swap;
}
/* idem 'Inter' -> /fuentes/Inter-Variable.woff2, font-weight 100 900 */
/* idem 'JetBrains Mono' -> /fuentes/JetBrainsMono-Variable.woff2, font-weight 100 800 */
```

- Los `.woff2` se colocan en `pwa/public/fuentes/` (se sirven desde el mismo origen; Vite los
  copia a `dist/` sin procesar).
- Si los archivos no se pueden obtener durante el build, **la app debe seguir funcionando**:
  los stacks de `--font-display`, `--font-body` y `--font-mono` terminan siempre en
  `system-ui, sans-serif` / `ui-monospace, monospace`, y `font-display: swap` garantiza que
  nunca haya texto invisible. En ese caso se deja
  `pwa/public/fuentes/LEEME.txt` documentando qué archivos faltan y de dónde bajarlos.
- **Prohibido**: `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`,
  `@import url('https://fonts.gstatic.com/...')` o cualquier equivalente.
- No se instala `@fontsource/*` ni ningún paquete npm de fuentes.

### 15.4.3 Escala tipográfica de aplicación

La escala del brandbook (`.bb-hero-title` hasta 124px, `.bb-h2` hasta 64px) es de landing page y
**se descarta**. La escala de este build:

| Rol | Familia | Tamaño / interlineado | Peso | Tracking | Aplica a |
|---|---|---|---|---|---|
| Título de pantalla | display | 24px / 1.2 | 600 | -0.02em | `h1` |
| Sección | display | 18px / 1.3 | 600 | -0.01em | `h2` |
| Subsección | display | 15px / 1.35 | 600 | 0 | `h3`, `fieldset legend` |
| Cuerpo | body | 15px / 1.5 | 400 | 0 | `body`, `p`, `td`, `.dato` |
| Etiqueta | body | 12px / 1.4 | 600 | 0.04em, `uppercase` | `label`, `th`, `.metrica-etiqueta`, `.origen-candidato` |
| Auxiliar | body | 13px / 1.45 | 400 | 0 | `.detalle`, `.metrica-detalle`, `.bb-variant-desc` |
| Dato / clave | mono | 13px / 1.4 | 400 | 0.02em | CURP, folios, claves de catálogo, IDs, coordenadas GPS, versiones |
| Métrica | display | 32px / 1.05 | 600 | -0.02em | `.metrica-valor` |
| Folio destacado | mono | 22px / 1.2 | 700 | 0.06em | `.folio-grande` |
| Contraseña temporal | mono | 24px / 1.3 | 700 | 0.12em | `.password-temporal` |
| Nav (rail/sidebar) | body | 13px / 1.2 | 500 | 0 | items del sidebar |

- `body` baja de 16px a **15px** para densificar tablas de gestión.
- **Excepción móvil obligatoria**: en `max-width: 767px`, `input`, `select` y `textarea`
  mantienen `font-size: 16px` (por debajo de 16px iOS Safari hace zoom automático al enfocar).
- `text-shadow: var(--shadow-text)` del brandbook **se descarta en toda la app**: perjudica la
  legibilidad de datos densos. Única excepción permitida: la marca del cascarón en modo claro.

---

## 15.5 Arquitectura del cascarón

### 15.5.1 Breakpoints exactos

| Nombre | Rango | Navegación | Sidebar |
|---|---|---|---|
| **Móvil** | `< 768px` | barra inferior fija + hoja "Más" | no se monta |
| **Tablet** | `768px – 1023px` | sidebar en modo **rail** (solo íconos) | 72px, expandible a overlay |
| **Escritorio** | `≥ 1024px` | sidebar **expandido** | 256px, colapsable a rail de 72px |

Viewports de referencia para la evaluación: **390×844** (móvil), **820×1180** (tablet),
**1440×900** (escritorio). El viewport por defecto de Playwright (1280×720) cae en escritorio.

### 15.5.2 Regla de montaje: JS, no CSS

El cambio entre sidebar y barra inferior se hace **montando/desmontando componentes** con
`matchMedia`, **no** con `display: none`. Motivo: si ambas barras existieran simultáneamente en el
DOM, los `data-testid` de navegación (`nav-dashboard`, `nav-usuarios`, …) estarían duplicados y
los criterios 1-386 —que hacen `page.click('[data-testid=nav-...]')`— fallarían por selector
ambiguo (strict mode violation de Playwright).

```
pwa/src/tema/viewport.ts
  export type Ancho = 'movil' | 'tablet' | 'escritorio';
  export function useAncho(): Ancho   // matchMedia('(min-width: 768px)') + '(min-width: 1024px)',
                                      // con listener; valor inicial calculado sincrónicamente.
```

**Invariante duro:** en cualquier viewport, cada `data-testid` que empiece con `nav-` aparece
**como máximo una vez** en el DOM.

### 15.5.3 Estructura del cascarón

```
<div class="cascaron" data-ancho="escritorio|tablet|movil">
  <FranjaEstado />                     <!-- fija arriba, 40px (36px en móvil) -->
  <BarraLateral />                     <!-- solo tablet/escritorio -->
  <main class="contenido" id="contenido">
    <Outlet />                          <!-- pantalla activa -->
  </main>
  <BarraInferior />                    <!-- solo móvil -->
</div>
```

- `.cascaron` es `display: grid` en tablet/escritorio:
  `grid-template-columns: var(--ancho-lateral) 1fr; grid-template-rows: var(--alto-franja) 1fr;`
  con `--ancho-lateral: 256px` (o `72px` colapsado) y `--alto-franja: 40px`.
- En móvil es una columna simple con `padding-bottom: calc(64px + env(safe-area-inset-bottom))`
  para que la barra inferior no tape el contenido.
- `<main class="contenido">` conserva la clase actual. Cambia su regla: deja de ser
  `max-width: 960px; margin: 0 auto` y pasa a `max-width: 1180px; padding: 24px` en escritorio,
  `padding: 20px` en tablet y `padding: 16px 14px` en móvil. Sigue centrado.
- El scroll vertical vive en `<main>` (`overflow-y: auto`), no en `<body>`, para que sidebar y
  franja queden fijos sin `position: fixed` en escritorio.
- Enlace de salto accesible: `<a class="salto-contenido" href="#contenido">Ir al contenido</a>`
  como primer hijo, visible solo con foco.

### 15.5.4 `BarraLateral.tsx` (tablet y escritorio)

`<nav data-testid="barra-lateral" aria-label="Navegación principal">`

- **Cabecera**: marca (glifo + "SEDEA" en display 600 + subtítulo mono 10px "CAMPO 2026").
  En modo rail solo el glifo.
- **Cuerpo**: items agrupados en secciones con encabezado mono 10px uppercase `--fg-muted`.
  Orden y agrupación fijos (§15.5.6). Cada item: ícono 20px + etiqueta.
  - Reposo: `color: var(--fg-muted)`, sin fondo.
  - Hover: `background: var(--bg-elev-2)`, `color: var(--fg)`.
  - **Activo** (`aria-current="page"`): `background: color-mix(in srgb, var(--accent) 14%, transparent)`,
    `color: var(--fg)`, y barra vertical de 3px en `--accent` pegada al borde izquierdo,
    con `border-radius: 0 var(--r-sm) var(--r-sm) 0`.
  - Alto de item: 40px (escritorio), 44px (tablet). En rail: 44×44 centrado.
- **Pie**: `<MenuUsuario />` (los dos botones de cuenta) + `<ToggleTema />` +
  botón `[data-testid="colapsar-lateral"]`.
- **Modo rail**: `--ancho-lateral: 72px`, etiquetas ocultas con
  `clip-path` + clase `.sr-solo` (siguen en el árbol de accesibilidad y siguen siendo clickeables
  por `data-testid`); cada item lleva `title` y `aria-label` con el mismo texto.
- **Colapsado persistido**: `localStorage['sedea.lateral']` = `'rail' | 'expandido'`.
  Default: `expandido` en ≥1024px, `rail` en 768-1023px.
- En tablet, tocar la marca expande el sidebar como **overlay** de 256px sobre el contenido, con
  velo `rgba(0,0,0,.45)`; se cierra con Escape, con click en el velo o al navegar.

### 15.5.5 `BarraInferior.tsx` (móvil)

`<nav data-testid="barra-inferior" aria-label="Accesos rápidos">`

- `position: fixed; bottom: 0; left: 0; right: 0; z-index: 950;`
  `background: color-mix(in srgb, var(--bg-elev) 92%, transparent);`
  `backdrop-filter: blur(16px) saturate(140%); border-top: 1px solid var(--border);`
  `padding-bottom: env(safe-area-inset-bottom);`
- Alto útil 60px. **Máximo 5 celdas**: hasta 4 destinos del rol + el botón "Más".
- Cada celda: `min-width: 44px; min-height: 48px`, ícono 22px arriba + etiqueta 10px abajo,
  `flex: 1`. Área táctil efectiva ≥ 44×44 CSS px.
- Activo: ícono y etiqueta en `--accent` + punto de 4px bajo la etiqueta.
- Botón `[data-testid="mas-opciones"]` (ícono de tres puntos): abre `HojaMas`, un
  `<div role="dialog" aria-modal="true" data-testid="hoja-mas">` que sube desde abajo
  (`transform: translateY(100%)` → `0`, 220ms `ease-out`), con velo, y contiene:
  los destinos del rol que no cupieron, `<MenuUsuario />` y `<ToggleTema />`.
  Se cierra con Escape, con click en el velo, con arrastre hacia abajo y al navegar.
  El foco entra a la hoja al abrir y vuelve al botón al cerrar.

### 15.5.6 `pwa/src/navegacion/menu.ts` — catálogo único de destinos

Fuente única de verdad para sidebar y barra inferior. **Las condiciones de rol son exactamente
las que hoy están en `BarraEstado.tsx` y en `rutas.tsx`; no se tocan.**

| # | `id` | Ruta | `data-testid` | Roles | Grupo | Ícono |
|---|---|---|---|---|---|---|
| 1 | `beneficiarios` | `/beneficiarios` | `nav-beneficiarios` *(nuevo)* | capturista, admin | Campo | usuarios |
| 2 | `sync` | `/sync` | `nav-sync` *(nuevo)* | capturista, admin | Campo | sincronizar |
| 3 | `dashboard` | `/dashboard` | `nav-dashboard` | admin, auditor, editor_datos | Gestión | gráfica |
| 4 | `auditoria` | `/auditoria` | `nav-auditoria` *(nuevo)* | auditor, admin | Gestión | lupa |
| 5 | `depuracion` | `/depuracion` | `nav-depuracion` | editor_datos, admin | Gestión | filtro |
| 6 | `correcciones` | `/correcciones` | `nav-correcciones` | editor_datos, admin | Gestión | lápiz |
| 7 | `solicitudes` | `/solicitudes` | `nav-solicitudes` | ventanilla, admin | Ventanilla | documento |
| 8 | `usuarios` | `/usuarios` | `nav-usuarios` | admin, editor_datos | Administración | escudo |

- Los `data-testid` marcados *(nuevo)* son **aditivos**. Los 5 preexistentes
  (`nav-dashboard`, `nav-depuracion`, `nav-correcciones`, `nav-solicitudes`, `nav-usuarios`)
  conservan su nombre exacto.
- El sidebar muestra **todos** los destinos del rol, en el orden de la tabla, agrupados por grupo.
  Los encabezados de grupo se ocultan si el grupo queda vacío para ese rol.

**Reparto en la barra inferior por rol** (primeros 4 de la tabla que apliquen; el resto va a "Más"):

| Rol | Celdas visibles | En "Más" |
|---|---|---|
| `capturista` | Beneficiarios, Sincronización | — (solo cuenta y tema) |
| `ventanilla` | Solicitudes | — |
| `auditor` | Dashboard, Auditoría | — |
| `editor_datos` | Dashboard, Depuración, Correcciones, Usuarios | — |
| `admin` | Beneficiarios, Sincronización, Dashboard, Auditoría | Depuración, Correcciones, Solicitudes, Usuarios |

### 15.5.7 `FranjaEstado.tsx` — reconversión de `BarraEstado.tsx`

**Decisión documentada:** `BarraEstado.tsx` **se renombra** a `FranjaEstado.tsx` y pierde toda
responsabilidad de navegación (los 6 `<Link>` que hoy renderiza se mudan a `menu.ts` +
`BarraLateral` / `BarraInferior`). Conserva **íntegra y sin tocar** su lógica actual:
`useEstadoRed()`, `contarPendientes()`, `alCambiarCola()`, el `setInterval` de 3s,
`sincronizarPendientes()` y la rama de bloqueo por `debe_cambiar_password`.
La clase CSS `.barra-estado` se conserva como alias de `.franja-estado` para no romper selectores.

Franja fija superior, **40px de alto** (36px en móvil), `background: var(--bg-elev)`,
`border-bottom: 1px solid var(--border)`, `z-index: 900`. Contenido de izquierda a derecha:

| Zona | Contenido | Móvil (<768) | Tablet/Escritorio |
|---|---|---|---|
| Izquierda | glifo + "SEDEA" | visible | oculto (la marca vive en el sidebar); en su lugar, el título de la ruta activa |
| Centro-derecha | `[data-testid="estado-red"]` | píldora con punto + texto | igual |
| | `[data-testid="contador-pendientes"]` | píldora `Pendientes: N` | igual |
| | botón "Sincronizar ahora" | solo ícono, `aria-label` completo | ícono + texto |
| | `[data-testid="usuario-actual"]` | nombre truncado (`text-overflow: ellipsis`, máx 12ch) | nombre completo con rol y regional |
| | `<ToggleTema />` | visible | visible |

- **`usuario-actual` se mueve** de `MenuUsuario.tsx` a `FranjaEstado.tsx`, para que exista y sea
  visible en los 3 viewports (en móvil `MenuUsuario` vive dentro de la hoja "Más", que está
  cerrada por defecto). `MenuUsuario.tsx` queda solo con `nav-cambiar-password` y
  `nav-cerrar-sesion`, y conserva su `data-testid="menu-usuario"`.
- Estilo de las píldoras (`.indicador`): base `.bb-tag` del brandbook —
  `border-radius: 99px`, `font-family: var(--font-mono)`, `font-size: 11px`,
  `padding: 4px 10px`, `background: var(--bg-elev-2)`, `border: 1px solid var(--border)`.
  - En línea: punto `--exito`, texto `--fg-muted`.
  - Sin conexión: `background: var(--peligro-bg)`, `color: var(--peligro)`,
    `border-color: var(--peligro)`, punto `--peligro`. **El texto "Sin conexión" se mantiene**
    (la información no se transmite solo por color).
  - Pendientes > 0: `color: var(--accent)`, `border-color: var(--accent)`.
- **Estado bloqueado** (`perfil.debe_cambiar_password === true`): `Cascaron` no monta ni sidebar
  ni barra inferior; solo la franja con marca, `usuario-actual` y `nav-cerrar-sesion`.
  El criterio 10.8.4 sigue pasando sin cambios.

---

## 15.6 Toggle de tema

### 15.6.1 `pwa/src/tema/tema.ts`

```
export type Modo = 'dark' | 'light';
const CLAVE = 'sedea.tema';

modoGuardado(): Modo | null          // lee localStorage; ignora valores inválidos
modoDelSistema(): Modo               // matchMedia('(prefers-color-scheme: dark)') ? 'dark' : 'light'
aplicarModo(m: Modo): void           // document.documentElement.setAttribute('data-mode', m)
                                     // + actualiza <meta name="theme-color">
useTema(): { modo, alternar, esExplicito }
```

Reglas:
1. **Origen del modo inicial**: `modoGuardado() ?? modoDelSistema()`.
2. **Persistencia**: solo se escribe `localStorage['sedea.tema']` cuando el usuario pulsa el
   toggle. Los valores admitidos son exactamente `"dark"` y `"light"`.
3. **Seguimiento del sistema**: mientras **no** exista la clave en `localStorage`, un listener de
   `matchMedia('(prefers-color-scheme: dark)')` cambia el tema en vivo. En cuanto el usuario
   elige, el listener deja de aplicar cambios (`esExplicito === true`).
4. `data-mode` se pone en `<html>` (`document.documentElement`), **no** en `<body>`.
5. El toggle **no** dispara ninguna petición HTTP ni escritura en IndexedDB.

### 15.6.2 Script anti-parpadeo (`pwa/index.html`)

Inline, síncrono, en `<head>` **antes** de `<script type="module" src="/src/main.tsx">`:

```html
<script>
  (function () {
    try {
      var g = localStorage.getItem('sedea.tema');
      var m = (g === 'dark' || g === 'light') ? g
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-mode', m);
      document.querySelector('meta[name=theme-color]')
        .setAttribute('content', m === 'dark' ? '#0A0A0C' : '#F5F4EE');
    } catch (e) { document.documentElement.setAttribute('data-mode', 'dark'); }
  })();
</script>
```

Además, en `index.html`:
- `<meta name="theme-color" content="#0A0A0C">` (sustituye a `#0b6b3a`).
- Se añade `<meta name="color-scheme" content="dark light">`.
- Se añade `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fuentes/Inter-Variable.woff2">`
  (solo la de cuerpo; opcional y con `onerror` silencioso).

### 15.6.3 `pwa/src/componentes/ToggleTema.tsx`

```html
<button type="button"
        data-testid="toggle-tema"
        class="toggle-tema"
        aria-pressed={modo === 'light'}
        aria-label="Cambiar a modo claro"   <!-- o "Cambiar a modo oscuro" -->
        title="…mismo texto…">
  <IconoSol|IconoLuna />
</button>
```

- Estilo base: `.bb-nav-mode` del brandbook adaptado — píldora 32×32 (44×44 en móvil),
  `border-radius: 99px`, `background: var(--bg-elev-2)`, `border: 1px solid var(--border)`,
  `color: var(--fg)`.
- Ícono: **sol** cuando el modo activo es `dark` (indica a dónde vas), **luna** cuando es `light`.
  El `aria-label` describe la acción, no el estado.
- Transición: `background-color .25s ease, color .25s ease` en `html, body` (ya viene de la
  referencia); el ícono rota 180° en 200ms. Todo bajo `@media (prefers-reduced-motion: reduce)`
  se desactiva.
- **Puntos de montaje**: (a) pie del sidebar en tablet/escritorio; (b) franja de estado en móvil;
  (c) esquina superior derecha de `/login`. Regla: **exactamente uno visible por viewport**.

---

## 15.7 Adopción del brandbook — qué sí y qué no

`_referencia_diseno/brandbook.css` es la hoja de una landing page de marketing. Se toma lo
estructural y se descarta lo editorial.

### 15.7.1 Se adopta

| Patrón del brandbook | Se convierte en |
|---|---|
| `.bb-card` | base de `.tarjeta`, `.metrica`, `.modal`, `.comparador .candidato`, `.campos-bloqueados` |
| `.bb-tag` | base de `.chip`, `.badge`, `.indicador`, `.semaforo` |
| `.bb-mono` | clase utilitaria `.mono` para CURP, folios, claves, coordenadas |
| `.bb-nav-mode` | base visual de `ToggleTema` |
| `.bb-landing-btn` / `.bb-landing-btn-primary` | base de `button.secundario` y de `button` (primario) |
| `.bb-slide-bullet` | filas de `.lista-documentos` (checklist de documentos, §12.9) |
| `.bb-variant-card:hover` / `.is-active` (elevación + anillo de acento) | tarjetas seleccionables del `ComparadorDuplicados` |
| `--grid-line` + patrón de rejilla de `.bb-hero-grid` | fondo decorativo **solo** de `/login` y `/sin-permiso` |
| `--r-*`, `--shadow-card`, `--shadow-pop` | radios y sombras de toda la app |
| `backdrop-filter: blur(20px) saturate(140%)` de `.bb-nav` | franja de estado y barra inferior |

### 15.7.2 Se descarta (y por qué)

| Patrón | Motivo |
|---|---|
| `.bb-nav` (nav superior de landing) | es exactamente el antipatrón que este build elimina |
| `.bb-hero*`, `.bb-section` (padding 100px) | escala editorial; desperdicia viewport en una app de captura |
| `.bb-h2` con `clamp(36px,5vw,64px)` | títulos gigantes ilegibles en tablas densas |
| `text-shadow: var(--shadow-text)` | reduce legibilidad de datos; se anula globalmente |
| `--shadow-glow` (halo naranja) | distrae en formularios; se permite **solo** en el botón de entrar de `/login` |
| `.bb-pillars`, `.bb-variant-picker`, `.bb-logo-*`, `.bb-dod-*`, `.bb-construction` | material de brand book, sin equivalente funcional |
| `.bb-brand-grid`, `.bb-neutral-row` | muestrarios de color |
| `.bb-bcard*` (tarjeta de presentación, `rotateY/rotateX`) | sin equivalente |
| `.bb-deck-*`, `.bb-slide*` (salvo `.bb-slide-bullet`) | plantilla de presentación |
| `.bb-landing-*` (salvo los botones) | mockup de sitio web |
| `.bb-footer` | una app de gestión no lleva footer de marketing |
| `logo.jsx` (variantes A/B/C de IntechQRO) | es la marca de otra empresa (ver A15-3) |
| Breakpoint único `980px` del brandbook | insuficiente; se usan 768/1024 (§15.5.1) |

---

## 15.8 Mapeo de componentes CSS existentes

Todas las clases actuales **conservan su nombre**. Solo cambia su declaración. Ninguna clase se
elimina de `global.css` sin reemplazo equivalente.

| Clase | Cambio |
|---|---|
| `.contenido` | `max-width` 960→1180px; padding responsivo; scroll propio |
| `.tarjeta` | `bg-elev` + `border` + `--r-lg` (18px) + `--shadow-card`; padding 20px (16px móvil); `margin-bottom: 16px` |
| `h1`/`h2` | familia display, escala §15.4.3, `text-shadow: none` |
| `label` | 12px, 600, uppercase, `letter-spacing: .04em`, `--fg-muted` |
| `input/select/textarea` | `bg: var(--bg-elev-2)`, `border: 1px solid var(--border)`, `--r-sm` (8px), alto 40px (48px móvil), `:focus-visible` → `border-color: var(--accent)` + `box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)` |
| `input:disabled` | `bg: var(--bg-sunk)`, `color: var(--fg-subtle)`, `cursor: not-allowed` |
| `button` / `.boton` | primario: `bg: var(--accent)`, `color: var(--sobre-acento)`, `--r-sm`, alto 40px (48px móvil), peso 600, `:hover` → `--brand-orange-soft`, `:active` → `--brand-orange-deep`, `:disabled` → `bg: var(--bg-sunk)` + `color: var(--fg-subtle)` |
| `button.secundario` | `bg: var(--bg-elev-2)`, `color: var(--fg)`, `border: 1px solid var(--border-strong)`; hover `bg: var(--bg-elev-3)` |
| `button.peligro` | `bg: var(--peligro-solido)`, `color: var(--sobre-peligro)` |
| `.acciones` | `gap: 10px`; en móvil `flex-direction: column` y botones a ancho completo cuando hay ≥3 |
| `.chip` / `.chip.activo` | base `.bb-tag`; activo `bg: var(--accent)`, `color: var(--sobre-acento)`; alto mínimo 36px (44px móvil) |
| `.lista` / `.lista a` | filas de 56px (64px móvil), separador `--border`, hover `bg: var(--bg-elev-2)`, `:focus-visible` con anillo de acento |
| `.badge.*` | `.bb-tag` + token semántico correspondiente (§15.3.4) |
| `table`, `th`, `td` | `th`: `bg: var(--bg-sunk)`, `color: var(--fg)`, 12px uppercase mono-tracking; `td`: 13px, `padding: 10px 12px`; `tbody tr:hover`: `bg: var(--bg-elev-2)`; primera columna `position: sticky; left: 0` en `.tabla-contenedor` con scroll |
| `.tabla-contenedor` | `overflow-x: auto`; en móvil, sombra lateral que indica scroll (`background-attachment: local`) |
| `.semaforo.*` | tokens `--exito/--aviso/--peligro` + su `-bg`; conserva los 3 estados semánticos |
| `.mensaje.*` | `--r-md`, borde 1px del token, fondo `-bg`, texto del token; ícono 16px al inicio |
| `.vacio` | `--fg-muted`, padding 40px, con ícono ilustrativo 32px `--fg-subtle` |
| `.toast` | `bg: var(--bg-elev-3)`, `color: var(--fg)`, `--shadow-pop`; en móvil sube a `bottom: calc(76px + env(safe-area-inset-bottom))` para no quedar bajo la barra inferior |
| `.progreso` | `bg: var(--bg-sunk)`, relleno `--accent`, alto 8px, `--r-xs` |
| `.mapa` / `.mapa-mini` | conserva alturas (380/240px); `--r-md`; en móvil `.mapa` pasa a `260px`; los controles Leaflet reciben `--bg-elev`/`--fg` y `z-index` por debajo de la barra inferior |
| `.previa`, `.foto-grande`, `td img.miniatura` | `--r-md`, borde `--border`, `background: var(--bg-sunk)` mientras carga |
| `.login-caja` | ancho 380→400px, centrada vertical con `min-height: 100dvh`, `--shadow-pop` |
| `.dato` | `strong` en 12px uppercase `--fg-muted`; valor 15px `--fg` |
| `.paginacion` | botones ≥ 44px en móvil |
| `.filtros` | `gap: 12px`; en móvil `grid-template-columns: 1fr 1fr` y el campo de búsqueda a ancho completo |
| `.tarjetas-resumen` / `.metrica` | grid `repeat(auto-fit, minmax(160px, 1fr))`; `.metrica` con base `.bb-card` y `--bg-elev`; `.metrica-valor` en display 32px |
| `.comparador .candidato` | ancho 300→320px; `.candidato-actual` → anillo de 2px `--accent` |
| `.campos-candidato .campo-difiere` | `bg: var(--aviso-bg)`, `color: var(--aviso)`, más un punto ámbar de 6px (no solo color) |
| `.campos-bloqueados` | `border: 1px dashed var(--border-strong)`, `bg: var(--bg-sunk)` |
| `.lienzo-grafica` | sin cambios estructurales; altura sigue viniendo por prop |
| `.modal-fondo` | velo `rgba(10,10,12,.6)` + `backdrop-filter: blur(6px)`; en móvil el `.modal` se ancla abajo tipo hoja |
| `.modal` | base `.bb-card` + `--shadow-pop`, `--r-xl`; `max-height: 92dvh` |
| `.password-temporal` | mono 24px, `bg: var(--bg-sunk)`, borde punteado `--accent` |
| `.menu-usuario` | deja de ser `margin-left: auto` en una barra horizontal; pasa a bloque vertical en el pie del sidebar y en la hoja "Más" |
| `.casilla` | área táctil 44px en móvil; `input[type=checkbox/radio]` con `accent-color: var(--accent)`, tamaño 18px (22px móvil) |
| `.lista-casillas` | `minmax(220px, 1fr)` → `minmax(200px,1fr)`; 1 columna en móvil |
| `.lista-documentos li` | base `.bb-slide-bullet`: fondo `--bg-elev-2`, `--r-sm`, `gap: 12px`, sin `border-bottom` |
| `.declaraciones` | `bg: var(--bg-sunk)`, `border: 1px solid var(--border)`, `--r-md`, 14px/1.6 |
| `.folio-grande` | mono 22px 700, `color: var(--accent)`, `letter-spacing: .06em`; encima, etiqueta "FOLIO" 10px mono `--fg-muted` |
| `fieldset` / `legend` | `border: 1px solid var(--border)`, `--r-md`, `legend` en display 15px 600 |
| **nuevas** | `.franja-estado` (+ alias `.barra-estado`), `.barra-lateral`, `.nav-item`, `.nav-grupo`, `.barra-inferior`, `.celda-inferior`, `.hoja-mas`, `.toggle-tema`, `.salto-contenido`, `.mono`, `.sr-solo` |

---

## 15.9 Las 17 pantallas — qué cambia en cada una

> `pwa/src/pantallas/` contiene 18 archivos, pero `FichaBeneficiario.tsx` sirve dos rutas
> (`modo="campo"` y `modo="correccion"`) y `SinPermiso.tsx` es una pantalla de sistema, no de
> negocio. El conteo de trabajo es de **17 pantallas de producto** + `SinPermiso`.
>
> **Regla transversal para las 17**: no se agrega, quita ni renombra ningún campo, columna,
> etiqueta, texto legal, validación ni botón. Solo cambia la envoltura visual (tarjetas,
> espaciados, tipografía, botones, inputs, tablas) y, donde se indica, la **disposición** en móvil.

| # | Pantalla | Qué cambia |
|---|---|---|
| 1 | `Login.tsx` | Fondo con rejilla `--grid-line` + resplandor naranja de esquina. Tarjeta 400px centrada con `--shadow-pop`. Marca tipográfica grande arriba. Botón de entrar a ancho completo, 48px, con `--shadow-glow`. `ToggleTema` en la esquina superior derecha. Sin cascarón. |
| 2 | `Beneficiarios.tsx` | Filtros pasan a tarjeta propia con grid responsivo (4 col escritorio / 2 tablet / 1 móvil). Chips de estado con estilo `.bb-tag`. Lista con filas de 64px en móvil, avatar-inicial circular con la letra del nombre, nombre en 15px 600 y CURP en mono 12px `--fg-muted`, badge a la derecha. Botón "Nueva captura" pasa a FAB sobre la barra inferior en móvil. |
| 3 | `FichaBeneficiario.tsx` (modo campo) | Cabecera con nombre en display 24px + CURP mono + badges de estado. Datos en dos columnas (una en móvil) con `.dato` reestilizado. Mini-mapa con `--r-md`. Acciones agrupadas en pie fijo de tarjeta. |
| 4 | `FichaBeneficiario.tsx` (modo corrección) | Igual que 3, más `.campos-bloqueados` con fondo hundido y candado 14px junto a la leyenda; los editables se distinguen por borde `--border-strong`. |
| 5 | `NuevaCaptura.tsx` | Flujo en tarjetas apiladas numeradas (1 Foto · 2 GPS · 3 Datos) con índice mono. `CapturaFoto`: zona de arrastre/captura de 200px con borde punteado `--border-strong` y previa `--r-md`. `CapturaGPS`: semáforo grande 44px + coordenadas en mono. Botón de guardar fijo al pie en móvil (encima de la barra inferior). |
| 6 | `Sync.tsx` | Barra de progreso rediseñada (8px, `--accent`). Contadores como `.metrica`. Bitácora de sincronización en lista mono 12px con estados semánticos. |
| 7 | `Auditoria.tsx` | Filtros en tarjeta. Mapa a `--r-md` con altura 380px (260px móvil). Tabla de resultados con cabecera `--bg-sunk` y primera columna sticky; en móvil, la tabla se sustituye por lista de tarjetas compactas (mismo contenido, misma información, sin scroll horizontal). |
| 8 | `Expediente.tsx` | Cabecera de expediente con folio mono destacado. Galería de fotos en grid `auto-fill minmax(140px,1fr)` con `--r-md`. Bloques de metadatos en tarjetas. Botón de exportar PDF como secundario. |
| 9 | `Depuracion.tsx` | Tarjetas de métricas arriba (`.metrica` rediseñada). Tabla densa: `td` 13px, hover `--bg-elev-2`, badges de alerta con token semántico + texto. Filtros colapsables en móvil (`<details>` estilizado). |
| 10 | `DepuracionDetalle.tsx` | `ComparadorDuplicados` con tarjetas de 320px, la actual con anillo `--accent`; campos que difieren con fondo `--aviso-bg` **y** punto ámbar. En móvil, comparación en scroll horizontal con indicador de desplazamiento. |
| 11 | `DepuracionCatalogos.tsx` | Tabla con claves de catálogo en `.mono`. Acciones de fila como botones ícono 36px con `title`. |
| 12 | `Correcciones.tsx` | Igual tratamiento que Depuración: métricas + tabla; en móvil, lista de tarjetas. `FormEdicionBeneficiario` con inputs y `fieldset` nuevos. |
| 13 | `Dashboard.tsx` | Grid de métricas `auto-fit minmax(180px,1fr)`. **Las 4 constantes de color de gráfica (`VERDE`, `GRIS`, `AMBAR`, `AZUL`) se sustituyen por lectura de las variables CSS del tema activo** (`getComputedStyle(document.documentElement).getPropertyValue('--accent')`, `--exito`, `--aviso`, `--info`, `--fg-muted`) y las gráficas se vuelven a construir cuando cambia `data-mode`. Ejes, rejilla y leyenda de Chart.js toman `--fg-muted` y `--border`. Cada gráfica dentro de una `.tarjeta`; 1 columna en móvil. |
| 14 | `Usuarios.tsx` | Tabla con rol en `.bb-tag`, estado activo/inactivo con token semántico + texto. `FormUsuario`, `ModalResetPassword` y `ModalPasswordTemporal` con el `.modal` nuevo; en móvil los modales se anclan abajo como hoja. `.password-temporal` rediseñada. |
| 15 | `Solicitudes.tsx` | Filtros en tarjeta. Folio en `.mono` como primera columna. Estados de solicitud con tokens semánticos. En móvil, lista de tarjetas con folio destacado. Botón "Nueva solicitud" como FAB en móvil. |
| 16 | `NuevaSolicitud.tsx` | El formulario largo (Solicitante · Alcance · Actividad · Conceptos · Documentos · Declaraciones) pasa a `fieldset` estilizados con numeración mono, y en escritorio gana un índice lateral pegajoso (`position: sticky`) dentro del contenido con anclas a cada sección. `TablaConceptos` con inputs alineados y totales en mono 600. `ChecklistDocumentos` con filas tipo `.bb-slide-bullet`. `BloqueAlcance` con `.lista-casillas` a 1 columna en móvil y casillas de 22px. Los selectores encadenados (Programa → Subprograma → Componente → Modalidad → Proyecto) se muestran como cadena visual con separadores. **Cero cambios a la lógica de encadenamiento ni a las validaciones.** |
| 17 | `DetalleSolicitud.tsx` | `.folio-grande` rediseñado con etiqueta "FOLIO". Bloques de datos en tarjetas. Los `var(--verde, #0b6b3a)` inline se sustituyen por `var(--accent)` sin fallback hex. **El bloque `@media print` de la carátula se deja intacto** (negro sobre blanco). Botón de imprimir como primario. |
| — | `SinPermiso.tsx` | Pantalla centrada con ícono 48px `--fg-subtle`, mensaje en display 18px y botón de volver. Fondo con rejilla `--grid-line`. |
| — | `CambiarPassword.tsx` | Reusa `.login-caja` rediseñada. Indicador de fuerza de contraseña con `.progreso` (sin cambiar ninguna regla de validación). |

---

## 15.10 Estructura de archivos

```
pwa/
  index.html                       # MODIF: script anti-parpadeo, theme-color, color-scheme, preload
  public/
    fuentes/                       # NUEVO
      Inter-Variable.woff2
      SpaceGrotesk-Variable.woff2
      JetBrainsMono-Variable.woff2
      LEEME.txt                    # origen y licencia (OFL) de cada archivo
  src/
    main.tsx                       # SIN CAMBIOS (sigue importando './styles/global.css')
    styles/
      global.css                   # MODIF: solo @import en orden fijo
      tokens.css                   # NUEVO: primitivos + dark + light + semánticos + alias
      fuentes.css                  # NUEVO: @font-face
      base.css                     # NUEVO: reset, html/body, tipografía, foco, .mono, .sr-solo
      componentes.css              # NUEVO: tarjeta, botón, input, chip, badge, tabla, mensaje, modal…
      cascaron.css                 # NUEVO: franja, sidebar, rail, barra inferior, hoja "Más", toggle
    tema/
      tema.ts                      # NUEVO: modo, persistencia, useTema
      viewport.ts                  # NUEVO: useAncho() con matchMedia
    navegacion/
      menu.ts                      # NUEVO: catálogo de destinos por rol
    componentes/
      Cascaron.tsx                 # NUEVO
      BarraLateral.tsx             # NUEVO
      BarraInferior.tsx            # NUEVO
      HojaMas.tsx                  # NUEVO
      FranjaEstado.tsx             # NUEVO (renombre de BarraEstado.tsx; lógica idéntica)
      ToggleTema.tsx               # NUEVO
      Iconos.tsx                   # NUEVO: SVG inline 24×24, stroke currentColor, width 1.75
      Marca.tsx                    # NUEVO: glifo + wordmark SEDEA
      BarraEstado.tsx              # ELIMINADO (sustituido por FranjaEstado.tsx)
      MenuUsuario.tsx              # MODIF: pierde `usuario-actual`, gana disposición vertical
    rutas.tsx                      # MODIF: Layout() -> <Cascaron />
    pantallas/*.tsx                # MODIF: solo className y estructura de envoltura
```

`global.css` queda exactamente así:

```css
/* Punto de entrada de estilos. El orden importa: tokens antes que todo. */
@import './tokens.css';
@import './fuentes.css';
@import './base.css';
@import './componentes.css';
@import './cascaron.css';
```

**Comandos de desarrollo (sin cambios):**

```
cd pwa
npm run dev         # Vite en http://localhost:5173
npm run typecheck   # tsc --noEmit
npm run build       # vite build -> pwa/dist
npm run preview     # http://localhost:8080
```

**Dependencias npm:** cero altas, cero bajas, cero cambios de versión.
Íconos = SVG inline propios. Fuentes = `.woff2` locales. Modo = `data-mode` + `localStorage`.

---

## 15.11 Accesibilidad

1. Objetivo táctil mínimo **44×44 CSS px** en `< 768px` para todo elemento interactivo
   (botones, links de lista, chips, casillas, celdas de la barra inferior, toggle).
2. `:focus-visible` global: `outline: 2px solid var(--accent); outline-offset: 2px`.
   Se prohíbe `outline: none` sin sustituto visible.
3. `aria-current="page"` en el destino activo del sidebar y de la barra inferior.
4. Landmarks: `<nav aria-label="Navegación principal">` (sidebar),
   `<nav aria-label="Accesos rápidos">` (barra inferior), `<main id="contenido">`,
   `<header>` (franja de estado).
5. Enlace de salto al contenido, visible solo con foco.
6. Trampa de foco en `HojaMas` y en los modales existentes; Escape cierra; el foco vuelve
   al disparador.
7. `@media (prefers-reduced-motion: reduce)`: `animation-duration: .01ms !important;`
   `transition-duration: .01ms !important;` y sin transformaciones de entrada de la hoja.
8. **Ninguna información se transmite solo por color**: el estado de red conserva su texto,
   los badges de alerta conservan su etiqueta, el semáforo GPS conserva su palabra, y los
   campos que difieren en el comparador llevan un punto además del fondo.
9. Contrastes mínimos, medidos con el algoritmo WCAG 2.1 sobre los valores computados:
   `--fg`/`--bg` ≥ 7:1, `--fg-muted`/`--bg` ≥ 4.5:1, texto de botón primario ≥ 4.5:1,
   texto de cada `.mensaje.*` sobre su fondo ≥ 4.5:1, cada estado del semáforo ≥ 4.5:1,
   en **ambos** modos.
10. `lang="es-MX"` en `<html>` se conserva; todo `aria-label` nuevo va en español.

---

## 15.12 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Duplicar `data-testid` entre sidebar y barra inferior rompe los criterios 1-386 | montaje condicional por `useAncho()`, nunca `display:none` (§15.5.2) + criterio 419 |
| `--blanco` seguía siendo `#fff` en dark → texto blanco sobre blanco | `--blanco` se realiasa a `var(--bg-elev)` (§15.3.5) + criterio 426 |
| `DetalleSolicitud.tsx` usa `var(--verde, #0b6b3a)` inline | la capa de alias garantiza que `--verde` siempre resuelve; además se limpian los fallbacks hex |
| Fuentes no disponibles offline | `local()` + archivos propios + fallback `system-ui` + `font-display: swap` (§15.4.2) |
| Parpadeo de tema al recargar | script inline síncrono en `<head>` (§15.6.2) |
| Chart.js con colores fijos ilegibles en dark | lectura desde variables CSS + reconstrucción al cambiar `data-mode` (§15.9 #13) |
| La barra inferior tapa botones de guardar / toasts / controles de Leaflet | `padding-bottom` del `<main>` + `bottom` del `.toast` calculados con la altura de la barra + `env(safe-area-inset-bottom)` |
| El renombre de `BarraEstado.tsx` rompe un import | es el único consumidor (`rutas.tsx`); `typecheck` lo detecta |
| Tabla ancha con scroll horizontal en móvil | en Auditoría, Depuración, Correcciones y Solicitudes la tabla se sustituye por lista de tarjetas en `< 768px`, con el mismo contenido |

---

## 15.13 Assumptions

- **A15-1** La paleta **no** se adapta a verde SEDEA. Naranja `#FF5A1F` + neutros ink son la base;
  el azul de marca queda restringido a `--info` (mensajes informativos). Decisión explícita del
  cliente, no se reabre.
- **A15-2** Los verdes que sobreviven (`--exito`, `.semaforo.verde`, `.badge.capturado`, punto de
  "En línea") son **semánticos**, no de marca. No se convierten a naranja.
- **A15-3** No se usa el logotipo de IntechQRO (`logo.jsx` es la marca de otra empresa) ni se
  inventa un escudo institucional. La marca del cascarón es tipográfica: glifo geométrico
  propio (cuadrado con esquina achaflanada y una barra en `--accent`) + wordmark "SEDEA" en
  Space Grotesk 600, con subtítulo mono "CAMPO 2026". Si el cliente entrega el escudo oficial,
  se sustituye solo el glifo.
- **A15-4** Modo inicial por defecto = preferencia del sistema. Si el sistema no expresa
  preferencia, `dark` (la referencia es primordialmente un design system de data-center y la app
  se usa en campo, donde el modo oscuro consume menos batería en OLED).
- **A15-5** Clave de `localStorage` para el tema: `sedea.tema`. Para el estado del sidebar:
  `sedea.lateral`. Prefijo `sedea.` reservado para preferencias de UI; no colisiona con las
  claves de IndexedDB ni con las de sesión.
- **A15-6** Breakpoints 768 / 1024 (no los 980 del brandbook), para que el viewport por defecto
  de Playwright (1280×720) caiga inequívocamente en escritorio y no altere los criterios 1-386.
- **A15-7** `BarraEstado.tsx` se **renombra** a `FranjaEstado.tsx` en vez de conservarse con el
  nombre viejo: su responsabilidad cambia (deja de ser "barra de navegación + estado" para ser
  solo "franja de estado") y mantener el nombre viejo confundiría. La clase CSS `.barra-estado`
  sí se conserva como alias, y toda su lógica se copia sin modificar una línea.
- **A15-8** `data-testid="usuario-actual"` se traslada de `MenuUsuario` a `FranjaEstado` para
  garantizar que exista y sea visible en los 3 viewports. El testid no cambia de nombre.
- **A15-9** Se agregan 3 `data-testid` de navegación que hoy no existen
  (`nav-beneficiarios`, `nav-sync`, `nav-auditoria`) porque el sidebar sí expone esos destinos.
  Son aditivos y no afectan ningún criterio previo.
- **A15-10** En móvil, las tablas de gestión se sustituyen por listas de tarjetas.
  Se conserva **exactamente la misma información** (mismos campos, mismos textos, mismos
  `data-testid` de fila); cambia solo la disposición. Los criterios previos que consultan esas
  tablas se ejecutan en el viewport por defecto (escritorio) y no se ven afectados.
- **A15-11** Los `.woff2` de Inter, Space Grotesk y JetBrains Mono se distribuyen bajo SIL Open
  Font License 1.1, que permite el alojamiento propio y la redistribución. Se documenta en
  `pwa/public/fuentes/LEEME.txt`.
- **A15-12** No se implementa un tercer modo "automático" en la UI del toggle. El toggle es
  binario (claro ↔ oscuro); el seguimiento del sistema es el estado inicial implícito y se
  abandona en cuanto el usuario elige.
- **A15-13** El resplandor naranja (`--shadow-glow`) y el patrón de rejilla se limitan a `/login`
  y `/sin-permiso`. Dentro de la app son ruido visual sobre formularios de captura.
- **A15-14** La carátula imprimible de `DetalleSolicitud` no se tematiza: sigue siendo negra sobre
  blanca en cualquier modo, porque es un documento oficial que se firma en papel.

---

## 15.14 Rubric de evaluación — Build 9 (criterios 387-446)

> Los criterios 1-386 de las secciones 1-14 siguen vigentes y deben seguir pasando **sin cambio de
> enunciado**. Verificables con `grep`, `git diff` y Playwright.
> Los criterios visuales se evalúan en los 3 viewports de referencia: **390×844**, **820×1180**
> y **1440×900**, salvo que se indique otro.
> Las mediciones de contraste usan la fórmula de luminancia relativa de WCAG 2.1 sobre los
> valores devueltos por `getComputedStyle`.

### Tokens y paleta

387. Existe `pwa/src/styles/tokens.css` y declara en `:root` los literales `#FF5A1F`
     (`--brand-orange`), `#1E40FF` (`--brand-blue`), la escala completa `--ink-1000` … `--ink-0`,
     los seis radios `--r-xs` … `--r-2xl` y los tres tokens `--font-display`, `--font-body`,
     `--font-mono`.
388. `tokens.css` contiene un bloque `[data-mode="dark"]` y un bloque `[data-mode="light"]`, y
     ambos definen al menos `--bg`, `--bg-elev`, `--bg-elev-2`, `--fg`, `--fg-muted`, `--border`,
     `--accent`, `--shadow-card` y `--bg-sunk`.
389. Con `document.documentElement.setAttribute('data-mode','dark')`,
     `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()` es `#0A0A0C`
     (case-insensitive); con `'light'` es `#F5F4EE`.
390. Los alias de compatibilidad resuelven en ambos modos: `--verde` computa al mismo valor que
     `--accent`, `--gris-texto` al mismo que `--fg`, `--gris-borde` al mismo que `--border` y
     `--blanco` al mismo que `--bg-elev` (en dark `--blanco` **no** es `#ffffff`).
391. `grep -ri "0b6b3a\|128a4c\|e6f2ea\|d7dce3\|f5f7f9\|b6bec9\|2b6cb0" pwa/src` no devuelve
     ninguna coincidencia fuera del bloque `@media print` de `DetalleSolicitud.tsx`.
392. Existen los 6 archivos `pwa/src/styles/{tokens,fuentes,base,componentes,cascaron,global}.css`
     y `global.css` contiene únicamente comentarios y cinco sentencias `@import` en el orden
     tokens → fuentes → base → componentes → cascaron.
393. `pwa/src/main.tsx` sigue importando exactamente `'./styles/global.css'` y `'leaflet/dist/leaflet.css'`.
394. `--sobre-acento` está definido en ambos modos y la regla del botón primario usa
     `color: var(--sobre-acento)`; el `color` computado de un `button` primario **no** es
     `rgb(255, 255, 255)` en ningún modo.
395. `git diff` sobre `pwa/package.json` no muestra ninguna línea agregada ni eliminada dentro de
     `"dependencies"` ni de `"devDependencies"`: cero dependencias npm nuevas.
396. `grep -ri "fonts.googleapis.com\|fonts.gstatic.com\|use.typekit" pwa/` no devuelve ninguna
     coincidencia; con las peticiones a hosts externos bloqueadas por Playwright
     (`page.route('**://fonts.*/**', r => r.abort())`), la app carga y muestra texto legible.

### Tipografía

397. `getComputedStyle(document.body).fontFamily` contiene `Inter` y contiene además al menos uno
     de `system-ui` o `sans-serif` como fallback final.
398. `getComputedStyle(h1).fontFamily` en cualquier pantalla contiene `Space Grotesk` y un
     fallback de sistema; el `fontSize` computado de `h1` está entre 22px y 28px.
399. En `/solicitudes/:id`, `getComputedStyle('.folio-grande').fontFamily` contiene
     `JetBrains Mono` o `ui-monospace`, y su `fontWeight` computado es 700.
400. Todas las reglas `@font-face` de `pwa/src/styles/fuentes.css` declaran `font-display: swap`
     y su `src` empieza por `local(`.
401. En viewport 390×844, todo `input`, `select` y `textarea` visible en `/login` y en
     `/solicitudes/nueva` tiene `fontSize` computado ≥ 16px.

### Toggle de tema

402. En cada ruta autenticada existe exactamente **un** `[data-testid="toggle-tema"]` visible.
403. Click en `[data-testid="toggle-tema"]` cambia `document.documentElement.dataset.mode` de
     `dark` a `light`; un segundo click lo devuelve a `dark`.
404. Tras cada click, `localStorage.getItem('sedea.tema')` es exactamente el valor de
     `document.documentElement.dataset.mode`.
405. Tras `page.reload()`, `document.documentElement.dataset.mode` conserva el modo elegido, y ese
     atributo ya está presente en el primer `document`ex evaluado tras `domcontentloaded`
     (script anti-parpadeo activo).
406. Con `localStorage` vacío y `colorScheme: 'dark'` emulado, la app arranca con
     `data-mode="dark"`; con `colorScheme: 'light'` emulado, arranca con `data-mode="light"`.
407. Con `localStorage['sedea.tema'] = 'light'` preestablecido y `colorScheme: 'dark'` emulado, la
     app arranca y permanece en `data-mode="light"`.
408. `[data-testid="toggle-tema"]` tiene un `aria-label` no vacío en español y un `aria-pressed`
     de valor `"true"` o `"false"` coherente con el modo activo.
409. El toggle es alcanzable con `Tab` y se activa con `Enter` y con `Space`.
410. `document.querySelector('meta[name=theme-color]').content` es `#0A0A0C` en dark y `#F5F4EE`
     en light; en ningún caso `#0b6b3a`.
411. `/login` (sin sesión) contiene un `[data-testid="toggle-tema"]` visible y funcional.
412. Alternar el tema no genera ninguna petición HTTP (`page.on('request')` no registra nada tras
     el click) ni modifica el contador de `[data-testid="contador-pendientes"]`.

### Cascarón y responsive

413. Existe `pwa/src/componentes/Cascaron.tsx`, `rutas.tsx` lo usa como `element` del layout, y
     `grep -r 'to="/dashboard"\|to="/usuarios"\|to="/solicitudes"' pwa/src/componentes/FranjaEstado.tsx`
     no devuelve nada (la franja ya no navega).
414. Viewport 1440×900: `[data-testid="barra-lateral"]` está visible y su `boundingBox().width`
     está entre 240 y 280 px; `[data-testid="barra-inferior"]` tiene `count() === 0`.
415. Viewport 1440×900: click en `[data-testid="colapsar-lateral"]` deja el sidebar con
     `width` ≤ 80 px, los items siguen teniendo `aria-label` no vacío y siguen siendo clickeables;
     `localStorage['sedea.lateral']` vale `'rail'`; tras `reload()` el sidebar sigue en rail.
416. Viewport 820×1180: `[data-testid="barra-lateral"]` está presente con `width` ≤ 80 px por
     defecto y `[data-testid="barra-inferior"]` tiene `count() === 0`.
417. Viewport 390×844: `[data-testid="barra-inferior"]` está visible, su borde inferior coincide
     con el del viewport, y `[data-testid="barra-lateral"]` tiene `count() === 0`.
418. Viewport 390×844: la barra inferior contiene entre 2 y 5 elementos interactivos, y **todos**
     tienen `boundingBox()` con `width ≥ 44` y `height ≥ 44`.
419. Viewport 390×844: click en `[data-testid="mas-opciones"]` abre `[data-testid="hoja-mas"]`,
     que contiene `[data-testid="nav-cambiar-password"]` y `[data-testid="nav-cerrar-sesion"]`;
     `Escape` la cierra y el foco vuelve al botón.
420. En los 3 viewports y en las rutas `/beneficiarios`, `/dashboard`, `/solicitudes`,
     `/usuarios`, `/depuracion` y `/auditoria` (con el rol correspondiente):
     `document.documentElement.scrollWidth <= window.innerWidth + 1` (sin scroll horizontal
     de página).
421. En cada uno de los 3 viewports, para cada `data-testid` que empieza con `nav-`,
     `page.locator('[data-testid=X]').count()` es ≤ 1.
422. `[data-testid="estado-red"]` es visible en los 3 viewports y su texto sigue siendo
     exactamente `En línea` o `Sin conexión`.
423. `[data-testid="contador-pendientes"]` es visible en los 3 viewports y su texto sigue
     coincidiendo con `/^Pendientes: \d+$/`.
424. `[data-testid="usuario-actual"]` existe y es visible en los 3 viewports.
425. Con `perfil.debe_cambiar_password === true`: no existen `[data-testid="barra-lateral"]` ni
     `[data-testid="barra-inferior"]`, y sí existe `[data-testid="nav-cerrar-sesion"]`
     (el criterio de la §10.8.4 sigue pasando).
426. El destino correspondiente a la ruta actual tiene `aria-current="page"` en el sidebar
     (escritorio/tablet) y en la barra inferior (móvil), y su `color` computado difiere del de los
     destinos inactivos.
427. El DOM contiene `<main>` con `id="contenido"`, un `<nav aria-label="Navegación principal">`
     en escritorio y un `<nav aria-label="Accesos rápidos">` en móvil.
428. Existe un enlace de salto `a[href="#contenido"]` que es el primer elemento enfocable con
     `Tab` y se hace visible al recibir foco.
429. Viewport 390×844 en `/beneficiarios`: el `.toast` (tras disparar una acción que lo muestre)
     no se solapa con `[data-testid="barra-inferior"]` (sus `boundingBox()` no se intersecan).

### Lenguaje visual en las pantallas

430. En las 17 pantallas, todo elemento `.tarjeta` computa `backgroundColor` igual al valor de
     `--bg-elev` del modo activo, `borderRadius` ≥ 12px y `boxShadow` distinto de `none`.
431. En modo dark, ninguna `.tarjeta`, `.modal`, `.metrica` ni `.declaraciones` computa
     `backgroundColor: rgb(255, 255, 255)`.
432. En `/depuracion`, `/correcciones`, `/usuarios` y `/solicitudes` (viewport 1440×900), los `th`
     computan `backgroundColor` igual a `--bg-sunk` y `color` igual a `--fg`, en ambos modos.
433. Viewport 390×844: en `/depuracion` y `/auditoria` no hay ningún `<table>` con
     `scrollWidth > clientWidth` visible; el contenido se presenta como lista de tarjetas.
434. En `/dashboard`, ninguna gráfica usa los literales `#128a4c`, `#b6bec9`, `#c98600` ni
     `#2b6cb0` (`grep` sobre `Dashboard.tsx` vacío); tras alternar el tema, los datasets se
     reconstruyen y los colores de eje/leyenda de Chart.js cambian.
435. En `/auditoria` (390×844), el contenedor `.mapa` mide ≥ 240px de alto y sus controles Leaflet
     no se solapan con `[data-testid="barra-inferior"]`.
436. En `/usuarios` (390×844), al abrir el modal de alta, el `.modal` es visible por completo
     dentro del viewport (o con scroll interno propio) y su ancho es ≤ el ancho del viewport.
437. En `/login` (390×844): `document.documentElement.scrollWidth <= window.innerWidth + 1` y el
     botón de entrar tiene `boundingBox().height ≥ 44`.
438. Viewport 390×844: todo `input`, `select`, `textarea`, `button`, `a.boton` y `.chip` visible
     tiene `boundingBox().height ≥ 44`.
439. Al enfocar por teclado un `button`, un `a` y un `input` en cada modo, el estilo computado
     muestra `outlineStyle !== 'none'` con `outlineWidth ≥ 2px`.
440. El semáforo GPS conserva sus tres clases `.semaforo.verde`, `.semaforo.ambar` y
     `.semaforo.rojo` con sus textos actuales, y ninguna computa el naranja de marca como color
     de texto.

### Contraste accesible en ambos modos

441. En dark: contraste `--fg` sobre `--bg` ≥ 7:1 y `--fg-muted` sobre `--bg` ≥ 4.5:1.
442. En light: contraste `--fg` sobre `--bg` ≥ 7:1 y `--fg-muted` sobre `--bg` ≥ 4.5:1.
443. En ambos modos, el contraste entre el `color` y el `backgroundColor` computados de un
     `button` primario es ≥ 4.5:1.
444. En ambos modos, el contraste texto/fondo de `.mensaje.error`, `.mensaje.aviso`,
     `.mensaje.info` y `.mensaje.exito`, y el de cada `.semaforo.*` y cada `.badge.alerta-*`,
     es ≥ 4.5:1.
445. Ninguna información se transmite solo por color: `[data-testid="estado-red"]` contiene texto,
     cada `.badge.alerta-*` contiene texto, y `.campos-candidato .campo-difiere` incluye un
     indicador no cromático además del fondo.

### No regresión de negocio

446. `git diff --stat` sobre `backend/`, `db/`, `packages/`, `scripts/`,
     `pwa/nginx.conf.template`, `pwa/Dockerfile`, `pwa/vite.config.ts`, `pwa/src/api/`,
     `pwa/src/db/` y `pwa/src/sync/` está **vacío**; y la suite completa de criterios **1-386**
     vuelve a pasar sobre el build con el rediseño aplicado.

# 16. EXTENSIÓN — Administración autoservicio de catálogos jerárquicos (Build 10)

> Esta sección **extiende** `SPEC.md`. No sustituye, no reinterpreta y no renegocia **nada** de las
> secciones 1–15. Todo lo definido antes sigue vigente palabra por palabra y los criterios **1–446**
> siguen siendo obligatorios. Mismo monorepo, mismo `docker-compose.yml`, mismos 3 servicios
> (`db`, `backend`, `pwa`). **Cero dependencias npm nuevas.** No se toca `pwa/nginx.conf.template`,
> ni el mecanismo `BACKEND_HOST`/`BACKEND_PORT`, ni el flujo offline de campo
> (`pwa/src/sync/*`, `pwa/src/db/indexeddb.ts`, service worker). Código comentado en español,
> UI en español.

---

## 16.1 Objetivo

Dar **autoservicio total** sobre los 7 catálogos jerárquicos de ventanilla
(`programas` → `subprogramas` → `componentes` → `modalidades` → `proyectos` →
`tipos_apoyo` → `documentos_requeridos`) para que `admin` y `editor_datos` puedan dar de alta el
próximo programa, proyecto o concepto de apoyo **sin escribir una línea de SQL y sin un deploy de
código**, tal como hoy es obligatorio hacerlo (Casas Ejidales se creó con la migración `014`,
PET/Modalidad con la `015`).

---

## 16.2 Scope

**SÍ incluye:**

1. Un router nuevo `backend/src/rutas/catalogosAdmin.ts` con un **patrón genérico por entidad**
   (`/api/admin/catalogos/:entidad`), 6 endpoints (**E49–E54**), sobre las 7 tablas ya existentes.
2. Validación explícita de clave duplicada, padre inexistente/inactivo, campos inmutables y
   coherencia componente↔modalidad, siempre con `4xx` y `codigo` estable — **nunca un 500**.
3. Baja lógica (`activo = false`) **sin cascada**, con reactivación.
4. Pantalla nueva `/catalogos` (árbol jerárquico + formularios de alta/edición por entidad) y
   `/catalogos/documentos` (reglas de `documentos_requeridos`), en el lenguaje visual del Build 9.
5. Entrada nueva en `pwa/src/navegacion/menu.ts` (destino #9, `nav-catalogos`).
6. 4 acciones nuevas de `auditoria_log.accion` (columna TEXT libre, el esquema **no** cambia).
7. Rubric extendido: criterios **447–503**.

**NO incluye:**

- **Ninguna migración.** Ver §16.3: este build **no crea** `db/migrations/016_*.sql` ni ningún otro
  archivo SQL. No agrega tablas, columnas, constraints ni índices.
- Modificación de las migraciones `001`–`015` ni de los seeds `001`–`006` (ya aplicados en producción).
- `DELETE` físico de cualquier fila de catálogo, en cualquier endpoint.
- Cambio al algoritmo del folio (§12.5), a `solicitudes`, `solicitud_conceptos`,
  `solicitud_documentos`, ni a los endpoints E40–E48.
- Cambio al motor de coincidencia de `documentos_requeridos` (§12.6.2): este build **edita las
  reglas**, no cambia cómo se evalúan.
- Administración de `ventanillas`, `municipios`, `direcciones_regionales`, `usuarios` ni `catalogos`
  (tabla genérica). Quedan fuera: `ventanillas` y `municipios` se siguen sembrando; `usuarios` ya
  tiene su pantalla (§10.8, §11.6, §12.8.4).
- Cambio al flujo offline de campo, a `pwa/src/sync/*`, al service worker ni a `nginx.conf.template`.
- Dependencias npm nuevas o cambios a `docker-compose.yml`.
- Importación masiva de catálogos por CSV/Excel (el importador CLI de §8 no se toca).

**Protocolo de evaluación (obligatorio para el Evaluator).** Los criterios 447–503 crean filas de
catálogo nuevas y por diseño **no se borran** (D45). Por eso la verificación se corre en este orden:

1. BD limpia (`docker compose down -v && docker compose up -d`), `npm run migrar && npm run sembrar`.
2. Se verifican los criterios **1–446** (estado sembrado de fábrica).
3. Se verifican los criterios **447–503** en el mismo despliegue.
4. El criterio **503** exige **recrear la BD desde cero** y volver a pasar 1–446.

Adicionalmente el criterio **502** obliga a que el E2E de alta completa **deje desactivado** el
componente y el proyecto que creó, para no alterar los conteos de catálogo del Build 8.

---

## 16.3 Modelo de datos — **cero migraciones**

**Decisión explícita: este build NO agrega ninguna migración.** Se revisaron las 7 tablas contra las
migraciones `002`, `012` y `015` y **todas las restricciones que el módulo necesita ya existen**:

| Tabla | Origen | Unicidad ya existente | ¿Falta algo? |
|---|---|---|---|
| `programas` | `012` | `clave TEXT UNIQUE NOT NULL` | No |
| `subprogramas` | `012` | `UNIQUE (programa_id, clave)` | No |
| `componentes` | `012` | `clave TEXT UNIQUE NOT NULL` | No |
| `modalidades` | `015` | `clave TEXT UNIQUE NOT NULL` | No |
| `proyectos` | `012` + `015` | `clave TEXT UNIQUE NOT NULL` | No |
| `tipos_apoyo` | `002` | `clave TEXT UNIQUE NOT NULL` | No |
| `documentos_requeridos` | `012` | — (no tiene `clave`; su identidad es `requisito`) | No |

Los índices de lectura que el árbol usa también existen: `idx_modalidades_componente`,
`idx_docsreq_activo`, y los GIN sobre `documentos_requeridos.componentes` y `.tipos_persona`.
Los listados restantes son de decenas a ~200 filas: un `seq scan` es correcto y **no se agrega
ningún índice nuevo** para no tocar producción. Si en el futuro un catálogo creciera a miles de
filas, el índice se agregaría en un build posterior, no aquí.

### 16.3.1 Esquema exacto que expone cada entidad

Copiado literal de §12.3.1 y §14.3 — **no se inventa ninguna columna**.

| Entidad (`:entidad`) | Tabla | Columnas gestionables | Padre (FK) |
|---|---|---|---|
| `programas` | `programas` | `clave`, `nombre`, `activo` | — |
| `subprogramas` | `subprogramas` | `programa_id`, `clave`, `nombre`, `activo` | `programas.id` |
| `componentes` | `componentes` | `clave`, `nombre`, `activo` | — |
| `modalidades` | `modalidades` | `clave`, `nombre`, `componente_id`, `activo` | `componentes.id` |
| `proyectos` | `proyectos` | `clave`, `nombre`, `prefijo_folio`, `componente_id`, `modalidad_id`, `activo` | `componentes.id` (nullable), `modalidades.id` (nullable) |
| `tipos_apoyo` | `tipos_apoyo` | `clave`, `nombre`, `categoria`, `unidad_medida`, `activo` | — |
| `documentos_requeridos` | `documentos_requeridos` | `requisito`, `componentes`, `tipos_persona`, `proyecto_id`, `apoyo_id`, `apoyo_etiquetas`, `apoyo_excluir_id`, `apoyo_excluir_etiquetas`, `orden`, `activo` | — (reglas transversales) |

`id` nunca es escribible. `activo` nunca se escribe por `POST`/`PATCH`: solo por **E53**.

### 16.3.2 Valores nuevos de `auditoria_log.accion`

Columna `TEXT` libre; el esquema **no cambia** (igual que §12.3.3).

| `accion` | `entidad` | `entidad_id` | `detalle` (JSONB) |
|---|---|---|---|
| `catalogo_creado` | nombre de la tabla (`programas`, `proyectos`, …) | id de la fila creada | `{entidad, clave, nombre, padre_id, campos}` |
| `catalogo_actualizado` | ídem | id de la fila | `{entidad, clave, cambios:{campo:{anterior,nuevo}}}` |
| `catalogo_estado_cambiado` | ídem | id de la fila | `{entidad, clave, activo_anterior, activo_nuevo, hijos_activos:{modalidades:N, proyectos:N}}` |
| `regla_documento_creada` | `documentos_requeridos` | id de la regla | `{requisito, componentes, tipos_persona, proyecto_id, apoyo_id, apoyo_excluir_id}` |

`detalle` nunca contiene CURP ni contraseñas (regla vigente de §12.3.3).

---

## 16.4 Decisiones de producto (implementar tal cual, no preguntar)

- **D45. Nunca se borra: se desactiva.** No existe ningún handler `DELETE` en el router nuevo.
  Un `DELETE /api/admin/catalogos/programas/1` debe devolver **404** (Fastify no tiene la ruta
  registrada). Mismo patrón que usuarios y catálogos existentes.
- **D46. La desactivación NO es en cascada.** Desactivar un `componente` deja sus `modalidades` y
  `proyectos` con `activo = true` en la BD. El único efecto es que el padre inactivo deja de
  aparecer en E40 y, por tanto, la rama completa deja de ser **elegible** en ventanilla. Motivo:
  evitar desactivaciones masivas accidentales e irreversibles-por-inspección (nadie sabría qué hijos
  ya estaban inactivos antes). La UI **avisa** con el conteo de hijos activos, pero **no** los toca.
- **D47. `prefijo_folio` es INMUTABLE.** Solo se define en el alta de un proyecto. `PATCH` que lo
  incluya con un valor distinto al actual ⇒ **422 `campo_inmutable`**. Para corregir un prefijo mal
  puesto: desactivar el proyecto y crear uno nuevo. Motivo: el prefijo ya está impreso en folios
  emitidos (`PEO-SJR-AME-0001-26`) y en `solicitud_folios (prefijo, clave_regional, siglas_municipio,
  anio)`; cambiarlo rompería la unicidad histórica del folio.
- **D48. `clave` también es INMUTABLE en edición**, para las 6 entidades que la tienen. Motivo: los
  seeds y migraciones idempotentes hacen `ON CONFLICT (clave) DO UPDATE`; renombrar una clave desde
  la UI provocaría que el siguiente `npm run sembrar` recreara un duplicado silencioso. `PATCH` con
  `clave` distinta ⇒ **422 `campo_inmutable`**. Enviar la **misma** clave es tolerado (no-op).
- **D49. Las claves se normalizan a mayúsculas** (`trim` + `toUpperCase`) en el alta. Todas las claves
  existentes (`PRG-2026`, `SUB-IP`, `TR`, `PET`, `MOD-PEPFO`, `PEO`, `AP-012`, `CASAS-EJIDALES`) ya
  cumplen, así que no hay migración de datos.
- **D50. Pantalla EN LÍNEA, no offline-first.** Igual que `/depuracion`, `/dashboard` y `/solicitudes`
  (D32): sin Dexie, sin cola de sync. Sin red muestra
  *"Esta sección requiere conexión a internet."*
- **D51. Roles: `admin` y `editor_datos`.** Mismos que ya administran staging, correcciones y
  usuarios. `capturista`, `auditor` y `ventanilla` ⇒ **403 `rol_no_autorizado`** con mensaje
  *"Tu rol no puede administrar catálogos."*
- **D52. Sin alcance por Regional/Componente aquí.** Los catálogos son estatales; un `editor_datos`
  con `regional_id` asignada administra el catálogo completo. El alcance de §12 solo aplica a
  solicitudes.
- **D53. Sin reordenamiento drag & drop.** El orden de las reglas de documentos se edita por el campo
  numérico `orden`, tal como está en la tabla.

---

## 16.5 Contrato de endpoints (E49–E54)

Router nuevo: `backend/src/rutas/catalogosAdmin.ts`, registrado con prefijo **`/api/admin/catalogos`**.
El prefijo `/api/admin/…` es nuevo y **no colisiona** con el `/api/catalogos` existente
(`backend/src/rutas/catalogos.ts`), que se deja intacto.

Formato de error vigente del proyecto: `{"error":{"codigo":"…","mensaje":"…"}}`.
Todos requieren `Authorization: Bearer <jwt>`; sin token ⇒ **401**.
Guardia de rol: `app.requiereRol('admin','editor_datos')` (plugin `rbac` existente, sin cambios).

| # | Método | Ruta | Descripción |
|---|---|---|---|
| E49 | GET | `/api/admin/catalogos/arbol` | Árbol jerárquico completo con conteos |
| E50 | GET | `/api/admin/catalogos/:entidad` | Listado paginado/filtrado de una entidad |
| E51 | POST | `/api/admin/catalogos/:entidad` | Alta |
| E52 | PATCH | `/api/admin/catalogos/:entidad/:id` | Edición (sin `activo`, sin campos inmutables) |
| E53 | POST | `/api/admin/catalogos/:entidad/:id/estado` | Activar / desactivar |
| E54 | GET | `/api/admin/catalogos/referencias` | Opciones para los `<select>` de los formularios |

`:entidad` ∈ `programas | subprogramas | componentes | modalidades | proyectos | tipos_apoyo |
documentos_requeridos`. Cualquier otro valor ⇒ **404 `entidad_desconocida`**
(*"No existe el catálogo solicitado."*).

### 16.5.1 Patrón genérico

`backend/src/servicios/catalogosAdmin.ts` define un **registro de entidades** (una sola fuente de
verdad), y las 4 rutas mutantes son genéricas sobre él. No se escribe un handler por tabla.

```ts
// Registro unico de catalogos administrables (build 10).
export interface DefinicionCatalogo {
  tabla: string;                    // nombre real de la tabla
  etiqueta: string;                 // titulo en la UI, en espanol
  campoClave: 'clave' | null;       // null en documentos_requeridos
  camposTexto: string[];            // columnas TEXT editables
  camposEnteros: string[];          // columnas INTEGER editables
  camposArreglo: string[];          // columnas TEXT[] editables
  padres: { campo: string; tabla: string; obligatorio: boolean }[];
  inmutables: string[];             // campos rechazados en PATCH
  esquemaAlta: ZodObject;           // .strict()
  esquemaEdicion: ZodObject;        // .strict()
  hijos: { entidad: string; campo: string }[]; // para el conteo de la baja
}
```

Esquemas Zod en `packages/shared/src/catalogos.ts` (archivo **nuevo**; no se toca
`packages/shared/src/solicitudes.ts`). Todos `.strict()`: un campo desconocido ⇒
**422 `payload_invalido`**.

### 16.5.2 E49 — `GET /api/admin/catalogos/arbol`

Query: `?incluir_inactivos=true|false` (default `false`).

`200`:

```json
{
  "programas": [
    {
      "id": 1, "clave": "PRG-2026", "nombre": "Apoyo al Campo Queretano 2026", "activo": true,
      "subprogramas": [
        { "id": 1, "clave": "SUB-IP", "nombre": "Impulso a la Productividad", "activo": true, "programa_id": 1 }
      ]
    }
  ],
  "componentes": [
    {
      "id": 4, "clave": "PET", "nombre": "Proyectos Estratégicos Territoriales", "activo": true,
      "modalidades": [
        {
          "id": 1, "clave": "MOD-PEPFO", "nombre": "Proyectos Estratégicos Productivos y para el Fortalecimiento Organizativo",
          "componente_id": 4, "activo": true,
          "proyectos": [
            { "id": 1, "clave": "PEO", "nombre": "…", "prefijo_folio": "PEO", "componente_id": 4, "modalidad_id": 1, "activo": true }
          ]
        }
      ],
      "proyectos_sin_modalidad": []
    }
  ],
  "proyectos_huerfanos": [],
  "conteos": {
    "programas": 1, "subprogramas": 1, "componentes": 4, "modalidades": 1,
    "proyectos": 1, "tipos_apoyo": 153, "documentos_requeridos": 42
  }
}
```

- `proyectos_sin_modalidad`: proyectos con `componente_id` pero `modalidad_id IS NULL`.
- `proyectos_huerfanos`: proyectos con `componente_id IS NULL` (caso legítimo, Assumption 45).
- `conteos` cuenta **solo activos** cuando `incluir_inactivos=false`.
- La rama `programas`/`subprogramas` y la rama `componentes`/`modalidades`/`proyectos` se muestran
  **por separado**: en el esquema real (§12.3.1/§14.3) los `componentes` **no** tienen FK a
  `subprogramas`; la relación programa↔componente solo existe a nivel de una `solicitud`. Esto se
  documenta en la UI con una nota, y **no se inventa una FK que no está en la BD**.

### 16.5.3 E50 — `GET /api/admin/catalogos/:entidad`

Query: `?incluir_inactivos` (bool, default `false`), `?padre_id` (entero, filtra por la FK padre de
la entidad), `?q` (texto, busca en `clave`/`nombre`/`requisito`, sin acentos y sin distinguir
mayúsculas, usando la normalización ya existente de §8.5.1), `?pagina` (default 1),
`?por_pagina` (default 50, máx 200).

`200`:

```json
{ "datos": [ { "id": 1, "clave": "PRG-2026", "nombre": "…", "activo": true } ],
  "total": 1, "pagina": 1, "por_pagina": 50 }
```

Orden: `clave` ascendente (`orden, requisito` para `documentos_requeridos`).
Para `documentos_requeridos` cada fila incluye además los campos resueltos legibles
`apoyo_clave`, `apoyo_excluir_clave`, `proyecto_clave` (o `null`), para que la tabla se lea sin
resolver ids a mano.

### 16.5.4 E51 — `POST /api/admin/catalogos/:entidad`

Body Zod `.strict()` por entidad. `activo` **no se acepta** (toda alta nace activa).

| Entidad | Body |
|---|---|
| `programas` | `{clave, nombre}` |
| `subprogramas` | `{programa_id, clave, nombre}` |
| `componentes` | `{clave, nombre}` |
| `modalidades` | `{clave, nombre, componente_id}` |
| `proyectos` | `{clave, nombre, prefijo_folio, componente_id?, modalidad_id?}` |
| `tipos_apoyo` | `{clave, nombre, categoria?, unidad_medida?}` |
| `documentos_requeridos` | `{requisito, componentes?, tipos_persona?, proyecto_id?, apoyo_id?, apoyo_etiquetas?, apoyo_excluir_id?, apoyo_excluir_etiquetas?, orden?}` |

**Reglas de validación (en este orden, todas antes de tocar la BD salvo la de unicidad):**

1. `clave`: `z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/)` tras `toUpperCase()`.
2. `nombre` / `requisito`: `z.string().trim().min(3).max(300)`.
3. `prefijo_folio`: `z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/)` — obligatorio en
   `proyectos`. Un valor como `"peo1"` o `"P"` ⇒ **422 `payload_invalido`**.
4. `tipos_persona`: cada elemento ∈ `{'fisica','moral','grupo'}`; si no ⇒
   **422 `tipo_persona_invalido`**.
5. `componentes` (array de `documentos_requeridos`): cada elemento debe ser la `clave` de un
   componente **existente**; si no ⇒ **422 `componente_invalido`**.
6. `orden`: `z.number().int().min(0).max(9999)`, default `0`.
7. **Padre obligatorio**: si la FK es `NOT NULL` (`subprogramas.programa_id`,
   `modalidades.componente_id`) y no existe la fila ⇒ **422 `padre_invalido`**
   (*"El programa indicado no existe."*). Si existe pero `activo = false` ⇒
   **422 `padre_inactivo`** (*"No se puede crear bajo un componente desactivado."*).
8. **Padre opcional** (`proyectos.componente_id`, `proyectos.modalidad_id`,
   `documentos_requeridos.proyecto_id`, `.apoyo_id`, `.apoyo_excluir_id`): si viene con valor, se
   aplican las mismas dos reglas; si viene `null`/ausente, se guarda `NULL`.
9. **Coherencia componente↔modalidad** en `proyectos`: si vienen ambos y
   `modalidades.componente_id !== componente_id` ⇒ **422 `modalidad_no_corresponde_componente`**.
   Si viene `modalidad_id` sin `componente_id`, el backend **deriva** `componente_id` de la modalidad.
10. **Unicidad**: se consulta la clave antes del `INSERT`; si ya existe ⇒ **409 `clave_duplicada`**
    (*"Ya existe un registro con la clave X."*). Además, el `INSERT` va envuelto en un
    `try/catch` que traduce el error `23505` de Postgres al **mismo 409** — un carrera concurrente
    **jamás** produce un 500. Para `subprogramas` la unicidad es por par
    `(programa_id, clave)`: la misma clave bajo **otro** programa se acepta.
11. `documentos_requeridos` no tiene `clave`: se rechaza con **409 `requisito_duplicado`** si ya
    existe una regla **activa** con el mismo `requisito` normalizado **y** el mismo
    `(componentes, tipos_persona, proyecto_id, apoyo_id)`.

`201`:

```json
{ "entidad": "proyectos",
  "registro": { "id": 2, "clave": "DEM", "nombre": "…", "prefijo_folio": "DEM",
                "componente_id": 5, "modalidad_id": 2, "activo": true } }
```

Se escribe `auditoria_log` con `accion='catalogo_creado'` (o `regla_documento_creada` para
`documentos_requeridos`) usando el plugin de auditoría existente, **dentro de la misma transacción**.

### 16.5.5 E52 — `PATCH /api/admin/catalogos/:entidad/:id`

Body Zod `.strict()` con **todos los campos opcionales**, mínimo uno presente
(si el body queda vacío ⇒ **422 `payload_invalido`**).

**Campos rechazados siempre (`inmutables`):**

| Entidad | Inmutables |
|---|---|
| todas las que tienen `clave` | `clave` (D48) |
| `proyectos` | `clave`, **`prefijo_folio`** (D47) |
| todas | `id`, `activo` (se cambia solo por E53) |

Enviar un inmutable con un valor **distinto** al actual ⇒ **422 `campo_inmutable`**, con mensaje
específico. Para `prefijo_folio` el mensaje es literal:

> `El prefijo de folio no se puede modificar. Desactiva el proyecto y da de alta uno nuevo.`

Enviar el inmutable con el **mismo** valor actual es un no-op tolerado (200), para que la UI pueda
mandar el objeto completo sin fallar.

Otros errores: **404 `registro_no_encontrado`** si el `:id` no existe en esa entidad;
las mismas reglas 1–9 de E51 para los campos que sí vienen.

`200`: `{ "entidad": "…", "registro": {…} }` con la fila ya actualizada.
Auditoría: `catalogo_actualizado` con `cambios:{campo:{anterior,nuevo}}` **solo** de los campos que
realmente cambiaron (si nada cambió, no se escribe fila de auditoría).

### 16.5.6 E53 — `POST /api/admin/catalogos/:entidad/:id/estado`

Body: `{"activo": true|false}` (Zod `.strict()`, `activo` obligatorio booleano).

- **Desactivar** (`false`): `UPDATE … SET activo = false WHERE id = :id`.
  **Ni un solo `UPDATE` toca las tablas hijas** (D46). La respuesta informa qué quedó colgando:

  ```json
  { "entidad": "componentes", "registro": {"id":5,"clave":"DEM-C","activo":false},
    "hijos_activos": { "modalidades": 1, "proyectos": 1 },
    "aviso": "Se desactivó el componente. Sus 1 modalidad y 1 proyecto siguen activos pero ya no serán seleccionables en ventanilla." }
  ```

  `hijos_activos` se calcula con la lista `hijos` del registro de entidades:
  `programas → subprogramas`, `componentes → modalidades` y `componentes → proyectos`,
  `modalidades → proyectos`, `tipos_apoyo → documentos_requeridos` (por `apoyo_id`),
  `proyectos → documentos_requeridos` (por `proyecto_id`). Las entidades sin hijos devuelven `{}`.

- **Reactivar** (`true`): si la entidad tiene un padre y ese padre está `activo = false` ⇒
  **409 `padre_inactivo`** (*"Reactiva primero el componente al que pertenece."*).
  Si no, `UPDATE … SET activo = true`.

- Es **idempotente**: poner `activo=false` sobre una fila ya inactiva devuelve `200` sin escribir
  auditoría.

Auditoría: `catalogo_estado_cambiado`.

### 16.5.7 E54 — `GET /api/admin/catalogos/referencias`

Alimenta los `<select>` de los formularios. Devuelve **todas** las filas (activas e inactivas, con
`activo` explícito) para que la UI pueda marcar una opción inactiva como no elegible sin perder el
valor guardado.

```json
{
  "programas":   [{"id":1,"clave":"PRG-2026","nombre":"…","activo":true}],
  "componentes": [{"id":4,"clave":"PET","nombre":"…","activo":true}],
  "modalidades": [{"id":1,"clave":"MOD-PEPFO","nombre":"…","componente_id":4,"activo":true}],
  "proyectos":   [{"id":1,"clave":"PEO","nombre":"…","prefijo_folio":"PEO","componente_id":4,"modalidad_id":1,"activo":true}],
  "tipos_apoyo": [{"id":153,"clave":"CASAS-EJIDALES","nombre":"Casas Ejidales","unidad_medida":"obra","activo":true}],
  "tipos_persona": [
    {"clave":"fisica","nombre":"Persona física"},
    {"clave":"moral","nombre":"Persona moral sin fines de lucro"},
    {"clave":"grupo","nombre":"Grupo de productores"}
  ]
}
```

### 16.5.8 Efecto sobre los endpoints existentes

**Ninguno se modifica.** E40 (`GET /api/solicitudes/catalogos`) ya filtra por `activo = true`, así
que una entidad creada aquí aparece en ventanilla **de inmediato** y una desactivada desaparece,
sin cambiar una línea de `backend/src/rutas/solicitudes.ts`. Igual para E41: el motor de
coincidencia ya lee `documentos_requeridos WHERE activo`.

---

## 16.6 Pantallas nuevas

Lenguaje visual del **Build 9** (§15): tokens de `pwa/src/styles/tokens.css`, tema dual, cascarón
`Cascaron.tsx` con `BarraLateral`/`BarraInferior`. **No se crean estilos nuevos de color, sombra ni
tipografía**: se reutilizan las clases existentes (`.tarjeta`, `.tabla`, `.campo`, `.mensaje`,
`.boton`, `.boton.secundario`, `.chip`, `.modal`). Solo se agrega un bloque acotado
`pwa/src/styles/catalogos.css` con el layout de dos columnas del árbol y la sangría de los nodos,
usando exclusivamente variables ya definidas (`--espacio-*`, `--color-*`, `--radio-*`).

### 16.6.1 Navegación

`pwa/src/navegacion/menu.ts` — **destino #9**, aditivo (los 8 anteriores conservan `id`, ruta,
`data-testid`, roles, grupo e ícono exactos):

| # | `id` | Ruta | `data-testid` | Roles | Grupo | Ícono |
|---|---|---|---|---|---|---|
| 9 | `catalogos` | `/catalogos` | `nav-catalogos` | admin, editor_datos | Administración | capas |

Reparto en la barra inferior (§15.5.6): `admin` y `editor_datos` ya tienen 4 celdas ocupadas, así
que **Catálogos va a "Más"** en ambos. Los roles `capturista`, `auditor` y `ventanilla` **no ven la
entrada**. El ícono `capas` se agrega a `pwa/src/componentes/Iconos.tsx` como SVG inline
`currentColor`, igual que los 8 existentes.

`pwa/src/rutas.tsx` — 2 rutas nuevas dentro de `<Cascaron>`, con la constante ya existente
`USUARIOS = ['admin', 'editor_datos']` renombrada conceptualmente a nivel de comentario
(la constante **no se toca**, se reutiliza tal cual):

```tsx
<Route path="/catalogos"            element={<RutaProtegida roles={USUARIOS}><Catalogos /></RutaProtegida>} />
<Route path="/catalogos/documentos" element={<RutaProtegida roles={USUARIOS}><CatalogoDocumentos /></RutaProtegida>} />
```

### 16.6.2 `/catalogos` — `pwa/src/pantallas/Catalogos.tsx`

Contenedor `[data-testid="pantalla-catalogos"]`. Título `<h1>Catálogos del programa</h1>`.
Layout de 2 columnas en ≥1024px (árbol 40% / panel 60%), apiladas en móvil.

**Cabecera**

- `[data-testid="toggle-incluir-inactivos"]` — checkbox "Mostrar desactivados"; recarga E49/E50.
- `[data-testid="link-reglas-documentos"]` — enlace a `/catalogos/documentos`.
- Nota fija: *"Los componentes cuelgan del programa a nivel de solicitud; el catálogo los administra
  como dos ramas independientes."*
- Sin red: `[data-testid="aviso-sin-conexion"]` con *"Esta sección requiere conexión a internet."*

**Columna izquierda — `pwa/src/componentes/ArbolCatalogos.tsx`**
(`[data-testid="arbol-catalogos"]`)

```
▸ Programas                                        [+ Nuevo programa]
  ▸ PRG-2026 · Apoyo al Campo Queretano 2026       [editar] [desactivar]
      · SUB-IP · Impulso a la Productividad        [editar] [desactivar]
                                                   [+ Nuevo subprograma]
▸ Componentes                                      [+ Nuevo componente]
  ▸ PET · Proyectos Estratégicos Territoriales     [editar] [desactivar]
      ▸ MOD-PEPFO · Proyectos Estratégicos…        [editar] [desactivar]
          · PEO · Proyectos Estratégicos…          [editar] [desactivar]
                                                   [+ Nuevo proyecto]
                                                   [+ Nueva modalidad]
  ▸ TR · Tecnificación del Riego                   [editar] [desactivar]
▸ Conceptos de apoyo (153)                         [+ Nuevo concepto]
  (lista paginada con buscador, E50 sobre tipos_apoyo)
```

- `data-testid` por nodo: `nodo-<entidad>-<id>` (ej. `nodo-proyectos-1`).
- Fila inactiva: clase `.inactivo` + `[data-testid="chip-inactivo"]` con el texto `Desactivado`,
  y el botón cambia a `[data-testid="btn-reactivar"]`.
- Botones: `[data-testid="btn-nuevo-<entidad>"]`, `[data-testid="btn-editar-<entidad>-<id>"]`,
  `[data-testid="btn-desactivar-<entidad>-<id>"]`.
- Los nodos son expandibles/colapsables (estado local, sin persistir).

**Columna derecha — `pwa/src/componentes/FormCatalogo.tsx`**
(`[data-testid="form-catalogo"]`)

Un solo componente controlado por `{entidad, modo:'alta'|'edicion', registro}`. Renderiza los campos
del registro de entidades de §16.5.1:

| `data-testid` | Campo | Notas |
|---|---|---|
| `input-clave` | `clave` | En `modo='edicion'`: `readOnly` + `disabled` + `aria-readonly="true"` y leyenda `[data-testid="leyenda-clave-inmutable"]` = *"La clave no se puede modificar."* |
| `input-nombre` | `nombre` | siempre editable |
| `input-prefijo-folio` | `prefijo_folio` (solo `proyectos`) | En `modo='alta'`: `<input maxLength={5}>` editable, se muestra en mayúsculas al escribir. En `modo='edicion'`: `readOnly` + `disabled` + `[data-testid="leyenda-prefijo-inmutable"]` = *"El prefijo de folio no se puede modificar. Desactiva el proyecto y da de alta uno nuevo."* |
| `select-padre-programa` | `programa_id` | solo `subprogramas`; opciones activas |
| `select-padre-componente` | `componente_id` | `modalidades` (obligatorio), `proyectos` (opcional) |
| `select-padre-modalidad` | `modalidad_id` | solo `proyectos`; se filtra al componente elegido con la función ya existente `modalidadesDeComponente` de `@sedea/shared` (§14.7) — **no se reimplementa** |
| `input-categoria`, `input-unidad-medida` | `tipos_apoyo` | opcionales |
| `btn-guardar-catalogo` | submit | deshabilitado mientras hay petición en vuelo |
| `btn-cancelar-catalogo` | cierra el panel | |
| `error-catalogo` | `role="alert"` | muestra `error.mensaje` del backend tal cual |
| `toast-exito` | `role="status"` | reutiliza la clase `.mensaje.exito` ya existente |

Tras un alta/edición exitosa: se recarga E49, se cierra el formulario y el nodo nuevo queda
seleccionado y visible.

**Modal de baja — `[data-testid="modal-confirmar-baja"]`**

Se abre al pulsar desactivar. Contiene:

- Texto: *"¿Desactivar «PET · Proyectos Estratégicos Territoriales»?"*
- `[data-testid="texto-hijos-activos"]`: *"Tiene 1 modalidad y 1 proyecto activos. **No se
  desactivarán**: seguirán existiendo, pero la rama completa dejará de estar disponible en
  ventanilla."* (el conteo se obtiene de E49; si no hay hijos, el bloque no se renderiza).
- `[data-testid="btn-confirmar-baja"]` y `[data-testid="btn-cancelar-baja"]`.

### 16.6.3 `/catalogos/documentos` — `pwa/src/pantallas/CatalogoDocumentos.tsx`

Contenedor `[data-testid="pantalla-catalogo-documentos"]`, título
`<h1>Reglas de documentación requerida</h1>`.

**Tabla `[data-testid="tabla-reglas-documentos"]`**, filas `[data-testid="fila-regla-documento"]`,
columnas: `Orden`, `Requisito`, `Componentes`, `Tipos de persona`, `Proyecto`, `Concepto`,
`Excepción`, `Estado`, acciones. Un array vacío/`NULL` se pinta como el chip `Todos`.
Filtros: `[data-testid="filtro-componente-regla"]`, `[data-testid="filtro-tipo-persona-regla"]`,
`[data-testid="input-buscar-regla"]`, `[data-testid="toggle-incluir-inactivos"]`.

**Formulario `pwa/src/componentes/FormReglaDocumento.tsx`**
(`[data-testid="form-regla-documento"]`) — mismo modelo de §12.3.1, sin inventar campos:

| `data-testid` | Campo | Control |
|---|---|---|
| `input-requisito` | `requisito` | texto obligatorio |
| `check-componente-<clave>` | `componentes[]` | un checkbox por componente activo. **Ninguno marcado = aplica a todos** (se guarda `NULL`), con la leyenda `[data-testid="leyenda-componentes-todos"]` |
| `check-tipo-persona-<clave>` | `tipos_persona[]` | `fisica`/`moral`/`grupo`; ninguno marcado = todos |
| `select-proyecto-regla` | `proyecto_id` | opcional, opción vacía = "Cualquier proyecto" |
| `select-apoyo` | `apoyo_id` | opcional, buscador sobre `tipos_apoyo`, vacío = regla general |
| `select-apoyo-excluir` | `apoyo_excluir_id` | opcional, "No pedir este documento si el único concepto es…" |
| `input-etiquetas-apoyo` | `apoyo_etiquetas[]` | texto separado por comas, en mayúsculas |
| `input-etiquetas-excluir` | `apoyo_excluir_etiquetas[]` | ídem |
| `input-orden` | `orden` | entero, default 0 |
| `btn-guardar-regla` | submit | |
| `error-regla` | `role="alert"` | |

**Vista previa `[data-testid="preview-checklist"]`**: al lado del formulario, un simulador que llama
al endpoint **existente** E41 (`POST /api/solicitudes/documentos-requeridos`) con el
componente / tipo de persona / proyecto / concepto elegidos, y muestra la lista resultante. Sirve
para confirmar que la regla recién creada sí aparece. **No se modifica E41.**

### 16.6.4 Archivos del build

| Archivo | Acción |
|---|---|
| `packages/shared/src/catalogos.ts` | **nuevo** — tipos + esquemas Zod de las 7 entidades |
| `packages/shared/src/index.ts` | re-export del módulo nuevo (única línea añadida) |
| `backend/src/servicios/catalogosAdmin.ts` | **nuevo** — registro de entidades y validaciones |
| `backend/src/db/queries/catalogosAdmin.ts` | **nuevo** — consultas del árbol, listados y upserts |
| `backend/src/rutas/catalogosAdmin.ts` | **nuevo** — E49–E54 |
| `backend/src/server.ts` | registra el router con prefijo `/api/admin/catalogos` (1 bloque) |
| `pwa/src/pantallas/Catalogos.tsx` | **nuevo** |
| `pwa/src/pantallas/CatalogoDocumentos.tsx` | **nuevo** |
| `pwa/src/componentes/ArbolCatalogos.tsx` | **nuevo** |
| `pwa/src/componentes/FormCatalogo.tsx` | **nuevo** |
| `pwa/src/componentes/FormReglaDocumento.tsx` | **nuevo** |
| `pwa/src/styles/catalogos.css` | **nuevo** — solo layout, solo tokens existentes |
| `pwa/src/componentes/Iconos.tsx` | + ícono `capas` |
| `pwa/src/navegacion/menu.ts` | + destino #9 |
| `pwa/src/rutas.tsx` | + 2 rutas |
| `db/migrations/*` | **sin cambios** |
| `db/seeds/*` | **sin cambios** |
| `docker-compose.yml`, `pwa/nginx.conf.template`, `*/package.json` | **sin cambios** |

Comandos de desarrollo: los ya existentes, sin variables de entorno nuevas.
`docker compose up -d --build` → `npm run migrar` (no aplica nada nuevo) → `npm run sembrar`.

---

## 16.7 Assumptions del Build 10 (continúa la numeración de §14.11 / §15.13)

- **A16-1.** Prefijo de API `/api/admin/catalogos` para no colisionar con `/api/catalogos` (§ build 1).
- **A16-2.** Un router genérico con registro de entidades, no 7 routers. Menos código, mismos contratos.
- **A16-3.** `clave` inmutable en edición (D48). Se documenta en la UI, no solo en el error.
- **A16-4.** `prefijo_folio` inmutable en edición (D47); editable únicamente en el alta.
- **A16-5.** Baja lógica sin cascada (D46); la UI informa el conteo de hijos activos.
- **A16-6.** Reactivar un hijo con el padre inactivo se bloquea con 409 (evita ramas incoherentes).
- **A16-7.** Programas/subprogramas y componentes/modalidades/proyectos se muestran como **dos
  ramas** porque el esquema real no tiene FK entre subprograma y componente.
- **A16-8.** `activo` solo se cambia con E53, nunca con E51/E52. Un único punto de auditoría de bajas.
- **A16-9.** Sin alcance por Regional en esta pantalla (D52).
- **A16-10.** Sin `DELETE` ni endpoint de fusión/merge de catálogos.
- **A16-11.** `documentos_requeridos` no gana campo `clave`; su duplicidad se juzga por
  `requisito` normalizado + su combinación de filtros.
- **A16-12.** El simulador de checklist reutiliza E41; no se duplica el motor de coincidencia.
- **A16-13.** Sin importación masiva de catálogos en este build.
- **A16-14.** El E2E de aceptación usa el prefijo `DEM` (nunca `CEJ`, para no romper el criterio 351).
- **A16-15.** El E2E deja desactivado lo que crea, para no alterar el conteo del criterio 347.

---

## 16.8 Rubric de evaluación — Build 10 (criterios 447–503)

Credenciales: `admin` (rol `admin`), `editor1` (rol `editor_datos`), `capturista1`, `auditor1`,
`ventanilla1`, con las contraseñas de semilla ya usadas por los builds previos.

### Acceso y roles (447–456)

| # | Criterio | Cómo verificar |
|---|---|---|
| 447 | `GET /api/admin/catalogos/arbol` **sin** header `Authorization` → `401`. | `curl -si …/api/admin/catalogos/arbol` |
| 448 | Con token de `admin` → `200` y el JSON trae las claves `programas`, `componentes`, `conteos`. | `curl … \| jq 'keys'` |
| 449 | Con token de `editor_datos` → `200` (mismo payload). | `curl` |
| 450 | Con token de `capturista` → `403` y `error.codigo == "rol_no_autorizado"`. | `curl \| jq '.error.codigo'` |
| 451 | Con token de `auditor` → `403` `rol_no_autorizado`. | `curl` |
| 452 | Con token de `ventanilla` → `403` `rol_no_autorizado`. | `curl` |
| 453 | `POST /api/admin/catalogos/programas` con token de `ventanilla` → `403`; `SELECT count(*) FROM programas` no cambia. | `curl` + `psql` |
| 454 | UI: `admin` autenticado ve `[data-testid="nav-catalogos"]` (sidebar o "Más") y al pulsarlo llega a `/catalogos` con `[data-testid="pantalla-catalogos"]` visible. | Playwright |
| 455 | UI: `editor_datos` ve `nav-catalogos`; `ventanilla`, `capturista` y `auditor` **no** lo ven en ninguna parte del cascarón. | Playwright, 4 sesiones |
| 456 | UI: `ventanilla` navegando directo a `/catalogos` termina en `/sin-permiso`. | Playwright |

### Restricciones del build (457–461)

| # | Criterio | Cómo verificar |
|---|---|---|
| 457 | No existe ningún archivo `db/migrations/016_*.sql` y `git diff HEAD -- db/migrations/ db/seeds/` está vacío. | `ls db/migrations` + `git diff` |
| 458 | `git diff HEAD -- '*package.json' '*package-lock.json'` no muestra cambios en `dependencies`/`devDependencies`. | `git diff` |
| 459 | `git diff HEAD -- docker-compose.yml pwa/nginx.conf.template pwa/src/sync pwa/src/db` está vacío. | `git diff` |
| 460 | `grep -n "\.delete(" backend/src/rutas/catalogosAdmin.ts` no devuelve nada, y `DELETE /api/admin/catalogos/programas/1` con token admin → `404`. | `grep` + `curl -X DELETE -si` |
| 461 | `npm run build` en `packages/shared`, `backend` y `pwa` termina en 0 sin errores de TypeScript. | Log de terminal |

### Lectura: árbol, listados y referencias (462–469)

| # | Criterio | Cómo verificar |
|---|---|---|
| 462 | E49 devuelve `programas[0].subprogramas` como array y `componentes[]` con `PET` conteniendo `modalidades[0].clave == "MOD-PEPFO"` y dentro `proyectos[0].clave == "PEO"`. | `curl \| jq` |
| 463 | E49 sin query no incluye filas con `activo=false`; con `?incluir_inactivos=true` sí las incluye y cada una trae `"activo": false`. | `curl` antes/después de desactivar algo |
| 464 | `GET /api/admin/catalogos/programas` → `200` con el objeto `{datos, total, pagina, por_pagina}` y `datos[0].clave == "PRG-2026"`. | `curl \| jq` |
| 465 | `GET /api/admin/catalogos/tipos_apoyo?q=casas` → `total >= 1` y algún `datos[].clave == "CASAS-EJIDALES"`. | `curl \| jq` |
| 466 | `GET /api/admin/catalogos/subprogramas?padre_id=<id de PRG-2026>` devuelve solo filas con ese `programa_id`. | `curl \| jq` |
| 467 | `GET /api/admin/catalogos/inexistente` → `404` con `error.codigo == "entidad_desconocida"`. | `curl` |
| 468 | `GET /api/admin/catalogos/documentos_requeridos?por_pagina=200` → `total >= 42`; cada fila trae `componentes`, `tipos_persona` (array o `null`) y las claves resueltas `apoyo_clave`/`proyecto_clave`. | `curl \| jq` |
| 469 | `GET /api/admin/catalogos/referencias` → `200` con las 6 claves (`programas`, `componentes`, `modalidades`, `proyectos`, `tipos_apoyo`, `tipos_persona`) y `tipos_persona` con exactamente `fisica`, `moral`, `grupo`. | `curl \| jq` |

### Alta y validación (470–481)

| # | Criterio | Cómo verificar |
|---|---|---|
| 470 | `POST /api/admin/catalogos/programas` `{"clave":"prg-demo","nombre":"Programa Demo 2027"}` → `201` con `registro.clave == "PRG-DEMO"` (normalizada a mayúsculas) y `registro.activo == true`. | `curl` |
| 471 | Repetir exactamente ese POST → `409` con `error.codigo == "clave_duplicada"`. **No** `500`, y la respuesta no filtra texto de Postgres. | `curl -si \| jq` |
| 472 | `POST …/subprogramas` con `programa_id: 999999` → `422` `padre_invalido`. | `curl` |
| 473 | Desactivar `PRG-DEMO` y luego `POST …/subprogramas` con ese `programa_id` → `422` `padre_inactivo`. Reactivarlo después. | `curl` x3 |
| 474 | `POST …/subprogramas` `{"programa_id":<PRG-DEMO>,"clave":"SUB-IP","nombre":"…"}` → `201` (la clave `SUB-IP` ya existe bajo `PRG-2026`, pero la unicidad es por par). Repetirlo bajo el **mismo** programa → `409` `clave_duplicada`. | `curl` x2 |
| 475 | `POST …/proyectos` con `prefijo_folio: "peo1"` → `422` `payload_invalido`; con `"P"` → `422`; con `"DEM"` → `201`. | `curl` x3 |
| 476 | `POST …/proyectos` con `componente_id` de `TR` y `modalidad_id` de `MOD-PEPFO` (que es de `PET`) → `422` `modalidad_no_corresponde_componente`. | `curl` |
| 477 | `POST …/programas` con un campo no declarado (`{"clave":"X1","nombre":"Y","color":"rojo"}`) → `422` `payload_invalido` (Zod `.strict()`). | `curl` |
| 478 | `POST …/tipos_apoyo` `{"clave":"DEM-CONCEPTO","nombre":"Concepto demo","categoria":"infraestructura","unidad_medida":"obra"}` → `201`. | `curl` |
| 479 | `POST …/documentos_requeridos` con `tipos_persona:["persona_fisica"]` → `422` `tipo_persona_invalido`; con `componentes:["ZZZ"]` → `422` `componente_invalido`. | `curl` x2 |
| 480 | `POST …/documentos_requeridos` `{"requisito":"Acta de asamblea demo","componentes":["DEM-C"],"tipos_persona":["grupo"],"apoyo_id":<DEM-CONCEPTO>,"orden":1}` → `201`. | `curl` |
| 481 | Tras 470 y 480, `SELECT accion, entidad FROM auditoria_log ORDER BY id DESC LIMIT 5` contiene `catalogo_creado`/`programas` y `regla_documento_creada`/`documentos_requeridos`, con `entidad_id` igual al id devuelto. | `psql` |

### Edición e inmutabilidad (482–489)

| # | Criterio | Cómo verificar |
|---|---|---|
| 482 | `PATCH …/programas/<PRG-DEMO>` `{"nombre":"Programa Demo 2027 corregido"}` → `200` y `SELECT nombre FROM programas` refleja el cambio. | `curl` + `psql` |
| 483 | `PATCH …/programas/<PRG-DEMO>` `{"clave":"PRG-OTRO"}` → `422` `campo_inmutable`; la clave en BD sigue `PRG-DEMO`. | `curl` + `psql` |
| 484 | `PATCH …/proyectos/<PEO>` `{"prefijo_folio":"XXX"}` → `422` `campo_inmutable` con `error.mensaje` = `"El prefijo de folio no se puede modificar. Desactiva el proyecto y da de alta uno nuevo."`; `SELECT prefijo_folio FROM proyectos WHERE clave='PEO'` sigue `PEO`. | `curl` + `psql` |
| 485 | UI: abrir editar sobre el proyecto `PEO` en `/catalogos` → `[data-testid="input-prefijo-folio"]` está `disabled` **y** `readonly`, con valor `PEO`, y es visible `[data-testid="leyenda-prefijo-inmutable"]`. | Playwright |
| 486 | UI: pulsar `[data-testid="btn-nuevo-proyectos"]` → el mismo `[data-testid="input-prefijo-folio"]` está **habilitado** y editable. | Playwright |
| 487 | `PATCH …/proyectos/999999` `{"nombre":"x"}` → `404` `registro_no_encontrado`. | `curl` |
| 488 | `PATCH …/proyectos/<id demo>` con `{"clave":"DEM","prefijo_folio":"DEM","nombre":"Proyecto demo v2"}` (inmutables con el **mismo** valor) → `200`, nombre actualizado, sin error. | `curl` |
| 489 | Tras 482, `auditoria_log` tiene una fila `catalogo_actualizado` cuyo `detalle->'cambios'->'nombre'` trae `anterior` y `nuevo` distintos. | `psql` |

### Baja lógica sin cascada (490–496)

| # | Criterio | Cómo verificar |
|---|---|---|
| 490 | `POST …/componentes/<DEM-C>/estado` `{"activo":false}` → `200`, `registro.activo == false` y `hijos_activos` reporta `modalidades >= 1` y `proyectos >= 1`. | `curl \| jq` |
| 491 | Inmediatamente después: `SELECT activo FROM modalidades WHERE componente_id=<DEM-C>` devuelve **todos `true`**. La desactivación del padre no tocó a los hijos. | `psql` |
| 492 | Ídem `SELECT activo FROM proyectos WHERE componente_id=<DEM-C>` → todos `true`. | `psql` |
| 493 | `GET /api/solicitudes/catalogos` con token admin **no** incluye el componente `DEM-C` en `componentes[]` mientras está desactivado. | `curl \| jq` |
| 494 | `POST …/componentes/<DEM-C>/estado` `{"activo":true}` → `200`, `registro.activo == true`; repetir la misma llamada → `200` idempotente sin fila nueva de auditoría. | `curl` x2 + `psql` |
| 495 | Con `DEM-C` desactivado, `POST …/modalidades/<hija>/estado` `{"activo":true}` → `409` `padre_inactivo`. | `curl` |
| 496 | UI: pulsar desactivar sobre un componente con hijos abre `[data-testid="modal-confirmar-baja"]` con `[data-testid="texto-hijos-activos"]` visible mencionando que **no** se desactivarán; al confirmar, el nodo padre muestra `[data-testid="chip-inactivo"]` y los nodos hijos **no** lo muestran. | Playwright |

### Alta end-to-end de un programa completo, sin SQL (497–503)

Toda esta sección se ejecuta **solo por HTTP/UI**; el criterio 497 falla si el Evaluator necesita
abrir `psql` para escribir algo.

| # | Criterio | Cómo verificar |
|---|---|---|
| 497 | Cadena de 7 altas, todas `201`, en este orden y solo con `POST /api/admin/catalogos/…` autenticado como `admin`: `programas` (`PRG-DEMO`) → `subprogramas` (`SUB-DEMO`, hijo del anterior) → `componentes` (`DEM-C`) → `modalidades` (`MOD-DEMO`, de `DEM-C`) → `proyectos` (`DEM`, `prefijo_folio="DEM"`, de `DEM-C` + `MOD-DEMO`) → `tipos_apoyo` (`DEM-CONCEPTO`) → `documentos_requeridos` (`"Acta de asamblea demo"`, componente `DEM-C`, tipo de persona `grupo`, `apoyo_id = DEM-CONCEPTO`). | Script `curl` de 7 llamadas |
| 498 | `GET /api/solicitudes/catalogos` (token admin) ya incluye, **sin reiniciar el backend ni re-sembrar**: el programa `PRG-DEMO`, el subprograma `SUB-DEMO`, el componente `DEM-C`, la modalidad `MOD-DEMO` (con `componente_id` correcto), el proyecto `DEM` (con `modalidad_id` correcto) y el concepto `DEM-CONCEPTO`. | `curl \| jq` |
| 499 | `POST /api/solicitudes/documentos-requeridos` `{"componente_id":<DEM-C>,"tipo_persona":"grupo","proyecto_id":<DEM>,"tipos_apoyo_ids":[<DEM-CONCEPTO>]}` → `200` y la lista contiene `"Acta de asamblea demo"`. | `curl \| jq '.documentos[].requisito'` |
| 500 | `POST /api/solicitudes` con esa jerarquía completa (`programa_id`, `subprograma_id`, `componente_id`, `modalidad_id`, `proyecto_id` demo, un concepto `DEM-CONCEPTO`) → `201` y `solicitud.folio` cumple `^DEM-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$`. El prefijo del folio salió del catálogo creado por UI/API, no de una migración. | `curl \| jq '.solicitud.folio'` |
| 501 | UI Playwright: como `admin`, desde `/catalogos`, pulsar `[data-testid="btn-nuevo-programas"]`, llenar `input-clave`=`PRG-UI` e `input-nombre`, guardar → aparece `[data-testid="toast-exito"]` y el nodo `[data-testid^="nodo-programas-"]` con el texto `PRG-UI` es visible en `[data-testid="arbol-catalogos"]` sin recargar la página. | Playwright |
| 502 | Limpieza obligatoria del E2E: desactivar por API el componente `DEM-C` y el proyecto `DEM`; después `SELECT count(*) FROM componentes WHERE activo` vuelve a devolver `4` y `SELECT count(*) FROM proyectos WHERE activo` vuelve a `1`. | `curl` x2 + `psql` |
| 503 | Regresión completa: recrear la BD desde cero (`docker compose down -v && docker compose up -d`, `npm run migrar && npm run sembrar`) y volver a pasar los criterios **1–446** sin modificar el enunciado de ninguno. | Re-run del Evaluator |

**Definición de "terminado" (Build 10):** pasan los **57** criterios nuevos (447–503) **y** siguen
pasando los 446 anteriores. Total acumulado: **503** criterios.
# SPEC — Sección 17 (Build 11)

> **Anexo de `SPEC.md`.** Este archivo contiene, literal y completa, la **sección 17** de `SPEC.md`.
> Debe concatenarse al final de `SPEC.md` sin modificar ni una línea de las secciones 1–16.
> Mismo patrón que `SPEC_SECCION_14_JERARQUIA.md`.
> Continúa la numeración de secciones (§16 = Build 10) y de criterios (último criterio previo: **503**).

---

# 17. EXTENSIÓN — Densidad de interfaz: acciones con ícono y contenedores anchos (Build 11)

## 17.1 Objetivo

Compactar la interfaz de escritorio de la PWA: las acciones de fila de **todas** las tablas y árboles
pasan de botones de texto grandes a **botones de ícono** con nombre accesible, los botones primarios
de creación se reducen de altura sin perder su texto, y los contenedores de contenido aprovechan el
ancho real del viewport en tablet/escritorio para que ninguna columna quede truncada.

**Cero cambios de negocio.** No se toca backend, esquema, endpoints, validaciones, textos legales ni
lógica de ninguna pantalla. Es un build exclusivamente de CSS + envoltura de presentación.

---

## 17.2 Scope

### SÍ incluye (lista cerrada)

1. Componente nuevo `pwa/src/componentes/BotonIcono.tsx` (§17.4).
2. Cuatro íconos nuevos en `pwa/src/componentes/Iconos.tsx` (§17.5): `ojo-tachado`, `check`,
   `basura`, `copiar`.
3. Clase nueva `.boton-icono` (+ variante `.peligro`) y clase nueva `.celda-texto` en
   `pwa/src/styles/componentes.css` (§17.6).
4. Reducción de altura/padding de los botones de texto en `≥768px` (§17.6.2).
5. Ensanchamiento de `.contenido` y clase `.pantalla-ancha` (§17.7).
6. Densificación de `th`/`td` y desbloqueo del ajuste de línea en columnas de texto largo (§17.8).
7. Sustitución de los botones de texto por `BotonIcono` **solo en las filas del inventario cerrado
   de §17.3**.
8. Ajuste de `pwa/src/styles/catalogos.css`: `.catalogos-layout { max-width: none }`.

### NO incluye (explícitamente fuera)

- Ningún cambio en `backend/`, `db/`, `packages/shared/`.
- Ninguna migración, semilla, endpoint, contrato de API ni permiso.
- Ningún `data-testid` nuevo, renombrado o eliminado (§17.9).
- Ningún color, sombra, radio, fuente o token nuevo: solo variables ya definidas en `tokens.css`.
- Ninguna dependencia npm nueva (íconos = SVG inline propios, como en Build 9).
- Ningún cambio en el layout **móvil** (`<768px`) más allá de garantizar el objetivo táctil de 44 px.
- Ningún cambio en el bloque `@media print` de `DetalleSolicitud.tsx`.
- Los enlaces de navegación de fila ("Ver", "Corregir") **no** se convierten a ícono: conservan su
  texto visible (D11-6).

---

## 17.3 Inventario cerrado de botones afectados

Esta tabla es exhaustiva. El Generator **no** convierte a ícono ningún botón que no esté aquí.

### 17.3.1 Acciones de fila → `BotonIcono` (pierden texto visible, conservan nombre accesible)

| Pantalla / componente | `data-testid` (SIN CAMBIOS) | Texto visible actual | Ícono | `aria-label` = `title` = texto de `.sr-solo` | Tono |
|---|---|---|---|---|---|
| `ArbolCatalogos.tsx` | `btn-editar-programas-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-programas-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-editar-subprogramas-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-subprogramas-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-editar-componentes-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-componentes-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-editar-modalidades-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-modalidades-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-editar-proyectos-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-proyectos-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-editar-tipos_apoyo-<id>` | Editar | `lapiz` | `Editar` | neutro |
| `ArbolCatalogos.tsx` | `btn-desactivar-tipos_apoyo-<id>` | Desactivar | `ojo-tachado` | `Desactivar` | peligro |
| `ArbolCatalogos.tsx` | `btn-reactivar` (fila inactiva) | Reactivar | `check` | `Reactivar` | neutro |
| `CatalogoDocumentos.tsx` | `btn-editar-regla` | Editar | `lapiz` | `Editar` | neutro |
| `CatalogoDocumentos.tsx` | `btn-toggle-estado-regla` | Desactivar / Activar | `ojo-tachado` / `check` | `Desactivar` / `Activar` (según `regla.activo`) | peligro / neutro |
| `Usuarios.tsx` | `btn-editar-usuario` | Editar | `lapiz` | `Editar` | neutro |
| `Usuarios.tsx` | `btn-reset-password` | Resetear contraseña | `llave` | `Resetear contraseña` | neutro |
| `Usuarios.tsx` | `btn-toggle-activo` | Desactivar / Activar | `ojo-tachado` / `check` | `Desactivar` / `Activar` (según `fila.activo`) | peligro / neutro |
| `TablaConceptos.tsx` | `btn-quitar-concepto` | Quitar | `basura` | `Quitar concepto` | peligro |
| `DepuracionCatalogos.tsx` | `btn-aprobar-catalogo` | Aprobar | `check` | `Aprobar` | neutro |
| `DepuracionCatalogos.tsx` | `btn-descartar-catalogo` | Descartar | `ojo-tachado` | `Descartar` | peligro |
| `ModalPasswordTemporal.tsx` | `btn-copiar-password` | Copiar | `copiar` | `Copiar contraseña` | neutro |

**Regla de tono:** el tono solo cambia el color del glifo y del borde en `:hover`. Nunca cambia el
`data-testid`, el `onClick` ni la habilitación.

### 17.3.2 Botones que conservan texto visible (solo se compactan)

| Pantalla | `data-testid` | Texto visible (INVARIABLE) |
|---|---|---|
| `ArbolCatalogos.tsx` | `btn-nuevo-programas` | `+ Nuevo programa` |
| `ArbolCatalogos.tsx` | `btn-nuevo-subprogramas` | `+ Nuevo subprograma` |
| `ArbolCatalogos.tsx` | `btn-nuevo-componentes` | `+ Nuevo componente` |
| `ArbolCatalogos.tsx` | `btn-nuevo-modalidades` | `+ Nueva modalidad` |
| `ArbolCatalogos.tsx` | `btn-nuevo-proyectos` | `+ Nuevo proyecto` |
| `ArbolCatalogos.tsx` | `btn-nuevo-tipos_apoyo` | `+ Nuevo concepto` |
| `CatalogoDocumentos.tsx` | `btn-nueva-regla` | `Nueva regla` |
| `Usuarios.tsx` | `btn-nuevo-usuario` | `Nuevo usuario` |
| `Solicitudes.tsx` | `btn-nueva-solicitud` | `Nueva solicitud` |
| `NuevaSolicitud.tsx` | `btn-agregar-concepto` | `Agregar concepto` |
| `NuevaSolicitud.tsx` | `btn-guardar-solicitud` | (texto actual) |
| `FichaBeneficiario.tsx` | `btn-editar-datos` | `Editar datos de contacto/ubicación` |
| `DepuracionDetalle.tsx` | `btn-aprobar`, `btn-descartar`, `btn-fusionar` | (textos actuales) |
| `DetalleSolicitud.tsx` | `btn-imprimir-caratula` | (texto actual) |
| Todos los `btn-guardar-*`, `btn-cancelar-*`, `btn-confirmar-*` | — | (textos actuales) |

Los del glifo `+` mantienen el `+` como texto plano dentro del botón (no es SVG).

`btn-editar-datos` **no** se convierte a ícono: es una acción de cabecera de ficha, y su texto
visible está comprometido por los criterios 151, 152 y 156.

---

## 17.4 `pwa/src/componentes/BotonIcono.tsx` (nuevo)

Único punto de verdad para las acciones de §17.3.1. Ningún otro archivo escribe la clase
`.boton-icono` a mano.

```tsx
import type { ReactNode } from 'react';
import {
  IconoLapiz, IconoLlave, IconoOjoTachado, IconoCheck, IconoBasura, IconoCopiar, IconoMas
} from './Iconos';

export type NombreIconoAccion =
  | 'lapiz' | 'llave' | 'ojo-tachado' | 'check' | 'basura' | 'copiar' | 'mas';

const MAPA: Record<NombreIconoAccion, (p: { tamano?: number }) => ReactNode> = {
  'lapiz': IconoLapiz,
  'llave': IconoLlave,
  'ojo-tachado': IconoOjoTachado,
  'check': IconoCheck,
  'basura': IconoBasura,
  'copiar': IconoCopiar,
  'mas': IconoMas
};

type Props = {
  icono: NombreIconoAccion;
  /** Nombre accesible. Es el MISMO string que mostraba el botón de texto anterior. */
  etiqueta: string;
  onClick: () => void;
  testId: string;
  tono?: 'neutro' | 'peligro';
  deshabilitado?: boolean;
};

export function BotonIcono({
  icono, etiqueta, onClick, testId, tono = 'neutro', deshabilitado = false
}: Props) {
  const Glifo = MAPA[icono];
  return (
    <button
      type="button"
      className={tono === 'peligro' ? 'boton-icono peligro' : 'boton-icono'}
      data-testid={testId}
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
    >
      <Glifo tamano={18} />
      <span className="sr-solo">{etiqueta}</span>
    </button>
  );
}
```

Reglas duras:

- **Nunca** se le pasa `className="secundario"`; `.boton-icono` es autosuficiente.
- El `<svg>` es `aria-hidden="true"` (ya lo es por el `Base` de `Iconos.tsx`).
- El nombre accesible viene de `aria-label`; el `.sr-solo` existe para que cualquier prueba previa
  basada en el string siga encontrando el texto en el DOM.
- `title` idéntico a `aria-label` → tooltip nativo en escritorio, sin librería de tooltips.

---

## 17.5 Íconos nuevos (`pwa/src/componentes/Iconos.tsx`)

Se añaden **4** exports al final del archivo, con el mismo `Base` ya existente (24×24, `fill="none"`,
`stroke="currentColor"`, `strokeWidth=1.75`, `aria-hidden`). Los 17 íconos actuales no se tocan.

| Export | Uso | Trazado |
|---|---|---|
| `IconoOjoTachado` | desactivar / descartar | ojo (`M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z` + círculo r=3) + diagonal `M3 3l18 18` |
| `IconoCheck` | activar / reactivar / aprobar | `M4 12.5l5 5L20 6.5` |
| `IconoBasura` | quitar concepto | `M4 7h16` + `M9 7V5h6v2` + `M6 7l1 13h10l1-13` + `M10 11v6` + `M14 11v6` |
| `IconoCopiar` | copiar contraseña temporal | `M9 9h10v10H9z` + `M5 15V5h10` |

---

## 17.6 CSS — `pwa/src/styles/componentes.css`

Todo lo de esta sección usa **solo** variables ya declaradas en `tokens.css`. Cero literales de color.

### 17.6.1 Bloque nuevo `.boton-icono` (se inserta justo después del bloque `button.peligro`)

```css
/* --------------------------- Boton de icono ------------------------------ */

button.boton-icono,
.boton-icono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  flex: 0 0 auto;
  background: var(--bg-elev-2);
  color: var(--fg-muted);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  cursor: pointer;
}

button.boton-icono:hover:not(:disabled) {
  background: var(--bg-elev-3);
  color: var(--fg);
  border-color: var(--accent);
}

button.boton-icono.peligro {
  background: var(--bg-elev-2);
  color: var(--peligro);
  border-color: var(--border-strong);
}

button.boton-icono.peligro:hover:not(:disabled) {
  background: var(--peligro-bg);
  color: var(--peligro);
  border-color: var(--peligro);
}

button.boton-icono:active:not(:disabled) {
  background: var(--bg-sunk);
}

button.boton-icono:disabled {
  background: var(--bg-sunk);
  color: var(--fg-subtle);
  border-color: var(--border);
  cursor: not-allowed;
}
```

La especificidad de `button.boton-icono.peligro` (0,2,1) gana a `button.peligro` (0,1,1), así que la
variante de peligro **no** hereda el relleno rojo sólido de los botones destructivos grandes.

En `@media (max-width: 767px)` (bloque móvil ya existente) se agrega:

```css
  button.boton-icono,
  .boton-icono {
    width: 44px;
    height: 44px;
    min-height: 44px;
  }
```

### 17.6.2 Compactación de los botones de texto (solo `≥768px`)

Bloque nuevo al final de `componentes.css`:

```css
@media (min-width: 768px) {
  button,
  .boton {
    min-height: 34px;
    padding: 6px 14px;
    font-size: 13px;
  }

  button.boton-icono {
    padding: 0;
    font-size: 0;
  }

  .boton-entrar {
    min-height: 44px;
    font-size: 14px;
  }
}
```

`Login` y `CambiarPassword` conservan su botón de 44 px vía `.boton-entrar`. El bloque móvil actual
(48 px) queda intacto.

### 17.6.3 Acciones dentro de tabla y árbol

```css
td.acciones,
.acciones.en-fila {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  margin-top: 0;
  white-space: nowrap;
}
```

En `ArbolCatalogos.tsx`, el contenedor de acciones de cada nodo usa
`className="acciones en-fila"` (la clase `acciones` se conserva).

### 17.6.4 Celdas de texto largo

```css
.celda-texto {
  white-space: normal;
  min-width: 24ch;
  max-width: 46ch;
  line-height: 1.35;
}
```

Se aplica como `className="celda-texto"` (además del `data-etiqueta` que ya tienen) en:

| Pantalla | Columna |
|---|---|
| `CatalogoDocumentos.tsx` | `Requisito` |
| `Usuarios.tsx` | `Nombre completo` |
| `Depuracion.tsx` | columna de nombre del beneficiario |
| `Correcciones.tsx` | columna de nombre del beneficiario |
| `DepuracionCatalogos.tsx` | columna de valor/descripción del catálogo |
| `Auditoria.tsx` | columna de nombre del beneficiario |

Ninguna otra celda pierde su `white-space: nowrap`.

---

## 17.7 Ancho del contenedor

Reemplaza únicamente la regla `.contenido` y sus dos medias queries existentes:

```css
.contenido {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px;
  width: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

@media (min-width: 1024px) {
  .contenido { max-width: 1440px; padding: 20px 28px; }
}

@media (min-width: 1680px) {
  .contenido { max-width: 1760px; }
}

/* Pantallas con tabla ancha: sin techo, el limite lo pone el viewport. */
.contenido:has(.pantalla-ancha) {
  max-width: none;
}
```

Las medias queries `max-width: 1023px` y `max-width: 767px` de `.contenido` que ya existen no se
modifican.

`className="pantalla-ancha"` se añade al **elemento raíz** (el que ya lleva el
`data-testid="pantalla-*"` o equivalente) de estas 9 pantallas, sin quitar ninguna clase previa:

`Catalogos.tsx`, `CatalogoDocumentos.tsx`, `Usuarios.tsx`, `Solicitudes.tsx`, `Beneficiarios.tsx`,
`Auditoria.tsx`, `Depuracion.tsx`, `DepuracionCatalogos.tsx`, `Correcciones.tsx`.

En `pwa/src/styles/catalogos.css`, la línea `max-width: 1400px` de `.catalogos-layout` pasa a
`max-width: none` (única línea que cambia en ese archivo).

`:has()` es soportado por Chromium ≥105, Firefox ≥121 y Safari ≥15.4; la matriz de navegadores del
proyecto (Build 9) ya lo cubre. Si el selector no aplicara, la degradación es exactamente el
comportamiento de Build 10 (1180/1440 px), sin rotura visual.

---

## 17.8 Densidad de tablas

Reemplaza el bloque `th, td` de `componentes.css`:

```css
th,
td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

th {
  background: var(--bg-sunk);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 10px;
}
```

`table { font-size: 13px }` no cambia. El bloque móvil `max-width: 767px` que convierte la tabla en
tarjetas **no se toca**: ahí `padding` y `white-space` siguen gobernados por sus propias reglas.

---

## 17.9 Contrato de `data-testid` y criterios previos afectados

**Invariantes (el Generator los rompe = build fallido):**

1. **Cero** `data-testid` nuevos, renombrados o eliminados en este build.
2. Cada botón de §17.3.1 conserva su `data-testid`, su handler y su condición de habilitación.
3. El **nombre accesible** de cada botón de §17.3.1 es idéntico, carácter por carácter, al texto
   visible que tenía en Build 10 — salvo dos casos documentados abajo.
4. El string sigue presente en el DOM dentro de `<span class="sr-solo">`, por lo que un selector de
   texto lo encuentra; lo que ya **no** se cumple es `toBeVisible()` sobre ese texto.

**Cambios de contrato declarados explícitamente:**

| Referencia previa | Qué decía | Qué dice a partir de Build 11 |
|---|---|---|
| §10.8.1 (Build 4) | *"Acciones por fila: `btn-editar-usuario` ("Editar"), `btn-reset-password` ("Resetear contraseña"…), `btn-toggle-activo` ("Desactivar"/"Activar")"* | Los tres son `BotonIcono`. Los strings entre paréntesis pasan a ser `aria-label`/`title`/`.sr-solo`, no texto visible. El resto de la fila (confirmaciones, modales, efectos) es idéntico. |
| §16.6.2 (Build 10) | Árbol con `[editar] [desactivar]` como botones de texto | Los mismos botones, mismos testids, renderizados como `BotonIcono`. |
| §16.6.3 (Build 10) | Columna "acciones" con `Editar` / `Desactivar`-`Activar` | Ídem. |
| `TablaConceptos` | `btn-quitar-concepto` mostraba "Quitar" | `aria-label` = `Quitar concepto` (string **distinto** al anterior: se añade el sustantivo para que el nombre accesible sea autoexplicativo fuera de contexto). Ningún criterio previo depende de ese texto. |
| `ModalPasswordTemporal` | `btn-copiar-password` mostraba "Copiar" | `aria-label` = `Copiar contraseña` (string **distinto**, misma justificación). |

**Criterios previos verificados como NO afectados** (todos seleccionan por `data-testid`, por
estado o por texto de elementos que no se convierten): 151, 152, 156, 199, 200, 203, 204, 236, 239,
298, 301, 485, 486, 496, 501. El criterio 503 (regresión 1–446) sigue vigente con las dos
salvedades textuales de la tabla anterior.

---

## 17.10 Accesibilidad

1. Todo `.boton-icono` tiene `aria-label` **y** `title` no vacíos, más `.sr-solo` con el mismo texto.
2. Objetivo táctil: 44×44 CSS px en `<768px`; 32×32 con separación de 6 px en `≥768px` (aceptable
   bajo WCAG 2.2 SC 2.5.8 *Target Size (Minimum)*, que exige 24×24 con espaciado).
3. Contraste mínimo 4.5:1 del glifo contra su fondo, en ambos modos:
   - oscuro: `--fg-muted` `#9A9AA8` sobre `--bg-elev-2` → cumple;
   - claro: `--fg-muted` `#6E6E7E` sobre `--bg-elev-2` → cumple;
   - peligro claro `#B91C1C` y peligro oscuro `#FCA5A5` sobre sus fondos respectivos → cumplen.
   Prohibido bajar el glifo a `--fg-subtle` en estado normal (solo en `:disabled`, que está exento).
4. Se conserva el `:focus-visible` global de Build 9 (`outline: 2px solid var(--accent)`);
   `.boton-icono` **no** declara `outline: none`.
5. `title` no sustituye al `aria-label`: ambos coexisten.
6. Ninguna acción queda identificada **solo** por color (el ícono es distinto entre desactivar y
   activar: ojo tachado vs. check).

---

## 17.11 Archivos

| Archivo | Acción |
|---|---|
| `pwa/src/componentes/BotonIcono.tsx` | **nuevo** |
| `pwa/src/componentes/Iconos.tsx` | + 4 exports (`IconoOjoTachado`, `IconoCheck`, `IconoBasura`, `IconoCopiar`) |
| `pwa/src/styles/componentes.css` | + `.boton-icono`, + `.celda-texto`, + `td.acciones`, MODIF `.contenido`, MODIF `th`/`td`, + media `≥768px` |
| `pwa/src/styles/catalogos.css` | MODIF 1 línea (`.catalogos-layout { max-width: none }`) |
| `pwa/src/componentes/ArbolCatalogos.tsx` | MODIF: 13 botones → `BotonIcono`; contenedor `acciones en-fila` |
| `pwa/src/pantallas/CatalogoDocumentos.tsx` | MODIF: 2 botones → `BotonIcono`; `celda-texto`; `pantalla-ancha` |
| `pwa/src/pantallas/Usuarios.tsx` | MODIF: 3 botones → `BotonIcono`; `celda-texto`; `pantalla-ancha` |
| `pwa/src/componentes/TablaConceptos.tsx` | MODIF: `btn-quitar-concepto` → `BotonIcono` |
| `pwa/src/pantallas/DepuracionCatalogos.tsx` | MODIF: 2 botones → `BotonIcono`; `celda-texto`; `pantalla-ancha` |
| `pwa/src/componentes/ModalPasswordTemporal.tsx` | MODIF: `btn-copiar-password` → `BotonIcono` |
| `pwa/src/pantallas/Catalogos.tsx` | MODIF: `pantalla-ancha` |
| `pwa/src/pantallas/Solicitudes.tsx` | MODIF: `pantalla-ancha` |
| `pwa/src/pantallas/Beneficiarios.tsx` | MODIF: `pantalla-ancha` |
| `pwa/src/pantallas/Auditoria.tsx` | MODIF: `pantalla-ancha`; `celda-texto` |
| `pwa/src/pantallas/Depuracion.tsx` | MODIF: `pantalla-ancha`; `celda-texto` |
| `pwa/src/pantallas/Correcciones.tsx` | MODIF: `pantalla-ancha`; `celda-texto` |
| `backend/**`, `db/**`, `packages/shared/**`, `*/package.json`, `docker-compose.yml` | **sin cambios** |

**Comandos (sin cambios):**

```
cd pwa
npm run dev         # http://localhost:5173
npm run typecheck   # tsc --noEmit
npm run build       # vite build -> pwa/dist
```

Dependencias npm: **cero altas, cero bajas, cero cambios de versión**.

---

## 17.12 Assumptions del Build 11 (continúa la numeración de §16.7)

- **A17-1.** Los botones de acción de fila pierden texto visible pero conservan nombre accesible
  idéntico; se prefiere `aria-label` + `title` + `.sr-solo` (triple redundancia) antes que romper
  cualquier selector existente.
- **A17-2.** 32×32 px en escritorio y 44×44 px en móvil. No se usa un tamaño intermedio en tablet
  para no multiplicar breakpoints.
- **A17-3.** Los botones "Nuevo X" conservan texto: un ícono `+` solo sería ambiguo para el personal
  de ventanilla.
- **A17-4.** Los enlaces de fila "Ver" y "Corregir" no se iconifican (son navegación, no acción, y
  hay criterios previos que los pulsan por texto).
- **A17-5.** El ensanchamiento se hace con `.contenido:has(.pantalla-ancha)` y no con una prop del
  `Cascaron`, para no tocar el enrutado ni el cascarón de Build 9.
- **A17-6.** Sin techo de ancho en las pantallas de tabla: en monitores muy anchos se prefiere ver
  todas las columnas antes que preservar una medida de línea ideal.
- **A17-7.** `white-space: normal` se aplica por lista blanca de columnas (`.celda-texto`), no de
  forma global, para no reintroducir tablas de altura irregular.
- **A17-8.** No se agrega librería de tooltips: `title` nativo es suficiente y no compite con el
  lector de pantalla porque el nombre accesible ya viene de `aria-label`.
- **A17-9.** Variante `peligro` de ícono = glifo rojo con fondo neutro (no botón rojo sólido), para
  no gritar en cada fila de la tabla y mantener el contraste AA.
- **A17-10.** Este build no toca `NuevaSolicitud.tsx` salvo el `BotonIcono` de `TablaConceptos`:
  es la pantalla con más criterios vigentes y el riesgo de regresión no compensa.

---

## 17.13 Rubric de evaluación — Build 11 (criterios 504–530)

Salvo indicación contraria, Playwright con `admin` autenticado, viewport de escritorio
**1440×900** y modo oscuro (el de arranque por defecto).

### Botones de ícono — estructura y semántica (504–511)

| # | Criterio | Cómo verificar |
|---|---|---|
| 504 | En `/catalogos`, el primer `[data-testid^="btn-editar-programas-"]` contiene exactamente **1** `svg` y su `innerText` es la cadena vacía (`''`) tras `trim()`. | Playwright |
| 505 | Ese mismo botón tiene `aria-label="Editar"` **y** `title="Editar"`, y `page.getByRole('button', { name: 'Editar' }).first()` lo resuelve. | Playwright |
| 506 | Ese mismo botón contiene un `span.sr-solo` con texto `Editar`, y ese `span` **no** es visible (`toBeHidden()`), mientras el `button` sí es visible. | Playwright |
| 507 | En `/catalogos`, todo `button[data-testid^="btn-desactivar-"]` tiene `aria-label="Desactivar"` y la clase `boton-icono peligro`; su `color` computado es distinto del `color` computado de los `btn-editar-*`. | Playwright + `getComputedStyle` |
| 508 | En `/usuarios`, los tres botones de la primera fila (`btn-editar-usuario`, `btn-reset-password`, `btn-toggle-activo`) tienen `aria-label` no vacío (`Editar`, `Resetear contraseña`, `Desactivar`\|`Activar`) e `innerText` vacío. | Playwright |
| 509 | En `/usuarios`, pulsar `[data-testid="btn-toggle-activo"]` de la fila de prueba y confirmar deja su `aria-label` en `Activar`; volver a pulsar y confirmar lo deja en `Desactivar`. El `badge-estado-usuario` acompaña el cambio (criterio 204 sigue pasando). | Playwright |
| 510 | En `/catalogos/documentos`, `btn-editar-regla` y `btn-toggle-estado-regla` de la primera fila tienen `svg` y `aria-label`; ningún `button` de esa tabla tiene `innerText` con las palabras `Editar`, `Desactivar` o `Activar` visibles. | Playwright |
| 511 | Recorriendo **todos** los `button` de `/catalogos`, `/catalogos/documentos`, `/usuarios`, `/solicitudes` y `/depuracion/catalogos`: **0** botones con nombre accesible vacío (`aria-label`, `innerText` o `title` no vacío en alguno). | `page.$$eval` |

### Dimensiones y densidad (512–518)

| # | Criterio | Cómo verificar |
|---|---|---|
| 512 | A 1440×900, el `boundingBox()` de `[data-testid^="btn-editar-programas-"]` tiene `width` y `height` entre **30 y 34** px inclusive. | Playwright |
| 513 | A 390×844 (móvil), ese mismo botón tiene `width ≥ 44` y `height ≥ 44`. | Playwright |
| 514 | A 1440×900, `[data-testid="btn-nueva-regla"]` es visible, su `innerText` normalizado es `Nueva regla` y su `height` está entre **32 y 38** px. | Playwright |
| 515 | A 390×844, `[data-testid="btn-nueva-regla"]` tiene `height ≥ 44`. | Playwright |
| 516 | A 1440×900, en `/usuarios` la celda `td.acciones` de la primera fila tiene `width ≤ 160` px y su `display` computado es `flex`. | Playwright |
| 517 | A 1440×900, `getComputedStyle` de un `td` de `[data-testid="tabla-usuarios"]` devuelve `padding-top: 6px` y `padding-left: 10px`. | Playwright |
| 518 | A 1440×900, la altura de una `[data-testid="fila-usuario"]` es ≤ **44** px. | Playwright |

### Ancho del contenedor y columnas sin truncar (519–523)

| # | Criterio | Cómo verificar |
|---|---|---|
| 519 | A 1920×1080 en `/catalogos/documentos`, `getComputedStyle(document.querySelector('.contenido')).maxWidth === 'none'` y el `clientWidth` del `.contenido` es ≥ **80%** del `innerWidth` de la ventana. | Playwright |
| 520 | A 1920×1080 en `/sync` (pantalla sin `.pantalla-ancha`), `maxWidth` computado del `.contenido` es `1760px`. | Playwright |
| 521 | A 1440×900 en `/catalogos/documentos`, la celda de `Requisito` de la primera fila tiene `white-space: normal` computado y `scrollWidth <= clientWidth + 1` (texto no truncado). | Playwright |
| 522 | A 1440×900 en `/catalogos/documentos`, el `.tabla-contenedor` de `[data-testid="tabla-reglas-documentos"]` cumple `scrollWidth <= clientWidth + 1` (sin scroll horizontal). | Playwright |
| 523 | En `/catalogos` a 1440×900, `getComputedStyle(document.querySelector('.catalogos-layout')).maxWidth === 'none'`. | Playwright |

### Tema, contraste y focus (524–526)

| # | Criterio | Cómo verificar |
|---|---|---|
| 524 | Con `data-mode="dark"` y con `data-mode="light"`, el `color` computado del glifo de `[data-testid^="btn-editar-programas-"]` es **distinto** entre ambos modos y en ninguno de los dos coincide con el `background-color` computado del propio botón. | Playwright + toggle de tema |
| 525 | El contraste calculado (WCAG) entre `color` y `background-color` computados de `.boton-icono` (variante neutra y variante peligro) es **≥ 4.5:1** en ambos modos. | Playwright + función de contraste en `page.evaluate` |
| 526 | Enfocando `[data-testid="btn-editar-usuario"]` con teclado (`Tab`), `document.activeElement` es ese botón y su `outline-style` computado es `solid` con `outline-width` `2px`. | Playwright |

### No regresión (527–530)

| # | Criterio | Cómo verificar |
|---|---|---|
| 527 | Los **22** `data-testid` de §17.3.1 siguen existiendo en el DOM de sus pantallas (para los patrones `<entidad>-<id>`, al menos una ocurrencia por entidad presente en el árbol). Ningún testid nuevo aparece en esas filas. | Playwright |
| 528 | En `/solicitudes` y `/auditoria`, los enlaces de fila con texto `Ver` siguen siendo visibles (`toBeVisible()`) y navegan al detalle correspondiente. | Playwright |
| 529 | El bloque `.boton-icono` de `pwa/src/styles/componentes.css` no contiene ningún literal de color: `rg -n "#[0-9a-fA-F]{3}|rgb\(|hsl\(" ` sobre ese bloque devuelve **0** coincidencias; todos los colores son `var(--…)` ya definidos en `tokens.css`. | `rg` |
| 530 | `cd pwa && npm run typecheck && npm run build` terminan con código 0, y los criterios **1–503** siguen pasando con las dos salvedades textuales declaradas en §17.9 (`btn-quitar-concepto`, `btn-copiar-password`). | CLI + re-run del Evaluator |

**Definición de "terminado" (Build 11):** pasan los **27** criterios nuevos (504–530) **y** siguen
pasando los 503 anteriores. Total acumulado: **530** criterios.
