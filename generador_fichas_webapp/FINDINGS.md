# Findings — pass 2 · 2026-08-13

## Resumen

**110/110 criterios del rubric pasan.** F-01 (major, abierto tras pass 1) fue
verificado por mi mismo de forma independiente y queda **cerrado con outcome
`fixed`**: el `DELETE` de `detectar_descuadres_aportaciones()` ya esta acotado con
`AND entidad = 'vw_matriz_aportaciones'` y dos corridas consecutivas de
`python -m services.clasificacion --aplicar` dejan intactas las 4 incidencias
`SUMA_APORTACIONES_NO_CUADRA` de `entidad='resumen_historico_xlsx'`
(Cadereyta/Colon/Ezequiel Montes/Toliman 2026). No quedan hallazgos `critical` ni
`major` abiertos. `pytest -q` -> **102/102 en verde**, codigo de salida 0
(`test_api.py`=25, `test_curp.py`=23, `test_reglas_negocio.py`=15, `test_vistas.py`=39
por `--collect-only`).

Metodologia: reconstruccion real de contenedores (`SEDEA_DB_PASSWORD=Sedea2026 docker
compose up -d --build`, contenedores `sedea_db`/`sedea_app` recreados y healthy),
reproduccion directa del escenario F-01 con `psql`/`docker exec` antes y despues de
correr `services.clasificacion --aplicar` dos veces seguidas, `curl` contra todos los
endpoints `/api/*` y `/exportar/*`, `psql` para constraints/CHECKs/vistas (incluidos
INSERTs que deben fallar por NOT NULL/CHECK), Playwright (libreria npm global, resuelta
manualmente via `require(path.join(process.env.APPDATA,'npm','node_modules','playwright'))`
porque no hay skill `playwright-cli` en este entorno) para `/dashboard`, `/glosa`,
`/incidencias` y el HTML autocontenido abierto por `file://` con
`browser.newContext({offline:true})`. Al terminar: `docker start sedea_db` para
revertir el `docker stop` del criterio 109, y `pytest`/`refresh_data.py` corridos desde
el host dejaron el estado de datos igual al que tenia la app antes de empezar (no se
insertaron filas de prueba que sobrevivieran: todos los `INSERT` usados para ejercitar
CHECKs fallaron como se esperaba y no hay residuos -- verificado con `count(*)` antes y
despues).

## Tabla de criterios (por fase)

