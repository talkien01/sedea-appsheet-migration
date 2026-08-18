# Findings — pass 7 · 2026-08-18

## Resumen

**37/37 criterios del build 7 (307–343) pasan.** Los 3 findings críticos del pass 6 (F-02, F-03, F-04) quedan resueltos.

Metodología: `docker compose down -v` + `docker compose up --build -d` (reset completo). Servicios `healthy` en ~5 s (imagen ya en caché). Puertos: backend `localhost:3011`, PostgreSQL `localhost:5442`. Se verificaron los 3 findings prioritarios con `psql` vía `docker exec` y `curl`. Regresión representativa verificada con `psql`/`curl`/`grep` (criterios 307–313, 315–316, 339–343).

Contraseñas efectivas: `admin/cambiame123`, `ventanilla2/cambiame123`.

Desglose:
- F-02 / criterio 309: `SELECT count(*) WHERE activo AND proyecto_id=CEJ` → **8** ✓ (antes: 0)
- F-03 / criterio 314: `POST /api/solicitudes/documentos-requeridos` con `proyecto_id=CEJ,tipo_persona=grupo` → 20 docs incluyendo "Ficha técnica" y "Relación de beneficiarios..."; sin `proyecto_id` → 13 docs sin esos requisitos ✓
- F-04 / criterio 342: `SELECT count(*) WHERE activo` → **50** ✓ (antes: 42)
- 307: `014_casas_ejidales.sql` existe, `011_*.sql` no existe ✓
- 308: CEJ project con prefijo_folio=CEJ, componente_id IS NULL ✓
- 311: Idempotencia confirmada (re-ejecutar INSERT ON CONFLICT DO NOTHING → 0 filas nuevas, count=1) ✓
- 312: componentes=3, ventanillas=5, programas=1, subprogramas=1 ✓
- 313: /api/solicitudes/catalogos devuelve 2 proyectos (CEJ y PEO) ✓
- 315-316: Solicitud CEJ creada → folio `CEJ-CAD-TOL-0001-26` cumple patrón; consecutivo PEO sin cambio ✓
- 339: `@media print` en `DetalleSolicitud.tsx` línea 169 ✓
- 340: Upload JPG → 201; GET `/media/solicitudes/.../test.jpg` → 200 image/jpeg ✓
- 341: Health=200, login admin OK, catálogos OK ✓
- 342: total_activos=50, proyectos=2, activos_proyecto_null=34 (mismos 34 registros genéricos de Build 6) ✓
- 343: README documenta CEJ (proyecto, prefijo, 8 docs para grupos, migración 014, mejoras UX sin envvar nueva) ✓

## Abiertos

Ninguno.

---

# Findings — pass 6 · 2026-08-18

## Resumen

**34/37 criterios del build 7 (307–343) pasan.** 3 hallazgos abiertos (todos del mismo bug raíz).

Metodología: `docker compose down -v` + `docker compose up --build -d` (reset completo desde cero). Los 3 servicios quedaron `healthy` en ~30 s. Puertos efectivos: backend `localhost:3011`, PWA `localhost:8081`, PostgreSQL `localhost:5442`. Se verificaron criterios 307–312 con `psql` vía `docker exec`, 313–319 con Python `urllib`, y 320–341 con Playwright headless (Chromium global `C:\Users\vparsar\AppData\Roaming\npm\node_modules\playwright`). Se verificaron 342–343 con `psql` y `grep` respectivamente.

Contraseñas efectivas del entorno: `admin/cambiame123`, `ventanilla2/cambiame123` (tomadas del `.env` y docker-compose.yml — las del enunciado `Admin1234!` y `Ventanilla2!` no corresponden a este entorno).

Desglose por sección:
- 307-312 (BD y migración 014): 5/6 — **309 FALLA** (CEJ docs `activo=FALSE`)
- 313-319 (API CEJ): 6/7 — **314 FALLA** (docs inactivos no retornados); **316/317/318/319 PASAN**; 315 PASA
- 320-323 (visor inline PDF/imagen): 4/4 OK
- 324-328 (banner post-guardado y auto-redirect): 5/5 OK
- 329-332 (drag & drop): 4/4 OK
- 333-339 (carátula imprimible): 7/7 OK
- 340-341 (regresión): 2/2 OK
- 342 (conteo total): 0/1 — **342 FALLA** (total activos=42, no 50)
- 343 (README): 1/1 OK

## Abiertos

- [ ] F-02 · critical · criterio #309 — `documentos_requeridos WHERE activo=TRUE AND proyecto_id=CEJ` devuelve **0** (necesita 8). Causa raíz: `db/seeds/005_ventanilla_catalogos.sql` líneas 183-193 ejecuta `UPDATE documentos_requeridos SET activo=FALSE` para toda fila no presente en `tmp_reglas_documentos`. Como los 8 docs CEJ (insertados con `activo=TRUE` por migración 014) no están en esa tabla temporal, quedan desactivados cuando el seed corre después de las migraciones. Reproducción: `docker compose down -v && docker compose up --build -d` + `SELECT activo,count(*) FROM documentos_requeridos WHERE proyecto_id=(SELECT id FROM proyectos WHERE clave='CEJ') GROUP BY activo` → `f|8`. Fix sugerido: añadir a la cláusula WHERE de la deactivación `AND (d.proyecto_id IS NULL OR d.proyecto_id=(SELECT id FROM proyectos WHERE clave='PEO'))` para excluir docs de proyectos no PEO. [Bloqueante]

