-- 012_ventanilla_catalogos.sql
-- Build 6: catalogos del modulo de captura de Solicitud de Apoyo en ventanilla.
--
-- La numeracion salta el 011 a proposito: el criterio 231 del build 5 afirma
-- que NO existe ningun archivo db/migrations/011_*.sql y se conserva vigente.
-- Todo aqui es ADITIVO e IDEMPOTENTE: ninguna columna existente se elimina,
-- renombra ni cambia de tipo.

-- Rol nuevo 'ventanilla' (build 6). Se conservan los 4 roles anteriores.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('capturista','auditor','admin','editor_datos','ventanilla'));

-- Siglas de 3 letras del municipio para el folio oficial (ej. AME = Amealco).
-- Nullable a proposito: se llenan por catalogo/admin; hay fallback determinista
-- en backend/src/servicios/folios.ts (12.5).
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS siglas_folio TEXT;

-- Clave de 3 letras de la Regional para el folio oficial (SJR/CAD/JAL/QRO).
ALTER TABLE direcciones_regionales ADD COLUMN IF NOT EXISTS clave_folio TEXT;

-- ---------------------------------------------------------------------------
-- Catalogos del programa: Programa -> Subprograma -> Componente -> Proyecto.
-- Jerarquia modelada plana y flexible (Assumption 45).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS programas (
  id     BIGSERIAL PRIMARY KEY,
  clave  TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS subprogramas (
  id          BIGSERIAL PRIMARY KEY,
  programa_id BIGINT NOT NULL REFERENCES programas(id),
  clave       TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (programa_id, clave)
);

-- Exactamente 3 filas sembradas: TR, CAA, DIN (12.4).
CREATE TABLE IF NOT EXISTS componentes (
  id     BIGSERIAL PRIMARY KEY,
  clave  TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS proyectos (
  id            BIGSERIAL PRIMARY KEY,
  clave         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  -- 2-5 letras mayusculas; aporta el primer segmento del folio (ej. PEO).
  prefijo_folio TEXT NOT NULL,
  -- NULLABLE a proposito: un proyecto puede aplicar a cualquier componente.
  componente_id BIGINT REFERENCES componentes(id),
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Las 5 ventanillas receptoras (4 regionales + SEDEA central).
CREATE TABLE IF NOT EXISTS ventanillas (
  id          BIGSERIAL PRIMARY KEY,
  clave       TEXT UNIQUE NOT NULL,
  nombre      TEXT NOT NULL,
  -- Regional que heredan los beneficiarios creados desde esta ventanilla.
  regional_id BIGINT NOT NULL REFERENCES direcciones_regionales(id),
  -- Segmento regional del folio (SJR/CAD/JAL/QRO/SED).
  clave_folio TEXT NOT NULL,
  es_central  BOOLEAN NOT NULL DEFAULT FALSE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- Reglas de documentacion requerida (12.7). Un arreglo NULL o vacio significa
-- "aplica a todos" en esa dimension.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documentos_requeridos (
  id                      BIGSERIAL PRIMARY KEY,
  requisito               TEXT NOT NULL,
  componentes             TEXT[],
  tipos_persona           TEXT[],
  proyecto_id             BIGINT REFERENCES proyectos(id),
  apoyo_id                BIGINT REFERENCES tipos_apoyo(id),
  -- Etiquetas crudas del Excel real cuando no hay concepto exacto en el
  -- catalogo de 152 filas (Assumption 51).
  apoyo_etiquetas         TEXT[],
  apoyo_excluir_id        BIGINT REFERENCES tipos_apoyo(id),
  apoyo_excluir_etiquetas TEXT[],
  orden                   INTEGER NOT NULL DEFAULT 0,
  activo                  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_docsreq_activo ON documentos_requeridos (activo);
CREATE INDEX IF NOT EXISTS idx_docsreq_componentes
  ON documentos_requeridos USING GIN (componentes);
CREATE INDEX IF NOT EXISTS idx_docsreq_tipos_persona
  ON documentos_requeridos USING GIN (tipos_persona);
