# Findings pass 4 - 2026-08-20

## Resumen

Stack recreado desde cero (docker compose down -v && docker compose up --build). Los 57
criterios del rubric de Build 10 (447-503) se verificaron uno por uno con curl, psql y
Playwright contra http://localhost:8081.

50/57 pasan. 7 fallan.

### F-13 y F-18: confirmacion independiente de los fixes

- F-13 (documentos_requeridos, commit 13c180a) - RESUELTO, confirmado. Alta de
  documentos_requeridos con body minimo, con arrays (componentes, tipos_persona) y dentro de
  la cadena end-to-end de 7 altas (criterio 497) devuelve 201 en todos los casos. Verificado con
  curl directo (criterios 479, 480) y con la auditoria (regla_documento_creada, criterio 481).
  Ya no hay 500 ni columnas duplicadas ni error de literal de array.
- F-18 (doble /api/api/ en el cliente HTTP, commit c7ad92c) - RESUELTO, confirmado. La
  pantalla /catalogos carga datos reales en el navegador (Playwright): arbol visible, conteos,
  alta de un programa nuevo (PRG-UI) aparece en el arbol sin recargar la pagina (parte del
  criterio 501). El doble prefijo ya no aparece en ninguna llamada de red observada durante las
  pruebas de UI.

Ambos fixes estan correctamente verificados de forma independiente, no solo por el mensaje de commit.

### Hallazgo nuevo de este pass