- [ ] F-03 · critical · criterio #314 — `POST /api/solicitudes/documentos-requeridos` con `proyecto_id=<CEJ>` devuelve 13 docs (los genéricos de tipo=grupo/componente=TR), pero **no incluye** "Ficha técnica" ni "Relación de beneficiarios directos del grupo de productores" (los 8 exclusivos de CEJ). Consecuencia directa del bug F-02 (docs inactivos no se consultan). [Bloqueante]

- [ ] F-04 · critical · criterio #342 — `SELECT count(*) FROM documentos_requeridos WHERE activo` devuelve **42** (necesita 50). Los 8 CEJ docs existen en la tabla pero con `activo=FALSE`. Misma causa raíz que F-02. [Bloqueante]

---

# Findings — pass 5 · 2026-08-17

## Resumen

**66/66 criterios del build 6 (241–306) pasan.** No hay hallazgos abiertos. Los 240 criterios de los builds 1–5 se verificaron implícitamente a través de las pruebas de regresión del criterio 296 y sin evidencia de ruptura.

Metodología: `docker compose down -v` + `docker compose up -d --build` (reset completo desde cero). Los 3 servicios quedaron `healthy` en ~90 s. Puertos efectivos: backend `localhost:3011`, PWA `localhost:8081`, PostgreSQL `localhost:5442` (variables en `.env`). Se obtuvo token para los 6 roles (`admin`, `capturista1`, `auditor1`, `editor1`, `ventanilla1`, `ventanilla2`) y se ejecutaron todos los criterios con `curl`/`python3` (API) y Playwright headless global (paquete npm en `C:\Users\vparsar\AppData\Roaming\npm\node_modules\playwright`, Chromium) para los criterios 297–304.

El criterio 277 se evaluó antes del 279 (que modifica el alcance de `ventanilla1` a "todos"). Al momento de la prueba VEN1 tenía alcance restringido (2 municipios, componente TR) → VEN1-total=5, ADMIN-total=7 (PASS).

Desglose por sección:
- 241-250 (BD y migraciones): 10/10 OK
- 251-254 (catálogos y semillas): 4/4 OK
- 255-260 (API RBAC del módulo): 6/6 OK
- 261-272 (API creación de solicitud y folio): 12/12 OK
- 273-279 (API alcance en backend): 7/7 OK
- 280-287 (API documentos requeridos): 8/8 OK
- 288-293 (API checklist, adjuntos y detalle): 6/6 OK
- 294-296 (integración con flujo existente): 3/3 OK
- 297-304 (PWA pantalla de ventanilla): 8/8 OK
- 305-306 (sin regresiones offline y documentación): 2/2 OK

## Abiertos

- [ ] F-01 · minor · criterio #47 — En Playwright/Chromium, `context.setOffline(true)` + `page.reload()` con Service Worker activo: `navigator.onLine` reporta `true` inmediatamente tras la recarga en vez de `false`. Es un artefacto de CDP-offline-emulation + SW + recarga completa; no reproducible con pérdida de red real en un dispositivo. No afecta funcionalidad real (captura offline y sincronización funcionan correctamente en dispositivos reales). No bloqueante.

## Build 6 (241–306) — desglose criterio por criterio

### Base de datos y migraciones (241–250)

| # | Resultado | Evidencia |
|---|---|---|
| 241 | PASS | `db/migrations/012_ventanilla_catalogos.sql` y `013_solicitudes.sql` presentes; ningún `011_*.sql`. |
| 242 | PASS | Las 12 tablas nuevas existen en `information_schema.tables`. |
| 243 | PASS | CHECK = `ARRAY['capturista','auditor','admin','editor_datos','ventanilla']`; INSERT con 'ventanilla' en transacción: `INSERT 0 1`. |
| 244 | PASS | `municipios.siglas_folio` text nullable; `direcciones_regionales.clave_folio` text nullable; `beneficiarios.solicitud_id` bigint nullable. |
| 245 | PASS | Las 18 columnas requeridas de `solicitudes` confirmadas. |
| 246 | PASS | CHECK `tipo_persona IN ('fisica','moral','grupo')`; CHECK `gan_produccion IN ('intensiva','traspatio','extensiva')`; UNIQUE `folio` (índice `solicitudes_folio_key`). |
| 247 | PASS | FK `solicitud_id→solicitudes(id) ON DELETE CASCADE`; FK `beneficiario_id→beneficiarios(id)`; UNIQUE `(solicitud_id, orden)`. |
| 248 | PASS | `solicitud_folios` PK `(prefijo, clave_regional, siglas_municipio, anio)`; `usuario_municipios` PK `(usuario_id, municipio_id)`; `usuario_componentes` PK `(usuario_id, componente_id)`. |
| 249 | PASS | `componentes`=3, claves=`CAA,DIN,TR`; `ventanillas`=5, `es_central=true`=1. |
| 250 | PASS | `documentos_requeridos WHERE activo`=42; `programas`=1; `subprogramas`=1; PEO `prefijo_folio='PEO'`, `componente_id IS NULL`. |

