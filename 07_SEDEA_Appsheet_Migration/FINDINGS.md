# Findings - pass N - 2026-08-21

## Resumen
50/50 criterios nuevos (551-600, seccion 19 "Pre-dictaminacion con IA") pasan, verificados con evidencia real (curl, psql via docker exec, y Playwright contra el stack levantado desde cero con docker compose down -v && up --build). Regresion superficial de /catalogos (rediseno a pestanas) y /solicitudes (ventanilla) tambien verificada sin errores.

## Verificacion de los puntos de atencion declarados por el Generator

1. Driver anthropic sin ANTHROPIC_API_KEY -> 503 ia_no_configurada. Confirmado en vivo: se recreo el contenedor backend con PREDICTAMEN_DRIVER=anthropic y ANTHROPIC_API_KEY vacio. El healthcheck siguio en 200 (el arranque no falla) y POST /api/dictamen/predictaminar devolvio 503 con codigo ia_no_configurada. Correcto. Se restauro el backend a simulado despues de la prueba.

2. Criterio 595 (precarga del veredicto humano) - interpretacion ok/ilegible/falta. Confirmado que el codigo (pwa/src/pantallas/DictamenDetalle.tsx, funcion veredictoSugerido) hace exactamente lo declarado: ok si presente y legible; si no, ilegible cuando hay archivoUrl y falta solo si no hay archivo.

3. No auto-aprobacion (598-600). Verificado explicitamente:
   - 598: confirmar S_NEG con resultado negativo y nota >=10 caracteres via Playwright creo una fila en dictamenes (solicitud_id=2, resultado=negativo, dictaminado_por=7 que es dict.test, predictamen_id=6 que es el ultimo pre-dictamen, coincide_con_ia=true).
   - 599: POST /api/dictamen/1/confirmar con resultado negativo contradiciendo un pre-dictamen positivo de S_POS devolvio 201 con coincide_con_ia=false. Confirmado tambien en BD.
   - 600: (a) antes de cualquier confirmacion, dictamenes no tenia fila para S_POS y la bandeja mostraba chip-dictamen-S_POS = Pendiente (Playwright, test previo a la mutacion de 599); (b) grep -ri de auto-aprob/autoaprob/aprobar con ia en backend/src pwa/src sin coincidencias; (c) POST /api/dictamen/id/confirmar sin resultado en el body -> 422 (Playwright + curl).
   Los tres se sostienen: ningun pre-dictamen queda como veredicto final sin confirmacion humana explicita.

## Detalle de verificacion por bloque

- 551-557 (migracion/rol/arranque): tablas predictamenes_ia/dictamenes existen, solicitud_expedientes no existe; columnas de predictamenes_ia correctas y sin ninguna columna con "expediente"; CHECK de estado rechaza valor invalido; npm run migrate corrido dos veces seguidas, exit 0 ambas (nota: el script se llama migrate, no migrar como decia el prompt de esta tarea); ROLES_USUARIO/ETIQUETAS_ROL incluyen dictaminador y packages/shared compila; usuario vent.dict (multi-rol) ya existe con rol exactamente ventanilla+dictaminador via API; backend y pwa (typecheck + build) terminan en 0.
- 558-565 (documentos individuales, sin expediente): S_POS con 8/8 filas con archivo_url, S_SIN con 0/8; E46 (POST .../documentos/id/archivo) sigue devolviendo 201 con archivo_url bajo /media/solicitudes/; descarga con token dict.test 200, sin token 401; grep de "expediente" sin coincidencias en codigo; POST .../expediente y GET /api/dictamen/id/expediente.pdf devuelven 404; GET /api/dictamen/S_POS trae 8 documentos con las claves esperadas; GET /api/dictamen/S_SIN todos con archivo_url null; sin clave expediente en el JSON.
- 566-575 (E55 predictaminar): sin token 401; rol solo capturista 403; S_POS positivo, S_NEG negativo, S_SIN negativo con documentos_con_archivo 0 y todo detalle presente false; payload vacio 422 payload_invalido; 21 ids 422 sin insertar filas; fila de S_POS con modelo_usado, generado_por correcto y detalle/documentos_evaluados igual a 8; repetir sobre S_POS inserto una segunda fila (no actualizo la anterior); claves y tipos de detalle correctos.
- 576-583 (bandeja/metricas E56/E59): filas/total con tipos correctos; orden negativo menor que sin-predictamen menor que positivo verificado creando una cuarta solicitud sin pre-dictaminar; filtro estado negativo correcto; busqueda q por folio; por_pagina 200 se recorta a 100; /api/dictamen/metricas con las 6 claves y porcentaje en rango; bandeja accesible con rol combinado ventanilla+dictaminador.
- 584-591 (pantalla /dictamen): nav visible y navega; usuario solo capturista va a /sin-permiso; 3 o mas filas en la tabla; boton de lote disabled sin seleccion, enabled con seleccion y contador correcto; seleccionar todos marca todo con contador correcto; predictaminar en lote muestra mensaje y chips Negativo/Positivo correctos; contadores docs-dictamen correctos (0/n y n/n).
- 592-600 (detalle y confirmacion): navegacion al detalle correcta; sin visor-expediente ni iframe, con enlaces /media/solicitudes/; un bloque doc-dictamen por documento; documento NEG muestra Ilegible con radio preseleccionado; S_SIN muestra Sin archivo adjunto sin enlaces; confirmar sin resultado deshabilitado, negativo con nota vacia muestra error-dictamen con role alert sin crear fila; confirmar con nota valida crea la fila correctamente; contradiccion con pre-dictamen deja coincide_con_ia false; no auto-aprobacion confirmada en sus tres partes.

