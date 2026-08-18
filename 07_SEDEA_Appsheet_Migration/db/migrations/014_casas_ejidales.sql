-- 014_casas_ejidales.sql
-- Build 7: concepto de apoyo "Casas Ejidales" y sus 8 documentos requeridos.
--
-- CORRECCION DE DISENO: la primera version de esta migracion daba de alta
-- Casas Ejidales como un PROYECTO nuevo con prefijo de folio propio. Eso era
-- incorrecto: los documentos oficiales son del proyecto PEO ya existente
-- (folio real PEO-SJR-AME-0001-26). Casas Ejidales es un CONCEPTO DE APOYO
-- (una fila de tipos_apoyo) que se solicita dentro de PEO. No se crea ningun
-- programa, subprograma, componente ni proyecto, y no existe el prefijo de
-- folio de un proyecto nuevo: estas solicitudes se folian como PEO.
--
-- Migracion aditiva e idempotente: no crea tablas ni columnas y no toca
-- ningun catalogo estructural. Puede ejecutarse sobre una BD de Build 6 sin
-- downtime y repetidas veces sin error ni duplicados.

-- -------------------------------------------------------------------------
-- 0. Limpieza del artefacto de la version equivocada de esta migracion: un
--    indice unico parcial sobre (requisito, proyecto_id) que impediria que
--    convivan la regla del anexo PEO y la del concepto con el mismo texto.
-- -------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_docsreq_req_proyecto;

-- -------------------------------------------------------------------------
-- 1. Concepto de apoyo nuevo: Casas Ejidales.
--    clave = 'CASAS-EJIDALES' (no se usa la serie AP-### reservada a los 152
--    conceptos de la hoja APOYO). categoria 'infraestructura' porque una casa
--    ejidal es obra civil; unidad de medida 'obra'.
-- -------------------------------------------------------------------------
INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida, activo)
VALUES ('CASAS-EJIDALES', 'Casas Ejidales', 'infraestructura', 'obra', TRUE)
ON CONFLICT (clave) DO UPDATE
  SET nombre        = EXCLUDED.nombre,
      categoria     = EXCLUDED.categoria,
      unidad_medida = EXCLUDED.unidad_medida,
      activo        = TRUE;

-- -------------------------------------------------------------------------
-- 2. Alineacion de texto (D48-bis): las 8 reglas del anexo PEO sembradas en
--    Build 6 salen del mismo PDF, pero con el texto abreviado. Se llevan al
--    texto verbatim para que la deduplicacion por requisito de E41 colapse
--    cada par en un solo item y el capturista no vea el documento dos veces.
--    UPDATE acotado (apoyo_id IS NULL y proyecto_id = PEO) e idempotente:
--    no cambia el numero de filas ni ninguna otra regla.
-- -------------------------------------------------------------------------
UPDATE documentos_requeridos dr
SET requisito = v.nuevo
FROM (VALUES
  ('Acta de integración del grupo de productores',
   'Acta integración del grupo de productores'),
  ('Identificación oficial vigente con fotografía del representante',
   'Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores'),
  ('CURP del representante',
   'CURP del representante del grupo de productores'),
  ('Constancia de Situación Fiscal del representante',
   'Constancia de Situación Fiscal del representante del grupo de productores'),
  ('Comprobante de domicilio del representante',
   'Comprobante de domicilio del representante de grupo de productores'),
  ('Relación de beneficiarios directos',
   'Relación de beneficiarios directos del grupo de productores')
) AS v(viejo, nuevo)
WHERE dr.requisito = v.viejo
  AND dr.apoyo_id IS NULL
  AND dr.proyecto_id = (SELECT id FROM proyectos WHERE clave = 'PEO');

-- -------------------------------------------------------------------------
-- 3. Ocho documentos requeridos del concepto Casas Ejidales.
--    apoyo_id  = concepto 'CASAS-EJIDALES'
--    proyecto_id = proyecto PEO ya existente (no NULL)
--    tipos_persona = '{grupo}' => solo aparecen cuando el tipo de persona es
--    "Grupo de productores". componentes = NULL => cualquier componente.
--    Textos verbatim del PDF CamScanner 17-08-2026 10.27.pdf.
--    Idempotencia por WHERE NOT EXISTS sobre (requisito, apoyo_id).
-- -------------------------------------------------------------------------
INSERT INTO documentos_requeridos (requisito, componentes, tipos_persona, proyecto_id, apoyo_id, orden, activo)
SELECT docs.req, NULL, '{grupo}', proy.id, ap.id, docs.ord, TRUE
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
CROSS JOIN (SELECT id FROM proyectos   WHERE clave = 'PEO')            AS proy
CROSS JOIN (SELECT id FROM tipos_apoyo WHERE clave = 'CASAS-EJIDALES') AS ap
WHERE NOT EXISTS (
  SELECT 1 FROM documentos_requeridos dr
  WHERE dr.requisito = docs.req
    AND dr.apoyo_id = ap.id
);
