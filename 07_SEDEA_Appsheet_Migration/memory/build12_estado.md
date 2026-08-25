# Build 12 - Estado y alcance

## Fecha de cierre
Agosto 25, 2026

## Funcionalidades completadas

### 1. Multi-rol de usuario (D34)
- Usuarios pueden tener múltiples roles combinados con "+" (ej. "capturista+ventanilla")
- Formulario de usuarios usa checkboxes en lugar de select único
- Backend y frontend actualizados para verificar `rol.split('+').includes()`
- La Regional es obligatoria si el rol contiene "capturista"
- La Regional es opcional para "ventanilla" pura (alcance estatal = Central)

### 2. Timer de plazo de solicitudes
- Componente `TimerPlazo.tsx` muestra días restantes para el cierre
- Configuración desde `/api/configuracion/plazo-solicitudes`
- Bloqueo automático al vencer el plazo

### 3. Folio de entrega con QR
- Componente `FolioEntrega.tsx` genera QR con el folio
- Imprimible desde la vista previa
- Datos: beneficiario, programa, proyecto, concepto, monto, regional

### 4. Capturista crea solicitudes (E40-E48)
- Rol `capturista` puede acceder a `/solicitudes/nueva`
- Alcance filtrado por Regional asignada
- Municipios visibles = todos los de la Regional (no solo la capital)

### 5. Fix: Municipios auto-asignados (D35)
- Al crear usuario (individual o CSV), se insertan automáticamente todos los municipios activos de su Regional
- Tabla `usuario_municipios` ya no requiere inserción manual
- Semántica: "0 filas = todos" se preserva para usuarios existentes sin Regional

### 6. Fix: Uppercase en formularios
- Campos de texto libre se convierten a mayúsculas al escribir
- Aplica en `SeccionSolicitante`: nombre, razón social, CURP, localidad, delegación, asentamiento, vialidad
- No aplica en: correo (minúsculas), teléfono, CP, fechas, selects

## Archivos clave modificados

### Backend
- `backend/src/rutas/usuarios.ts` - Inserta municipios al crear usuario
- `backend/src/servicios/usuariosLote.ts` - Inserta municipios en alta CSV
- `backend/src/db/queries/usuarios.ts` - Nueva función `obtenerMunicipiosDeRegional()`
- `backend/src/plugins/rbac.ts` - Multi-rol checking con `tieneRol()`
- `backend/src/servicios/usuarios.ts` - `resolverRegional()` multi-rol aware

### Frontend (PWA)
- `pwa/src/componentes/FormUsuario.tsx` - Checkboxes para roles, Regional condicional
- `pwa/src/componentes/SeccionSolicitante.tsx` - Uppercase en campos de texto
- `pwa/src/componentes/campoMayusculas.ts` - Utilidad `aMayusculas()` y `ESTILO_MAYUSCULAS`
- `pwa/src/navegacion/menu.ts` - `tieneAlgunRol()` para multi-rol
- `pwa/src/componentes/RutaProtegida.tsx` - Guards con multi-rol

## Pendientes para deploy

1. Ejecutar migración de municipios existentes (si aplica)
2. Verificar que usuarios ventanilla existentes tengan su alcance correcto
3. Build de producción y deploy a EasyPanel

## Notas de deploy

- El fix de municipios es retroactivo: usuarios nuevos lo reciben automático
- Usuarios existentes sin filas en `usuario_municipios` siguen teniendo alcance "todos"
- Si se quiere restringir usuarios existentes, requiere script SQL manual
