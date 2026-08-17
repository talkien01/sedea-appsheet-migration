-- 013_solicitudes.sql
-- Build 6: la Solicitud de Apoyo capturada en ventanilla y sus tablas hijas.
--
-- `solicitudes` es una tabla NUEVA (D38): sus columnas no se fusionan dentro de
-- `beneficiarios` para no inflar la tabla que el capturista de campo descarga a
-- IndexedDB. `beneficiarios` solo gana la columna `solicitud_id`.

CREATE TABLE IF NOT EXISTS solicitudes (
  id             BIGSERIAL PRIMARY KEY,
  -- Folio oficial generado por el backend (12.5). El usuario nunca lo escribe.
  folio          TEXT UNIQUE NOT NULL,
  recibida_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  capturado_por  BIGINT NOT NULL REFERENCES usuarios(id),

  programa_id    BIGINT NOT NULL REFERENCES programas(id),
  subprograma_id BIGINT REFERENCES subprogramas(id),
  componente_id  BIGINT NOT NULL REFERENCES componentes(id),
  proyecto_id    BIGINT NOT NULL REFERENCES proyectos(id),
  ventanilla_id  BIGINT NOT NULL REFERENCES ventanillas(id),
  -- Derivado de la ventanilla, no capturable.
  regional_id    BIGINT NOT NULL REFERENCES direcciones_regionales(id),

  -- --- Seccion 2.1 Datos personales -------------------------------------
  tipo_persona       TEXT NOT NULL CHECK (tipo_persona IN ('fisica','moral','grupo')),
  nombre_solicitante TEXT NOT NULL,
  sexo               TEXT CHECK (sexo IN ('H','M')),
  fecha_nacimiento   DATE,
  correo             TEXT,
  telefono           TEXT,
  curp               TEXT,
  razon_social       TEXT,
  num_integrantes    INTEGER,

  -- --- Seccion 2.2 Domicilio particular del solicitante ------------------
  -- OJO: este domicilio NO alimenta beneficiarios (D40).
  dom_municipio_id      BIGINT REFERENCES municipios(id),
  dom_localidad         TEXT,
  dom_delegacion        TEXT,
  dom_cp                TEXT,
  dom_tipo_asentamiento TEXT CHECK (dom_tipo_asentamiento IN
                          ('colonia','fraccionamiento','ejido','pueblo','rancho')),
  dom_asentamiento      TEXT,
  dom_tipo_vialidad     TEXT CHECK (dom_tipo_vialidad IN
                          ('avenida','boulevard','calzada','calle','privada','otra')),
  dom_vialidad          TEXT,

  -- --- Seccion 3 Actividad economica -------------------------------------
  act_agricola              BOOLEAN NOT NULL DEFAULT FALSE,
  agr_superficie_total_ha   NUMERIC(12,3),
  agr_superficie_siembra_ha NUMERIC(12,3),
  agr_temporal_ha           NUMERIC(12,3),
  agr_riego_ha              NUMERIC(12,3),
  agr_cultivo_principal     TEXT,

  act_ganadera                 BOOLEAN NOT NULL DEFAULT FALSE,
  gan_tipo_ganado              TEXT,
  gan_num_cabezas              INTEGER,
  gan_superficie_agostadero_ha NUMERIC(12,3),
  gan_produccion               TEXT CHECK (gan_produccion IN
                                 ('intensiva','traspatio','extensiva')),

  act_acuicola BOOLEAN NOT NULL DEFAULT FALSE,
  acu_especies TEXT,

  act_pesca    BOOLEAN NOT NULL DEFAULT FALSE,
  pes_especies TEXT,

  -- --- Seccion 4 Datos del apoyo -----------------------------------------
  descripcion_proyecto TEXT,
  ben_hombres_total            INTEGER NOT NULL DEFAULT 0,
  ben_hombres_discapacidad     INTEGER NOT NULL DEFAULT 0,
  ben_hombres_lengua_indigena  INTEGER NOT NULL DEFAULT 0,
  ben_mujeres_total            INTEGER NOT NULL DEFAULT 0,
  ben_mujeres_discapacidad     INTEGER NOT NULL DEFAULT 0,
  ben_mujeres_lengua_indigena  INTEGER NOT NULL DEFAULT 0,

  -- --- Seccion 4.1 Ubicacion del apoyo (la que alimenta beneficiarios) ----
  ubi_municipio_id BIGINT NOT NULL REFERENCES municipios(id),
  ubi_localidad    TEXT,
  ubi_ejido        TEXT,
  -- Texto libre: lo que el productor declara en papel. Sin geolocalizacion
  -- del navegador en esta pantalla (D42).
  ubi_coordenadas  TEXT,

  -- --- Seccion 6 Declaraciones -------------------------------------------
  declaracion_aceptada BOOLEAN NOT NULL,
  declaracion_version  TEXT NOT NULL DEFAULT 'v1-2026',
  observaciones        TEXT,

  origen         TEXT NOT NULL DEFAULT 'solicitud_ventanilla',
  datos_extra    JSONB NOT NULL DEFAULT '{}',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_folio         ON solicitudes (folio);
CREATE INDEX IF NOT EXISTS idx_sol_regional      ON solicitudes (regional_id);
CREATE INDEX IF NOT EXISTS idx_sol_ubi_municipio ON solicitudes (ubi_municipio_id);
CREATE INDEX IF NOT EXISTS idx_sol_componente    ON solicitudes (componente_id);
CREATE INDEX IF NOT EXISTS idx_sol_capturado_por ON solicitudes (capturado_por);
CREATE INDEX IF NOT EXISTS idx_sol_recibida      ON solicitudes (recibida_en);

-- Un beneficiario de produccion por concepto solicitado (D39).
CREATE TABLE IF NOT EXISTS solicitud_conceptos (
  id              BIGSERIAL PRIMARY KEY,
  solicitud_id    BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL,
  tipo_apoyo_id   BIGINT NOT NULL REFERENCES tipos_apoyo(id),
  descripcion     TEXT,
  cantidad        NUMERIC(14,3) NOT NULL,
  unidad_medida   TEXT,
  monto_estatal   NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_productor NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  beneficiario_id BIGINT REFERENCES beneficiarios(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (solicitud_id, orden)
);
CREATE INDEX IF NOT EXISTS idx_solconcepto_solicitud ON solicitud_conceptos (solicitud_id);

-- Checklist materializado al crear la solicitud: cambiar las reglas despues
-- NO altera las solicitudes ya recibidas (Assumption 53).
CREATE TABLE IF NOT EXISTS solicitud_documentos (
  id                     BIGSERIAL PRIMARY KEY,
  solicitud_id           BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  documento_requerido_id BIGINT REFERENCES documentos_requeridos(id),
  requisito              TEXT NOT NULL,
  recibido               BOOLEAN NOT NULL DEFAULT FALSE,
  archivo_url            TEXT,
  archivo_hash           TEXT,
  archivo_nombre         TEXT,
  observaciones          TEXT,
  actualizado_por        BIGINT REFERENCES usuarios(id),
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (solicitud_id, requisito)
);
CREATE INDEX IF NOT EXISTS idx_soldoc_solicitud ON solicitud_documentos (solicitud_id);

-- Contador atomico del consecutivo del folio (12.5). El consecutivo nunca se
-- reutiliza aunque la transaccion falle despues (Assumption 47).
CREATE TABLE IF NOT EXISTS solicitud_folios (
  prefijo          TEXT NOT NULL,
  clave_regional   TEXT NOT NULL,
  siglas_municipio TEXT NOT NULL,
  anio             SMALLINT NOT NULL,
  consecutivo      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefijo, clave_regional, siglas_municipio, anio)
);

-- Alcance granular del usuario de ventanilla (D35).
-- Semantica: CERO filas = "todos" (sin restriccion), Assumption 44.
CREATE TABLE IF NOT EXISTS usuario_municipios (
  usuario_id   BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  municipio_id BIGINT NOT NULL REFERENCES municipios(id),
  PRIMARY KEY (usuario_id, municipio_id)
);

CREATE TABLE IF NOT EXISTS usuario_componentes (
  usuario_id    BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  componente_id BIGINT NOT NULL REFERENCES componentes(id),
  PRIMARY KEY (usuario_id, componente_id)
);

-- Unica alteracion de una tabla existente en este build.
ALTER TABLE beneficiarios ADD COLUMN IF NOT EXISTS solicitud_id BIGINT REFERENCES solicitudes(id);
CREATE INDEX IF NOT EXISTS idx_benef_solicitud ON beneficiarios (solicitud_id);
