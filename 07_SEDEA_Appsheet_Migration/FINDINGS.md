# Findings — pass 15 · 2026-08-20

## Resumen

**57/57 criterios del rubric de Build 10 (447-503) verificados con evidencia real** (curl,
psql, Playwright), sobre una base de datos recreada desde cero (docker compose down -v &&
docker compose up --build). **43 pasan, 13 fallan, 1 (503) se verifico de forma parcial**
(smoke test de endpoints pre-Build-10, no los 446 criterios uno por uno, ver nota al final).

### Hallazgo critico nuevo (bloquea la mayor parte de la UI de administracion):
- F-18, critical, criterio 501 (y afecta 454/485/486/496 funcionalmente) - el cliente
  HTTP del PWA antepone un /api extra a las 6 llamadas de catalogosAdmin, generando
  GET /api/api/admin/catalogos/arbol -> 404. La pantalla /catalogos nunca carga datos
  en el navegador real, aunque la API funciona perfectamente por curl.

### F-13 (documentos_requeridos) sigue critico: el commit f99d935 NO lo resolvio.
Cualquier alta de documentos_requeridos que incluya cualquier campo (incluso ninguno) devuelve
500, por dos bugs distintos en crearEntidad (backend/src/servicios/catalogosAdmin.ts):
1. Columnas duplicadas en el INSERT (orden, proyecto_id, apoyo_id, apoyo_excluir_id
   se agregan dos veces: una vez por el bucle generico de camposEnteros y otra vez en el
   bloque "Campos especificos de documentos_requeridos") -> error: column "orden" specified
   more than once.
2. Los campos array (componentes, tipos_persona, etc.) se serializan con JSON.stringify
   (["DEM-C"]) en vez de literal de array de Postgres ({DEM-C}) -> error: malformed array
   literal.

Esto bloquea en cascada los criterios 480, 481, 497, 499 y hace que 479 caiga en codigos de
error equivocados (una validacion nueva no pedida en el spec se ejecuta antes que las
validaciones correctas).

### Hallazgos previos: estado tras este pass
- [x] F-09 resuelto (403 rol_no_autorizado, confirmado, ver 450-453)
- [x] F-10 resuelto (clave normalizada a mayusculas, 470)
- [x] F-11 resuelto (SUB-IP bajo dos programas, 474)
- [x] F-12 resuelto (prefijo_folio 3 letras, 475)
- [ ] F-13 sigue abierto, critical (documentos_requeridos: 500 siempre, 479/480/481/497/499)
- [x] F-14 resuelto (PATCH con inmutables iguales -> 200, 488)
- [x] F-15 resuelto (padre_inactivo bloquea activar hijo, 495; confirmado tras corregir la
      metodologia de prueba: la modalidad de prueba debia desactivarse primero)
- [x] F-16 resuelto (modalidad_no_corresponde_componente, 476)

### Hallazgos nuevos de este pass
- F-17, minor, criterios 464/465/466 - la paginacion responde porPagina (camelCase) en vez
  de por_pagina (snake_case) como exige el contrato. No rompe funcionalidad pero el shape
  exacto exigido por 464 no se cumple.
- F-18, critical, criterio 501 (y bloquea 454 funcional, 485, 486, 496) - doble prefijo
  /api/api/... en pwa/src/api/cliente.ts (lineas 329-359): rompe toda la pantalla
  /catalogos en el navegador.
- F-19, major, criterio 456 - al navegar directo a /catalogos sin rol, la app no
  redirige a /sin-permiso ni existe data-testid="pantalla-sin-permiso" en ningun lado del
  codigo (pwa/src/pantallas/SinPermiso.tsx no tiene ese testid). Se queda en la URL
  /catalogos mostrando el mensaje inline via RutaProtegida.
- F-20, major, criterio 468 - GET /api/admin/catalogos/documentos_requeridos no agrega los
  campos resueltos apoyo_clave, apoyo_excluir_clave, proyecto_clave; el servicio nunca
  implemento esa resolucion.
- F-21, major, criterios 485 y 486 - no existe ningun boton [data-testid="btn-nuevo-proyectos"]
  en pwa/src/componentes/ArbolCatalogos.tsx. Solo programas, componentes y tipos_apoyo
  tienen boton "Nuevo"; no hay forma de crear proyectos, modalidades ni subprogramas
  desde la UI (aunque si desde la API).
