# Findings pass 5 - 2026-08-20

## Resumen

Stack recreado desde cero dos veces en este pass (docker compose down -v && docker compose up
--build, y una segunda recreacion completa para poder ejecutar limpio el E2E de 497 sin
contaminacion de datos de pruebas exploratorias anteriores). Los 57 criterios del rubric de
Build 10 (447-503) se verificaron con curl, psql y Playwright contra http://localhost:8081 /
http://localhost:3011.

55/57 pasan. 2 siguen abiertos (F-17 y F-22, minor, explicitamente fuera de alcance de este
round de fix).

### Los 5 findings objetivo de este round: confirmados resueltos

- F-19 (criterio 456) - RESUELTO. ventanilla1 navegando directo a /catalogos ahora termina en
  /sin-permiso. Confirmado con Playwright: page.url() es http://localhost:8081/sin-permiso y
  [data-testid=pantalla-sin-permiso] count = 1. El guard vive en
  pwa/src/pantallas/Catalogos.tsx (useEffect que redirige si perfil.rol distinto de admin y
  editor_datos).
- F-20 (criterio 468) - RESUELTO. GET /api/admin/catalogos/documentos_requeridos?por_pagina=200
  ahora trae apoyo_clave, apoyo_excluir_clave y proyecto_clave resueltos en cada fila.
  Confirmado con curl sobre filas reales con apoyo_id/proyecto_id no nulos (ids 43-50):
  apoyo_id=1 resuelve a apoyo_clave=CASAS-EJIDALES, proyecto_id=1 resuelve a
  proyecto_clave=PEO. total: 50 (mayor o igual a 42 exigido).

- F-21 (criterio 486) - RESUELTO. Existen ahora [data-testid=btn-nuevo-subprogramas],
  [data-testid=btn-nuevo-modalidades] y [data-testid=btn-nuevo-proyectos] en
  pwa/src/componentes/ArbolCatalogos.tsx (junto con los ya existentes de programas, componentes
  y tipos_apoyo). Confirmado con Playwright: los 6 botones btn-nuevo-* tienen count 1, y al
  pulsar btn-nuevo-proyectos el campo input-prefijo-folio queda habilitado (disabled: false), a
  diferencia del modo edicion donde permanece deshabilitado (verificado tambien con el proyecto
  real PEO, id 1: disabled: true, value: PEO, leyenda-prefijo-inmutable visible).
- F-23 (criterio 496) - RESUELTO. Existe [data-testid=modal-confirmar-baja] en
  pwa/src/pantallas/Catalogos.tsx. Confirmado con Playwright con datos reales: al desactivar el
  componente PET (con 1 modalidad y 1 proyecto activos) se abre el modal con
  [data-testid=texto-hijos-activos] visible con el texto Este nodo tiene 2 hijo(s) activo(s).
  No se desactivaran. Ademas se verifico el ciclo completo con el componente DEM-C creado por
  el E2E: al confirmar la baja, el nodo padre (nodo-componentes-6) muestra
  [data-testid=chip-inactivo] y el nodo hijo modalidad (nodo-modalidades-3, que sigue activo)
  NO lo muestra (count 0).

- F-24 (criterio 501) - RESUELTO. El toast de exito ya se pinta. En
  pwa/src/pantallas/Catalogos.tsx, guardar() ya no llama a cerrarForm() (que limpiaba exito en
  la misma pasada sincrona); ahora solo hace setModoForm(null) mas setErrorForm(null) y luego
  setExito(mensaje). Confirmado con Playwright: alta de un programa nuevo (PRG-UI2) desde
  /catalogos da como resultado [data-testid=toast-exito] count 1 y
  [data-testid nodo-programas-*] con texto PRG-UI2 count 1, sin recargar la pagina.
### Sin regresiones

Se re-verificaron con curl/psql/Playwright los criterios que ya pasaban en el pass anterior
(447-455, 457-467, 469-495, 497-500, 502) sobre el stack recreado desde cero, y todos siguen
pasando. Detalle completo en la tabla de abajo. Tambien se corrio npm run build en
packages/shared, backend y pwa: los tres terminan en 0 con exito (criterio 461). Spot checks
fuera del rubric de Build 10 (login, /api/beneficiarios, /api/solicitudes,
/api/auditoria/capturas, la PWA sirviendo /) responden 200, sin indicios de regresion en el
resto de la app.

### Nota metodologica sobre el criterio 497