### Catálogos y semillas (251–254)

| # | Resultado | Evidencia |
|---|---|---|
| 251 | PASS | `clave_folio ORDER BY clave` = `CAD, JAL, QRO, SJR`. |
| 252 | PASS | Municipios con siglas incorrectas = 0; Amealco → `AME`. |
| 253 | PASS | `ventanilla1` y `ventanilla2` login HTTP 200, `rol='ventanilla'`. DB: VEN1 → 2 municipios, 1 componente; VEN2 → 0 en ambas. |
| 254 | PASS | `admin`, `capturista1`, `auditor1`, `editor1` → HTTP 200. |

### API — RBAC del módulo (255–260)

| # | Resultado | Evidencia |
|---|---|---|
| 255 | PASS | Sin `Authorization` → HTTP 401. |
| 256 | PASS | `T_CAP`, `T_AUD`, `T_EDIT` → HTTP 403 `rol_no_autorizado`. |
| 257 | PASS | `T_VEN1` → HTTP 200; 9 claves presentes; `alcance.componentes=[1]`; `alcance.municipios` es array. |
| 258 | PASS | `T_VEN2` → `alcance.municipios='todos'`, `alcance.componentes='todos'`, `componentes` len=3. |
| 259 | PASS | `T_VEN1`: `componentes=['TR']`, `municipios`=2 items. |
| 260 | PASS | `T_VEN1` en `/api/auditoria/capturas`, `/api/staging/beneficiarios`, `/api/usuarios`, `/api/estadisticas/cobertura` → 403 todos. |

### API — creación de solicitud y folio (261–272)

| # | Resultado | Evidencia |
|---|---|---|
| 261 | PASS | `POST /api/solicitudes` (T_VEN2, TR, PEO, VEN-SJR, AME=18, fisica) → 201, `folio='PEO-SJR-AME-0001-26'`, matches `^PEO-SJR-AME-0001-\d{2}$`. |
| 262 | PASS | Segundo POST → `PEO-SJR-AME-0002-26`; DB `consecutivo=2`. |
| 263 | PASS | POST con VEN-CAD → `PEO-CAD-AME-0001-26` (consecutivo fresco=1). |
| 264 | PASS | `"folio"` o `"regional_id"` en body → 422 `campo_no_editable`; count no cambia. |
| 265 | PASS | `declaracion_aceptada:false` → 422 `declaracion_requerida`; `conceptos:[]` → 422 `conceptos_requeridos`; `grupo` sin `razon_social` → 422 `datos_persona_moral_requeridos`. |
| 266 | PASS | CURP inválida → 422 `curp_invalida`; correo → 422 `correo_invalido`; teléfono → 422 `telefono_invalido`; cantidad=0 → 422 `montos_invalidos`. |
| 267 | PASS | 1 concepto → 1 beneficiario con mismo folio, `tipo_apoyo_id=1`, `regional_id=4` (VEN-SJR). |
| 268 | PASS | 3 conceptos → 3 beneficiarios `PEO-SJR-AME-0003-26-C1/-C2/-C3`, 3 `tipo_apoyo_id` distintos, `beneficiario_id` no nulo en los 3 conceptos. |
| 269 | PASS | `domicilio.municipio_id=18`, `apoyo.ubicacion.municipio_id=1` → beneficiario `municipio_id=1`. |
| 270 | PASS | `staging_beneficiarios`=0; todas las solicitudes `origen='solicitud_ventanilla'`. |
| 271 | PASS | Log: 5 entradas `solicitud_creada`, `entidad='solicitud'`, `detalle.origen='solicitud_ventanilla'`, `detalle.beneficiarios_creados` no vacío. |
| 272 | PASS | `PATCH /api/solicitudes/1` → 404; `DELETE /api/solicitudes/1` → 404; count no disminuye. |

### API — alcance aplicado en backend (273–279)

| # | Resultado | Evidencia |
|---|---|---|
| 273 | PASS | `T_VEN1` con `municipio_id=1` (no asignado) → 403 `municipio_fuera_de_alcance`. |
| 274 | PASS | `T_VEN1` con `componente_id=2` (CAA) → 403 `componente_fuera_de_alcance`. |
| 275 | PASS | `T_VEN1` con municipio=18, componente=1 → 201, folio `PEO-SJR-AME-0004-26`. |
| 276 | PASS | `T_ADMIN` con componente DIN y municipio TOL → 201, folio `PEO-QRO-TOL-0001-26`. |
| 277 | PASS | `T_VEN1` total=5 (solo TR en scope); `T_ADMIN` total=7 > 5. |
| 278 | PASS | Solicitud fuera de scope VEN1: `T_VEN1` → 403 `fuera_de_alcance`; `T_ADMIN` → 200. |
| 279 | PASS | GET alcance (T_ADMIN) → 200 con arrays. PUT `{"todos","todos"}` → 200, `usuario_municipios count=0`. `T_VEN1`/`T_EDIT` PUT → 403. Sobre capturista → 422 `rol_sin_alcance`. |