## Regresion

- /catalogos (rediseno reciente a pestanas): pantalla carga, pantalla-catalogos visible tras login como admin. Verificacion superficial (no se re-corrio el spec completo test-catalogos-pestanas.spec.js porque tiene el BASE hardcodeado a http://localhost:5173, puerto de dev server que no estaba levantado en este pass; se uso Docker en 8081). Recomendacion menor: parametrizar ese spec con PWA_URL como hacen test-dictamen.spec.js y otros, para que sea reusable contra Docker.
- /solicitudes (ventanilla): pantalla carga sin errores con usuario ventanilla2.
- No se detecto ninguna regresion en el flujo de login, autenticacion por rol, ni en los endpoints de solicitudes/documentos usados como base del modulo de dictamen (E40, E44, E46 siguen funcionando sin cambios).

## Abiertos

Ninguno.

## Resueltos (verificados este pass)

- [x] 551 - migracion crea predictamenes_ia/dictamenes, no crea solicitud_expedientes.
- [x] 552 - columnas y tipos de predictamenes_ia correctos, sin columna expediente.
- [x] 553 - CHECK de estado rechaza valores fuera de positivo/negativo/error.
- [x] 554 - npm run migrate idempotente (dos corridas, exit 0 ambas).
- [x] 555 - dictaminador en ROLES_USUARIO/ETIQUETAS_ROL, packages/shared compila.
- [x] 556 - usuario con rol ventanilla+dictaminador creado/verificado via API.
- [x] 557 - backend/pwa typecheck y build en 0.
- [x] 558 - fixture deja S_POS 8/8 con archivo y S_SIN 0/8.
- [x] 559 - E46 sigue devolviendo 201 con archivo_url bajo /media/solicitudes/.
- [x] 560 - descarga de archivo con token 200, sin token 401.
- [x] 561 - sin rastro de expediente unico en el codigo (grep limpio).
- [x] 562 - endpoints de expediente inexistentes devuelven 404.
- [x] 563 - GET /api/dictamen/S_POS con documentos completos y claves correctas.
- [x] 564 - GET /api/dictamen/S_SIN todos archivo_url null.
- [x] 565 - sin clave expediente en la respuesta.
- [x] 566 - POST /api/dictamen/predictaminar sin token -> 401.
- [x] 567 - rol solo capturista -> 403.
- [x] 568 - S_POS -> 200, estado positivo.
- [x] 569 - S_NEG -> 200, estado negativo.
- [x] 570 - S_SIN -> 200, negativo, documentos_con_archivo 0, detalle todo presente false.
- [x] 571 - payload vacio -> 422 payload_invalido.
- [x] 572 - 21 ids -> 422, sin insertar filas.
- [x] 573 - fila de S_POS con modelo_usado, generado_por, detalle/documentos_evaluados correctos.
- [x] 574 - repetir sobre S_POS inserta segunda fila, no actualiza la anterior.
- [x] 575 - claves y tipos de detalle correctos, ids referenciados existen.
- [x] 576 - GET /api/dictamen/bandeja 200 con filas/total tipados.
- [x] 577 - orden negativo menor que sin-predictamen menor que positivo (verificado creando 4a solicitud).
- [x] 578 - claves de fila correctas, sin tiene_expediente.
- [x] 579 - filtro estado negativo correcto.
- [x] 580 - busqueda q por folio correcta.
- [x] 581 - por_pagina se recorta a 100.
- [x] 582 - /api/dictamen/metricas con las 6 claves y porcentaje en rango.
- [x] 583 - bandeja accesible con rol combinado.
- [x] 584 - nav a /dictamen funciona.
- [x] 585 - capturista redirige a /sin-permiso.
- [x] 586 - 3 o mas filas en la tabla.
- [x] 587 - boton de lote disabled/enabled segun seleccion.
- [x] 588 - seleccionar todos mas contador correcto.
- [x] 589 - predictaminar en lote, mensaje mas chip Negativo.
- [x] 590 - chip Positivo tras predictaminar, Sin revisar si nunca.
- [x] 591 - contadores de documentos por fila correctos.
- [x] 592 - navegacion al detalle correcta.
- [x] 593 - sin visor de expediente/iframe, con enlaces a /media/solicitudes/.
- [x] 594 - un bloque por documento, cantidad coincide con la API.
- [x] 595 - documento NEG muestra Ilegible preseleccionado (interpretacion revisada y razonable).
- [x] 596 - S_SIN muestra Sin archivo adjunto sin enlaces.
- [x] 597 - confirmar sin resultado disabled; negativo con nota vacia -> error visible, sin fila creada.
- [x] 598 - confirmar con nota valida crea fila en dictamenes con los campos correctos.
- [x] 599 - confirmacion que contradice al pre-dictamen deja coincide_con_ia false.
- [x] 600 - no auto-aprobacion confirmada en sus tres partes (a, b, c).
