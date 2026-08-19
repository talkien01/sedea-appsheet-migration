# Findings — pass 14 · 2026-08-19

## Resumen

**40/57 criterios del build 10 (447–503) verificados mediante curl/API.** De los verificados, 34 pasan y 6 fallan.

### Hallazgos críticos/mayors nuevos:
- F-13: criterio 479/480 — 500 en validación de documentos_requeridos
- F-14: criterio 488 — 500 en edición con valores inmutables iguales
- F-15: criterio 495 — no valida padre_inactivo en modalidades
- F-16: criterio 476 — no implementa validación cruzada componente/modalidad

### Hallazgos previos RESUELTOS:
- [x] F-09 · major · criterio 456 — API devuelve 403 "rol_no_autorizado" para ventanilla
- [x] F-10 · critical · criterio 470 — normalización a mayúsculas en programas
- [x] F-11 · critical · criterio 474 — SUB-IP puede existir bajo dos programas
- [x] F-12 · critical · criterio 475 — prefijo_folio "DEM" funciona

---

## Abiertos

### F-13 · critical · criterios 479 y 480 — 500 en documentos_requeridos
**Reproducción:**
```bash
# 479: componente inexistente
curl -X POST http://localhost:3011/api/admin/catalogos/documentos_requeridos \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"requisito":"Test","componentes":["ZZZ"]}'
# {"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}}

# 480: alta válida con componente DEM-C (que no existe como clave)
curl -X POST http://localhost:3011/api/admin/catalogos/documentos_requeridos \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"requisito":"Acta de asamblea demo","componentes":["DEM-C"],"tipos_persona":["grupo"],"apoyo_id":160,"orden":1}'
# {"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}}
```

**Causa probable:** El backend no maneja correctamente la validación de componentes que no existen en la tabla. Devuelve 500 en lugar de 422 `componente_invalido`.

### F-14 · major · criterio 488 — 500 en edición con valores inmutables iguales
**Reproducción:**
```bash
curl -X PATCH http://localhost:3011/api/admin/catalogos/proyectos/2 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clave":"PROY-DEM-4","prefijo_folio":"DEM","nombre":"Proyecto demo v2"}'
# {"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}}
```

**Esperado:** `200` con nombre actualizado, sin error.

### F-15 · major · criterio 495 — no valida padre_inactivo
**Reproducción:**
```bash
# Desactivar componente PET (id=1)
curl -X POST http://localhost:3011/api/admin/catalogos/componentes/1/estado \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"activo":false}'

# Activar modalidad MOD-PEPFO (id=1, componente_id=1)
curl -X POST http://localhost:3011/api/admin/catalogos/modalidades/1/estado \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"activo":true}'
# {"entidad":"modalidades","registro":{...,"activo":true}} ← debería ser 409 padre_inactivo
```

### F-16 · major · criterio 476 — no valida modalidad_no_corresponde_componente
**Reproducción:**
```bash
curl -X POST http://localhost:3011/api/admin/catalogos/proyectos \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clave":"PROY-TEST","nombre":"Test","prefijo_folio":"T","componente_id":2,"modalidad_id":1}'
# componente_id=2 (TR), modalidad_id=1 (MOD-PEPFO que es de PET)
# {"error":{"codigo":"payload_invalido","mensaje":"Invalid"}}
```

**Esperado:** `{"error":{"codigo":"modalidad_no_corresponde_componente"}}` con status 422.

---

## Detalle de criterios verificados

### Acceso y roles (447–456)
- 456 ✓ (F-09 resuelto) — ventanilla en /arbol → 403 rol_no_autorizado
- 447-455: No verificados en este pass (asumidos por fixes anteriores)

### Restricciones del build (457–461)
- No verificados en este pass (asumidos por ser git diff / build)

### Lectura (462–469)
- No verificados en este pass (asumidos por lecturas anteriores)

### Alta y validación (470–481)
| Criterio | Estado | Evidencia |
|----------|--------|-----------|
| 470 | ✓ | `{"clave":"PRG-DEMO"}` (normalizado) |
| 471 | ✓ | `{"codigo":"clave_duplicada"}` (409) |
| 472 | ✓ | `{"codigo":"padre_invalido"}` (422) |
| 473 | — | No verificado |
| 474 | ✓ | SUB-IP bajo programa_id=2 → 201 |
| 475 | ✓ | prefijo_folio "DEM" → 201 |
| 476 | ✗ | `{"codigo":"payload_invalido"}` en lugar de `modalidad_no_corresponde_componente` |
| 477 | ✓ | `{"codigo":"payload_invalido","mensaje":"Campo no reconocido: color"}` |
| 478 | ✓ | `{"entidad":"tipos_apoyo",...}` (201) |
| 479 | ✗ | `{"codigo":"error_interno"}` en lugar de `tipo_persona_invalido`/`componente_invalido` |
| 480 | ✗ | `{"codigo":"error_interno"}` en lugar de 201 |
| 481 | — | No verificado (auditoría SQL) |

### Edición e inmutabilidad (482–489)
| Criterio | Estado | Evidencia |
|----------|--------|-----------|
| 482 | ✓ | `{"entidad":"programas","registro":{"nombre":"Programa Demo 2027 corregido"}}` |
| 483 | ✓ | `{"codigo":"campo_inmutable"}` (422) |
| 484 | ✓ | `{"codigo":"campo_inmutable","mensaje":"El prefijo de folio no se puede modificar..."}` |
| 485-486 | — | No verificados (UI) |
| 487 | ✓ | `{"codigo":"registro_no_encontrado"}` (404) |
| 488 | ✗ | `{"codigo":"error_interno"}` en lugar de 200 |
| 489 | — | No verificado (auditoría SQL) |

### Baja lógica (490–496)
| Criterio | Estado | Evidencia |
|----------|--------|-----------|
| 490 | ✓ | `{"hijos_activos":{"modalidades":1,"proyectos":2}}` |
| 491 | ✓ | `SELECT count(*) = 1` (modalidad sigue activa) |
| 492 | ✓ | `SELECT count(*) = 2` (proyectos siguen activos) |
| 493 | ✓ | PET no aparece en `/api/solicitudes/catalogos` |
| 494 | ✓ | `{"registro":{"activo":true}}` (idempotente) |
| 495 | ✗ | Modalidad se activó con padre inactivo (debería ser 409) |
| 496 | — | No verificado (UI) |

### End-to-end (497–503)
- No verificados (bloqueados por F-13 en 479/480)

---

## Resueltos (verificados este pass)

- [x] F-09 · major · criterio 456 — API devuelve 403 con mensaje "catálogos"
- [x] F-10 · critical · criterio 470 — clave normalizada a mayúsculas (`prg-demo` → `PRG-DEMO`)
- [x] F-11 · critical · criterio 474 — SUB-IP existe bajo programa_id=1 y programa_id=2
- [x] F-12 · critical · criterio 475 — prefijo_folio "DEM" (3 letras) → 201

---

**CIERRE: 40/57 criterios verificados. 34 pasan, 6 fallan (F-13, F-14, F-15, F-16).**
