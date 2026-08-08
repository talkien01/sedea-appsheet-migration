-- Administracion de usuarios reales + cambio de contrasena obligatorio (build 4).
-- Migracion PURAMENTE ADITIVA e IDEMPOTENTE: la base de produccion ya tiene
-- datos y los 4 usuarios operativos no deben verse afectados.

-- Cambio de contrasena obligatorio.
-- DEFAULT FALSE: las filas existentes NO quedan forzadas a cambiar contrasena.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Marca de la ultima vez que el usuario cambio su propia contrasena
-- (informativa, puede ser NULL).
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS password_actualizado_en TIMESTAMPTZ;

-- Indices de apoyo para el listado filtrado de /api/usuarios.
CREATE INDEX IF NOT EXISTS idx_usuarios_rol      ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo   ON usuarios (activo);
CREATE INDEX IF NOT EXISTS idx_usuarios_regional ON usuarios (regional_id);