- F-22, minor, criterio 487 - con el body literal del spec ({"nombre":"x"}, 1 caracter)
  contra un id inexistente, Zod rechaza el payload (min(3)) antes de llegar al chequeo de
  existencia, devolviendo 422 payload_invalido en vez de 404 registro_no_encontrado. Con
  un nombre valido (3+ caracteres) el 404 si funciona correctamente.
- F-23, major, criterio 496 - no existe ningun data-testid="modal-confirmar-baja" en todo
  pwa/src; desactivar un componente con hijos llama la API directo sin ninguna confirmacion.

---

## Abiertos

- [ ] F-13, critical, criterios 479, 480, 481, 497, 499 - alta de documentos_requeridos
  siempre devuelve 500 (columnas duplicadas + serializacion de arrays incorrecta). Ver
  reproduccion abajo.
- [ ] F-18, critical, criterio 501 (bloquea funcionalmente 454/485/486/496) - doble
  /api/api/ en el cliente HTTP rompe toda la pantalla de administracion de catalogos.
- [ ] F-17, minor, criterios 464, 465, 466 - porPagina en vez de por_pagina en la
  respuesta de E50.
- [ ] F-19, major, criterio 456 - no hay redireccion a /sin-permiso ni testid
  pantalla-sin-permiso.
- [ ] F-20, major, criterio 468 - faltan apoyo_clave/apoyo_excluir_clave/proyecto_clave
  resueltos en documentos_requeridos.
- [ ] F-21, major, criterios 485, 486 - no hay boton para crear proyectos en la UI.
- [ ] F-22, minor, criterio 487 - validacion Zod se ejecuta antes que el chequeo de
  existencia; con el body literal del spec da 422 en vez de 404.
- [ ] F-23, major, criterio 496 - no hay modal de confirmacion al desactivar un nodo con
  hijos activos.

### F-13 reproduccion

Incluso el body minimo (solo requisito) falla:

curl -X POST http://localhost:3011/api/admin/catalogos/documentos_requeridos -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"requisito\":\"Test minimo\"}"