- F-24, major, criterio 501 - aunque el nodo nuevo si aparece en el arbol sin recargar (la
  parte de F-18 que estaba rota), el toast de exito nunca llega a pintarse. En
  pwa/src/pantallas/Catalogos.tsx, la funcion guardar() hace setExito('Registro creado
  correctamente.') y, en la siguiente linea sincrona (sin ningun await entre medio), llama a
  cerrarForm(), que a su vez hace setExito(null) y setModoForm(null). React nunca renderiza
  el estado intermedio: el data-testid="toast-exito" (que si existe en
  pwa/src/componentes/FormCatalogo.tsx linea 85) queda siempre en count() == 0 tras guardar.
  Confirmado con Playwright: toast-exito count: 0 inmediatamente despues de guardar, mientras que
  nodo PRG-UI count: 1 si aparece. El criterio 501 exige ambas cosas, asi que sigue fallando.

## Abiertos

- [ ] F-17 - minor - criterio 464 (y afecta el shape de 465/466 aunque no los hace fallar) - GET
  /api/admin/catalogos/:entidad devuelve porPagina (camelCase) en vez de por_pagina
  (snake_case). Reproduccion:
  curl -s http://localhost:3011/api/admin/catalogos/programas -H "Authorization: Bearer <admin>"
  da como resultado {"datos":[...],"total":1,"pagina":1,"porPagina":50}. El criterio 464 exige
  literalmente el objeto {datos, total, pagina, por_pagina}.

- [ ] F-19 - major - criterio 456 - ventanilla1 navegando directo a /catalogos NO redirige
  a /sin-permiso; la URL se queda en /catalogos (confirmado con Playwright:
  page.url() == http://localhost:8081/catalogos tras waitForLoadState('networkidle')) y no
  existe en ningun lado [data-testid="pantalla-sin-permiso"] (count() == 0).

- [ ] F-20 - major - criterio 468 - GET /api/admin/catalogos/documentos_requeridos?por_pagina=200
  sigue sin agregar los campos resueltos apoyo_clave, apoyo_excluir_clave, proyecto_clave que
  exige el contrato (16.5.3). Cada fila trae apoyo_id/proyecto_id en crudo pero nunca la clave
  legible. Confirmado con curl sobre una fila real: sin esas tres claves en el objeto.

- [ ] F-21 - major - criterio 486 - no existe [data-testid="btn-nuevo-proyectos"] en
  pwa/src/componentes/ArbolCatalogos.tsx. Solo programas (linea 53), componentes (linea 76) y
  tipos_apoyo (linea 99) tienen boton "Nuevo". No hay forma de dar de alta un proyecto,
  modalidad o subprograma desde la UI (aunque si por API, como demuestra la cadena de 497). El
  criterio 485 (editar PEO, prefijo deshabilitado) si pasa: se probo con el boton
  [data-testid="btn-editar-proyectos-1"], que si existe.

- [ ] F-22 - minor - criterio 487 - con el body literal del spec ({"nombre":"x"}, 1 caracter)
  contra un id inexistente (999999), Zod rechaza el payload por min(3) antes de llegar al
  chequeo de existencia, devolviendo 422 payload_invalido en vez de 404
  registro_no_encontrado. Reproduccion: curl -X PATCH
  http://localhost:3011/api/admin/catalogos/proyectos/999999 -d '{"nombre":"x"}' da 422.

- [ ] F-23 - major - criterio 496 - no existe [data-testid="modal-confirmar-baja"] en ningun
  archivo de pwa/src. Desactivar un componente con hijos activos llama la API directo sin ningun
  modal de confirmacion previo.

- [ ] F-24 - major - criterio 501 - el toast de exito nunca se pinta al dar de alta un registro
  desde /catalogos, por una condicion de carrera en Catalogos.tsx (guardar() limpia
  exito en la misma pasada sincrona en la que lo asigna, via cerrarForm()). El nodo nuevo si
  aparece en el arbol sin recargar, pero [data-testid="toast-exito"] nunca es visible.

## Resueltos (verificados este pass)

- [x] F-13 - critical - criterios 479, 480, 481, 497, 499 - alta de documentos_requeridos ya no
  devuelve 500. Confirmado con curl (body minimo, con arrays) y con la cadena end-to-end de
  criterio 497. Fix del commit 13c180a.
- [x] F-18 - critical - criterios 454, 485, funcionalmente el arbol de 496/501 - la pantalla
  /catalogos ya carga datos reales en el navegador; el doble /api/api/ desaparecio. Fix del
  commit c7ad92c. (Los criterios 486, 496 y 501 siguen fallando, pero por causas distintas y ya
  identificadas -- F-21, F-23 y la nueva F-24 respectivamente -- no por el bug original de F-18.)

## Detalle de verificacion por criterio (447-503)

| # | Resultado | Nota |
|---|---|---|
| 447 | pass | 401 sin Authorization |
| 448 | pass | 200, claves programas/componentes/conteos presentes |
| 449 | pass | 200 con editor_datos |
| 450 | pass | 403 rol_no_autorizado (capturista) |
| 451 | pass | 403 rol_no_autorizado (auditor) |
| 452 | pass | 403 rol_no_autorizado (ventanilla) |
| 453 | pass | 403 con ventanilla; count(*) FROM programas sin cambio |
| 454 | pass | Playwright: nav-catalogos visible, llega a pantalla-catalogos |
| 455 | pass | Playwright: editor ve nav, capturista/auditor/ventanilla no (count 0) |
| 456 | FALLA F-19 | se queda en /catalogos, sin pantalla-sin-permiso |
| 457 | pass | sin 016_*.sql, diff vacio en migrations/seeds |
| 458 | pass | sin diff en dependencies |
| 459 | pass | diff vacio en docker-compose/nginx/sync/db |
| 460 | pass | sin .delete( en catalogosAdmin.ts; DELETE devuelve 404 |
| 461 | pass | build de shared/backend/pwa en 0 (en host con devDependencies) |
| 462 | pass | subprogramas array, PET -> MOD-PEPFO -> PEO |
| 463 | pass | sin incluir_inactivos no trae DEM-C desactivado; con la query si, activo:false |
| 464 | FALLA F-17 | porPagina en vez de por_pagina |
| 465 | pass | total>=1, CASAS-EJIDALES presente |
| 466 | pass | filtra por padre_id correctamente |
| 467 | pass | 404 entidad_desconocida |
| 468 | FALLA F-20 | faltan apoyo_clave/proyecto_clave/apoyo_excluir_clave |
| 469 | pass | 6 claves, tipos_persona correcto |
| 470 | pass | clave normalizada a mayusculas |
| 471 | pass | 409 clave_duplicada, sin 500 |
| 472 | pass | 422 padre_invalido |
| 473 | pass | 422 padre_inactivo, reactivado despues |
| 474 | pass | unicidad por par (programa_id, clave) |
| 475 | pass | peo1 -> 422, P -> 422, DEM -> 201 |
| 476 | pass | 422 modalidad_no_corresponde_componente |
| 477 | pass | 422 payload_invalido (campo no declarado) |
| 478 | pass | 201 tipos_apoyo |
| 479 | pass | 422 tipo_persona_invalido y componente_invalido |
| 480 | pass | 201 documentos_requeridos |
| 481 | pass | auditoria_log con catalogo_creado/programas y regla_documento_creada/documentos_requeridos |
| 482 | pass | PATCH nombre, refleja en BD |
| 483 | pass | 422 campo_inmutable (clave) |
| 484 | pass | 422 campo_inmutable (prefijo_folio) con mensaje literal |
| 485 | pass | Playwright: input-prefijo-folio disabled, value=PEO, leyenda visible |
| 486 | FALLA F-21 | no existe btn-nuevo-proyectos en la UI |
| 487 | FALLA F-22 | body literal del spec da 422 (Zod) en vez de 404 |
| 488 | pass | inmutables con mismo valor -> 200, no-op tolerado |
| 489 | pass | auditoria catalogo_actualizado con cambios anterior/nuevo |
| 490 | pass | 200, hijos_activos reporta modalidades/proyectos |
| 491 | pass | modalidades hijas siguen activo=true |
| 492 | pass | proyectos hijos siguen activo=true |
| 493 | pass | GET /api/solicitudes/catalogos no incluye componente desactivado |
| 494 | pass | reactivar 200; repetir no agrega fila de auditoria |
| 495 | pass | 409 padre_inactivo al reactivar modalidad con padre inactivo |
| 496 | FALLA F-23 | no existe modal-confirmar-baja |
| 497 | pass | cadena de 7 altas, todas 201 |
| 498 | pass | GET /api/solicitudes/catalogos refleja todo sin reiniciar |
| 499 | pass | POST documentos-requeridos devuelve el requisito nuevo |
| 500 | pass | POST /api/solicitudes 201, folio DEM-CAD-AME-0001-26 cumple el patron |
| 501 | FALLA F-24 | nodo aparece sin recargar, pero toast-exito nunca se pinta |
| 502 | pass | limpieza: componentes activos=4, proyectos activos=1 tras desactivar DEM-C/DEM (y el artefacto propio DEMBAJA creado durante la prueba de 490-496) |
| 503 | parcial | ver nota abajo |

### Nota sobre 503 (regresion 1-446)

Por presupuesto de esta pasada no se re-verificaron los 446 criterios uno por uno. Se hizo un
smoke test dirigido sobre el mismo despliegue recreado desde cero:

- curl a /api/health, /api/auth/me, /api/beneficiarios, /api/catalogos, /api/solicitudes,
  /api/usuarios -> todos 200 con payloads coherentes.
- Playwright: login como admin y navegacion a /solicitudes, /beneficiarios, /auditoria,
  /depuracion, /usuarios, /dashboard -> las 6 pantallas cargan sin ningun texto de error
  visible ("error interno", "500", "no encontrado").

No se detecto ninguna regresion en esta muestra, pero no es una verificacion exhaustiva de los
446 criterios previos; un pass dedicado a 503 deberia recorrerlos explicitamente.

## Estado del entorno

Se dejaron los contenedores arriba (docker compose up -d) para que el entorno quede verificable.
Los archivos de prueba temporales creados durante la evaluacion (eval_pass4*.spec.js, capturas
eval485_*.png, sc_tmp.json, test-results/) fueron eliminados del working tree antes de terminar.
