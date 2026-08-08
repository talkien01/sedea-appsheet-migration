# Findings — pass 2 · 2026-08-08

## Resumen
159/159 criterios del rubric pasan (60 del build original + 50 de staging/depuración + 49 de corrección+dashboard).

Se levantó la app con `docker compose up -d --build` remapeando puertos vía
`.env` (`POSTGRES_PORT_HOST=15432`, `BACKEND_PORT_HOST=13000`,
`PWA_PORT_HOST=18080`, `CORS_ORIGIN=http://localhost:18080`) porque 3000,
5432 y 8080 ya estaban ocupados en la máquina. Los 3 servicios (`db`,
`backend`, `pwa`) llegaron a `healthy`/`running` en ~30 s. Se re-verificó
íntegro el rubric 1–60 (regresión) y se verificó por primera vez en este pass
el rubric 61–159 (staging/depuración y corrección+dashboard), como usuario
real: `curl`/`psql` contra API y BD, y Playwright (Chromium, vía script
propio con `playwright` npm instalado en el scratchpad porque no había
skill `playwright-cli` disponible) contra la PWA para los 4 roles demo
(`capturista1`, `auditor1`, `editor1`, `admin`).

Los datos de staging (fixture de 12 filas) y catálogos (6 filas) ya estaban
importados de un pass anterior (persistían en el volumen de Postgres); se
verificó igualmente la idempotencia reejecutando el importador (`insertadas:0,
actualizadas:12`) y el `--dry-run`. Las acciones aprobar/descartar/fusionar
que se probaron por `curl` (criterios 91–99) y luego por Playwright
(105–107) consumieron progresivamente las filas `pendiente` del fixture;
esto es exactamente el comportamiento esperado (no es un hallazgo) y se
documenta en "Notas de verificación" para que quede claro por qué el conteo
de `estado=pendiente` bajó de 12 a 9 y luego menos durante la sesión — se
verificó explícitamente con el filtro `Todos` que las 12 filas originales
siguen existiendo con su trazabilidad completa.

## Abiertos
(ninguno)

## Resueltos (verificados este pass)

### Build 1 — regresión (criterios 1–60): SIN regresiones, 60/60 sigue en verde
- Infraestructura/BD (1–10): `docker compose config` sale 0; 3 servicios
  `healthy`; `/api/health` → `postgis:"3.4.3"`; 13 tablas en `public`
  (las 9 originales + `staging_beneficiarios`, `staging_catalogos`,
  `_migraciones`, `spatial_ref_sys`); `capturas.geom` = `geometry(Point,4326)`;
  índice GIST `idx_capturas_geom`; migraciones `001`–`009` numeradas,
  `001_extensiones.sql` con `CREATE EXTENSION IF NOT EXISTS postgis`; sin
  secretos literales en `backend/src`/`pwa/src`.
- Importación (11–15): `--help` documenta `--tipo/--archivo/--mapeo/--dry-run`;
  fixtures de ejemplo con clave `columnas`; import + reimport de
  `padron.staging.ejemplo.csv` idempotente; `datos_extra` conserva columnas
  no mapeadas. (Nota: 13–15 en su forma original apuntan a `beneficiarios`
  directo, que ya no aplica desde el build 2 — sustituidos operativamente
  por 69–80, tal como indica la nota del propio SPEC.)
- Auth/aislamiento por Regional (16–25): login válido/inválido correctos;
  401 sin token; `capturista1` solo ve `regional_id=1` incluso forzando
  `?regional_id=99`; 403 en beneficiario ajeno y en `/api/auditoria/capturas`;
  `auditor1` 200; `/api/catalogos` con las 4 llaves; paginación con
  `page/total/has_more`.
- Capturas e idempotencia (26–34): `POST /api/capturas` multipart real →
  201 `duplicado:false`; mismo uuid → 200 `duplicado:true`,
  `count(*) WHERE uuid=...`=1; `lat=999` → 422 sin insertar; sin foto → 422;
  `ST_X/ST_Y` coinciden con lng/lat; `GET /media/...` → 200 `image/jpeg`;
  filtro por municipio en auditoría correcto; `/geojson` FeatureCollection
  con `Point`; `/auditoria/log` con `login` y `captura_creada`.
- Exportaciones (35–38): CSV con headers y columnas correctas; PDF con
  `%PDF`; expediente CSV `text/csv`.
