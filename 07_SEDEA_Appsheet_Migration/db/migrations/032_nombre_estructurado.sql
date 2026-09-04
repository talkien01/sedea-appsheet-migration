-- 032_nombre_estructurado.sql
-- Agrega nombre de pila / apellido paterno / apellido materno como columnas
-- separadas, ademas del nombre completo combinado que ya existia (no se
-- quita: sigue siendo lo que se imprime y se muestra en todos lados).
--
-- De donde salen los datos exactos hacia adelante: el QR de la Constancia
-- CURP (RENAPO) YA trae estos 3 campos separados — antes se combinaban al
-- vuelo y se descartaba la separacion (ver packages/shared/src/curpQr.ts).
-- La captura manual (sin QR) tambien pasa a pedir los 3 por separado.
--
-- Lo historico (filas ya capturadas) NO tiene esta separacion real: se
-- rellena aqui con la MISMA heuristica que ya usa el filtro de apellido
-- de /beneficiarios (packages/shared/src/nombres.ts /
-- backend/src/rutas/beneficiarios.ts::expresionApellido) — "mejor esfuerzo"
-- declarado, no exacto. Los registros nuevos capturados via QR despues de
-- esta migracion SI quedan exactos.

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS nombre_pila TEXT,
  ADD COLUMN IF NOT EXISTS apellido_paterno TEXT,
  ADD COLUMN IF NOT EXISTS apellido_materno TEXT;

ALTER TABLE beneficiarios
  ADD COLUMN IF NOT EXISTS nombre_pila TEXT,
  ADD COLUMN IF NOT EXISTS apellido_paterno TEXT,
  ADD COLUMN IF NOT EXISTS apellido_materno TEXT;

-- Backfill de solicitudes (heuristica v2: cuenta desde el final).
WITH partes AS (
  SELECT id,
         string_to_array(regexp_replace(trim(nombre_solicitante), '\s+', ' ', 'g'), ' ') AS p
    FROM solicitudes
   WHERE nombre_pila IS NULL
)
UPDATE solicitudes s SET
  apellido_paterno = CASE
    WHEN array_length(p.p, 1) >= 3 THEN p.p[array_length(p.p, 1) - 1]
    WHEN array_length(p.p, 1) = 2 THEN p.p[2]
    ELSE NULL
  END,
  apellido_materno = CASE
    WHEN array_length(p.p, 1) >= 3 THEN p.p[array_length(p.p, 1)]
    ELSE NULL
  END,
  nombre_pila = CASE
    WHEN array_length(p.p, 1) >= 3 THEN array_to_string(p.p[1 : array_length(p.p, 1) - 2], ' ')
    WHEN array_length(p.p, 1) >= 1 THEN p.p[1]
    ELSE NULL
  END
  FROM partes p
 WHERE s.id = p.id;

-- Backfill de beneficiarios (mismo criterio, sobre nombre_completo).
WITH partes AS (
  SELECT id,
         string_to_array(regexp_replace(trim(nombre_completo), '\s+', ' ', 'g'), ' ') AS p
    FROM beneficiarios
   WHERE nombre_pila IS NULL
)
UPDATE beneficiarios b SET
  apellido_paterno = CASE
    WHEN array_length(p.p, 1) >= 3 THEN p.p[array_length(p.p, 1) - 1]
    WHEN array_length(p.p, 1) = 2 THEN p.p[2]
    ELSE NULL
  END,
  apellido_materno = CASE
    WHEN array_length(p.p, 1) >= 3 THEN p.p[array_length(p.p, 1)]
    ELSE NULL
  END,
  nombre_pila = CASE
    WHEN array_length(p.p, 1) >= 3 THEN array_to_string(p.p[1 : array_length(p.p, 1) - 2], ' ')
    WHEN array_length(p.p, 1) >= 1 THEN p.p[1]
    ELSE NULL
  END
  FROM partes p
 WHERE b.id = p.id;
