-- 001_clasificacion.sql — Emergentes / Productividad (aditivo, idempotente).
-- NOTA: programa.categoria (preexistente, vacía) NO se reutiliza (A10).

ALTER TABLE analitica.programa
  ADD COLUMN IF NOT EXISTS clasificacion text NOT NULL DEFAULT 'NO_CLASIFICADO',
  ADD COLUMN IF NOT EXISTS clasificacion_criterio text,
  ADD COLUMN IF NOT EXISTS clasificacion_fuente text,
  ADD COLUMN IF NOT EXISTS clasificado_en timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'programa_clasificacion_chk'
  ) THEN
    ALTER TABLE analitica.programa
      ADD CONSTRAINT programa_clasificacion_chk
      CHECK (clasificacion IN ('EMERGENTE','PRODUCTIVIDAD','NO_CLASIFICADO'));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS analitica.programa_clasificacion_regla (
  regla_id      serial PRIMARY KEY,
  orden         int NOT NULL,
  patron        text NOT NULL,
  clasificacion text NOT NULL CHECK (clasificacion IN ('EMERGENTE','PRODUCTIVIDAD')),
  criterio      text NOT NULL,
  fuente        text NOT NULL,
  vigente_desde date NOT NULL DEFAULT current_date,
  UNIQUE (orden)
);
