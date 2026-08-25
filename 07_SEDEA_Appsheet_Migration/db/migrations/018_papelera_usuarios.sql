-- 018_papelera_usuarios.sql
-- Eliminación lógica de usuarios con papelera de reciclaje.
--
-- Se agrega una columna `eliminado` que permite ocultar usuarios sin perder
-- el historial de capturas y auditoría. Los usuarios eliminados:
-- - No pueden iniciar sesión (se rechaza en autenticación)
-- - No aparecen en listados normales
-- - Se pueden restaurar desde la papelera (solo admin)
-- - Su eliminación permanente requiere script SQL directo (no hay API para eso)

-- Columna de eliminación lógica.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice para filtrar usuarios eliminados (la papelera solo la ve el admin).
CREATE INDEX IF NOT EXISTS idx_usuarios_eliminado ON usuarios (eliminado);

-- Restricción: un usuario no puede estar activo y eliminado al mismo tiempo.
-- Si eliminado=true, activo debe ser false.
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_activo_eliminado_excluyente
  CHECK (NOT (eliminado = TRUE AND activo = TRUE));

-- Comentario para documentar la semántica.
COMMENT ON COLUMN usuarios.eliminado IS
  'Eliminación lógica: el usuario no puede login ni aparece en listados. Se conserva el historial.';
