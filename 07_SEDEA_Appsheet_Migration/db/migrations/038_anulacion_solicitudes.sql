-- 038_anulacion_solicitudes.sql
-- "Anular solicitud" (solo admin): hasta hoy, corregir un folio capturado
-- con el concepto equivocado (ej. avena en vez de garbanzo) se resolvia con
-- un DELETE por SQL directo desde la terminal -- funcional, pero fuera de
-- la aplicacion, sin registro propio, y con riesgo de error humano en cada
-- corrida. Se agrega un estado de anulacion EN LUGAR de borrar: el
-- expediente queda como historial (quien, cuando, por que), no como si
-- nunca hubiera existido.
--
-- Aditiva e idempotente. No modifica ninguna migracion anterior.

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS anulada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulada_por BIGINT REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

COMMENT ON COLUMN solicitudes.anulada_en IS
  'NULL = vigente. Con fecha = anulada por un admin (ver anulada_por/motivo_anulacion); el folio deja de ofrecerse en "Entregar apoyos" y de contarse en Reportes, pero el registro NO se borra.';

-- Consulta habitual: "dame las anuladas" o "dame las vigentes" (filtro
-- parcial, la mayoria de las filas son NULL).
CREATE INDEX IF NOT EXISTS idx_solicitudes_anulada_en
  ON solicitudes (anulada_en)
  WHERE anulada_en IS NOT NULL;
