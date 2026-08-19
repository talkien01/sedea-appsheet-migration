# Findings — pass 12 · 2026-08-19

## Resumen

**445/446 criterios** del rubric acumulado (secciones 1-15, criterios 1-446) pasan. Build 9 (rediseño visual IntechQRO, criterios 387-446) está sólidamente implementado: tokens dark/light, toggle de tema persistente, cascarón sidebar/barra-inferior sin duplicar `data-testid` en ningún viewport, tipografía autoalojada sin CDN, contraste WCAG AA verificado por cómputo real en ambos modos, y ningún endpoint/lógica de negocio de las secciones 1-14 se rompió.

Un solo hallazgo nuevo, **minor**, sobre la letra literal del criterio 401. Se mantiene abierto F-05 (minor, arrastrado desde builds anteriores, sin relación con Build 9).

Arranque limpio desde cero: `docker compose down -v` + `docker compose up --build`. 14 migraciones aplicadas en orden (incluye `015_modalidades.sql`), seed corrido automáticamente, ambos con exit 0.

Verificación real con Playwright (Chromium) contra `http://localhost:8081`/`http://localhost:3011` — scripts propios para: toggle de tema (persistencia, `prefers-color-scheme`, teclado, ARIA), cascarón en 390×844/820×1180/1440×900 para 5 roles (capturista1, ventanilla1, auditor1, editor1, admin), deduplicación de `data-testid` `nav-*`, contraste WCAG 2.1 sobre `getComputedStyle` real (incluye parseo de `color(srgb …)` de `color-mix()`), flujo E2E de alta de solicitud, flujo E2E de captura offline, capturas de pantalla de varias pantallas en ambos modos — más `curl` con tokens JWT reales y `psql` directo.

### Desglose Build 9 (387-446): 59/60
Tokens y paleta 10/10 · Tipografía 4/5 · Toggle de tema 11/11 · Cascarón y responsive 17/17 · Lenguaje visual 11/11 · Contraste 5/5 · No regresión 1/1.

### Regresión secciones 1-386: sin hallazgos nuevos
`git diff --stat` vacío sobre todos los directorios protegidos por el scope de Build 9. RBAC por rol y por endpoint sin cambios de comportamiento.

## Abiertos

- **F-08 · minor · criterio 401** — En viewport 390×844, `/solicitudes/nueva` tiene 9 elementos `input[type=checkbox]`/`input[type=radio]` visibles (`radio-componente-*`, `chk-agricola`, `chk-ganadera`, `chk-acuicola`, `chk-pesca`, `chk-declaracion`) cuyo `fontSize` computado es `13.3333px`, no ≥16px. La letra del criterio 401 dice "todo `input`, `select` y `textarea` visible… tiene `fontSize` computado ≥ 16px" sin excepción de tipo. `/login` sí cumple (sus 2 `input` de texto miden 16px). La motivación documentada en §15.4.3 del propio SPEC.md ("por debajo de 16px iOS Safari hace zoom automático al enfocar") aplica solo a campos de texto editables — un checkbox/radio no dispara ese zoom — así que probablemente el criterio esté redactado más amplio de lo que su justificación requiere, pero tomado literalmente falla con evidencia reproducible. Reproducción: Playwright, viewport 390×844, login `ventanilla2/cambiame123`, `/solicitudes/nueva`, listar `input:visible` y leer `fontSize` — 9 de 47 miden `13.3333px` (el resto, incluidos todos los `input type=text/date/tel/email` y `select`, mide 16px).

- **F-05 · minor · criterio 342** (arrastrado, sin relación con Build 9) — `SELECT count(*) FROM tipos_apoyo WHERE activo` devuelve 159 en vez de 153 (6 filas demo de Build 1). Reconfirmado con arranque limpio en este pass. Las otras 3 sub-condiciones del criterio siguen pasando exactamente.

## Resueltos este pass
Ninguno nuevo — no había abiertos de Build 8 distintos de F-05, que se re-confirma sin cambios.

## Notas metodológicas relevantes
- Al medir el criterio 431 (ninguna `.tarjeta` blanca en dark) tuve un falso positivo inicial: fijar `data-mode` con `setAttribute` y luego navegar (`page.goto`) hace que el script anti-parpadeo de `index.html` lo revierta según `localStorage`/preferencia de sistema. Corregido fijando `localStorage['sedea.tema']` antes de cada navegación; tras la corrección, dark nunca muestra `rgb(255,255,255)` en tarjetas.
- El criterio 429 (toast vs. barra inferior) no es literalmente probable en `/beneficiarios` porque esa pantalla no dispara ningún `.toast` propio. Se verificó con el flujo real de captura (`/beneficiarios/:id/captura`), que usa la misma clase `.toast` y la misma regla `@media` de offset — comportamiento equivalente, sin solape con la barra inferior.
- El criterio 399 (`.folio-grande` en `/solicitudes/:id`) requirió crear una solicitud real vía flujo E2E completo porque la base recién sembrada no trae ninguna; detecté en el camino un detalle de UX del formulario (no reportado como hallazgo porque no es un criterio del rubric): el estado inicial de "conceptos" ya trae una fila vacía, así que pulsar "Agregar concepto" antes de llenarla dos veces deja una fila incompleta que bloquea el guardado — comportamiento correcto de la app, solo hay que llenar la fila existente en vez de agregar una nueva si solo se necesita un concepto.

Contenedores Docker detenidos al finalizar (`docker compose down`, sin `-v`).

## Nota adicional (fuera del rubric, no bloqueante)

`npm run typecheck` reporta 4 errores preexistentes `TS18047: 'catalogos' is possibly 'null'` en `pwa/src/pantallas/NuevaSolicitud.tsx` (líneas 458, 463, 489, 496), confirmados presentes desde antes del Build 9 (`git stash` lo verificó). `vite build` no typechequea, por eso no bloquearon ningún build anterior. No forman parte de ningún criterio del rubric.
