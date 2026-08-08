-- 002_catalogos.sql
-- Catalogos base: direcciones regionales, municipios, tipos de apoyo y catalogo generico.

CREATE TABLE IF NOT EXISTS direcciones_regionales (
  id      BIGSERIAL PRIMARY KEY,
  clave   TEXT UNIQUE NOT NULL,
  nombre  TEXT NOT NULL,
  activo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS municipios (
  id           BIGSERIAL PRIMARY KEY,
  clave        TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  regional_id  BIGINT NOT NULL REFERENCES direcciones_regionales(id),
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clave, regional_id)
);
CREATE INDEX IF NOT EXISTS idx_municipios_regional ON municipios (regional_id);

CREATE TABLE IF NOT EXISTS tipos_apoyo (
  id            BIGSERIAL PRIMARY KEY,
  clave         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  categoria     TEXT,
  unidad_medida TEXT,
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Catalogo generico clave/valor para parametros no normalizados (colonia, seccion, etc.)
CREATE TABLE IF NOT EXISTS catalogos (
  id          BIGSERIAL PRIMARY KEY,
  grupo       TEXT NOT NULL,
  clave       TEXT NOT NULL,
  valor       TEXT NOT NULL,
  padre_grupo TEXT,
  padre_clave TEXT,
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Unicidad tolerante a padre_clave NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogos_unico
  ON catalogos (grupo, clave, COALESCE(padre_clave, ''));
CREATE INDEX IF NOT EXISTS idx_catalogos_grupo ON catalogos (grupo);