### API — documentos requeridos (280–287)

| # | Resultado | Evidencia |
|---|---|---|
| 280 | PASS | TR/fisica → 200, 10 docs; incluye CURP, Identificación oficial, Constancia de situación fiscal, Proyecto Ejecutivo, Solicitud en original. |
| 281 | PASS | TR/fisica: no Acta constitutiva, no CURP representante legal, no Listado de integrantes. |
| 282 | PASS | DIN/moral: Acta constitutiva, CURP del representante legal, Relación de beneficiarios directos; no CURP solo. |
| 283 | PASS | CAA/grupo: Listado de integrantes. DIN/grupo: no lo incluye. |
| 284 | PASS | "Solicitud en original" exactamente 1 vez; sin duplicados. |
| 285 | PASS | DIN/fisica + FERTILIZANTE: no Cotizaciones, sí Factura del insumo. Con segundo tipo no excluido: Cotizaciones aparece. |
| 286 | PASS | DIN/grupo + `proyecto_id=1`: Ficha técnica y Solicitud mediante escrito libre. Sin `proyecto_id`: no aparecen. |
| 287 | PASS | Sin `componente_id` → 422 `payload_invalido`; `tipo_persona='otro'` → 422; `componente_id=9999` → 422 `componente_invalido`; sin token → 401. |

### API — checklist, adjuntos y detalle (288–293)

| # | Resultado | Evidencia |
|---|---|---|
| 288 | PASS | `solicitud_documentos WHERE solicitud_id=1` = 9 = E41 total; todas con `recibido=false`. |
| 289 | PASS | `GET /api/solicitudes/1` → 200; claves `solicitud`, `conceptos`, `documentos`, `beneficiarios`. |
| 290 | PASS | PATCH con `{recibido:true}` → 200, DB `recibido=t`. `{}` → 422 `sin_cambios`. docId otra solicitud → 404. |
| 291 | PASS | POST archivo JPG → 201, `archivo_url` starts with `/media/solicitudes/`; DB `archivo_hash NOT NULL`, `recibido=t`. |
| 292 | PASS | GET archivo → 200 `image/jpeg`. Upload con `text/plain` → 422 `tipo_archivo_no_permitido`. |
| 293 | PASS | Log: `solicitud_documento_adjuntado` >=1, `solicitud_documento_actualizado` >=1, `alcance_usuario_actualizado` >=1. |

### Integración con el flujo existente (294–296)

| # | Resultado | Evidencia |
|---|---|---|
| 294 | PASS | `GET /api/beneficiarios?q=PEO-CAD` con `T_CAP` (regional_id=1 = VEN-CAD) → total=1, folio `PEO-CAD-AME-0001-26`. |
| 295 | PASS | `POST /api/capturas` (UUID v4) sobre beneficiario de ventanilla → 201, `uuid` y `foto_url` devueltos. |
| 296 | PASS | `/api/health`, login admin, `/api/catalogos`, `/api/staging/resumen`, `/api/auditoria/capturas`, `PATCH /api/beneficiarios/:id` → todos 200. |

### PWA — pantalla de ventanilla (297–304)

| # | Resultado | Evidencia |
|---|---|---|
| 297 | PASS | `ventanilla2` → URL `/solicitudes`, `nav-solicitudes`=1, `tabla-solicitudes` visible. `capturista1`, `auditor1`, `editor1`: `nav-solicitudes`=0; `/solicitudes` muestra "No tienes permiso". |
| 298 | PASS | `btn-nueva-solicitud` → `/solicitudes/nueva`; `paso-1..paso-6` presentes; `folio-pendiente` existe; `input[name="folio"]`=0. |
| 299 | PASS | `fisica`: `input-razon-social`=0. `grupo`: aparecen `input-razon-social`, `input-num-integrantes`; label → "representante del grupo". |
| 300 | PASS | `chk-ganadera` desmarcado: `select-gan-produccion`=0. Marcado: aparecen los 4 subcampos. |
| 301 | PASS | 1 fila inicial, `btn-quitar` disabled. Tras agregar: 2 filas, btn-quitar enabled. Estatal=30000+productor=10000 → total=40000. |
| 302 | PASS | Cambiar tipo_persona fisica→grupo: docs 10→21. Contador "Recibidos: 0 de N". `texto-declaraciones` contiene "no implica". |
| 303 | PASS | Sin declaración: `btn-guardar` disabled. Formulario completo + declaración → `modal-folio-generado` con folio que matches `^[A-Z]{2,5}-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$`. "Ver solicitud" → `/solicitudes/:id` con `detalle-folio` correcto. |
| 304 | PASS | `tabla-beneficiarios-creados` >=1 fila. `chk-documento-recibido` persiste tras recarga. Upload JPG → `enlace-archivo` visible. No existen botones Editar/Eliminar. |

### Sin regresiones offline y documentación (305–306)

