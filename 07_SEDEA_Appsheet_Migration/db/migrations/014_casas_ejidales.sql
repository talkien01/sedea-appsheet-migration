-- 014_casas_ejidales.sql
-- Build 7: Proyecto Casas Ejidales (CEJ) y sus 8 documentos requeridos.
--
-- Migración 100 % aditiva e idempotente. No toca ninguna tabla, columna,
-- índice ni fila existente. Puede ejecutarse sobre una BD de Build 6 sin
-- downtime ni errores en ejecuciones repetidas.

-- -------------------------------------------------------------------------
-- 1. Proyecto nuevo: Casas Ejidales (clave CEJ)
--    - prefijo_folio = 'CEJ' (3 letras, igual que PEO)
--    - componente_id IS NULL => aplica con cualquier componente (igual que PEO)
--    - Se inserta bajo el programa y subprograma ya existentes;
--      NO se crea ningún registro en programas, subprogramas ni componentes.
-- -------------------------------------------------------------------------
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, activo)
VALUES ('CEJ', 'Casas Ejidales', 'CEJ', NULL, TRUE)
ON CONFLICT (clave) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2. Índice único parcial para garantizar idempotencia en documentos_requeridos
--    cuando proyecto_id IS NOT NULL. Si ya existe, IF NOT EXISTS lo ignora.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_docsreq_req_proyecto
  ON documentos_requeridos (requisito, proyecto_id)
  WHERE proyecto_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 3. Ocho documentos requeridos para Casas Ejidales.
--    tipos_persona = '{grupo}' => solo aparecen en el checklist cuando
--    tipo_persona = 'grupo'.
--    componentes = NULL => aplican con cualquier componente.
--    Textos tomados verbatim del PDF CamScanner 17-08-2026 10.27.pdf.
-- -------------------------------------------------------------------------
INSERT INTO documentos_requeridos (requisito, componentes, tipos_persona, proyecto_id, orden, activo)
SELECT docs.req, NULL, '{grupo}', proy.id, docs.ord, TRUE
FROM (VALUES
  ('Solicitud mediante escrito libre dirigida al Titular de la Secretaría', 1),
  ('Ficha técnica', 2),
  ('Acta integración del grupo de productores', 3),
  ('Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores', 4),
  ('CURP del representante del grupo de productores', 5),
  ('Constancia de Situación Fiscal del representante del grupo de productores', 6),
  ('Comprobante de domicilio del representante de grupo de productores', 7),
  ('Relación de beneficiarios directos del grupo de productores', 8)
) AS docs(req, ord)
CROSS JOIN (SELECT id FROM proyectos WHERE clave = 'CEJ') AS proy
ON CONFLICT (requisito, proyecto_id) WHERE proyecto_id IS NOT NULL DO NOTHING;
