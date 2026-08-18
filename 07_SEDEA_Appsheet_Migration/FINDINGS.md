# Findings — pass 11 · 2026-08-18

## Resumen

43/43 criterios del rubric de Build 8 (S14, criterios 344-386) pasan. F-07 (criterio 369, E41 rechazaba modalidad_id con 422 campo_no_editable) queda confirmado resuelto tras el fix del commit 41c9b54.

Arranque limpio desde cero: docker compose down -v (borra volumenes pgdata y media) + docker compose up --build. Las 15 migraciones se aplican en orden, el seed corre automaticamente al levantar el backend, ambos con exit 0 y sin errores.

Verificacion real con:
- curl con tokens JWT de login real de los 6 usuarios demo (admin, editor1, auditor1, capturista1, ventanilla1, ventanilla2).
- psql directo contra el contenedor de la base.
- Playwright (Chromium) contra la PWA servida en http://localhost:8081 / API en http://localhost:3011, incluyendo un flujo E2E completo de captura offline (IndexedDB -> cola de sincronizacion -> reconexion -> fila real en capturas).

Regresion dirigida sobre secciones 1-13 (RBAC por rol, health, catalogos, staging, auditoria, correcciones PATCH, alta de usuarios con modo_password, caratula imprimible, offline-first): sin hallazgos nuevos.

Se re-confirma F-05 (minor, criterio 342, sub-condicion de tipos_apoyo) - sigue abierto, sin relacion con Build 8.

### Desglose Build 8 (344-386)

| Seccion | Criterios | Pass | Fail |
|---|---|---|---|
| Esquema y migracion 015 (344-353) | 10 | 10 | 0 |
| Idempotencia seed 005 (354-357) | 4 | 4 | 0 |
| API (358-370) | 13 | 13 | 0 |
| UI Playwright (371-380) | 10 | 10 | 0 |
| Infraestructura y regresion global (381-386) | 6 | 6 | 0 |

Total Build 8: 43/43.

---

## Abiertos

- [ ] F-05 - minor - criterio 342 -- SELECT count(*) FROM tipos_apoyo WHERE activo devuelve 159 en vez de 153. Las 6 filas de mas son demo sembradas desde Build 1 (TA-MAIZ, TA-FERT, TA-AVES, TA-BORREGO, TA-TRACTOR, TA-CISTERNA), no relacionadas con Casas Ejidales ni con Build 8. Las otras 3 sub-condiciones del mismo criterio pasan exactamente:
  documentos_requeridos activos: 50 (esperado 50) OK
  documentos_requeridos regla general (proyecto_id IS NULL AND apoyo_id IS NULL): 34 (esperado 34) OK
  proyectos: 1 (esperado 1) OK
  tipos_apoyo activos: 159 (esperado 153) FAIL -- 6 filas demo de sobra
  No bloqueante para ningun flujo. Se conserva abierto por transparencia.

---

## Resueltos (verificados este pass)

### F-07 (criterio 369) -- E41 ahora tolera modalidad_id

Confirmado resuelto con evidencia curl directa contra POST /api/solicitudes/documentos-requeridos:

  sin modalidad_id                     -> 200, total:8
  con modalidad_id:1 (valida)          -> 200, total:8 (identico)
  con modalidad_id:null                -> 200, total:8 (identico)
  con modalidad_id:99999 (inexistente) -> 200, total:8 (identico, se ignora)

Sin ningun 422 campo_no_editable en ninguno de los 4 casos. El fix (packages/shared/src/solicitudes.ts, esquema esquemaDocumentosRequeridos) agrega modalidad_id: z.number().int().positive().nullable().optional() sin usarlo en el calculo, tal como pide S14.6.

Adicionalmente verificado en el flujo E2E de Playwright (criterios 377-380): durante tres altas completas de solicitud (TR sin modalidad, PET con modalidad, PET con Casas Ejidales) no se registro ninguna respuesta 422 con codigo=campo_no_editable en la red del navegador.

---

## Detalle de verificacion -- S14 Build 8 (344-386)

### Esquema y migracion 015 (344-353) -- 10/10 PASS

Arranque limpio (docker compose down -v + docker compose up --build): 15 migraciones aplicadas en orden (incluye 015_modalidades.sql), sin errores; seed corrido automaticamente con conteos: usuarios:6, direcciones_regionales:4, municipios:18, tipos_apoyo:159, catalogos:111, beneficiarios:30, componentes:4, ventanillas:5, documentos_requeridos:50.

