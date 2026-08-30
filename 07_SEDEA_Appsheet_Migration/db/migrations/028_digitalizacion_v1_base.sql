-- 028_digitalizacion_v1_base.sql
-- Digitalizacion V1 / Fase 1: lotes de preparacion, solicitudes incluidas y QR persistente.
-- Cambio completamente aditivo: no altera ni elimina tablas existentes.

CREATE SEQUENCE IF NOT EXISTS digitalizacion_lote_codigo_seq START 1;

CREATE TABLE IF NOT EXISTS digitalizacion_lotes (
  id                  BIGSERIAL PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  nombre              TEXT NOT NULL,
  -- Son los filtros con los que el operador construyo el lote; NO son la fuente
  -- de autoridad territorial. El backend vuelve a validar cada solicitud.
  filtro_regional_id  BIGINT REFERENCES direcciones_regionales(id),
  filtro_municipio_id BIGINT REFERENCES municipios(id),
  criterios           JSONB NOT NULL DEFAULT '{}',
  estado              TEXT NOT NULL DEFAULT 'preparacion'
                        CHECK (estado IN ('preparacion','cerrado','cancelado')),
  creado_por          BIGINT NOT NULL REFERENCES usuarios(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dig_lotes_regional
  ON digitalizacion_lotes (filtro_regional_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_dig_lotes_municipio
  ON digitalizacion_lotes (filtro_municipio_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_dig_lotes_estado
  ON digitalizacion_lotes (estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS digitalizacion_lote_solicitudes (
  lote_id              BIGINT NOT NULL REFERENCES digitalizacion_lotes(id) ON DELETE CASCADE,
  solicitud_id         BIGINT NOT NULL REFERENCES solicitudes(id),
  orden                INTEGER NOT NULL CHECK (orden > 0),
  estado               TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN (
                           'pendiente',
                           'caratula_generada',
                           'digitalizado',
                           'incidencia'
                         )),
  agregado_por         BIGINT NOT NULL REFERENCES usuarios(id),
  agregado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  caratula_generada_en TIMESTAMPTZ,
  digitalizado_en      TIMESTAMPTZ,
  PRIMARY KEY (lote_id, solicitud_id),
  UNIQUE (lote_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_dig_lote_sol_solicitud
  ON digitalizacion_lote_solicitudes (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_dig_lote_sol_estado
  ON digitalizacion_lote_solicitudes (lote_id, estado, orden);

-- El QR es una identidad persistente del expediente fisico/electronico.
-- El token no contiene CURP, nombre, municipio ni otros datos personales.
-- Se deja preparado el tipo 'complemento' para fases posteriores.
CREATE TABLE IF NOT EXISTS expediente_qr (
  id            BIGSERIAL PRIMARY KEY,
  solicitud_id  BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'expediente'
                 CHECK (tipo IN ('expediente','complemento')),
  token         UUID NOT NULL UNIQUE,
  version       SMALLINT NOT NULL DEFAULT 1 CHECK (version > 0),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por    BIGINT NOT NULL REFERENCES usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  desactivado_en TIMESTAMPTZ
);

-- Una solicitud tiene un solo QR principal activo. Los complementos podran
-- tener tokens independientes sin romper la identidad principal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expediente_qr_principal_activo
  ON expediente_qr (solicitud_id)
  WHERE tipo = 'expediente' AND activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_expediente_qr_solicitud
  ON expediente_qr (solicitud_id, tipo, creado_en DESC);
