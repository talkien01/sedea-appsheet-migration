-- 027_presencia_usuarios.sql
-- Presencia EN VIVO: en que pantalla esta cada usuario ahora mismo.
--
-- Deliberadamente NO es historico: un solo renglon por usuario, sobrescrito en
-- cada latido (upsert). El historico de "que hizo" ya lo cubre auditoria_log,
-- que si es append-only. Duplicarlo aqui solo haria crecer la tabla sin
-- aportar nada que la bitacora no tenga.

CREATE TABLE IF NOT EXISTS presencia_usuarios (
  usuario_id        BIGINT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  ruta              TEXT NOT NULL,
  etiqueta_pantalla TEXT,
  ip                TEXT,
  user_agent        TEXT,
  visto_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El monitor ordena siempre por el ultimo latido.
CREATE INDEX IF NOT EXISTS idx_presencia_visto_en ON presencia_usuarios (visto_en DESC);
