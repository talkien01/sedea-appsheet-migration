-- 035_localidades_historico.sql
-- Catalogos geograficos (Municipio -> Localidad/Ejido/Comunidad) importados
-- del sistema anterior en AppSheet ("CATALOGOS"), y el historico de apoyos
-- de otro programa previo ("Impulso Productivo del Campo", PIIPC) -- ambos
-- solo para BUSQUEDA/PRELLENADO, nunca se consultan en vivo desde Sheets.
--
-- id_legado en cada catalogo nuevo guarda el ID que traia el AppSheet
-- original: es lo que usa el import (backend/src/scripts/importarHistorico.ts)
-- para resolver las llaves foraneas del historico de PIIPC sin adivinar por
-- nombre. Re-correr el import es seguro (upsert por id_legado/folio+concepto).

-- Mapa legado -> municipio actual. Los 18 municipios YA existen (002); esto
-- solo les agrega el ID de 1 a 18 que traia CATALOGOS!MUNICIPIO.CVE_MUN, para
-- poder resolver las FK de todo lo demas en esta migracion.
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS id_legado_appsheet SMALLINT UNIQUE;

CREATE TABLE IF NOT EXISTS localidades (
  id           BIGSERIAL PRIMARY KEY,
  id_legado    INTEGER UNIQUE,
  municipio_id BIGINT NOT NULL REFERENCES municipios(id),
  nombre       TEXT NOT NULL,
  ambito       TEXT,
  -- Seccion electoral: no tiene catalogo propio en el origen (la pestana
  -- SECCION del Sheet esta vacia), viaja como columna de la localidad.
  cve_seccion  TEXT,
  latitud      NUMERIC(10, 6),
  longitud     NUMERIC(10, 6),
  poblacion    INTEGER,
  activo       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_localidades_municipio ON localidades (municipio_id);
CREATE INDEX IF NOT EXISTS idx_localidades_nombre ON localidades (nombre);

-- Ejido y Comunidad son catalogos HERMANOS de Localidad (cuelgan de
-- Municipio, no de Localidad) y se dejan SEPARADOS a proposito: el propio
-- Sheet origen ya trae inconsistencias entre los dos (el tab EJIDO marca
-- algunas filas como TIPO=COMUNIDAD). Se fusionan mas adelante solo si en
-- uso real se ve que no tiene sentido tenerlos aparte -- no antes.
CREATE TABLE IF NOT EXISTS ejidos (
  id           BIGSERIAL PRIMARY KEY,
  id_legado    INTEGER UNIQUE,
  municipio_id BIGINT NOT NULL REFERENCES municipios(id),
  nombre       TEXT NOT NULL,
  tipo         TEXT
);
CREATE INDEX IF NOT EXISTS idx_ejidos_municipio ON ejidos (municipio_id);

CREATE TABLE IF NOT EXISTS comunidades (
  id           BIGSERIAL PRIMARY KEY,
  id_legado    TEXT UNIQUE,
  municipio_id BIGINT NOT NULL REFERENCES municipios(id),
  nombre       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comunidades_municipio ON comunidades (municipio_id);

-- Padron de IDENTIDAD historico (fuente: CATALOGOS!BENEFICIARIOS). NO trae
-- concepto/monto/ano -- eso solo existe en historial_solicitudes de abajo.
-- Sirve unicamente como fuente de prellenado por CURP (nunca se muestra
-- como "solicitud anterior" porque no lo es).
CREATE TABLE IF NOT EXISTS beneficiarios_historicos (
  id                    BIGSERIAL PRIMARY KEY,
  fuente                TEXT NOT NULL DEFAULT 'catalogos',
  curp                  TEXT NOT NULL,
  nombre_completo       TEXT,
  nombre_pila           TEXT,
  apellido_paterno      TEXT,
  apellido_materno      TEXT,
  telefono              TEXT,
  correo                TEXT,
  rfc                   TEXT,
  banco                 TEXT,
  dom_calle             TEXT,
  dom_numero            TEXT,
  dom_colonia           TEXT,
  dom_cp                TEXT,
  dom_tipo_asentamiento TEXT,
  municipio_id          BIGINT REFERENCES municipios(id),
  localidad_id          BIGINT REFERENCES localidades(id)
);
CREATE INDEX IF NOT EXISTS idx_beneficiarios_historicos_curp ON beneficiarios_historicos (curp);

-- Historial de apoyos por solicitud (fuente: PIIPC "Impulso Productivo del
-- Campo", programa/catalogo DISTINTO al actual CFA/CFG -- por eso programa/
-- subprograma/componente/concepto/proveedor quedan como texto plano, nunca
-- se intenta ligar a los catalogos vigentes de tipos_apoyo). Un folio trae
-- 1 o 2 conceptos (ver historial_conceptos).
CREATE TABLE IF NOT EXISTS historial_solicitudes (
  id                       BIGSERIAL PRIMARY KEY,
  fuente                   TEXT NOT NULL DEFAULT 'piipc',
  folio_origen             TEXT,
  curp                     TEXT NOT NULL,
  nombre_completo          TEXT,
  nombre_pila              TEXT,
  apellido_paterno         TEXT,
  apellido_materno         TEXT,
  sexo                     TEXT,
  fecha_nacimiento         DATE,
  telefono                 TEXT,
  correo                   TEXT,
  anio                     INTEGER,
  fecha_solicitud          DATE,
  programa                 TEXT,
  subprograma              TEXT,
  componente               TEXT,
  regional                 TEXT,
  ventanilla               TEXT,
  nombre_capturista        TEXT,
  -- Domicilio del SOLICITANTE (texto libre en el origen, sin FK).
  dom_municipio_texto      TEXT,
  dom_localidad_texto      TEXT,
  dom_colonia              TEXT,
  dom_calle                TEXT,
  dom_cp                   TEXT,
  -- Ubicacion del PROYECTO/apoyo: el origen SI trae IDs legado (ID_MUN_PROY,
  -- ID_LOC_PROY, ID_EJIDO) -- se resuelven a FK cuando el import los
  -- encuentra en los catalogos de arriba; el texto se conserva siempre como
  -- respaldo si la resolucion falla o el catalogo no cubre ese caso.
  municipio_proyecto_id    BIGINT REFERENCES municipios(id),
  localidad_proyecto_id    BIGINT REFERENCES localidades(id),
  ejido_proyecto_id        BIGINT REFERENCES ejidos(id),
  municipio_proyecto_texto TEXT,
  localidad_proyecto_texto TEXT,
  ejido_proyecto_texto     TEXT,
  seccion_electoral        TEXT,
  -- Unico indicador de entrega que trae el origen: es de la SOLICITUD
  -- completa, no por concepto (por eso vive aqui y no en historial_conceptos).
  recibido                 BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_historial_solicitudes_curp ON historial_solicitudes (curp);
CREATE INDEX IF NOT EXISTS idx_historial_solicitudes_folio ON historial_solicitudes (folio_origen);

CREATE TABLE IF NOT EXISTS historial_conceptos (
  id                     BIGSERIAL PRIMARY KEY,
  historial_solicitud_id BIGINT NOT NULL REFERENCES historial_solicitudes(id) ON DELETE CASCADE,
  num_concepto           SMALLINT NOT NULL DEFAULT 1,
  concepto               TEXT,
  descripcion            TEXT,
  cantidad_solicitada    NUMERIC(14, 3),
  unidad_medida          TEXT,
  proveedor              TEXT,
  monto_total            NUMERIC(14, 2),
  monto_estatal          NUMERIC(14, 2),
  monto_beneficiario     NUMERIC(14, 2),
  UNIQUE (historial_solicitud_id, num_concepto)
);
CREATE INDEX IF NOT EXISTS idx_historial_conceptos_solicitud ON historial_conceptos (historial_solicitud_id);

-- Propuesta A: la solicitud ACTUAL puede referenciar una Localidad del
-- catalogo nuevo. dom_localidad (texto) NO se toca -- sigue siendo la fuente
-- de verdad para imprimir/mostrar; dom_localidad_id es aditivo/opcional,
-- para cuando el capturista SI encontro la localidad en el buscador.
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS dom_localidad_id BIGINT REFERENCES localidades(id);
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS dom_seccion TEXT;
