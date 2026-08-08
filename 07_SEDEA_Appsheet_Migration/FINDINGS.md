# Findings — pass 1 · 2026-08-08

## Resumen
60/60 criterios del rubric pasan.

Se levantó la app con `docker compose up -d --build` remapeando puertos vía
`.env` (`POSTGRES_PORT_HOST=15432`, `BACKEND_PORT_HOST=13000`,
`PWA_PORT_HOST=18080`, `CORS_ORIGIN=http://localhost:18080`) porque 3000 y 5432
ya estaban ocupados en la máquina. Los 3 servicios (`db`, `backend`, `pwa`)
llegaron a `healthy` en ~20 s. Se verificó cada criterio como usuario real:
`curl` contra la API (E1–E15, rubric #1–40) y Playwright (Chromium) contra la
PWA (rubric #41–58) para los flujos de capturista (login, sync, listado,
búsqueda, selects encadenados, captura offline foto+GPS, cola de sync,
sincronización idempotente) y auditor (panel con Leaflet/OSM, filtros,
expediente PDF/CSV). También se ejecutó el importador CLI dos veces para
comprobar idempotencia y `datos_extra`.

## Abiertos
(ninguno)

## Resueltos (verificados este pass)
- [x] Infraestructura y BD (criterios 1–10): `docker compose config` sale 0;
  los 3 servicios quedan `healthy`; `GET /api/health` → `200 {"ok":true,"db":true,"postgis":"3.4.3"}`;
  `SELECT postgis_version()` OK; existen las 9 tablas; `capturas.geom` es
  `geometry(Point,4326)`; existe `idx_capturas_geom` GIST; `db/migrations/`
  numeradas con `001_extensiones.sql` conteniendo `CREATE EXTENSION IF NOT
  EXISTS postgis`; `.env.example` trae `JWT_SECRET`, `DATABASE_URL`,
  `MEDIA_DIR` con placeholders `cambiame*`; no hay secretos literales en
  `backend/src` ni `pwa/src`.
- [x] Importación (11–15): `npm run importar -- --help` sale 0 con
  `--tipo/--archivo/--mapeo/--dry-run`; existen `scripts/mapeos/padron.ejemplo.json`
  y `scripts/datos-ejemplo/padron.ejemplo.csv` con clave `columnas`;
  primera ejecución inserta 10 filas y crea fila en `importaciones`; segunda
  ejecución (mismo archivo) actualiza 10, `COUNT(*)` de `beneficiarios` no
  cambia (40→40); columnas no mapeadas (`CICLO AGRICOLA`,
  `OBSERVACIONES DE CAMPO`) aparecen en `beneficiarios.datos_extra`.
- [x] Auth y aislamiento por Regional (16–25): login válido devuelve `token`;
  password incorrecto → 401 sin token; sin `Authorization` → 401; capturista1
  (Regional Centro) solo ve `regional_id=1` en `/api/beneficiarios`, incluso
  pasando `?regional_id=99` (se ignora); `GET /api/beneficiarios/:id` de otra
  Regional → 403; `capturista` en `/api/auditoria/capturas` → 403; `auditor1`
  → 200 con `data`; `/api/catalogos` trae `regionales/municipios/tipos_apoyo`;
  paginación `page_size=5` respeta `data.length≤5` y trae `page/total/has_more`.
- [x] Capturas e idempotencia (26–34): `POST /api/capturas` multipart con foto
  JPEG real → 201 `duplicado:false` con `foto_url`; repetir mismo uuid → 200
  `duplicado:true`, `COUNT(*) WHERE uuid=...`=1; `lat=999` → 422 sin insertar;
  sin foto → 422; `ST_X(geom)/ST_Y(geom)` coinciden con `lng/lat` enviados;
  `GET /media/<ruta>` con token → 200 `image/jpeg`; filtro por
  `municipio_id` en auditoría devuelve solo ese municipio; `/api/auditoria/geojson`
  → `FeatureCollection` con `geometry.type:"Point"`; `/api/auditoria/log` (admin)
  contiene `login`, `login_fallido`, `sync_padron`, `captura_creada`,
  `captura_duplicada`, `import_padron`.
- [x] Exportaciones (35–38): `export.csv` → `text/csv`,
  `Content-Disposition: attachment`, cabecera con
  `beneficiario,curp,regional,municipio,colonia,seccion,lat,lng,precision_m,capturado_en,capturista`;
  `expediente/:id.pdf` → `application/pdf`, cuerpo inicia con `%PDF`;
  `expediente/:id.csv` → `text/csv`.
- [x] PWA instalabilidad (39–40): `GET $APP/` → 200; `manifest.webmanifest` →
  200 con `name`, `display:"standalone"`, iconos 192/512; `sw.js` y
  `registerSW.js` → 200.
- [x] Playwright — flujo capturista (41–52): login válido navega fuera de
  `/login` (→ `/sync`) y muestra "Capturista Regional Centro"; credenciales
  inválidas mantienen `/login` y muestran "Usuario o contraseña incorrectos.";
  en `/sync`, "Descargar padrón y catálogos" muestra "14 de 14 beneficiarios
  descargados" y fecha `08/08/2026 ...`; `/beneficiarios` filtra de 16→3
  filas al buscar "Hermelinda"; existen `data-testid=select-regional/municipio/colonia/seccion`,
  el de Regional está `disabled` para capturista; con `context.setOffline(true)`
  la barra de estado muestra "Sin conexión" y recargar `/beneficiarios`
  sigue mostrando la lista (14 beneficiarios) sin pantalla de error; en la
  captura offline se ve "Latitud/Longitud" y "Precisión: ±15 m", y existe
  botón "Reintentar ubicación"; adjuntar foto + "Guardar captura" hace subir
  "Pendientes" de 0 a 1; al volver online, la sincronización automática deja
  "Pendientes: 0" y el estado de la captura pasa a sincronizada.
- [x] Playwright — panel de auditoría (53–58): un `capturista` en `/auditoria`
  ve "No tienes permiso para ver esta sección." sin tabla; `auditor1` ve
  tabla con filas y `.leaflet-container` con `.leaflet-marker-icon` (3
  marcadores); hay `img.leaflet-tile` con `src` conteniendo
  `tile.openstreetmap.org` y atribución "© Colaboradores de OpenStreetMap"
  visible; existen filtros de Regional, Municipio y fecha desde/hasta; un
  rango de fechas imposible (2099) deja la tabla vacía con mensaje "Sin
  resultados"; en el expediente, "Descargar expediente PDF" dispara una
  descarga `expediente_BEN-0007.pdf`; `grep -i` en `pwa/src` no encuentra
  `arcgis`, `mapbox` ni `googleapis`.
- [x] Documentación (59–60): `README.md` contiene `EasyPanel`, `Hostinger`,
  `Cloudflare Tunnel`, sección `## Protección de datos`, comandos
  `docker compose up` y `npm run importar`; documenta HTTPS obligatorio,
  aislamiento por Regional en capa SQL, bitácora `auditoria_log`, y lista
  los usuarios demo (`admin`, `capturista1`, `auditor1`) con advertencia de
  cambiarlos en producción.

## Notas de verificación
- Puertos remapeados solo para esta corrida del Evaluator (`.env` local, no
  commiteado); el `docker-compose.yml` soporta esto de forma nativa vía
  `*_PORT_HOST`, documentado en el README.
- Se observó que `navigator.onLine` se resetea a `true` en Chromium/Playwright
  tras un `page.reload()` posterior a `context.setOffline(true)` (posible
  particularidad del entorno de prueba, no reproducido como error de UI: antes
  del reload la barra de estado sí mostraba "Sin conexión" correctamente, y
  el criterio 46 solo exige que la lista siga visible tras recargar, lo cual
  se cumplió). No se contabiliza como hallazgo porque los criterios 46 y 47 no
  exigen el texto "Sin conexión" específicamente después del reload.
- Contenedores y `.env`/tempfiles de prueba se eliminaron al finalizar
  (`docker compose down`, `rm -rf .evaltmp .env`).