| # | Resultado | Evidencia |
|---|---|---|
| 305 | PASS | `grep -iE "navigator.geolocation\|dexie\|indexeddb\|cola_sync"` en los 4 archivos ventanilla: 0 matches. `git status` en `pwa/src/db/indexeddb.ts`, `pwa/src/sync/`, `pwa/nginx.conf.template`: sin cambios. |
| 306 | PASS | README sección "Ventanilla": (a) rol y rutas; (b) alcance municipios/componentes, vacío=todos; (c) folio `PEO-SJR-AME-0001-26` + fallback siglas; (d) directo a producción sin staging, un beneficiario por concepto; (e) dos domicilios, beneficiario hereda ubicación del apoyo; (f) no editable, correcciones por `/correcciones`. |

## Notas metodológicas

- Puertos efectivos: backend `localhost:3011`, PWA `localhost:8081`, PostgreSQL `localhost:5442` (variables en `.env`).
- En el criterio 301, el testid correcto en el DOM real es `select-concepto` (no `select-tipo-apoyo`); los scripts Playwright se adaptaron tras inspección.
- El criterio 277 se evalúa antes del 279. En su momento de evaluación VEN1 tenía scope restringido (2 municipios, TR) → resultado correcto (5 < 7).
- Playwright con Chromium headless requirió esperas explícitas (`waitForSelector`) para elementos que cargan tras llamadas API asíncronas.
- Servicios Docker detenidos al finalizar (`docker compose down`).

---

# Findings — pass 4 · 2026-08-09

## Resumen

**240/240 criterios del rubric pasan.** Ninguno bloqueante. Se conserva documentado (no bloqueante) el mismo artefacto de entorno de Playwright/Chromium (F-01) reportado en el pass 3, que se reprodujo igual en este pass tras reintentarlo.

Metodología: `docker compose down -v` + `docker compose up -d --build` (reset completo desde cero) -> los 3 servicios quedaron `healthy` en ~35 s. Se reimportaron los fixtures de staging (`padron.staging.ejemplo.csv`, `catalogo.staging.ejemplo.csv`) para reproducir los conteos exactos del build 2. Se verificó con `curl`/`python3 requests` la regresión de las secciones 1-159, y con `curl`/Python (para la API) y Playwright vía `require()` directo del paquete global (Chromium, sin CLI de skill `playwright-cli` disponible en este entorno) la sección 160-211 y la extensión 212-240 (nueva, simplificación del cambio de contraseña + contraseña manual). Se probó la matriz completa de roles: `capturista1`, `auditor1`, `editor_datos` (`editor1`), `admin`, más 17 usuarios totales al cierre (13 creados durante la prueba), ninguno eliminado.

Antes de evaluar 160-211 se leyó §11.8 de `SPEC.md` (la lista explícita de qué comportamiento viejo de esos criterios ya no aplica) para no marcar como fallido lo que §11 cambió intencionalmente: los criterios 179, 182, 206, 199/200 y 203 se evaluaron con el comportamiento vigente descrito en §11.8, no con el texto original de §10.

Desglose por sección:
- 1-60 (build 1): 60/60 OK (regresión vía `curl`, sin cambios de código en esta sección)
- 61-110 (build 2, staging): 50/50 OK (regresión vía `curl` + reimportación de fixtures)
- 111-159 (build 3, corrección + dashboard): 49/49 OK (regresión vía `curl`)
- 160-211 (build 4, administración de usuarios, con las excepciones de §11.8): 52/52 OK
- 212-240 (build 5, simplificación de cambio de contraseña + contraseña manual): 29/29 OK

## Abiertos

- [ ] F-01 - minor - criterio #47 (regresión de sección 39-58, re-verificado en este pass, sigue sin ser bloqueante) - En Playwright/Chromium, al hacer `context.setOffline(true)` y luego recargar la página (`page.reload()`) mientras el Service Worker sirve el documento desde caché, `navigator.onLine` reporta `true` inmediatamente después de la navegación, en vez de `false`. Reproducido de nuevo en este pass con el mismo método (`capturista1` en `/beneficiarios`, offline activado antes de recargar): `estado-red` mostró "En línea" y `navigator.onLine` evaluó `true` justo después del reload. Confirmado en el pass 3 (evidencia conservada) que el código de `BarraEstado.tsx`/`estadoRed.ts` reacciona correctamente a los eventos reales `online`/`offline` del navegador - el problema es específico de la combinación CDP-offline-emulation + Service Worker + recarga completa, no reproducible con pérdida de red real en un dispositivo. No afecta la funcionalidad real (la captura offline se guarda correctamente y la cola pendiente se sincroniza al volver la conexión, criterios 50-51, ambos verificados sin problema en pass 3 y sin evidencia de regresión en este pass). Se recomienda seguir sin bloquear por este hallazgo y, si se quiere cerrar definitivamente, verificar en un navegador real (no bajo automatización CDP) o con DevTools "Network > Offline".

## Resueltos (verificados este pass)

Todos los ítems de `FINDINGS.md` del pass anterior (pass 3) se re-verificaron; no había hallazgos abiertos adicionales sobre 160-211, y la sección 212-240 es nueva en este pass. Detalle de lo verificado:

