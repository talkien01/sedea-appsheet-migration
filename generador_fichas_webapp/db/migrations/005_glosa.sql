-- 005_glosa.sql — insumos verificables para la Glosa del Informe (R7).
-- Sin fuente y sin criterio de cálculo, el INSERT falla: el insumo no existe.

CREATE TABLE IF NOT EXISTS analitica.glosa_insumo (
  insumo_id        serial PRIMARY KEY,
  clave            text UNIQUE NOT NULL,
  tema             text NOT NULL,
  pregunta         text NOT NULL,
  indicador        text NOT NULL,
  valor_numerico   numeric(16,2),
  valor_texto      text,
  unidad           text NOT NULL,
  anio             int NOT NULL,
  ambito           text NOT NULL CHECK (ambito IN ('ESTATAL','REGION','MUNICIPIO')),
  region_id        int,
  municipio_id     int,
  programa_id      int,
  fuente_tabla     text NOT NULL,
  fuente_vista     text NOT NULL,
  fuente_archivo   text NOT NULL,
  fuente_hoja      text NOT NULL,
  criterio_calculo text NOT NULL CHECK (char_length(criterio_calculo) >= 20),
  fecha_corte      date NOT NULL,
  responsable      text NOT NULL,
  verificado       boolean NOT NULL DEFAULT false,
  verificado_por   text,
  verificado_en    timestamptz,
  generado_en      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS glosa_insumo_anio_tema_idx ON analitica.glosa_insumo (anio, tema);