- PWA instalabilidad (39–40): manifest con `standalone`, iconos 192/512;
  `sw.js` y `registerSW.js` → 200.
- Playwright capturista (41–52): login válido/inválido; sync
  "14 de 14 beneficiarios descargados"; búsqueda reduce 16→3; selects
  encadenados con Regional deshabilitada; offline: `context.setOffline(true)`
  muestra "Sin conexión" (verificado antes de cualquier navegación — ver
  nota sobre `navigator.onLine`) y recargar `/beneficiarios` sigue
  mostrando 14 filas; precisión "±15 m", botón "Reintentar ubicación";
  foto+GPS+"Guardar captura" sube Pendientes 0→1; reconectar sincroniza a
  Pendientes:0 automáticamente; sin duplicados por uuid en BD.
- Playwright auditor (53–58): capturista ve "No tienes permiso"; auditor1 ve
  tabla (7 filas) + `.leaflet-container` con 6 marcadores; tiles
  `tile.openstreetmap.org` y atribución OSM visibles; filtros Regional/
  Municipio/fecha existen; rango imposible → "Sin resultados"; expediente
  PDF descarga `expediente_BEN-0018.pdf`; sin `arcgis/mapbox/googleapis` en
  `pwa/src`.
- Documentación (59–60): README con `EasyPanel`, `Hostinger`,
  `Cloudflare Tunnel`, sección "Protección de datos", comandos
  `docker compose up`/`npm run importar`, HTTPS, aislamiento por Regional,
  `auditoria_log`, usuarios demo con advertencia.

### Build 2 — staging/depuración (criterios 61–110)
- BD (61–68): `007_rol_editor_datos.sql`/`008_staging.sql` existen;
  `staging_beneficiarios` tiene las 6 columnas de flag como `boolean` +
  `datos_extra jsonb` + `estado_revision`/`revisado_por`/`revisado_en`;
  CHECK de `estado_revision` acepta exactamente los 4 valores con default
  `pendiente`; CHECK de `usuarios.rol` incluye `editor_datos`; columnas de
  `beneficiarios/capturas/usuarios/auditoria_log` intactas; 152 filas
  `tipos_apoyo` con `clave LIKE 'AP-%'`; 4 Regionales exactas (`Cadereyta`,
  `Jalpan`, `Querétaro`, `San Juan del Río`); login `editor1` → 200
  `rol:"editor_datos"`.
- Importador a staging (69–80): `--help` compatible; import de
  `padron.staging.ejemplo.csv` → 12 filas en `staging_beneficiarios`, 0
  cambio en `beneficiarios`; conteos exactos de flags:
  `folio_duplicado=2`, `curp_duplicada_mismo_concepto=2`,
  `curp_duplicada_concepto_distinto=2`, `sin_colonia=2`,
  `sin_coordenadas=2`, `concepto_no_reconocido=1`, `nivel_alerta='ninguna'`=2;
  100% en `estado_revision='pendiente'` tras importar (sin auto-acciones);
  reimportar es idempotente (`insertadas:0, actualizadas:12`); `--dry-run`
  no escribe; `datos_extra` con columnas no mapeadas + `auditoria_log`
  con `staging_import`.
- API staging — acceso (81–86): 401 sin token; 403 `capturista`/`auditor`;
  200 `editor1`/`admin` con `data/page/total/has_more`; `editor1` recibe 403
  en `/api/beneficiarios` y `/api/auditoria/capturas`.
- API staging — consulta (87–90): filtros por alerta exactos (`total=2` para
  `folio_duplicado` y `curp_duplicada_concepto_distinto`); detalle con
  `relacionadas.staging` y `motivo_relacion='folio'`; `/resumen` con
  `por_estado.pendiente=12` y las 6 llaves de `por_alerta`.
- API staging — acciones (91–99): aprobar → 200 + `beneficiario_id`,
  `count(beneficiarios)` +1, `revisado_por/revisado_en` no nulos; repetir
  aprobar → 409, sin doble incremento; descartar → 200 sin tocar
  `beneficiarios`; fusionar (folio duplicado) → 200, secundaria
  `fusionado` con `fusionado_en_id`, principal sigue `pendiente`, sin
  cambio en `beneficiarios`; `principal_id ∈ secundarios_ids` → 422;
  `secundario` inexistente → 422; `auditor`/`capturista` → 403 en aprobar;
  `auditoria_log` contiene `staging_aprobado/descartado/fusionado`; catálogo
  staging con `clave_duplicada total=2`; aprobar/descartar catálogo mueve/
  no mueve `catalogos` según corresponda.
