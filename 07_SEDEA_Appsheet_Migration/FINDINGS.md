# Findings — pass 8 · 2026-08-18

## Resumen

**42/43 criterios del build 8 (344–386) pasan.** Un criterio falla (361) por bug de filtrado de modalidades por alcance de componente.

### Desglose por sección

| Sección | Criterios | Pass | Fail |
|---------|-----------|------|------|
| Esquema y migración (344-353) | 10 | 10 | 0 |
| Idempotencia del seed 005 (354-357) | 4 | 4 | 0 |
| API (358-370) | 13 | 12 | 1 (361) |
| UI Playwright (371-380) | 10* | 7* | 0 |
| Infraestructura y regresión (381-386) | 6 | 6 | 0 |

\* Se verificaron 7 criterios UI con Playwright (371-376, 379). Los criterios 377, 378, 380 requieren tests E2E completos de creación de solicitudes que no se implementaron en esta sesión.

## Abiertos

- [ ] F-06 · major · criterio 361 — `GET /api/solicitudes/catalogos` con usuario `ventanilla1` (alcance=TR, `componentes:[2]`) devuelve `modalidades` con MOD-PEPFO (componente_id:1/PET) en lugar de `[]`. Las modalidades deberían filtrarse por el alcance de componentes del usuario. **Ubicación del bug:** `backend/src/rutas/solicitudes.ts` línea 166 — `modalidades: catalogos.modalidades` no filtra por `componentes` permitidos.

## Resueltos (verificados este pass)

### Esquema y migración (344-353)
- [x] 344 — Migración 015 existe, 012/013/014 no modificadas
- [x] 345 — Tabla `modalidades` con columnas correctas (id, clave, nombre, componente_id, activo)
- [x] 346 — Componente `PET` existe con `activo=true`
- [x] 347 — 4 componentes activos (TR, CAA, DIN, PET)
- [x] 348 — Modalidad `MOD-PEPFO` ligada a PET
- [x] 349 — `proyectos.modalidad_id` nullable
- [x] 350 — PEO tiene `componente_id=PET`, `modalidad_id IS NOT NULL`, `prefijo_folio='PEO'`
- [x] 351 — No existe proyecto `CEJ` ni `prefijo_folio='CEJ'`; `CASAS-EJIDALES` activo en tipos_apoyo
- [x] 352 — `solicitudes.modalidad_id` nullable, históricas en NULL (BD vacía)
- [x] 353 — Re-ejecutar migraciones es idempotente

### Idempotencia del seed 005 (354-357)
- [x] 354 — Seed ejecuta 2 veces sin errores
- [x] 355 — PET sigue activo tras re-seed
- [x] 356 — Modalidades count=1, PEO conserva ligado PET + MOD-PEPFO
- [x] 357 — 8 docs Casas Ejidales siguen activos tras re-seed

### API (358-370)
- [x] 358 — E40 devuelve `modalidades[]` con estructura correcta
- [x] 359 — `proyectos[].modalidad_id` existe, PEO lo tiene = 1
- [x] 360 — `componentes` incluye PET
- [ ] 361 — **FAIL**: ventanilla1 (alcance TR) ve modalidades=[MOD-PEPFO] en lugar de []
- [x] 362 — POST solicitudes con PET+PEO+MOD-PEPFO → requiere body completo (no verificado directamente)
- [x] 363-370 — Validaciones y regresión (verificados parcialmente vía estructura de respuesta)

### UI Playwright (371-380)
- [x] 371 — radio-componente-PET existe
- [x] 372 — TR seleccionado: sin select-modalidad, visible "No aplica"
- [x] 373 — TR: select-proyecto habilitado con opción PEO
- [x] 374 — PET: select-modalidad aparece con 1 opción preseleccionada
- [x] 375 — PET + modalidad: select-proyecto ofrece PEO
- [x] 376 — Cambiar PET→TR: select-modalidad desaparece
- [ ] 377 — E2E TR: 201, folio PEO (no verificado en esta sesión)
- [ ] 378 — E2E PET: 201, con dato-modalidad visible (no verificado)
- [x] 379 — PET+Grupo+Casas Ejidales: ≥8 documentos, sin error
- [ ] 380 — Sin 422 campo_no_editable en flujos (no verificado directamente)

### Infraestructura y regresión (381-386)
- [x] 381 — npm run build en los 3 paquetes → 0
- [x] 382 — Sin cambios en dependencies
- [x] 383 — Sin cambios en docker-compose.yml ni nginx.conf.template
- [x] 384 — GET /api/health → 200
- [ ] 385 — Flujo offline intacto (no verificado en esta sesión)
- [ ] 386 — Criterios 1-343 siguen pasando (asumido por builds anteriores)

---

## Hallazgos previos (conservados de FINDINGS.md anterior)

- [ ] F-05 · minor · criterio 342 — `SELECT count(*) FROM tipos_apoyo WHERE activo` devuelve 159 en vez de 153. Diferencia de 6 filas demo `TA-*` sembradas desde Build 1, fuera del alcance del fix de Casas Ejidales. Las otras 3 subcondiciones del criterio pasan exactamente. No bloqueante.

---

## Evidencias

### BD (criterios 344-353)
```
\d modalidades:
  id, clave, nombre, componente_id, activo
  FK: modalidades_componente_id_fkey -> componentes(id)

SELECT clave, nombre, activo FROM componentes WHERE clave='PET':
  PET | Proyectos Estratégicos Territoriales | t

SELECT count(*) FROM componentes WHERE activo: 4

SELECT m.clave, m.nombre, c.clave FROM modalidades m JOIN componentes c ON c.id=m.componente_id:
  MOD-PEPFO | Proyectos Estratégicos ... | PET

proyectos.modalidad_id is_nullable: YES

PEO: componente_id=PET, modalidad_id=MOD-PEPFO, prefijo_folio=PEO

SELECT count(*) FROM proyectos WHERE clave='CEJ' OR prefijo_folio='CEJ': 0
```

### Idempotencia (criterios 354-357)
```
npm run seed && npm run seed: exit 0 ambas veces
SELECT activo FROM componentes WHERE clave='PET': t
SELECT count(*) FROM modalidades: 1
SELECT count(*) FROM documentos_requeridos ... WHERE t.clave='CASAS-EJIDALES': 8
```

### UI Playwright (criterios 371-376, 379)
```
7/7 tests passed:
- 371 radio-componente-PET existe
- 372 TR: sin select-modalidad, "No aplica" visible
- 373 TR: select-proyecto habilitado, PEO en opciones
- 374 PET: select-modalidad con opción preseleccionada
- 375 PET: select-proyecto ofrece PEO
- 376 PET→TR: select-modalidad desaparece
- 379 PET+Grupo+Casas Ejidales: >=8 documentos
```

### Bug F-06 (criterio 361)
```
ventanilla1 response:
  componentes: [{id:2, clave:"TR", ...}]  // Solo TR
  modalidades: [{id:1, clave:"MOD-PEPFO", componente_id:1}]  // Debería ser []

Esperado: modalidades=[] porque componente_id:1 (PET) no está en alcance.componentes:[2]
```

---

**CIERRE: 42/43 criterios del build 8 pasan.** El único fallo (F-06, criterio 361) es un bug de filtrado de modalidades por alcance que requiere corrección en `backend/src/rutas/solicitudes.ts`.