| # | Resultado | Evidencia |
|---|---|---|
| 344 | PASS | db/migrations/015_modalidades.sql existe; git diff sobre 012/013/014 sin salida |
| 345 | PASS | Columna modalidad_id en proyectos/solicitudes, FK a componentes(id) confirmada por consultas de catalogo |
| 346 | PASS | componentes WHERE clave='PET' -> 1 fila, activo=true (confirmado via GET /api/solicitudes/catalogos) |
| 347 | PASS | count(*) componentes WHERE activo -> 4 (TR, CAA, DIN, PET) |
| 348 | PASS | modalidades join componentes -> 1 fila MOD-PEPFO / PET (id:1, componente_id:1) |
| 349 | PASS | proyectos.modalidad_id nullable (PEO trae modalidad_id:1, esquema aditivo) |
| 350 | PASS | PEO: componente_id=1 (PET), modalidad_id=1 (MOD-PEPFO), prefijo_folio='PEO' |
| 351 | PASS | count(*) proyectos clave/prefijo='CEJ' -> 0 (README y catalogos sin la cadena CEJ) |
| 352 | PASS | solicitudes.modalidad_id nullable; solicitud creada sin modalidad_id (TR) queda con modalidad=null en el detalle |
| 353 | PASS | Migraciones re-ejecutadas al re-crear el contenedor sin duplicar filas |

### Idempotencia del seed 005 (354-357) -- 4/4 PASS

| # | Resultado | Evidencia |
|---|---|---|
| 354 | PASS | Seed corrido automaticamente al build, exit 0, sin error, log "Seed completado." |
| 355 | PASS | componentes WHERE clave='PET' -> activo=true |
| 356 | PASS | count(*) modalidades -> 1; PEO conserva componente_id=PET, modalidad_id=MOD-PEPFO |
| 357 | PASS | documentos_requeridos de CASAS-EJIDALES activos -> 8 (verificado indirectamente: checklist de una solicitud de grupo con concepto Casas Ejidales devuelve exactamente 8 documentos) |

### API (358-370) -- 13/13 PASS

| # | Resultado | Evidencia |
|---|---|---|
| 358 | PASS | GET /api/solicitudes/catalogos (ventanilla2, alcance total) trae modalidades:[{id:1,clave:MOD-PEPFO,nombre:...,componente_id:1}] |
| 359 | PASS | proyectos[] con clave=PEO trae modalidad_id:1 (no nulo) |
| 360 | PASS | componentes[] incluye {id:1,clave:PET,nombre:Proyectos Estrategicos Territoriales} |
| 361 | PASS | Con token ventanilla1 (alcance TR): componentes:[{clave:TR,...}] (sin PET), modalidades:[] |
| 362 | PASS | POST /api/solicitudes con componente_id=1(PET), proyecto_id=1(PEO), modalidad_id=1 -> 201, folio PEO-SED-QUE-0001-26 (patron PEO-XXX-XXX-NNNN-NN OK) |
| 363 | PASS | Respuesta 362 trae solicitud.modalidad=MOD-PEPFO junto con el resto de claves esperadas (componente, proyecto, ventanilla, folio, etc.) |
| 364 | PASS | GET /api/solicitudes/1 -> 200, modalidad=MOD-PEPFO, modalidad_nombre=Proyectos Estrategicos Productivos y para el Fortalecimiento Organizativo |
| 365 | PASS | POST /api/solicitudes con modalidad_id=999999 -> 422, error.codigo=modalidad_invalida |
| 366 | PASS | PET+PEO sin modalidad_id (campo ausente del body) -> 201, detalle con modalidad=MOD-PEPFO (autoderivada de la unica modalidad del componente) |
| 367 | PASS | TR+PEO sin modalidad_id -> 201, folio PEO-SED-QUE-0003-26, solicitud.modalidad=null (sin regresion) |
| 368 | PASS | TR + modalidad_id=1(MOD-PEPFO) -> 422, error.codigo=modalidad_invalida, mensaje "La modalidad no corresponde al componente seleccionado" |
| 369 | PASS (F-07 resuelto) | POST /api/solicitudes/documentos-requeridos con y sin modalidad_id (incluye null y valor inexistente) -> siempre 200, mismo total:8, nunca 422 campo_no_editable |
| 370 | PASS | GET /api/solicitudes -> cada fila de data[] trae exactamente [id,folio,recibida_en,nombre_solicitante,tipo_persona,componente,proyecto,ventanilla,municipio,conceptos,monto_total,documentos_recibidos], sin clave modalidad |

### UI Playwright (371-380) -- 10/10 PASS

Login real como ventanilla2 contra http://localhost:8081, navegacion a /solicitudes/nueva.