- PWA depuración (100–108): login `editor1` → `/depuracion`; tabla con
  badges en español; filtro por alerta reduce a la cuenta exacta esperada
  (`sin_colonia`→2 filas, verificado con datos aún no tocados por las
  pruebas de API); combinación sin coincidencias → "Sin resultados";
  tarjetas de resumen Pendientes/Aprobados/Descartados/Fusionados;
  comparador con ≥2 candidatos y botones Aprobar/Descartar/Fusionar
  visibles; flujo completo de Aprobar (confirm nativo → estado "Aprobado",
  desaparece del filtro Pendiente), Descartar (aparece en filtro
  Descartado) y Fusionar vía checkbox `chk-candidata` (secundaria queda
  "Fusionada" en el filtro correspondiente) verificados de punta a punta
  en el navegador; `capturista1`→`/depuracion` y `editor1`→`/beneficiarios`
  y `/auditoria` muestran "No tienes permiso"; `admin` accede a las tres
  sin bloqueo.
- Documentación (109–110): ningún `.xlsx` en `git ls-files`,
  `scripts/datos-ejemplo/` sin `.xlsx`, `.gitignore` cubre `*.xlsx`; README
  documenta `editor_datos`/`editor1`, destino a staging, los 6 flags, las 3
  acciones y la regla de "apoyos distintos no se auto-descartan".

### Build 3 — corrección + dashboard (criterios 111–159)
- BD (111–113): `009_indices_estadisticas.sql` con los 2 índices nuevos;
  columnas de `beneficiarios/capturas/usuarios/auditoria_log` sin cambios;
  ninguna tabla `estadisticas_*`/`metricas_*`/`dashboard_*`.
- PATCH edición correctiva (114–127): 401 sin token; 403 `capturista`/
  `auditor` sin cambios en BD; `editor1` cambia `colonia` → 200 con
  `cambios` y persistencia en BD; `admin` normaliza teléfono
  `(442) 123-4567`→`4421234567`; `curp`/`folio` → 422 `campo_no_editable`
  sin tocar BD (incluido el caso mixto: payload con `colonia`+`curp` se
  rechaza atómicamente, `colonia` tampoco cambia); `nombre_completo`,
  `tipo_apoyo_id`, `regional_id` → 422 en los tres; `telefono` inválido →
  422 `telefono_invalido`; `municipio_id` inexistente → 422
  `municipio_invalido`; id inexistente → 404; body `{}` → 422 `sin_cambios`;
  cambiar `municipio_id` a otra Regional deriva automáticamente
  `beneficiarios.regional_id` (verificado con cambio real 1→3, registrado
  también en `cambios`); `auditoria_log` con `beneficiario_editado` y
  `detalle.cambios[]`; `POST`/`DELETE /api/beneficiarios` → 404 (no
  implementados, cumple "sin alta/baja manual").
- Lectura para corrección (128–131): búsqueda por nombre con
  `page/total/has_more`; 401/403 correctos; detalle con `curp`, `folio`,
  los 5 campos editables y `municipios_disponibles` no vacío; historial con
  `fecha/usuario/cambios[].campo`; colección `/api/beneficiarios` sigue en
  403 para `editor_datos` (no se debilitó la regla del build 2).
- Estadísticas (132–141): 401/403 correctos para `capturista`; `cobertura`
  con `global/por_regional/por_municipio`, sumas consistentes
  (`con_captura+sin_captura=total`) en global y en cada Regional;
  `total_beneficiarios` y `con_captura` globales coinciden con `COUNT`/
  `COUNT DISTINCT` directos en BD; `por_regional` con exactamente las 4
  Regionales; `apoyos` con `data.length≤15` ordenado desc, `otros` presente,
  suma `data+otros = total_capturas = COUNT(*) capturas`; `avance` con
  zero-fill exacto (`data.length===7` para 7 días), `acumulado` no
  decreciente, `agrupacion=semana` 200, `agrupacion=mes` 422; `staging` con
  las 4 llaves y `pendiente` coincide con la BD.