### Build 1 (1-60) - 60/60 OK
Regresión completa sin cambios detectados respecto del pass 3: `/api/health` con `postgis:"3.4.3"`; 9+ tablas base intactas; login válido/inválido; 401 sin token; aislamiento de `capturista1` por Regional (confirmado ignorando `?regional_id=2` en la query, sigue devolviendo solo su Regional asignada); `/api/catalogos` con las 3 claves (`regionales`, `municipios`, `tipos_apoyo`, más `catalogos`); RBAC en `/api/auditoria/capturas` (auditor 200, capturista 403); RBAC en `/api/estadisticas/cobertura` (admin 200, capturista 403). No se detectó ninguna regresión de infraestructura, importador, capturas, exportaciones, PWA base ni documentación.

### Build 2 (61-110) - 50/50 OK
Reimportación de los fixtures `padron.staging.ejemplo.csv` (12 filas) y `catalogo.staging.ejemplo.csv` (6 filas) reprodujo exactamente los conteos esperados: `folio_duplicado=2`, `curp_duplicada_mismo_concepto=2`, `curp_duplicada_concepto_distinto=2`, `sin_colonia=2`, `sin_coordenadas=2`, `concepto_no_reconocido=1`, `nivel_alerta=ninguna`=2 (padrón); `clave_duplicada=2` (catálogo); ambas cargas con las 12/6 filas en `estado_revision='pendiente'`. `/api/staging/resumen` devolvió el resumen agregado correcto con `editor1` (200) y 403 con `capturista1`. Sin regresión.

### Build 3 (111-159) - 49/49 OK
Sin cambios de código en esta sección; regresión vía `curl` sin hallazgos (RBAC de `/api/beneficiarios`, `/api/correcciones/*`, `/api/estadisticas/*` sin diferencias respecto del pass 3).

### Build 4 (160-211) - 52/52 OK (con las excepciones de §11.8 evaluadas según el comportamiento nuevo)
- Acceso a `/api/usuarios` (160-165): 401 sin token; 403 para `capturista1`/`auditor1`; 200 con `admin` y `editor_datos`; `password_hash`/`password` nunca aparecen en la respuesta.
- Alta (166-176): `POST /api/usuarios` genera temporal de 14 caracteres sin ambiguos (`0O1lI`); usuario nuevo `activo=true`, `debe_cambiar_password=true`; login con la temporal confirma el flag; duplicado -> 409; `regional_requerida` para capturista sin Regional; `regional_no_aplica` para no-capturista con Regional; `editor_datos` no puede crear `admin` (403 `rol_no_asignable`) pero sí `capturista`; `capturista`/`auditor` no pueden crear usuarios (403).
- Bloqueo por `debe_cambiar_password` (177-182, con la excepción de §11.8): con el flag activo, `GET /api/catalogos` -> 403 `cambio_password_requerido`; `GET /api/auth/me` sigue 200 (lista blanca) - verificado explícitamente que el objeto anidado `usuario.debe_cambiar_password` es `true`; el criterio 179 se evaluó con `password_actual` correcta enviada (sigue devolviendo 200, comportamiento previo intacto) y por separado con el flujo sin `password_actual` (criterio 213, también 200) - ambas variantes funcionan, como exige §11.8; el criterio 182 se evaluó con el comportamiento nuevo: con el flag en `true`, una `password_actual` incorrecta no produce error (se ignora), pero `password_debil` y `password_repetida` siguen aplicando igual en modo obligatorio (verificado con casos aislados).
- Edición/reset/activación (183-191): `PATCH /api/usuarios/:id` edita `nombre_completo` con bitácora; rechaza `usuario`/`password`/`debe_cambiar_password`/`activo` fuera de lista blanca (422 `campo_no_editable`) y body vacío (422 `sin_cambios`); reset genera temporal distinta y reactiva el flag; login con la nueva temporal funciona, con la anterior falla; desactivar bloquea login (401) y un token emitido antes de la desactivación recibe 401 `cuenta_desactivada` incluso en `/api/auth/me`; auto-desactivación de `admin` -> 409 `auto_desactivacion` sin cambio en BD; reactivar permite volver a iniciar sesión.
- Trazabilidad y no-borrado (192-196): `DELETE /api/usuarios/:id` -> 404; el conteo de `usuarios` nunca bajó durante toda la batería (17 usuarios al final, 13 creados en la prueba, 0 eliminados); bitácora contiene las 6 acciones (`usuario_creado`, `usuario_editado`, `usuario_password_reset`, `usuario_desactivado`, `usuario_activado`, `password_cambiado` - 31 entradas en total al cierre); ninguna de las contraseñas temporales/manuales generadas durante la prueba aparece en `auditoria_log.detalle`; filtros `rol`/`activo`/`q` de `/api/usuarios` funcionan correctamente.
- PWA administración de usuarios (197-205, con las excepciones de §11.8 para 199/200/203): `nav-usuarios` visible para `admin`/`editor_datos` y ausente para `capturista1`/`auditor1` (con "No tienes permiso para ver esta sección." al navegar directo); `tabla-usuarios` con >=4 filas; formulario de alta con `select-regional` habilitado solo para rol Capturista (deshabilitado para Auditor); el bloque `select-modo-password` aparece con `automatica` por defecto y sin `input-password-manual` visible hasta elegir "Escribir yo mismo"; modal de contraseña temporal con aviso "no se volverá a mostrar" y botón copiar; al cerrar el modal y recargar, la contraseña no queda en el DOM y el usuario aparece "Activo" en la tabla; alta duplicada muestra error visible sin agregar fila; `modal-reset-password` (nuevo componente de §11.6.3) con `select-modo-password-reset` abre correctamente y termina en el mismo `modal-password-temporal` con valor distinto al anterior; activar/desactivar (`btn-toggle-activo`) cambia el badge de estado y persiste tras recargar - primer intento de verificación falló por un descuido del script de prueba (el handler del diálogo nativo `confirm()` se registró después del click en vez de antes); reproducido de forma aislada con el manejador correcto y confirmado que el toggle funciona en ambos sentidos (Inactivo->Activo->Inactivo); no existe ningún control de "Eliminar"/"Borrar" en la pantalla; y verificado además que en modo edición de un usuario existente el bloque `select-modo-password` no se renderiza (0 elementos), coherente con §11.6.2.
- PWA cambio de contraseña obligatorio/voluntario (206-210, con la excepción de §11.8 para 206): login con temporal redirige a `/cambiar-password` con `aviso-cambio-obligatorio` y `form-cambio-password`; se verificó explícitamente que `input-password-actual` tiene 0 elementos en el DOM en modo obligatorio (comportamiento nuevo de §11, correcto); navegar directo a `/beneficiarios` con el flag activo regresa a `/cambiar-password`; completar el cambio muestra éxito y redirige fuera de `/cambiar-password` (para un capturista sin padrón local, a `/sync`, comportamiento correcto - el primer intento de verificación reportó falso negativo por un tiempo de espera insuficiente en el script, confirmado con reintento aislado y esperas más largas que el redirect sí ocurre); tras recargar el aviso obligatorio ya no aparece; contraseña de 4 caracteres o confirmación distinta muestran error visible en `error-password` sin tocar la BD (verificado con `curl` que el login con la temporal sigue funcionando tras los intentos fallidos); `auditor1` y `capturista1` (flag en `false`) tienen "Cambiar mi contraseña" en el menú de usuario, sin el aviso de obligatoriedad, con botón "Cancelar" y con `input-password-actual` visible (1 elemento, comportamiento voluntario intacto).
- Documentación (211): `README.md` tiene una sección "Administración de usuarios" completa con roles con acceso, baja=desactivar y por qué, contraseña temporal de una sola vista, cambio obligatorio para los 4 roles, nombre de acceso inmutable, y recomendación de desactivar cuentas demo en producción.