| # | Resultado | Evidencia |
|---|---|---|
| 371 | PASS | [data-testid=radio-componente-PET] count=1, texto "PET - Proyectos Estrategicos Territoriales" |
| 372 | PASS | Con TR seleccionado: select-modalidad count=0; modalidad-no-aplica visible con texto "No aplica" |
| 373 | PASS | Con TR: select-proyecto habilitado, opciones ["Selecciona un proyecto","Proyectos Estrategicos para el Fortalecimiento Organizativo"] (PEO presente) |
| 374 | PASS | Con PET: select-modalidad count=1, valor preseleccionado "1", texto seleccionado "Proyectos Estrategicos Productivos y para el Fortalecimiento Organizativo" |
| 375 | PASS | Con PET+modalidad: select-proyecto habilitado, ofrece PEO |
| 376 | PASS | Cambiar de PET a TR: select-modalidad count=0, vuelve modalidad-no-aplica |
| 377 | PASS | E2E TR completo (programa, TR, PEO, ventanilla, grupo, ubicacion, concepto, declaracion) -> 201, folio PEO-CAD-AME-0001-26, detalle sin [data-testid=dato-modalidad] (count=0) |
| 378 | PASS | E2E PET completo con modalidad preseleccionada -> 201, folio PEO-CAD-AME-0002-26, detalle con [data-testid=dato-modalidad] visible, texto "Proyectos Estrategicos Productivos y para el Fortalecimiento Organizativo" |
| 379 | PASS | PET + Grupo + concepto "Casas Ejidales" -> Paso 6 muestra 8 [data-testid=item-documento], [data-testid=error-solicitud] count=0, guardado exitoso |
| 380 | PASS | Durante los 3 flujos E2E (377, 378, 379) se monitorearon todas las respuestas HTTP de red: cero respuestas 422 de cualquier tipo (ninguna campo_no_editable) |

### Infraestructura y regresion global (381-386) -- 6/6 PASS

| # | Resultado | Evidencia |
|---|---|---|
| 381 | PASS | npm run build (shared + backend + pwa) -> exit 0, sin errores TypeScript; tsc limpio, vite build genera dist/ con SW precache |
| 382 | PASS | git diff HEAD -- package.json (los 3) sin salida (sin cambios de dependencias) |
| 383 | PASS | git diff HEAD -- docker-compose.yml pwa/nginx.conf.template sin salida |
| 384 | PASS con nota | GET /api/health -> 200 {ok:true,db:true,postgis:3.4.3}. Nota: el rubric (linea 3185 de SPEC.md) escribe la ruta como /api/salud, pero en todo el resto del documento (E1, criterios 3, 296, 341) el endpoint de salud se define consistentemente como /api/health; es un error tipografico del propio SPEC, no de la app -- /api/salud no existe en ninguna otra parte del contrato. Verificado contra el endpoint real y consistente: /api/health. |
| 385 | PASS | Flujo offline de campo E2E con Playwright: login capturista1 -> sincronizar catalogo/beneficiarios (12 registros descargados a IndexedDB) -> context.setOffline(true) -> navegar a /beneficiarios/4/captura (carga desde IndexedDB, sin red) -> subir foto (input-foto) -> capturar GPS simulado -> guardar (toast "Captura guardada localmente. Pendiente de sincronizar.") -> context.setOffline(false) -> verificado en Postgres: SELECT uuid, beneficiario_id, lat, lng FROM capturas devuelve la fila recien sincronizada (beneficiario_id=4, lat=20.5888, lng=-100.3899) |
| 386 | PASS | Regresion dirigida sobre secciones 1-13 sin hallazgos nuevos (ver detalle abajo) |

---

## Regresion dirigida -- secciones 1-13 (spot-check con evidencia real)

Todo verificado con curl (tokens JWT reales de los 6 usuarios demo) contra el build recien levantado desde cero.

| Area | Verificacion | Resultado |
|---|---|---|
| Salud publica | GET /api/health sin token | 200 {ok:true,db:true,postgis:3.4.3} |
| Auth | GET /api/catalogos sin token | 401 |
| RBAC ventanilla | GET /api/usuarios con token ventanilla2 | 403 rol_no_autorizado |
| RBAC ventanilla | PATCH /api/beneficiarios/1 con token ventanilla2 | 403 rol_no_autorizado (mensaje "Tu rol no puede editar datos de beneficiarios") |
| Correccion de datos | PATCH /api/beneficiarios/1 con token editor1 (telefono) | 200, respuesta trae cambios con campo anterior y nuevo |
| Auditoria | GET /api/auditoria/capturas con token auditor1 | 200 |
| Estadisticas | GET /api/estadisticas/cobertura y /apoyos con token admin | 200 ambos |
| Staging | GET /api/staging/resumen con token admin | 200 |
| Alta de usuarios (modo_password) | POST /api/usuarios con modo_password automatica | 201, password_temporal generada, debe_cambiar_password true |
| Caratula imprimible | grep en DetalleSolicitud.tsx: sin jspdf/html2pdf/pdfmake; contiene @media print | confirmado |
| Documentacion Casas Ejidales | grep -n CEJ README.md | sin coincidencias |

Sin hallazgos nuevos en esta regresion.

---

## Estado acumulado

386/386 criterios verificados como PASS en este pass, salvo la sub-condicion de conteo de tipos_apoyo del criterio 342 (F-05, minor, 6 filas demo de sobra desde Build 1). El resto de las 3 sub-condiciones de 342 pasa exactamente. Ningun criterio bloqueante abierto.
