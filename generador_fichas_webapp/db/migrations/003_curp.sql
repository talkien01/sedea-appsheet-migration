-- 003_curp.sql — beneficiario_curp: género y edad derivados de CURP válida (R6).

CREATE TABLE IF NOT EXISTS analitica.beneficiario_curp (
  curp_id            serial PRIMARY KEY,
  curp_hash          char(64) NOT NULL,
  curp               char(18),
  curp_valida        boolean NOT NULL,
  motivo_invalidez   text CHECK (motivo_invalidez IS NULL OR motivo_invalidez IN
                       ('FORMATO','DIGITO_VERIFICADOR','FECHA','ENTIDAD','LONGITUD','NULA')),
  genero             char(1) CHECK (genero IS NULL OR genero IN ('H','M')),
  fecha_nacimiento   date,
  edad_anios         int,
  rango_edad         text CHECK (rango_edad IS NULL OR rango_edad IN
                       ('MENOR_18','18-29','30-44','45-59','60+')),
  entidad_nacimiento char(2),
  anio               int NOT NULL,
  programa_id        int REFERENCES analitica.programa(programa_id),
  municipio_id       int REFERENCES analitica.municipio(municipio_id),
  municipio_usado    text NOT NULL,
  fuente_municipio   text NOT NULL CHECK (fuente_municipio IN
                       ('EXPLICITO','ALIAS','CURP','DISTRIBUCION','ESTATAL_NO_DESAGREGADO','DESCONOCIDO')),
  folio              text,
  monto_total        numeric(14,2),
  fuente_archivo     text NOT NULL,
  fuente_hoja        text NOT NULL,
  fila_origen        int NOT NULL,
  fecha_corte        date NOT NULL,
  cargado_en         timestamptz DEFAULT now(),
  -- R6: si la CURP no es válida, nada se infiere.
  CONSTRAINT beneficiario_curp_invalida_sin_derivados CHECK (
    curp_valida OR (genero IS NULL AND fecha_nacimiento IS NULL
                    AND edad_anios IS NULL AND rango_edad IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS beneficiario_curp_uniq
  ON analitica.beneficiario_curp (curp_hash, anio, coalesce(programa_id,-1), coalesce(folio,''));
CREATE INDEX IF NOT EXISTS beneficiario_curp_anio_muni_idx
  ON analitica.beneficiario_curp (anio, municipio_id);
CREATE INDEX IF NOT EXISTS beneficiario_curp_hash_idx
  ON analitica.beneficiario_curp (curp_hash);
CREATE INDEX IF NOT EXISTS beneficiario_curp_prog_anio_idx
  ON analitica.beneficiario_curp (programa_id, anio);
