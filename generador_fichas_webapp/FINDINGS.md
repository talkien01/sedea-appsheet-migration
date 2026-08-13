# Findings — pass 1 · 2026-08-13

## Resumen

**109/110 criterios del rubric pasan.** 1 hallazgo `major` abierto (bug reproducible en
`services/incidencias.py::detectar_descuadres_aportaciones`, no cubierto por ningún
criterio binario del rubric tal como está redactado, pero viola R8 en la práctica).
2 notas `minor` de pulido/cobertura. `pytest -q` -> 102/102 en verde (72+30 tests
recogidos por `--collect-only`: `test_api.py`=25, `test_curp.py`=23,
`test_reglas_negocio.py`=15, `test_vistas.py`=39). `docker compose up -d --build` con
`SEDEA_DB_PASSWORD=Sedea2026` deja `sedea_db` y `sedea_app` healthy en <15 s;
`/api/salud` responde 200 con `db:true`.

Metodología: reinicio real de contenedores (`docker compose up -d --build`), `curl`
contra todos los endpoints `/api/*` y `/exportar/*`, `psql` vía `docker exec` para
constraints y vistas, Playwright (librería local vía npm global, no había skill
`playwright-cli` en este entorno) para `/dashboard`, `/glosa`, `/incidencias` y el HTML
autocontenido abierto por `file://` con `context.newPage({offline:true})`. Se restauró
el estado de datos (`services.clasificacion --aplicar` +
`ingesta.cargar_resumen_historico`) al finalizar, después de usarlo para reproducir F-01.

## Tabla de criterios (por fase)

| Fase | Criterios | Resultado |
|---|---|---|
| F0 Normalización (1-6) | 6/6 | OK — verificados en `docs/CRITERIOS.md` |
| F1 Inventario de fuentes (7-13) | 7/7 | OK — `--help`, regeneración, 16 QUERIES con `assert` |
| F2 Base maestra extendida (14-33) | 20/20 | OK — migraciones idempotentes, CHECKs, vistas, INSERTs fallidos verificados con `psql` real |
| F3 Carga de datos faltantes (34-46) | 13/13 | OK — clasificación, backfill, CURP dry-run/idempotente |
| F4 Matriz y API (47-60) | 14/14 | OK — filtros, paginación, 2027 vacío, exports CSV/XLSX |
| F5 Machotes de fichas (61-70) | 10/10 | OK — .docx municipal/regional/estatal, columna Federal, 400 en municipio inexistente |
| F6 Dashboard (71-82) | 12/12 | OK — Playwright: KPIs, 5 canvas, filtro región sin recarga, 2027 sin `$0`, 0 requests externos, 0 console errors |
| F7 HTML autocontenido (83-89) | 7/7 | OK — 0 CDN, `file://` con red bloqueada renderiza canvas >0px, 0 `requestfailed` |
| F8 Insumos Glosa (90-97) | 8/8 | OK — API, UI, descarga .xlsx con hojas `Insumos`/`Fuentes`, `—` para `valor_numerico` null |
| F9 Validación y reglas críticas (98-110) | 13/13 | OK — pytest 102 verde, CURP sin heurística de nombre, degradación a modo CSV con DB apagada |

**Total: 110/110 criterios binarios del rubric pasan tal como están redactados.**

## Abiertos

