-- 003_usuarios.sql
-- Usuarios del sistema con rol y adscripcion a una Direccion Regional.

CREATE TABLE IF NOT EXISTS usuarios (
  id              BIGSERIAL PRIMARY KEY,
  usuario         TEXT UNIQUE NOT NULL,
  nombre_completo TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  rol             TEXT NOT NULL CHECK (rol IN ('capturista', 'auditor', 'admin')),
  regional_id     BIGINT REFERENCES direcciones_regionales(id),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_regional ON usuarios (regional_id);
