-- 002_trazabilidad.sql — municipio_usado / fuente_municipio / confianza (R5).

ALTER TABLE analitica.apoyo_municipio
  ADD COLUMN IF NOT EXISTS municipio_usado text,
  ADD COLUMN IF NOT EXISTS fuente_municipio text,
  ADD COLUMN IF NOT EXISTS confianza_municipio text,
  ADD COLUMN IF NOT EXISTS fila_origen int;

ALTER TABLE analitica.accion
  ADD COLUMN IF NOT EXISTS municipio_usado text,
  ADD COLUMN IF NOT EXISTS fuente_municipio text,
  ADD COLUMN IF NOT EXISTS confianza_municipio text,
  ADD COLUMN IF NOT EXISTS fila_origen int;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['apoyo_municipio','accion'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_fuente_municipio_chk') THEN
      EXECUTE format(
        'ALTER TABLE analitica.%I ADD CONSTRAINT %I CHECK (fuente_municipio IS NULL OR fuente_municipio IN
           (''EXPLICITO'',''ALIAS'',''CURP'',''DISTRIBUCION'',''ESTATAL_NO_DESAGREGADO'',''DESCONOCIDO''))',
        t, t || '_fuente_municipio_chk');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_confianza_municipio_chk') THEN
      EXECUTE format(
        'ALTER TABLE analitica.%I ADD CONSTRAINT %I CHECK (confianza_municipio IS NULL OR confianza_municipio IN
           (''ALTA'',''MEDIA'',''BAJA''))',
        t, t || '_confianza_municipio_chk');
    END IF;
  END LOOP;
END$$;