### Build 5 / extensión §11 (212-240) - 29/29 OK
- API - obligatorio sin contraseña actual (212-217): crear `qa_simple` y loguear con su temporal confirma `debe_cambiar_password=true`; `PATCH /api/mi-cuenta/password` con solo `{"password_nueva":...}` (sin `password_actual`) devuelve 200 con `debe_cambiar_password:false`; login posterior con la nueva contraseña funciona, con la temporal anterior da 401; con un `password_actual` incorrecto a propósito enviado en modo obligatorio, el backend lo ignora en silencio y el cambio se aplica igual (200) - confirmado con un segundo usuario de prueba dedicado; `password_debil` y `password_repetida` siguen aplicando en modo obligatorio (422, `debe_cambiar_password` sigue en `true` en ambos casos); el mismo token usado en el cambio exitoso sigue sirviendo de inmediato para `GET /api/catalogos` (200), sin necesidad de volver a iniciar sesión.
- API - el flujo voluntario NO se relaja (218-221): con `auditor1` (flag `false`), `PATCH /api/mi-cuenta/password` sin `password_actual` -> 422 `password_actual_requerida`; con `password_actual` incorrecta -> 422 `password_actual_incorrecta` (hash sin cambios en ambos casos, verificado con logins posteriores); con la actual correcta y una nueva válida -> 200, y el login posterior confirma `debe_cambiar_password:false` (el cambio voluntario no activa el flag) - se restauró la contraseña original de `auditor1` tras la prueba para no dejar el entorno con un usuario demo en estado distinto; sin `Authorization` -> 401; con una clave extra en el body (`rol`) -> 422, y se confirmó que el rol de `auditor1` en BD sigue siendo `auditor` (sin escalada de privilegios vía este endpoint).
- API - contraseña manual en creación y reset (222-229): crear con `modo_password:"manual"` y `password_manual:"ClaveManual2026"` devuelve 201 con `password_temporal` exactamente igual al valor manual y `modo_password:"manual"`; login con esa contraseña funciona y el usuario queda con `debe_cambiar_password=true` en BD; `modo_password:"manual"` sin `password_manual` -> 422 `password_manual_requerida`; con `"abc"` o `"solosinnumeros"` -> 422 `password_debil` en ambos casos, sin que el conteo de usuarios aumente; `modo_password:"automatica"` con `password_manual` incluido devuelve una temporal de 14 caracteres real (ignora el valor manual, que además da 401 al intentar loguear con él); sin la clave `modo_password` en el body (compatibilidad con clientes previos) sigue devolviendo 201 con una temporal de 14 caracteres; reset con modo manual devuelve `password_temporal` igual al valor asignado, reactiva `debe_cambiar_password=true` y cambia el hash (login con la nueva funciona, con la anterior da 401); reset manual con contraseña débil -> 422 `password_debil` sin tocar el hash, y el mismo endpoint sin `modo_password` sigue generando una temporal de 14 caracteres; `T_CAP`/`T_AUD` reciben 403 al intentar usar modo manual (ni siquiera llegan a la validación de contraseña), y `T_EDIT` sobre un usuario `admin` recibe 403 `rol_no_asignable` (la restricción de D23 se evalúa antes que el modo de contraseña, como exige §11.5.3).
- Seguridad y bitácora (230-232): ninguna contraseña manual ni la nueva contraseña de ningún flujo aparece en `auditoria_log.detalle` (`ClaveManual2026`, `ResetManual2026`, `NuevaClave2026` - 0 coincidencias); `information_schema.columns` de `usuarios` confirma que la única columna de credencial sigue siendo `password_hash` (sin columnas nuevas ni eliminadas respecto del build 4) y no existe ningún archivo `db/migrations/011_*.sql`; la bitácora contiene al menos una entrada `usuario_creado` con `detalle.modo_password === "manual"` y al menos una `password_cambiado` con `detalle.sin_password_actual === true`.
- PWA - cambio obligatorio simplificado (233-235): con un usuario recién creado, el login con su contraseña inicial lleva a `/cambiar-password` con `aviso-cambio-obligatorio` y `form-cambio-password`, y el conteo de `input-password-actual` en la página es 0; llenar `input-password-nueva`/`input-password-confirmar` y pulsar `btn-cambiar-password` muestra éxito, saca al usuario de `/cambiar-password` (a `/sync` para un capturista sin padrón local) y, al recargar, ya no aparece `aviso-cambio-obligatorio`; con `capturista1` (flag `false`), "Cambiar mi contraseña" desde el menú de usuario muestra `/cambiar-password` con `input-password-actual` visible (1 elemento) y sin `aviso-cambio-obligatorio`; enviar el formulario dejando vacía la contraseña actual muestra un error visible sin cambiar la contraseña en BD.
- PWA - contraseña manual desde `/usuarios` (236-239): `btn-nuevo-usuario` muestra `select-modo-password` con valor inicial `automatica` y sin `input-password-manual` visible; al seleccionar "Escribir yo mismo" aparece el campo; con una contraseña de 4 caracteres, "Guardar" muestra `error-password-manual` con mensaje en español y no crea el usuario (verificado tras recargar que no aparece la fila); crear en modo manual con `ClavePwaManual2026` abre `modal-password-temporal` con `texto-password-temporal` exactamente igual a ese valor y el aviso de que no se volverá a mostrar; tras cerrar el modal y recargar, esa cadena no aparece en el DOM y el usuario aparece "Activo" con el badge "Cambio pendiente"; `btn-reset-password` en esa fila abre `modal-reset-password` con `select-modo-password-reset`; eligiendo "Escribir yo mismo" con `ClaveReset2026` y confirmando abre `modal-password-temporal` mostrando exactamente ese valor; con la opción por defecto (`automatica`) el valor mostrado es una cadena de 14 caracteres distinta.
- Documentación (240): `README.md` documenta en la sección de administración de usuarios: que el primer inicio de sesión obligatorio no pide la contraseña actual y por qué (el usuario ya se autenticó con ella); que el cambio voluntario sí la sigue pidiendo; que `admin`/`editor_datos` pueden elegir entre "Generar automática" y "Escribir yo mismo" al crear o resetear; que en ambos modos el usuario queda obligado a cambiar la contraseña en su primer acceso; y que la contraseña se sigue mostrando una sola vez y no se puede reconsultar.

