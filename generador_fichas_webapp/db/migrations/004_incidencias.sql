-- 004_incidencias.sql — lo que no cuadra se reporta, no se esconde (R8).

CREATE TABLE IF NOT EXISTS analitica.incidencia_carga (
  incidencia_id   serial PRIMARY KEY,
  tipo            text NOT NULL CHECK (tipo IN (
                    'MUNICIPIO_NO_RESUELTO','CURP_INVALIDA','CURP_DUPLICADA',
                    'PROGRAMA_NO_CLASIFICADO','PROGRAMA_CLASIFICADO_POR_DEFECTO',
                    'SUMA_APORTACIONES_NO_CUADRA','MONTO_NEGATIVO','ANIO_SIN_DATOS',
                    'FOLIO_DUPLICADO','FUENTE_FALTANTE','DATO_MANUAL_FALTANTE')),
  severidad       text NOT NULL CHECK (severidad IN ('BLOQUEANTE','ADVERTENCIA','INFO')),
  entidad         text NOT NULL,
  entidad_id      int,
  anio            int,
  municipio_id    int,
  programa_id     int,
  descripcion     text NOT NULL,
  valor_origen    text,
  accion_sugerida text NOT NULL,
  fuente_archivo  text,
  fuente_hoja     text,
  fila_origen     int,
  resuelta        boolean NOT NULL DEFAULT false,
  detectada_en    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS incidencia_carga_uniq
  ON analitica.incidencia_carga
     (tipo, entidad, coalesce(entidad_id,-1), coalesce(anio,-1), coalesce(fila_origen,-1));
CREATE INDEX IF NOT EXISTS incidencia_carga_tipo_idx ON analitica.incidencia_carga (tipo, severidad);