- [x] F-01 · **major** · outcome: **fixed** · violación práctica de R8 (no cubierta por ningún criterio
  binario específico del rubric, pero rompe la garantía "todo lo que no cuadra se
  reporta" que el propio SPEC exige como regla dura) —
  `services/incidencias.py::detectar_descuadres_aportaciones()` hace
  `DELETE FROM analitica.incidencia_carga WHERE tipo = 'SUMA_APORTACIONES_NO_CUADRA'`
  **sin filtrar por `entidad`**, y luego reinserta solo las derivadas de
  `vw_matriz_aportaciones.cuadra=false`. Esto borra también las incidencias del **mismo
  tipo pero de otro origen**: la comparación machote-vs-base de Cadereyta que
  `ingesta/cargar_resumen_historico.py` registra con `entidad='resumen_historico_xlsx'`
  (la discrepancia CADEREYTA/COLÓN/EZEQUIEL MONTES/TOLIMÁN 2026 que el generator dice
  haber "documentado en vez de resolver arbitrariamente").
  **Reproducción:**
  1. `python -m ingesta.cargar_resumen_historico --archivo "Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx"`
     -> registra 4 incidencias `SUMA_APORTACIONES_NO_CUADRA` con `entidad=resumen_historico_xlsx`.
     Confirmado: `SELECT count(*) FROM analitica.incidencia_carga WHERE tipo='SUMA_APORTACIONES_NO_CUADRA'` -> 4.
  2. `python -m services.clasificacion --aplicar` (paso 5 del `README.md`, comando
     documentado como parte del setup y reejecutable) -> imprime "Descuadres de
     aportaciones registrados: 0" y borra las 4 incidencias anteriores sin
     re-registrarlas. Confirmado: el mismo `count(*)` cae a 0.
  3. Si en ese momento se abre `/incidencias` o se descarga `/exportar/glosa.xlsx`, la
     discrepancia Cadereyta desaparece silenciosamente — sin error, sin log, sin
     diferencia visible entre "no hay descuadre" y "se borró el que había".
  **Por qué importa:** el orden documentado en `README.md` (clasificación en el paso 5,
  carga del resumen histórico en el paso 7) hace que la incidencia sobreviva la primera
  vez, pero **cualquier re-ejecución posterior de la clasificación** (mantenimiento
  normal, no un caso raro) la vuelve a borrar sin avisar. El estado en el que se dejó la
  base al cerrar esta evaluación tiene las 4 incidencias restauradas manualmente (se
  re-corrió `cargar_resumen_historico` al final para dejar el ambiente como se encontró),
  pero el bug sigue presente en el código.
  **Sugerencia (diagnóstico, no aplicada — no se toca código como Evaluator):** filtrar
  el `DELETE` por `entidad = 'vw_matriz_aportaciones'` además de por `tipo`, o usar un
  `tipo` distinto para las incidencias derivadas de comparación de archivo externo vs.
  las derivadas del chequeo interno de la vista.
  **Fix aplicado (generator):** en `services/incidencias.py::detectar_descuadres_aportaciones()`
  el `DELETE` y el `count(*)` de retorno ahora llevan `AND entidad = 'vw_matriz_aportaciones'`,
  así la función solo re-deriva lo que ella misma produce y no toca las incidencias del
  mismo tipo de otros orígenes (`resumen_historico_xlsx`). **Verificado:** con las 4
  incidencias Cadereyta/Colón/Ezequiel Montes/Tolimán 2026 en base, dos corridas seguidas
  de `python -m services.clasificacion --aplicar` dejan `resumen_historico_xlsx=4` intacto
  (antes caía a 0); una fila stale sembrada con `entidad='vw_matriz_aportaciones'` sí se
  borra en la siguiente corrida, o sea la re-derivación sigue funcionando. `pytest -q`
  102/102 en verde y `/api/incidencias?tipo=SUMA_APORTACIONES_NO_CUADRA` sigue devolviendo
  la discrepancia Cadereyta después de las re-ejecuciones.

## Resueltos (verificados este pass)

*(Primer pass de evaluación completo con este formato; no había `FINDINGS.md` previo
que reconciliar.)*

## Notas menores (no bloquean, no forman parte del rubric)

- **minor** · `blueprints/export.py` fija `mimetype="text/csv; charset=utf-8"` en la
  respuesta de `/exportar/matriz.csv`; Flask añade su propio `charset=utf-8` de nuevo y
  el header queda `Content-Type: text/csv; charset=utf-8; charset=utf-8` (duplicado,
  cosmético — no rompe el criterio 59, que solo exige que el `Content-Type` contenga
  `csv`).
- **minor** · Criterio 66 (leyenda "sin CURP" en la sección de género/edad del .docx) no
  pudo ejercitarse con un municipio real sin datos: los 18 municipios tienen al menos
  algún registro en `beneficiario_curp` (carga estatal completa vía `--desde-oficial`),
  así que la rama "no hay CURP para ese municipio" del código no se probó con datos
  reales en este ambiente — solo se confirmó por lectura de código que la ruta existe.
  No es un fallo del build, es una limitación de cobertura de datos disponibles.