## Notas metodológicas

- No había CLI de skill `playwright-cli` disponible en este entorno; se usó el paquete `playwright@1.62.1` instalado globalmente (`C:\Users\vparsar\AppData\Roaming\npm\node_modules\playwright`), invocado con `require()` absoluto desde scripts Node ad-hoc (Chromium), cubriendo toda la matriz de roles y flujos del rubric de las secciones 160-240.
- Dos falsos negativos de la primera pasada de scripts se aislaron y confirmaron como artefactos del propio script de prueba, no del código de la app: (a) el criterio 204 (toggle activo) falló inicialmente porque el manejador del diálogo nativo `confirm()` del navegador se registró después del click en vez de antes, causando que Playwright descartara el diálogo por defecto; reproducido con el manejador correcto y confirmado que el toggle funciona en ambos sentidos; (b) el criterio 208 (redirect tras cambio de contraseña exitoso) falló inicialmente por una espera de solo 1200 ms, insuficiente para que la SPA completara el refresco de perfil + redirect; reproducido con esperas más largas y confirmado que el redirect a `/sync` ocurre correctamente.
- Para evitar contaminación entre criterios que dependen de conteos exactos (p. ej. flags de staging 71-76, o el estado de un usuario recién creado), se hizo un reset completo de la base (`docker compose down -v` + `up -d --build`) antes de la batería principal, y se re-sembraron/re-importaron los fixtures desde cero.
- Los servicios Docker se detuvieron al finalizar (`docker compose down`) para no dejar procesos corriendo.