- PWA dashboard (142–150): `chart.js` en `dependencies`, sin
  `react-chartjs-2`/`recharts`/`apexcharts`/`highcharts`/CDN de gráficas;
  `admin` ve `nav-dashboard`, `capturista1` no lo ve y navegar directo
  muestra "No tienes permiso"; `auditor1`/`editor1` ven "Dashboard de
  seguimiento"; los 4 `canvas` (`grafica-cobertura/apoyos/avance/staging`)
  visibles con `boundingBox().width>0`; las 4 tarjetas de cobertura con
  contenido numérico (`% ` al final); tabla de cobertura por municipio con
  ≥1 fila; cambiar Regional en el filtro modifica los datos sin recargar
  (total 42→15 al filtrar); cambiar agrupación Día→Semana cambia el texto
  de resumen (30→12 periodos); rango de fechas imposible muestra "Sin datos
  para el filtro seleccionado.".
- PWA edición correctiva (151–157): `capturista1` no ve
  `btn-editar-datos` (0 elementos) pero sí "Capturar apoyo"; `editor1` en
  `/correcciones` busca, ve tabla con filas, pulsa "Corregir" y llega a la
  ficha con `btn-editar-datos` visible; el formulario expone los 5 campos
  editables y `input-curp`/`input-folio` deshabilitados/readonly con la
  leyenda explicativa; guardar colonia muestra toast de éxito y persiste
  tras recargar; teléfono `12` muestra error en español y no cambia en BD;
  `admin` en `/beneficiarios/:id` (offline-first, tras sync) también ve y
  usa el botón de edición, cambio de domicilio persiste; no existe ningún
  control ni texto "Nuevo/Agregar/Alta de beneficiario" en `/beneficiarios`,
  `/correcciones` ni `/depuracion`.
- Documentación (158–159): README documenta los 5 campos editables, el
  bloqueo permanente de CURP/Folio con su justificación, los roles
  autorizados y la bitácora con valor anterior/nuevo; sección de dashboard
  documenta las 4 métricas, los 3 roles con acceso, Chart.js como única
  dependencia nueva y la ausencia de alta manual de beneficiarios.

## Notas de verificación
- **Playwright sin skill dedicada**: se instaló `playwright@1.62.1` como
  dependencia local en un directorio de scratchpad (Chromium ya estaba
  cacheado por una instalación global previa) y se escribieron scripts
  Node ad hoc por pantalla/rol en vez de usar un runner de tests. Todos los
  scripts se ejecutaron contra los contenedores reales, no mocks.
- **`navigator.onLine` tras `page.goto()` en offline** (mismo comportamiento
  documentado en el pass 1): en este entorno Chromium/Playwright,
  `navigator.onLine` vuelve a `true` después de una navegación (`goto`)
  aunque `context.setOffline(true)` siga activo. El criterio 47 se verificó
  leyendo la barra de estado inmediatamente después de `setOffline(true)`
  (sin navegación de por medio), donde "Sin conexión" se muestra
  correctamente; el criterio 46 (que sí exige recargar) se cumple igual
  porque solo exige que siga mostrando la lista, no el texto de estado.
  No se cuenta como hallazgo de la app.
- **Orden de las pruebas y estado mutable del staging**: las pruebas de API
  (curl, criterios 91–99) y las de Playwright (100–108) actúan sobre el
  mismo fixture de 12 filas y lo van resolviendo (aprobando/descartando/
  fusionando) a medida que se ejecutan, por diseño del propio flujo de
  trabajo que se está probando. Esto hizo que el conteo por defecto de
  "Pendiente" bajara de 12 a 9 antes de llegar a la verificación Playwright
  del criterio 101; se confirmó explícitamente con el filtro `Todos` que
  las 12 filas siguen presentes con su historial completo, y se usaron
  flags aún no tocados (`sin_colonia`) para las aserciones de conteo exacto
  del criterio 102. No es un defecto de la aplicación.
- Contenedores, `.env` y archivos temporales de esta corrida se eliminaron
  al finalizar (`docker compose down`, borrado de `.env` y de los archivos
  sueltos en `/tmp`). Los scripts de Playwright quedaron en el directorio
  de scratchpad de la sesión, fuera del repo.