La primera corrida de este pass uso claves ad-hoc (PRG-DEMO, DEM-CONCEPTO, "Acta de asamblea
demo", proyecto con prefijo_folio=DEM) para probar criterios 470-489 de forma exploratoria, lo
que colisionaba con las claves literales que pide el enunciado del criterio 497. Se detecto a
tiempo y se volvio a recrear el stack desde cero (docker compose down -v seguido de docker
compose up -d) para ejecutar la cadena de 497 de forma limpia, exactamente con las 7 claves
literales del enunciado (PRG-DEMO, SUB-DEMO, DEM-C, MOD-DEMO, DEM con prefijo_folio=DEM,
DEM-CONCEPTO, y el documento Acta de asamblea demo), sin tocar psql para escribir nada. Los 7
POST dieron 201.
## Abiertos (fuera de alcance de este round, sin cambios)

- [ ] F-17 - minor - criterio 464 (y afecta el shape de 465/466 aunque no los hace fallar) - GET
  /api/admin/catalogos/:entidad sigue devolviendo porPagina (camelCase) en vez de por_pagina
  (snake_case). Reproduccion: curl contra
  http://localhost:3011/api/admin/catalogos/programas con token admin da como resultado un
  objeto con las claves datos, total, pagina, porPagina (en vez de por_pagina). El criterio 464
  exige literalmente el objeto con datos, total, pagina, por_pagina. Re-confirmado sin cambios
  en este pass.

- [ ] F-22 - minor - criterio 487 - con el body literal del spec (nombre igual a x, 1 caracter)
  contra un id inexistente (999999), Zod rechaza el payload por min(3) antes de llegar al
  chequeo de existencia, devolviendo 422 payload_invalido en vez de 404
  registro_no_encontrado. Reproduccion: PATCH a
  http://localhost:3011/api/admin/catalogos/proyectos/999999 con body nombre igual a x da 422.
  Re-confirmado sin cambios en este pass. (Nota: con un nombre valido de 3 o mas caracteres
  contra el mismo id inexistente, si se obtiene correctamente 404 registro_no_encontrado, se
  probo tambien en este pass.)
## Resueltos (verificados este pass)

- [x] F-19 - major - criterio 456 - ver detalle arriba.
- [x] F-20 - major - criterio 468 - ver detalle arriba.
- [x] F-21 - major - criterio 486 - ver detalle arriba.
- [x] F-23 - major - criterio 496 - ver detalle arriba.
- [x] F-24 - major - criterio 501 - ver detalle arriba.
- [x] F-13 - critical - criterios 479, 480, 481, 497, 499 (heredado, re-confirmado sin
  regresion sobre stack recreado desde cero).
- [x] F-18 - critical - criterios 454, 485 (heredado, re-confirmado sin regresion).

## Detalle de verificacion por criterio (447-503)

| # | Resultado | Nota |
|---|---|---|
| 447 | pass | 401 sin Authorization |
| 448 | pass | 200, claves componentes/conteos/programas/proyectos_huerfanos presentes |
| 449 | pass | 200 con token editor_datos |
| 450 | pass | 403 rol_no_autorizado (capturista) |
| 451 | pass | 403 rol_no_autorizado (auditor) |
| 452 | pass | 403 rol_no_autorizado (ventanilla) |
| 453 | pass | 403 con ventanilla; count de programas sin cambio (2 a 2) |
| 454 | pass | Playwright: nav-catalogos visible para admin, llega a pantalla-catalogos |
| 455 | pass | Playwright, 4 sesiones: editor1 si ve nav-catalogos; ventanilla1, capturista1 y auditor1 no (count 0) |
| 456 | pass | F-19 resuelto. Playwright: ventanilla1 en /catalogos redirige a /sin-permiso, pantalla-sin-permiso visible |
| 457 | pass | ls db/migrations con filtro 016 vacio |
| 458 | pass | git diff HEAD sobre package.json y package-lock.json vacio |
| 459 | pass | git diff HEAD sobre docker-compose.yml, nginx.conf.template, pwa/src/sync, pwa/src/db vacio |
| 460 | pass | grep de delete vacio; DELETE /programas/1 da 404 no_encontrado |
| 461 | pass | npm run build en shared, backend y pwa: los 3 terminan en 0 sin errores TS |
| 462 | pass | subprogramas es array; PET.modalidades[0].clave=MOD-PEPFO; su proyectos[0].clave=PEO |
| 463 | pass | sin query: 0 inactivos; con incluir_inactivos=true: incluye los desactivados |
| 464 | fail (F-17, minor, fuera de alcance) | devuelve porPagina en vez de por_pagina |
| 465 | pass | q=casas da total=1, incluye CASAS-EJIDALES |
| 466 | pass | subprogramas con padre_id de PRG-2026 devuelve solo filas con ese programa_id |
| 467 | pass | 404 entidad_desconocida |
| 468 | pass | F-20 resuelto. apoyo_clave, apoyo_excluir_clave, proyecto_clave resueltos; total=50 |
| 469 | pass | 6 claves presentes; tipos_persona = fisica, moral, grupo |
| 470 | pass | POST programas con clave prg-demo da 201, clave PRG-DEMO, activo=true |
| 471 | pass | repetir da 409 clave_duplicada, sin 500 |
| 472 | pass | subprogramas con programa_id=999999 da 422 padre_invalido |
| 473 | pass | desactivar PRG-DEMO y crear subprograma bajo el da 422 padre_inactivo; reactivado despues |
| 474 | pass | SUB-IP bajo PRG-DEMO da 201; repetir mismo programa da 409 clave_duplicada |
| 475 | pass | prefijo peo1 da 422; prefijo P da 422; prefijo DEM da 201 |
| 476 | pass | componente_id de TR con modalidad_id de MOD-PEPFO (de PET) da 422 modalidad_no_corresponde_componente |
| 477 | pass | campo no declarado color da 422 payload_invalido (Zod strict) |
| 478 | pass | tipos_apoyo DEM-CONCEPTO da 201 |
| 479 | pass | tipos_persona invalido da 422 tipo_persona_invalido; componente invalido da 422 componente_invalido |
| 480 | pass | documentos_requeridos con body del spec da 201 |
| 481 | pass | psql: catalogo_creado sobre programas y regla_documento_creada sobre documentos_requeridos en auditoria_log |
| 482 | pass | PATCH nombre programa da 200, BD refleja el cambio |
| 483 | pass | PATCH clave da 422 campo_inmutable; BD sigue con clave original |
| 484 | pass | PATCH prefijo_folio de PEO da 422 campo_inmutable con el mensaje exacto del spec; BD sigue PEO |
| 485 | pass | Playwright con proyecto PEO real (id 1): input-prefijo-folio disabled y readonly, value=PEO, leyenda visible |
| 486 | pass | F-21 resuelto. Playwright: btn-nuevo-proyectos existe y al pulsarlo el campo prefijo queda habilitado |
| 487 | pass | PATCH proyectos/999999 con nombre valido (3 o mas caracteres) da 404 registro_no_encontrado |
| 488 | pass | PATCH con inmutables al mismo valor da 200, nombre actualizado sin error |
| 489 | pass | psql: catalogo_actualizado con cambios de nombre, anterior y nuevo distintos |
| 490 | pass | desactivar componente con hijos da 200, activo=false, hijos_activos reporta modalidades y proyectos |
| 491 | pass | psql: modalidades del componente desactivado siguen todas activo=true |
| 492 | pass | psql: proyectos del componente desactivado siguen todos activo=true |
| 493 | pass | GET /api/solicitudes/catalogos no incluye el componente mientras esta desactivado |
| 494 | pass | reactivar da 200 activo=true; repetir da 200 idempotente, sin fila nueva de auditoria (33 a 33) |
| 495 | pass | con componente inactivo, activar una modalidad hija da 409 padre_inactivo; verificado con ciclo completo desactivar y reactivar |
| 496 | pass | F-23 resuelto. Playwright: modal-confirmar-baja y texto-hijos-activos visibles; al confirmar, chip-inactivo en el padre y ausente en el hijo activo |
| 497 | pass | cadena de 7 altas (PRG-DEMO, SUB-DEMO, DEM-C, MOD-DEMO, DEM, DEM-CONCEPTO, Acta de asamblea demo), todas 201, solo HTTP, sin psql |
| 498 | pass | GET /api/solicitudes/catalogos incluye los 6 elementos nuevos, sin reiniciar backend ni re-sembrar |
| 499 | pass | POST documentos-requeridos con la jerarquia demo da 200, incluye Acta de asamblea demo |
| 500 | pass | POST /api/solicitudes con la jerarquia demo completa da 201, folio DEM-CAD-TOL-0001-26 cumple el regex |
| 501 | pass | F-24 resuelto. Playwright: alta de PRG-UI2 desde /catalogos da toast-exito visible y nodo en el arbol sin recargar |
| 502 | pass | desactivar DEM-C y DEM por API; psql: componentes activos vuelve a 4, proyectos activos vuelve a 1 |
| 503 | pass spot-check | stack recreado 2 veces desde cero en este pass; build de los 3 paquetes en 0; spot checks de login, beneficiarios, solicitudes, auditoria y la PWA responden 200. No se re-corrio exhaustivamente el rubric 1-446 completo en esta pasada (alcance del round: los 5 findings mas regresion de los 57 de Build 10), pero no se encontro ninguna senal de regresion en las areas muestreadas |

## Estado del stack al cerrar este pass

Se recreo el stack dos veces con docker compose down -v seguido de docker compose up --build o
up -d. Al finalizar la verificacion se dejaron los contenedores (db, backend, pwa) detenidos con
docker compose down (sin -v) para no dejar servicios corriendo de forma innecesaria. Para
reproducir cualquier hallazgo: docker compose up --build desde la raiz del repo.
