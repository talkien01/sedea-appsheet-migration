-- 004_beneficiarios.sql
-- Padron de beneficiarios y bitacora de importaciones.

CREATE TABLE IF NOT EXISTS importaciones (
  id                 BIGSERIAL PRIMARY KEY,
  archivo            TEXT NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('padron', 'catalogo')),
  mapeo              JSONB NOT NULL DEFAULT '{}',
  filas_leidas       INTEGER NOT NULL DEFAULT 0,
  filas_insertadas   INTEGER NOT NULL DEFAULT 0,
  filas_actualizadas INTEGER NOT NULL DEFAULT 0,
  filas_error        INTEGER NOT NULL DEFAULT 0,
  errores            JSONB NOT NULL DEFAULT '[]',
  ejecutado_por      TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beneficiarios (
  id                BIGSERIAL PRIMARY KEY,
  folio             TEXT UNIQUE NOT NULL,
  curp              TEXT,
  nombre_completo   TEXT NOT NULL,
  regional_id       BIGINT NOT NULL REFERENCES direcciones_regionales(id),
  municipio_id      BIGINT REFERENCES municipios(id),
  colonia           TEXT,
  seccion           TEXT,
  localidad         TEXT,
  domicilio         TEXT,
  telefono          TEXT,
  tipo_apoyo_id     BIGINT REFERENCES tipos_apoyo(id),
  cantidad_asignada NUMERIC(14,3),
  datos_extra       JSONB NOT NULL DEFAULT '{}',
  origen_import_id  BIGINT REFERENCES importaciones(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benef_regional  ON beneficiarios (regional_id);
CREATE INDEX IF NOT EXISTS idx_benef_municipio ON beneficiarios (municipio_id);
CREATE INDEX IF NOT EXISTS idx_benef_curp      ON beneficiarios (curp);
CREATE INDEX IF NOT EXISTS idx_benef_actualizado ON beneficiarios (actualizado_en);

-- Busqueda de texto completo en espanol sobre nombre, CURP y folio.
CREATE INDEX IF NOT EXISTS idx_benef_busqueda ON beneficiarios
  USING GIN (to_tsvector('spanish', nombre_completo || ' ' || coalesce(curp, '') || ' ' || folio));
