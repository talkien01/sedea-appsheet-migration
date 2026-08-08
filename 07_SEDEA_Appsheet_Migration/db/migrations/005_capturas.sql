-- 005_capturas.sql
-- Evidencia de entrega capturada en campo. El UUID lo genera el cliente y
-- es la clave de idempotencia de la sincronizacion.

CREATE TABLE IF NOT EXISTS capturas (
  uuid               UUID PRIMARY KEY,
  beneficiario_id    BIGINT NOT NULL REFERENCES beneficiarios(id),
  usuario_id         BIGINT NOT NULL REFERENCES usuarios(id),
  foto_url           TEXT NOT NULL,
  foto_hash          TEXT,
  geom               geometry(Point, 4326) NOT NULL,
  lat                DOUBLE PRECISION NOT NULL,
  lng                DOUBLE PRECISION NOT NULL,
  precision_m        REAL NOT NULL,
  tipo_apoyo_id      BIGINT REFERENCES tipos_apoyo(id),
  cantidad_entregada NUMERIC(14,3),
  observaciones      TEXT,
  capturado_en       TIMESTAMPTZ NOT NULL,
  sincronizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado_sync        TEXT NOT NULL DEFAULT 'sincronizada'
                     CHECK (estado_sync IN ('sincronizada', 'revisada', 'rechazada')),
  dispositivo        TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capturas_geom    ON capturas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_capturas_benef   ON capturas (beneficiario_id);
CREATE INDEX IF NOT EXISTS idx_capturas_usuario ON capturas (usuario_id);
CREATE INDEX IF NOT EXISTS idx_capturas_fecha   ON capturas (capturado_en);