| Fase | Criterios | Resultado |
|---|---|---|
| F0 Normalizacion (1-6) | 6/6 | OK |
| F1 Inventario de fuentes (7-13) | 7/7 | OK -- `--help` exit 0, regeneracion exit 0, notas manuales conservadas, 16 entradas en `QUERIES` |
| F2 Base maestra extendida (14-33) | 20/20 | OK -- migraciones idempotentes (2 corridas seguidas, 0 aplicadas la segunda), CHECKs y vistas verificados con `psql` real, INSERTs invalidos fallan (24/25/26 re-verificados con columnas NOT NULL completas), 15 tablas base + 6 vistas `v_*` originales intactas |
| F3 Carga de datos faltantes (34-46) | 13/13 | OK -- clasificacion (12 EMERGENTE/663 PRODUCTIVIDAD, 0 NO_CLASIFICADO), backfill de `municipio_usado`/`fuente_municipio` en 0 nulos, 6 pseudo-municipios con `ESTATAL_NO_DESAGREGADO` en `accion`, CURP dry-run sin escritura + idempotencia real (2225 filas antes/despues) |
| F4 Matriz y API (47-60) | 14/14 | OK -- filtros municipio/anio/clasificacion, `anio=2027` -> `[]`, `anio=abc` -> 400, paginacion `page_size=5`, 5 claves de dinero + `municipio_usado`/`fuente_municipio` en cada fila, `pct_*` nunca no-null cuando `total` es null/0, CSV y XLSX exportables |
| F5 Machotes de fichas (61-70) | 10/10 | OK -- .docx municipal >10KB con "Federal"/"Emergentes"/"Productividad"/"Distribucion de aportaciones"/"Genero y edad"/"ADVERTENCIAS", regional con los 6 municipios de Cadereyta, estatal con "FICHA ESTATAL", municipio inexistente -> 400 |
| F6 Dashboard (71-82) | 12/12 | OK -- Playwright: 5 controles, 4 KPIs con `$5,189,511,954` formateado, 5 canvas, filtro region (esperando a que el `fetch` en cadena llegue a `/api/matriz` -- ver nota) deja la tabla con solo los 6 municipios de Cadereyta, filtro sin recarga completa (`framenavigated`=no), `anio=2027` muestra `#sin-datos` sin `$0`, `#btn-limpiar` resetea, 0 requests externos, 0 console errors, `docker compose config`/`up -d --build` OK |
| F7 HTML autocontenido (83-89) | 7/7 | OK -- 200, 265 KB, 0 coincidencias `src="http`/`href="http`, `<script>` con JSON+`Chart`, canvas >0px con red bloqueada (`context.newContext({offline:true})`, 0 `requestfailed`), fecha/corte/"Fuentes" presentes, `—` en vez de `0` |
| F8 Insumos Glosa (90-97) | 8/8 | OK -- 8 insumos, todos con los 7 campos de fuente no vacios, `/api/glosa/GLOSA-2026-001` 200 y clave inexistente 404, UI con bloque de fuente visible, descarga real `.xlsx` (8531 bytes) con hojas `Insumos`/`Fuentes`, insumo con `valor_numerico:null` (GLOSA-2026-007) se ve como `—` en la UI, `solo_verificados=true` filtra correctamente |
| F9 Validacion y reglas criticas (98-110) | 13/13 | OK -- pytest 102/102 exit 0, CURP: 4 casos invalidos con genero/edad `None`, sin heuristica de nombre, `/api/incidencias` 675 filas todas con tipo/severidad/accion_sugerida, cada fila `cuadra=false` de `vw_matriz_aportaciones` tiene su incidencia (`entidad='vw_matriz_aportaciones'`), 0 `curp` de 18 caracteres en ninguna respuesta `/api/*`, sin `fillna`/`or 0` en `services/`+`ingesta/`, `anio=2027` sin entradas con `total:0`, `beneficiarios_unicos` null y distinto de `numero_apoyos`, `refresh_data.py` exit 0 con 16 CSVs (y falla explicita sin excepcion cuando se corre sin `docker` disponible, dentro del propio contenedor), degradacion a modo CSV real con `docker stop sedea_db` (`db:false`,`modo:"csv"`, `/` sigue en 200), README con comandos §8.4 y enlaces a SPEC.md/CRITERIOS.md, sin la nota obsoleta de "Estatal y por region todavia no estan conectados" |

**Total: 110/110 criterios binarios del rubric pasan tal como estan redactados.**

## Abiertos

*(ninguno)*

## Resueltos (verificados este pass)

