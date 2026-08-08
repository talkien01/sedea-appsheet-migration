-- 006_auditoria_log.sql
-- Bitacora inmutable de acciones sensibles (login, sync, capturas, exportaciones).

CREATE TABLE IF NOT EXISTS auditoria_log (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT REFERENCES usuarios(id),
  accion     TEXT NOT NULL,
  entidad    TEXT,
  entidad_id TEXT,
  detalle    JSONB NOT NULL DEFAULT '{}',
  ip         INET,
  user_agent TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_accion  ON auditoria_log (accion);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria_log (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha   ON auditoria_log (creado_en);
