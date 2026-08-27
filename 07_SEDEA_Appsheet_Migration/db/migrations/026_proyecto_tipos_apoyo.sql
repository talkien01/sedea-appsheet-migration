-- 026_proyecto_tipos_apoyo.sql
-- Concepto de apoyo ligado a su proyecto.
--
-- Hallazgo real de ventanilla: `tipos_apoyo` (161 conceptos) no tenia NINGUNA
-- relacion con `proyectos`, era una lista plana global. El selector de
-- "Concepto de apoyo" de Nueva Solicitud mostraba los 161 sin importar que
-- proyecto se hubiera elegido en el Paso 1, asi que una solicitud del proyecto
-- CFA (semilla de avena) podia llevar adentro un concepto de CFG (semilla de
-- garbanzo). Eso corrompe las estadisticas por proyecto en silencio: el
-- concepto ajeno queda contado bajo el proyecto de la solicitud que lo
-- contiene.
--
-- ALCANCE DELIBERADO: el mecanismo es generico (cualquier concepto puede
-- apuntar a su proyecto), pero SOLO se puebla para los dos proyectos activos
-- hoy, CFA y CFG, ambos bajo el componente CONT. No existe el mapeo
-- proyecto<->concepto para los otros 159 (la mayoria son de proyectos que no
-- estan en uso: PEO, CAA, DIN, PET, TR...), asi que se quedan en NULL.
--
-- `proyecto_id NULL` = SIN RESTRICCION. Es el mismo criterio "sin regla = sin
-- restriccion" que ya usan `reglas_cantidad_maxima_escalon` y
-- `documentos_requeridos` en este sistema. Cuando en el futuro se quiera
-- aplicar la regla a otro proyecto, basta poblar la relacion de esos
-- conceptos: no hay que tocar codigo.
--
-- Aditiva e idempotente: columna nullable, ningun dato existente se pierde.

ALTER TABLE tipos_apoyo
  ADD COLUMN IF NOT EXISTS proyecto_id BIGINT NULL REFERENCES proyectos(id);

COMMENT ON COLUMN tipos_apoyo.proyecto_id IS
  'Proyecto al que pertenece el concepto. NULL = concepto sin proyecto definido, se permite en cualquier solicitud (sin regla = sin restriccion). Con valor, el concepto SOLO puede usarse en solicitudes de ese proyecto: el alta lo rechaza con 422 concepto_proyecto_no_coincide y el selector de la PWA lo oculta.';

-- Un concepto se busca casi siempre filtrando por proyecto.
CREATE INDEX IF NOT EXISTS idx_tipos_apoyo_proyecto
  ON tipos_apoyo (proyecto_id)
  WHERE proyecto_id IS NOT NULL;

-- Los dos unicos conceptos mapeados hoy. UPDATE ... FROM sobre filas que ya
-- existen (creadas en la migracion 022), asi que es idempotente por
-- naturaleza: correrlo N veces deja exactamente el mismo estado.
UPDATE tipos_apoyo t
   SET proyecto_id = p.id
  FROM (VALUES
      ('CFA-AVENA',    'CFA'),
      ('CFG-GARBANZO', 'CFG')
    ) AS v(clave_apoyo, clave_proyecto)
  JOIN proyectos p ON p.clave = v.clave_proyecto
 WHERE t.clave = v.clave_apoyo
   AND t.proyecto_id IS DISTINCT FROM p.id;