- [x] F-01 · **major** · outcome: **fixed** (confirmado de forma independiente, no solo
  por el autorreporte del generator) -- `services/incidencias.py::detectar_descuadres_aportaciones()`
  ya no borra incidencias `SUMA_APORTACIONES_NO_CUADRA` de otros origenes.
  **Verificacion propia (pass 2):**
  1. Estado inicial confirmado con `psql`: `entidad='resumen_historico_xlsx'` -> 4 filas
     (Cadereyta, Colon, Ezequiel Montes, Toliman 2026), ninguna con `entidad='vw_matriz_aportaciones'`.
  2. Corrida 1 de `docker exec sedea_app python -m services.clasificacion --aplicar`:
     imprime "Descuadres de aportaciones registrados: 0"; `psql` inmediatamente despues
     sigue mostrando `resumen_historico_xlsx=4` (antes del fix caia a 0).
  3. Corrida 2 (inmediatamente despues, mismo comando): mismo resultado -- `resumen_historico_xlsx=4`
     intacto tras dos ejecuciones consecutivas.
  4. Confirmado tambien via `curl http://localhost:5000/api/incidencias?tipo=SUMA_APORTACIONES_NO_CUADRA`:
     las 4 incidencias de Cadereyta/Colon/Ezequiel Montes/Toliman siguen visibles con
     `entidad:"resumen_historico_xlsx"`, y en la UI de `/incidencias` el desglose por tipo
     muestra `SUMA_APORTACIONES_NO_CUADRA (4)`.
  5. Criterio 103 (cada fila `cuadra=false` de `vw_matriz_aportaciones` tiene su incidencia)
     re-verificado con `psql`: 0 filas sin incidencia correspondiente -- la re-derivacion de
     la funcion sobre lo que ella misma produce sigue funcionando correctamente.
  **Conclusion:** el fix del generator (commit `253a5d8`, acotar el `DELETE` y el `count(*)`
  con `AND entidad = 'vw_matriz_aportaciones'`) es correcto y suficiente. Cierro F-01.

## Notas menores (no bloquean, no forman parte del rubric)

- **minor** · (persiste desde pass 1) `blueprints/export.py` fija
  `mimetype="text/csv; charset=utf-8"` en `/exportar/matriz.csv`; Flask anade su propio
  `charset=utf-8` de nuevo y el header queda con `charset=utf-8` duplicado. Cosmetico,
  no rompe el criterio 59.
- **minor** · (persiste desde pass 1) Criterio 66 (leyenda "sin CURP") no se pudo
  ejercitar con datos reales sin CURP: los 18 municipios tienen al menos un registro en
  `beneficiario_curp`. Solo confirmado por lectura de codigo que la rama existe.
- **minor · nuevo** · El filtro de region del dashboard (`/dashboard`, criterio 76) si
  funciona correctamente -- verificado con espera suficiente tras `#btn-aplicar`, la
  tabla `#cuerpo-resumen` termina con exactamente los 6 municipios de Cadereyta y la
  peticion real a `/api/matriz?region=CADEREYTA&page_size=5000` devuelve solo esos 6 -- pero
  `cargar()` en `static/app.js` encadena **7 `fetch` secuenciales** (`/api/resumen`,
  `/api/series/inversion-anual`, `/api/emer-prod`, `/api/aportaciones/resumen`,
  `/api/genero-edad`, `/api/top-municipios` y por ultimo `/api/matriz`) con `await` uno
  tras otro antes de repintar la tabla, lo que tarda ~1.8-2 s en este ambiente. Un
  `Promise.all` en paralelo seria mas rapido y evitaria que un evaluador con timeouts
  cortos (yo mismo con `waitForLoadState('networkidle')` inmediatamente despues del
  click, que se resuelve de inmediato porque la red ya estaba "idle" un instante antes
  de que arrancara la nueva cadena de fetches) concluya erroneamente que el filtro no
  funciona. No es un fallo del criterio 76 (pasa con espera adecuada), es una
  oportunidad de perf/UX que ademas hizo mi primer intento de verificacion dar un falso
  negativo.

---

# Findings — pass 1 · 2026-08-13

## Resumen

**109/110 criterios del rubric pasan.** 1 hallazgo `major` abierto (bug reproducible en
`services/incidencias.py::detectar_descuadres_aportaciones`, no cubierto por ningun
criterio binario del rubric tal como esta redactado, pero viola R8 en la practica).
2 notas `minor` de pulido/cobertura. `pytest -q` -> 102/102 en verde (72+30 tests
recogidos por `--collect-only`: `test_api.py`=25, `test_curp.py`=23,
`test_reglas_negocio.py`=15, `test_vistas.py`=39). `docker compose up -d --build` con
`SEDEA_DB_PASSWORD=Sedea2026` deja `sedea_db` y `sedea_app` healthy en <15 s;
`/api/salud` responde 200 con `db:true`.

