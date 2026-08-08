-- 008_staging.sql
-- Capa de staging revisable por humanos entre la importacion y produccion.
-- Ninguna fila llega a beneficiarios/catalogos sin que un editor_datos la
-- apruebe o fusione explicitamente (decision D3 del SPEC).

-- ---------------------------------------------------------------------------
-- Staging del padron
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_beneficiarios (
  id                BIGSERIAL PRIMARY KEY,
  importacion_id    BIGINT REFERENCES importaciones(id),
  archivo           TEXT NOT NULL,
  fila_origen       INTEGER NOT NULL,

  folio             TEXT,
  curp              TEXT,
  nombre_completo   TEXT,
  regional_texto    TEXT,
  regional_id       BIGINT REFERENCES direcciones_regionales(id),
  municipio_texto   TEXT,
  municipio_id      BIGINT REFERENCES municipios(id),
  colonia           TEXT,
  seccion           TEXT,
  localidad         TEXT,
  domicilio         TEXT,
  telefono          TEXT,
  tipo_apoyo_texto  TEXT,
  tipo_apoyo_id     BIGINT REFERENCES tipos_apoyo(id),
  cantidad_asignada NUMERIC(14,3),
  lat_proyecto      DOUBLE PRECISION,
  lng_proyecto      DOUBLE PRECISION,
  datos_extra       JSONB NOT NULL DEFAULT '{}',

  -- Flags de diagnostico. Ninguno provoca accion automatica.
  folio_duplicado                    BOOLEAN NOT NULL DEFAULT FALSE,
  curp_duplicada_mismo_concepto      BOOLEAN NOT NULL DEFAULT FALSE,
  curp_duplicada_concepto_distinto   BOOLEAN NOT NULL DEFAULT FALSE,
  sin_coordenadas                    BOOLEAN NOT NULL DEFAULT FALSE,
  sin_colonia                        BOOLEAN NOT NULL DEFAULT FALSE,
  concepto_no_reconocido             BOOLEAN NOT NULL DEFAULT FALSE,

  nivel_alerta      TEXT NOT NULL DEFAULT 'ninguna'
                    CHECK (nivel_alerta IN ('alta','media','ninguna')),
  estado_revision   TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado_revision IN ('pendiente','aprobado','descartado','fusionado')),
  revisado_por      BIGINT REFERENCES usuarios(id),
  revisado_en       TIMESTAMPTZ,
  motivo_revision   TEXT,

  promovido_beneficiario_id BIGINT REFERENCES beneficiarios(id),
  fusionado_en_id           BIGINT REFERENCES staging_beneficiarios(id),

  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Hace idempotente la reimportacion del mismo archivo.
  UNIQUE (archivo, fila_origen)
);

CREATE INDEX IF NOT EXISTS idx_stgb_estado ON staging_beneficiarios (estado_revision);
CREATE INDEX IF NOT EXISTS idx_stgb_folio  ON staging_beneficiarios (folio);
CREATE INDEX IF NOT EXISTS idx_stgb_curp   ON staging_beneficiarios (curp);
CREATE INDEX IF NOT EXISTS idx_stgb_nivel  ON staging_beneficiarios (nivel_alerta);
CREATE INDEX IF NOT EXISTS idx_stgb_import ON staging_beneficiarios (importacion_id);

-- ---------------------------------------------------------------------------
-- Staging de catalogos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_catalogos (
  id                BIGSERIAL PRIMARY KEY,
  importacion_id    BIGINT REFERENCES importaciones(id),
  archivo           TEXT NOT NULL,
  fila_origen       INTEGER NOT NULL,

  grupo             TEXT,
  clave             TEXT,
  valor             TEXT,
  padre_grupo       TEXT,
  padre_clave       TEXT,
  orden             INTEGER NOT NULL DEFAULT 0,
  datos_extra       JSONB NOT NULL DEFAULT '{}',

  clave_duplicada        BOOLEAN NOT NULL DEFAULT FALSE,
  valor_duplicado        BOOLEAN NOT NULL DEFAULT FALSE,
  concepto_no_reconocido BOOLEAN NOT NULL DEFAULT FALSE,

  nivel_alerta      TEXT NOT NULL DEFAULT 'ninguna'
                    CHECK (nivel_alerta IN ('alta','media','ninguna')),
  -- 'fusionado' no se usa en catalogos (decision D5), pero el dominio se
  -- mantiene identico al del staging de padron por simetria.
  estado_revision   TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado_revision IN ('pendiente','aprobado','descartado','fusionado')),
  revisado_por      BIGINT REFERENCES usuarios(id),
  revisado_en       TIMESTAMPTZ,
  motivo_revision   TEXT,
  promovido_catalogo_id BIGINT REFERENCES catalogos(id),

  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (archivo, fila_origen)
);

CREATE INDEX IF NOT EXISTS idx_stgc_estado ON staging_catalogos (estado_revision);
CREATE INDEX IF NOT EXISTS idx_stgc_grupo  ON staging_catalogos (grupo);
CREATE INDEX IF NOT EXISTS idx_stgc_nivel  ON staging_catalogos (nivel_alerta);
