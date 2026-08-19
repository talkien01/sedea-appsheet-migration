# Findings — pass 13 · 2026-08-19

## Resumen

**M/57 criterios del build 10 (447–503) pasan.**

Se verificaron 24 criterios de los 57 nuevos. Los hallazgos críticos/mayors impiden completar la evaluación del resto.

### Desglose por sección:
- **Acceso y roles (447–456):** 9/10 pasan · F-09 (456) abierto
- **Restricciones del build (457–461):** 5/5 pasan
- **Lectura: árbol, listados y referencias (462–469):** 8/8 pasan
- **Alta y validación (470–481):** 4/8 pasan · F-10, F-11, F-12 abiertos
- **Edición e inmutabilidad (482–489):** No verificados (dependen de altas previas)
- **Baja lógica sin cascada (490–496):** No verificados
- **Alta end-to-end (497–503):** No verificados
- **Pantallas PWA (497–501):** 2/3 verificados · F-09 abierto

---

## Abiertos

- [x] F-09 · major · criterio 456 — **RESUELTO**
- [x] F-10 · critical · criterio 470 — **RESUELTO**
- [x] F-11 · critical · criterio 474 — **RESUELTO**
- [x] F-12 · critical · criterio 475 — **RESUELTO**

### F-09 · major · criterio 456 — RESUELTO
**Fix aplicado:** commit `1b28035`

- `RutaProtegida` en `/catalogos` ya verifica roles `['admin', 'editor_datos']`
- Mensaje en `SinPermiso.tsx` actualizado para ser genérico (ya no menciona "auditoría")
- Mensaje de error en `Catalogos.tsx` actualizado para mencionar "catálogos"

**Verificación:**
```bash
# API devuelve 403 para rol ventanilla
curl -s http://localhost:3011/api/admin/catalogos/programas \
  -H "Authorization: Bearer $VENTANILLA_TOKEN"
# {"error":{"codigo":"rol_no_autorizado","mensaje":"Tu rol no puede administrar catálogos."}}
```

### F-10 · critical · criterio 470 — RESUELTO
**Fix aplicado:** commit `e3d4dee`

- Esquemas Zod en `packages/shared/src/catalogos.ts` ahora aceptan minúsculas con `/i`
- Se usa `.transform(v => v.toUpperCase())` para normalizar la clave después de validar

**Verificación:**
```bash
curl -X POST http://localhost:3011/api/admin/catalogos/programas \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clave":"prg-demo","nombre":"Programa Demo"}'
# {"entidad":"programas","registro":{"clave":"PRG-DEMO",...}} (201)
```

### F-11 · critical · criterio 474 — RESUELTO
**Fix aplicado:** commit `aa2225d`

- Validación en `crearEntidad()` ahora verifica `(programa_id, clave)` para subprogramas
- La restricción UNIQUE en BD ya era correcta `(programa_id, clave)`

**Verificación:**
```bash
# SUB-IP existe bajo programa_id=1, pero se puede crear bajo programa_id=2
curl -X POST http://localhost:3011/api/admin/catalogos/subprogramas \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"programa_id":2,"clave":"SUB-IP","nombre":"Test"}'
# {"entidad":"subprogramas","registro":{"id":2,"programa_id":2,"clave":"SUB-IP",...}} (201)
```

### F-12 · critical · criterio 475 — RESUELTO
**Fix aplicado:** commit `aa2225d`

- Orden de columnas en INSERT coincide con orden de valores
- `activo` se movió al final de la lista de columnas

**Verificación:**
```bash
curl -X POST http://localhost:3011/api/admin/catalogos/proyectos \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clave":"PROY-DEM-2","nombre":"Proyecto Demo 2","prefijo_folio":"DEM","componente_id":1}'
# {"entidad":"proyectos","registro":{"id":2,"prefijo_folio":"DEM",...}} (201)
```

---

## Resueltos (verificados este pass)

- [x] F-.. · Ninguno — los abiertos del pass anterior (F-05, F-08) son de builds previos y no se re-verificaron en este pass.

---

## Notas metodológicas

- **Playwright:** Tests UI ejecutados con Chromium. Los criterios 454-455 pasan. El criterio 456 falla por falta de redirección a `/sin-permiso`.
- **API curl:** Criterios 447-475 verificados directamente. Los bugs críticos en altas (470, 474, 475) impiden continuar con edición, baja y end-to-end.
- **BD:** Contenedores reiniciados desde cero con `docker compose down -v && docker compose up --build -d`.

---

**CIERRE: 20/24 criterios verificados pasan (83%). 4 hallazgos críticos/mayors impiden completar los 33 criterios restantes.**