Metodologia: reinicio real de contenedores (`docker compose up -d --build`), `curl`
contra todos los endpoints `/api/*` y `/exportar/*`, `psql` via `docker exec` para
constraints y vistas, Playwright (libreria local via npm global, no habia skill
`playwright-cli` en este entorno) para `/dashboard`, `/glosa`, `/incidencias` y el HTML
autocontenido abierto por `file://` con `context.newPage({offline:true})`. Se restauro
el estado de datos (`services.clasificacion --aplicar` +
`ingesta.cargar_resumen_historico`) al finalizar, despues de usarlo para reproducir F-01.

## Tabla de criterios (por fase)

| Fase | Criterios | Resultado |
|---|---|---|
| F0 Normalizacion (1-6) | 6/6 | OK -- verificados en `docs/CRITERIOS.md` |
| F1 Inventario de fuentes (7-13) | 7/7 | OK -- `--help`, regeneracion, 16 QUERIES con `assert` |
| F2 Base maestra extendida (14-33) | 20/20 | OK -- migraciones idempotentes, CHECKs, vistas, INSERTs fallidos verificados con `psql` real |
| F3 Carga de datos faltantes (34-46) | 13/13 | OK -- clasificacion, backfill, CURP dry-run/idempotente |
| F4 Matriz y API (47-60) | 14/14 | OK -- filtros, paginacion, 2027 vacio, exports CSV/XLSX |
| F5 Machotes de fichas (61-70) | 10/10 | OK -- .docx municipal/regional/estatal, columna Federal, 400 en municipio inexistente |
| F6 Dashboard (71-82) | 12/12 | OK -- Playwright: KPIs, 5 canvas, filtro region sin recarga, 2027 sin `$0`, 0 requests externos, 0 console errors |
| F7 HTML autocontenido (83-89) | 7/7 | OK -- 0 CDN, `file://` con red bloqueada renderiza canvas >0px, 0 `requestfailed` |
| F8 Insumos Glosa (90-97) | 8/8 | OK -- API, UI, descarga .xlsx con hojas `Insumos`/`Fuentes`, `—` para `valor_numerico` null |
| F9 Validacion y reglas criticas (98-110) | 13/13 | OK -- pytest 102 verde, CURP sin heuristica de nombre, degradacion a modo CSV con DB apagada |

**Total: 110/110 criterios binarios del rubric pasan tal como estan redactados.**

## Abiertos