Respuesta: {"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}} 500

Log del backend: error: column "orden" specified more than once, en crearEntidad (catalogosAdmin.js:289)

Con arrays (componentes/tipos_persona), el 500 ocurre antes, en el SELECT de duplicados:
error: malformed array literal: "[\"grupo\"]", en crearEntidad (catalogosAdmin.js:181), query de unicidad de documentos_requeridos.

Body exacto del criterio 480 (spec) tambien da 500 error_interno.

Causa raiz (backend/src/servicios/catalogosAdmin.ts):
1. REGISTRO_ENTIDADES.documentos_requeridos.camposEnteros incluye proyecto_id, apoyo_id,
   apoyo_excluir_id y orden (packages/shared/src/catalogos.ts linea 285). El bucle
   generico de "Campos enteros (padres)" (linea ~279) ya agrega esas columnas al INSERT.
   Luego el bloque "Campos especificos de documentos_requeridos" (linea ~321) las vuelve a
   agregar, columna duplicada.
2. valores.push(JSON.stringify(valor)) para camposArreglo (linea ~291 y tambien en la
   query de duplicados en linea ~218-219) produce un string JSON que Postgres no puede
   parsear como text[] (malformed array literal). Se necesita el formato de array de
   Postgres o pasar el array de JS directamente sin JSON.stringify.

Impacto: ninguna regla de documentos_requeridos puede crearse desde el Build 10, ni por
API ni por UI. Esto bloquea 479, 480, 481 (nunca se escribe regla_documento_creada), 497
(la cadena de 7 altas no puede completar la septima) y 499 (el checklist dinamico nunca
encuentra la regla "Acta de asamblea demo" porque no existe).

### F-18 reproduccion

pwa/src/api/cliente.ts define URL_API = '/api' (linea 26) y todas las demas rutas del
cliente pasan la ruta SIN el prefijo /api (ejemplo: /usuarios/id, /mi-cuenta/password).
Las 6 rutas nuevas de Build 10 (lineas 329-359) SI incluyen el prefijo /api de mas, dentro
de peticion(rutaConPrefijoApi).

Resultado en el navegador (verificado con Playwright y logs del backend):
GET /api/api/admin/catalogos/arbol -> 404
GET /api/api/admin/catalogos/referencias -> 404

Captura: /catalogos muestra "Ruta no encontrada" y "Sin datos" en vez del arbol, ver
test-results/501-inicial.png (generado en este pass). El backend nunca ve la peticion
correcta; por eso los criterios de API que pasan por curl (que si usa la ruta correcta) no
reflejan lo que ve un usuario real en el navegador.

Fix de una linea por ocurrencia: quitar el prefijo /api de las 6 llamadas en
pwa/src/api/cliente.ts lineas 329, 334, 338, 345, 352, 359 (dejar solo /admin/catalogos/...).

---

## Detalle de criterios verificados (447-503)

### Acceso y roles (447-456)

| # | Estado | Evidencia |
|---|--------|-----------|
| 447 | pass | curl sin Authorization -> 401 |
| 448 | pass | admin -> 200, keys programas, componentes, proyectos_huerfanos, conteos |
| 449 | pass | editor_datos -> 200 |
| 450 | pass | capturista -> 403 rol_no_autorizado |
| 451 | pass | auditor -> 403 rol_no_autorizado |
| 452 | pass | ventanilla -> 403 rol_no_autorizado |
| 453 | pass | POST con token ventanilla -> 403; conteo de programas sin cambio (1 antes y despues) |
| 454 | pass | Playwright: admin ve nav-catalogos, llega a /catalogos, pantalla-catalogos visible |
| 455 | pass | Playwright: editor_datos ve nav-catalogos; capturista/auditor/ventanilla no lo ven (5 tests, todos pass) |
| 456 | FALLA F-19 | Playwright: ventanilla en /catalogos se queda en esa URL (no /sin-permiso); no existe data-testid pantalla-sin-permiso en el codigo |

### Restricciones del build (457-461)

| # | Estado | Evidencia |
|---|--------|-----------|
| 457 | pass | no existe db/migrations/016_*; git diff de migrations/seeds vacio |
| 458 | pass | git diff de package.json/package-lock.json sin cambios |
| 459 | pass | git diff de docker-compose.yml, nginx.conf.template, pwa/src/sync, pwa/src/db vacio |
| 460 | pass | grep de .delete( sin resultados; DELETE programas/1 -> 404 |
| 461 | pass | npm run build en packages/shared, backend, pwa: los 3 terminan en 0 con exito |

### Lectura (462-469)

| # | Estado | Evidencia |
|---|--------|-----------|
| 462 | pass | programas[0].subprogramas es array; modalidades[0].clave MOD-PEPFO; proyectos[0].clave PEO |
| 463 | pass | sin incluir_inactivos el componente inactivo esta ausente; con incluir_inactivos=true aparece con activo:false |
| 464 | FALLA F-17 | responde con clave porPagina, no por_pagina como exige el contrato |
| 465 | pass | q=casas -> total 1, clave CASAS-EJIDALES |
| 466 | pass | padre_id filtra correctamente por programa_id |
| 467 | pass | entidad inexistente -> 404 entidad_desconocida |
| 468 | FALLA F-20 | documentos_requeridos no trae apoyo_clave/apoyo_excluir_clave/proyecto_clave resueltos |
| 469 | pass | referencias trae las 6 claves; tipos_persona correcto |

### Alta y validacion (470-481)

| # | Estado | Evidencia |
|---|--------|-----------|
| 470 | pass | clave normalizada a mayusculas, 201 |
| 471 | pass | repetir -> 409 clave_duplicada |
| 472 | pass | padre inexistente -> 422 padre_invalido |
| 473 | pass | padre desactivado -> 422 padre_inactivo, reactivado despues |
| 474 | pass | SUB-IP bajo otro programa -> 201; repetir mismo programa -> 409 |
| 475 | pass | prefijo invalido -> 422 (x2); prefijo valido DEM -> 201 |
| 476 | pass | modalidad_no_corresponde_componente confirmado (F-16) |
| 477 | pass | campo no declarado -> 422 payload_invalido |
| 478 | pass | tipos_apoyo alta -> 201 |
| 479 | FALLA F-13 | codigos de error incorrectos (payload_invalido y requisito_invalido en vez de los especificos) |
| 480 | FALLA F-13 | body exacto del spec -> 500 error_interno |
| 481 | FALLA F-13 | regla_documento_creada nunca se escribe porque el alta siempre falla |

### Edicion e inmutabilidad (482-489)

| # | Estado | Evidencia |
|---|--------|-----------|
| 482 | pass | PATCH nombre -> 200, BD refleja el cambio |
| 483 | pass | PATCH clave -> 422 campo_inmutable, BD sin cambio |
| 484 | pass | PATCH prefijo_folio distinto -> 422 campo_inmutable con mensaje literal exacto, BD sin cambio |
| 485 | FALLA F-21 | no existe boton btn-nuevo-proyectos en ArbolCatalogos.tsx |
| 486 | FALLA F-21 | mismo motivo, no hay flujo de alta de proyectos en la UI |
| 487 | FALLA F-22 | body literal del spec da 422 payload_invalido (Zod min 3) en vez de 404; con nombre valido si da 404 |
| 488 | pass | PATCH con inmutables en su mismo valor -> 200, nombre actualizado (F-14 confirmado) |
| 489 | pass | auditoria_log tiene catalogo_actualizado con cambios de nombre distintos |

### Baja logica (490-496)

| # | Estado | Evidencia |
|---|--------|-----------|
| 490 | pass | desactivar componente con hijos -> 200, hijos_activos reportado |
| 491 | pass | modalidades hijas siguen activas |
| 492 | pass | proyectos hijos siguen activos |
| 493 | pass | catalogo publico no incluye el componente inactivo |
| 494 | pass | reactivar -> 200; repetir -> 200 idempotente sin fila nueva de auditoria |
| 495 | pass | activar hijo con padre inactivo -> 409 padre_inactivo (F-15 confirmado) |
| 496 | FALLA F-23 | no existe modal-confirmar-baja en ningun archivo de pwa/src |

### End-to-end (497-503)

| # | Estado | Evidencia |
|---|--------|-----------|
| 497 | FALLA F-13 | cadena de 6 altas exitosa, la septima (documentos_requeridos) siempre 500 |
| 498 | pass | catalogo publico incluye la jerarquia demo completa sin reiniciar backend |
| 499 | FALLA F-13 | checklist dinamico vacio porque la regla nunca se creo |
| 500 | pass | solicitud creada con folio DEM-CAD-AME-0001-26, cumple el patron esperado |
| 501 | FALLA F-18 | boton btn-nuevo-programas nunca aparece porque el arbol nunca carga (doble prefijo api) |
| 502 | pass | limpieza: componentes activo=4, proyectos activo=1 |
| 503 | parcial | BD recreada desde cero, migraciones y seed limpios; smoke test de endpoints clave post-reset OK; no se re-verificaron los 446 criterios anteriores uno por uno en este pass |

---

## Resueltos (verificados este pass)

- [x] F-09, criterio 456 parte API - 403 rol_no_autorizado confirmado en 450-453
- [x] F-10, criterio 470 - clave normalizada a mayusculas
- [x] F-11, criterio 474 - SUB-IP bajo dos programas distintos
- [x] F-12, criterio 475 - prefijo_folio de 3 letras acepta
- [x] F-14, criterio 488 - PATCH con inmutables en su mismo valor ya no da 500
- [x] F-15, criterio 495 - 409 padre_inactivo al intentar reactivar un hijo con padre inactivo
- [x] F-16, criterio 476 - modalidad_no_corresponde_componente cuando no coinciden

---

CIERRE: 43/57 criterios de Build 10 pasan, 13 fallan, 1 (503) verificado parcialmente.
Dos hallazgos criticos siguen bloqueando la funcionalidad real: F-13 (alta de
documentos_requeridos siempre 500, pese al commit f99d935) y F-18 (doble prefijo /api/api/
en el cliente rompe toda la UI de /catalogos en el navegador, aunque la API por si sola
funcione). Mientras F-18 no se corrija, ningun criterio de Playwright sobre /catalogos que
dependa de datos cargados (501, 496, y funcionalmente 454/485/486) puede pasar de verdad.
