-- 037_proyectos_pep_pem.sql
-- Dos proyectos nuevos bajo el componente PET (Build 8): PEP y PEM, hermanos
-- de PEO. Boceto oficial "PRG-2026 / PET / PEO-PEP-PEM" (CamScanner
-- 11-09-2026 09.48.pdf).
--
--   Proyecto  Requisitos              Tope por solicitud   Concepto
--   PEO       Grupos de productores   $150,000  (ya vigente)  CASAS-EJIDALES
--   PEP       Grupos de productores   $2,000,000              PROYECTO-PRODUCTIVO
--   PEM       Municipio (ayuntamiento) $4,000,000             MUNICIPALIZADO
--
-- Igual que PEO, cada uno cuelga de su propia Modalidad bajo PET (patron de
-- la migracion 015) y tiene folio con PREFIJO PROPIO (PEP-, PEM-), a
-- diferencia de Casas Ejidales que folia como PEO.
--
-- Aditiva e idempotente. No modifica 012-036.

-- -------------------------------------------------------------------------
-- 0. Nuevo tipo de persona 'municipio' (el solicitante de PEM es el propio
--    ayuntamiento). `solicitudes.tipo_persona` tiene un CHECK que hoy solo
--    admite 'fisica','moral','grupo' (migracion 013) -- se amplia.
-- -------------------------------------------------------------------------
ALTER TABLE solicitudes DROP CONSTRAINT IF EXISTS solicitudes_tipo_persona_check;
ALTER TABLE solicitudes ADD CONSTRAINT solicitudes_tipo_persona_check
  CHECK (tipo_persona IN ('fisica', 'moral', 'grupo', 'municipio'));

-- -------------------------------------------------------------------------
-- 1. Tope de monto por solicitud, generalizado de constante en codigo
--    (TOPE_MONTO_PROYECTO_PEO, exclusiva de PEO) a columna del catalogo.
--    NULL = sin tope, mismo criterio "sin regla = sin restriccion" que ya
--    usan reglas_cantidad_maxima_escalon y tipos_apoyo.proyecto_id.
-- -------------------------------------------------------------------------
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS tope_monto_solicitud NUMERIC(14, 2);

COMMENT ON COLUMN proyectos.tope_monto_solicitud IS
  'Tope en pesos de la suma de monto_total de TODOS los conceptos de una misma solicitud. NULL = sin tope. Se hace cumplir en el alta (E42) y en la edicion admin.';

-- Preserva el tope de PEO que hoy vive hardcodeado en codigo (shared/solicitudes.ts).
UPDATE proyectos SET tope_monto_solicitud = 150000 WHERE clave = 'PEO';

-- -------------------------------------------------------------------------
-- 2. Modalidades nuevas bajo PET, una por proyecto (mismo patron que
--    MOD-PEPFO en la migracion 015).
-- -------------------------------------------------------------------------
INSERT INTO modalidades (clave, nombre, componente_id)
SELECT 'MOD-PEP', 'Proyectos Estratégicos Productivos', c.id
  FROM componentes c WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET
  nombre        = EXCLUDED.nombre,
  componente_id = EXCLUDED.componente_id,
  activo        = TRUE;

INSERT INTO modalidades (clave, nombre, componente_id)
SELECT 'MOD-PEM', 'Proyectos Estratégicos Municipalizados', c.id
  FROM componentes c WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET
  nombre        = EXCLUDED.nombre,
  componente_id = EXCLUDED.componente_id,
  activo        = TRUE;

-- -------------------------------------------------------------------------
-- 3. Proyectos PEP y PEM. Folio propio (prefijo_folio = clave), a diferencia
--    de Casas Ejidales que folia como PEO.
-- -------------------------------------------------------------------------
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, modalidad_id, tope_monto_solicitud)
SELECT 'PEP', 'Proyectos Estratégicos Productivos', 'PEP', c.id, m.id, 2000000
  FROM componentes c
  JOIN modalidades m ON m.clave = 'MOD-PEP'
 WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET
  nombre                = EXCLUDED.nombre,
  prefijo_folio         = EXCLUDED.prefijo_folio,
  componente_id         = EXCLUDED.componente_id,
  modalidad_id          = EXCLUDED.modalidad_id,
  tope_monto_solicitud  = EXCLUDED.tope_monto_solicitud,
  activo                = TRUE;

INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, modalidad_id, tope_monto_solicitud)
SELECT 'PEM', 'Proyectos Estratégicos Municipalizados', 'PEM', c.id, m.id, 4000000
  FROM componentes c
  JOIN modalidades m ON m.clave = 'MOD-PEM'
 WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET
  nombre                = EXCLUDED.nombre,
  prefijo_folio         = EXCLUDED.prefijo_folio,
  componente_id         = EXCLUDED.componente_id,
  modalidad_id          = EXCLUDED.modalidad_id,
  tope_monto_solicitud  = EXCLUDED.tope_monto_solicitud,
  activo                = TRUE;

-- -------------------------------------------------------------------------
-- 4. Concepto de apoyo de cada proyecto, ligado por proyecto_id (migracion
--    026: "sin proyecto = sin restriccion"; con proyecto_id, el concepto
--    SOLO puede usarse en solicitudes de ese proyecto).
--    Descripcion y unidad de medida quedan en blanco: el documento oficial
--    de PEP/PEM (requisitos, formato) todavia no esta definido (pendiente,
--    ver Assumption del boceto CamScanner 11-09-2026). Se completan despues
--    desde /catalogos, sin tocar codigo ni migraciones.
-- -------------------------------------------------------------------------
INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida, proyecto_id, activo)
SELECT 'PROYECTO-PRODUCTIVO', 'Proyecto Productivo', NULL, NULL, p.id, TRUE
  FROM proyectos p WHERE p.clave = 'PEP'
ON CONFLICT (clave) DO UPDATE SET
  nombre      = EXCLUDED.nombre,
  proyecto_id = EXCLUDED.proyecto_id,
  activo      = TRUE;

INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida, proyecto_id, activo)
SELECT 'MUNICIPALIZADO', 'Municipalizado', NULL, NULL, p.id, TRUE
  FROM proyectos p WHERE p.clave = 'PEM'
ON CONFLICT (clave) DO UPDATE SET
  nombre      = EXCLUDED.nombre,
  proyecto_id = EXCLUDED.proyecto_id,
  activo      = TRUE;

-- -------------------------------------------------------------------------
-- 5. Documentos requeridos.
--    PEP: mismos 8 documentos que Casas Ejidales (confirmado por el
--    usuario), apoyo_id = PROYECTO-PRODUCTIVO, proyecto_id = PEP,
--    tipos_persona = '{grupo}' (mismo patron que la migracion 014).
--    PEM: NINGUNA regla todavia (checklist vacio = valido, "sin regla = sin
--    restriccion"; el usuario aun no define los requisitos de PEM).
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
CROSS JOIN (SELECT id FROM proyectos   WHERE clave = 'PEP')            AS proy
CROSS JOIN (SELECT id FROM tipos_apoyo WHERE clave = 'PROYECTO-PRODUCTIVO') AS ap
WHERE NOT EXISTS (
  SELECT 1 FROM documentos_requeridos dr
  WHERE dr.requisito = docs.req
    AND dr.apoyo_id = ap.id
);
