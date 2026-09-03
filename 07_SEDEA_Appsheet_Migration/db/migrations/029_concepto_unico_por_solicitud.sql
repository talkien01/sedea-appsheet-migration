-- 029_concepto_unico_por_solicitud.sql
-- Evita que una misma solicitud repita el mismo tipo de apoyo.
-- Ejemplos permitidos: Avena + Garbanzo.
-- Ejemplos bloqueados: Avena + Avena, Garbanzo + Garbanzo.
--
-- La limpieza de duplicados historicos se realizo antes de esta migracion.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_solicitud_concepto_tipo'
      AND conrelid = 'solicitud_conceptos'::regclass
  ) THEN
    ALTER TABLE solicitud_conceptos
      ADD CONSTRAINT uq_solicitud_concepto_tipo
      UNIQUE (solicitud_id, tipo_apoyo_id);
  END IF;
END
$$;
