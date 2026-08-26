-- 021_entregas_apoyo.sql
-- Registro de la entrega FISICA del apoyo al beneficiario (Parte 1).
--
-- Grano: UN RENGLON POR CONCEPTO de la solicitud, no por solicitud. Si una
-- solicitud pide garbanzo y avena, son dos entregas independientes que pueden
-- ocurrir en dias distintos, en camiones distintos y con evidencia distinta.
--
-- Sin entregas parciales (decision del usuario): un concepto se entrega
-- completo o no se entrega. Por eso NO hay columna de cantidad entregada: la
-- existencia de la fila ES el hecho. De ahi el UNIQUE sobre
-- solicitud_concepto_id.
--
-- Idempotencia: `uuid` lo genera el cliente en campo, igual que en `capturas`.
-- Reenviar la misma entrega desde la cola offline no duplica la fila.
--
-- Migracion ADITIVA: solo crea una tabla nueva, no toca ninguna existente.

CREATE TABLE IF NOT EXISTS entregas_apoyo (
  uuid                  UUID PRIMARY KEY,
  solicitud_concepto_id BIGINT NOT NULL UNIQUE
                        REFERENCES solicitud_conceptos(id) ON DELETE CASCADE,
  foto_url              TEXT NOT NULL,
  foto_hash             TEXT,
  geom                  geometry(Point, 4326) NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL,
  lng                   DOUBLE PRECISION NOT NULL,
  precision_m           REAL NOT NULL,
  observaciones         TEXT,
  entregado_en          TIMESTAMPTZ NOT NULL,
  entregado_por         BIGINT NOT NULL REFERENCES usuarios(id),
  dispositivo           TEXT,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entregas_apoyo_geom     ON entregas_apoyo USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_entregas_apoyo_usuario  ON entregas_apoyo (entregado_por);
CREATE INDEX IF NOT EXISTS idx_entregas_apoyo_fecha    ON entregas_apoyo (entregado_en);

COMMENT ON TABLE entregas_apoyo IS
  'Evidencia (foto + coordenadas) de la entrega fisica de UN concepto de una solicitud. Sin parcialidades: existe la fila o no existe.';
COMMENT ON COLUMN entregas_apoyo.uuid IS
  'Generado por el cliente en campo. Clave de idempotencia de la cola offline, igual que capturas.uuid.';
COMMENT ON COLUMN entregas_apoyo.solicitud_concepto_id IS
  'UNIQUE: un concepto no se puede entregar dos veces.';