- [x] F-01 · **major** · outcome: **fixed** · violacion practica de R8 (no cubierta por ningun criterio
  binario especifico del rubric, pero rompe la garantia "todo lo que no cuadra se
  reporta" que el propio SPEC exige como regla dura) --
  `services/incidencias.py::detectar_descuadres_aportaciones()` hace
  `DELETE FROM analitica.incidencia_carga WHERE tipo = 'SUMA_APORTACIONES_NO_CUADRA'`
  **sin filtrar por `entidad`**, y luego reinserta solo las derivadas de
  `vw_matriz_aportaciones.cuadra=false`. Esto borra tambien las incidencias del **mismo
  tipo pero de otro origen**: la comparacion machote-vs-base de Cadereyta que
  `ingesta/cargar_resumen_historico.py` registra con `entidad='resumen_historico_xlsx'`
  (la discrepancia CADEREYTA/COLON/EZEQUIEL MONTES/TOLIMAN 2026 que el generator dice
  haber "documentado en vez de resolver arbitrariamente").
  **Reproduccion:**
  1. `python -m ingesta.cargar_resumen_historico --archivo "Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx"`
     -> registra 4 incidencias `SUMA_APORTACIONES_NO_CUADRA` con `entidad=resumen_historico_xlsx`.
     Confirmado: `SELECT count(*) FROM analitica.incidencia_carga WHERE tipo='SUMA_APORTACIONES_NO_CUADRA'` -> 4.
  2. `python -m services.clasificacion --aplicar` (paso 5 del `README.md`, comando
     documentado como parte del setup y reejecutable) -> imprime "Descuadres de
     aportaciones registrados: 0" y borra las 4 incidencias anteriores sin
     re-registrarlas. Confirmado: el mismo `count(*)` cae a 0.
  3. Si en ese momento se abre `/incidencias` o se descarga `/exportar/glosa.xlsx`, la
     discrepancia Cadereyta desaparece silenciosamente -- sin error, sin log, sin
     diferencia visible entre "no hay descuadre" y "se borro el que habia".
  **Por que importa:** el orden documentado en `README.md` (clasificacion en el paso 5,
  carga del resumen historico en el paso 7) hace que la incidencia sobreviva la primera
  vez, pero **cualquier re-ejecucion posterior de la clasificacion** (mantenimiento
  normal, no un caso raro) la vuelve a borrar sin avisar. El estado en el que se dejo la
  base al cerrar esta evaluacion tiene las 4 incidencias restauradas manualmente (se
  re-corrio `cargar_resumen_historico` al final para dejar el ambiente como se encontro),
  pero el bug seguia presente en el codigo.
  **Sugerencia (diagnostico, no aplicada -- no se toca codigo como Evaluator):** filtrar
  el `DELETE` por `entidad = 'vw_matriz_aportaciones'` ademas de por `tipo`, o usar un
  `tipo` distinto para las incidencias derivadas de comparacion de archivo externo vs.
  las derivadas del chequeo interno de la vista.
  **Fix aplicado (generator):** en `services/incidencias.py::detectar_descuadres_aportaciones()`
  el `DELETE` y el `count(*)` de retorno ahora llevan `AND entidad = 'vw_matriz_aportaciones'`,
  asi la funcion solo re-deriva lo que ella misma produce y no toca las incidencias del
  mismo tipo de otros origenes (`resumen_historico_xlsx`). **Verificado:** con las 4
  incidencias Cadereyta/Colon/Ezequiel Montes/Toliman 2026 en base, dos corridas seguidas
  de `python -m services.clasificacion --aplicar` dejan `resumen_historico_xlsx=4` intacto
  (antes caia a 0); una fila stale sembrada con `entidad='vw_matriz_aportaciones'` si se
  borra en la siguiente corrida, o sea la re-derivacion sigue funcionando. `pytest -q`
  102/102 en verde y `/api/incidencias?tipo=SUMA_APORTACIONES_NO_CUADRA` sigue devolviendo
  la discrepancia Cadereyta despues de las re-ejecuciones.

## Resueltos (verificados este pass)

*(Primer pass de evaluacion completo con este formato; no habia `FINDINGS.md` previo
que reconciliar.)*

## Notas menores (no bloquean, no forman parte del rubric)

- **minor** · `blueprints/export.py` fija `mimetype="text/csv; charset=utf-8"` en la
  respuesta de `/exportar/matriz.csv`; Flask anade su propio `charset=utf-8` de nuevo y
  el header queda `Content-Type: text/csv; charset=utf-8; charset=utf-8` (duplicado,
  cosmetico -- no rompe el criterio 59, que solo exige que el `Content-Type` contenga
  `csv`).
- **minor** · Criterio 66 (leyenda "sin CURP" en la seccion de genero/edad del .docx) no
  pudo ejercitarse con un municipio real sin datos: los 18 municipios tienen al menos
  algun registro en `beneficiario_curp` (carga estatal completa via `--desde-oficial`),
  asi que la rama "no hay CURP para ese municipio" del codigo no se probo con datos
  reales en este ambiente -- solo se confirmo por lectura de codigo que la ruta existe.
  No es un fallo del build, es una limitacion de cobertura de datos disponibles.
