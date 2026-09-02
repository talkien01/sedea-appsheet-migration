-- 030_conciliacion_recibos_camiones.sql
-- Conciliacion posterior de los recibos fisicos regresados por los camiones.
-- El recibo se identifica por el QR/folio de la solicitud. Los kg y costales
-- se congelan como fotografia de lo conciliado para que el resumen historico
-- no cambie si despues se corrigen datos de la solicitud.

CREATE TABLE IF NOT EXISTS conciliacion_lotes (
  id              BIGSERIAL PRIMARY KEY,
  municipio_id    BIGINT NOT NULL REFERENCES municipios(id),
  regional_id     BIGINT NOT NULL REFERENCES direcciones_regionales(id),
  camion          TEXT NOT NULL,
  tipo_apoyo_id   BIGINT REFERENCES tipos_apoyo(id),
  estado          TEXT NOT NULL DEFAULT 'abierto'
                  CHECK (estado IN ('abierto', 'cerrado')),
  pdf_url         TEXT,
  pdf_hash        TEXT,
  pdf_bytes       BIGINT,
  paginas_pdf     INTEGER CHECK (paginas_pdf IS NULL OR paginas_pdf > 0),
  creado_por      BIGINT NOT NULL REFERENCES usuarios(id),
  cerrado_por     BIGINT REFERENCES usuarios(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_concilotes_regional
  ON conciliacion_lotes (regional_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_concilotes_municipio
  ON conciliacion_lotes (municipio_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_concilotes_estado
  ON conciliacion_lotes (estado, creado_en DESC);

-- Un renglon por pagina del PDF del escaner. Conserva tambien las paginas que
-- no pudieron conciliarse para que el operador pueda corregirlas manualmente.
CREATE TABLE IF NOT EXISTS conciliacion_paginas (
  id               BIGSERIAL PRIMARY KEY,
  lote_id          BIGINT NOT NULL REFERENCES conciliacion_lotes(id) ON DELETE CASCADE,
  pagina           INTEGER NOT NULL CHECK (pagina > 0),
  estado           TEXT NOT NULL CHECK (estado IN (
                     'conciliada',
                     'sin_qr',
                     'varios_qr',
                     'folio_no_encontrado',
                     'municipio_distinto',
                     'sin_concepto_lote',
                     'duplicada',
                     'pendiente_manual',
                     'error'
                   )),
  qr_text          TEXT,
  folio_detectado  TEXT,
  mensaje          TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, pagina)
);
CREATE INDEX IF NOT EXISTS idx_concipaginas_lote_estado
  ON conciliacion_paginas (lote_id, estado, pagina);

-- Un recibo fisico conciliado. Si un lote es especifico de Avena o Garbanzo,
-- un mismo folio puede aparecer posteriormente en otro lote para el otro
-- concepto; por eso la unicidad real de entrega se protege en la tabla hija.
CREATE TABLE IF NOT EXISTS conciliacion_recibos (
  id             BIGSERIAL PRIMARY KEY,
  lote_id        BIGINT NOT NULL REFERENCES conciliacion_lotes(id) ON DELETE CASCADE,
  pagina_id      BIGINT NOT NULL UNIQUE REFERENCES conciliacion_paginas(id) ON DELETE CASCADE,
  solicitud_id   BIGINT NOT NULL REFERENCES solicitudes(id),
  folio          TEXT NOT NULL,
  origen         TEXT NOT NULL CHECK (origen IN ('qr', 'manual')),
  conciliado_por BIGINT NOT NULL REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, solicitud_id)
);
CREATE INDEX IF NOT EXISTS idx_concirecibos_lote
  ON conciliacion_recibos (lote_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_concirecibos_solicitud
  ON conciliacion_recibos (solicitud_id);

-- Grano real de la conciliacion: un concepto de una solicitud solo puede
-- contabilizarse una vez en todo el sistema, aunque el mismo folio se intente
-- escanear en otro lote o por otro capturista.
CREATE TABLE IF NOT EXISTS conciliacion_recibo_conceptos (
  id                    BIGSERIAL PRIMARY KEY,
  recibo_id             BIGINT NOT NULL REFERENCES conciliacion_recibos(id) ON DELETE CASCADE,
  solicitud_concepto_id BIGINT NOT NULL UNIQUE REFERENCES solicitud_conceptos(id),
  tipo_apoyo_id         BIGINT NOT NULL REFERENCES tipos_apoyo(id),
  cantidad              NUMERIC(14,3) NOT NULL,
  unidad_medida         TEXT,
  cantidad_kg           NUMERIC(14,3),
  costales              INTEGER,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recibo_id, solicitud_concepto_id)
);
CREATE INDEX IF NOT EXISTS idx_conciconceptos_recibo
  ON conciliacion_recibo_conceptos (recibo_id);
CREATE INDEX IF NOT EXISTS idx_conciconceptos_tipo
  ON conciliacion_recibo_conceptos (tipo_apoyo_id);
