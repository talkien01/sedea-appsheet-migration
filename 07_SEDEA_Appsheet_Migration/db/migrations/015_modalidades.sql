-- 015_modalidades.sql
-- Build 8: nivel "Modalidad" entre Componente y Proyecto + componente PET.
-- Migracion aditiva e idempotente: ejecutable N veces sin error ni duplicados.

-- 1. Catalogo nuevo de modalidades.
CREATE TABLE IF NOT EXISTS modalidades (
  id            BIGSERIAL PRIMARY KEY,
  clave         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  componente_id BIGINT NOT NULL REFERENCES componentes(id),
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_modalidades_componente ON modalidades (componente_id);

-- 2. Columnas nuevas en proyectos y solicitudes, ambas NULLABLE a proposito.
ALTER TABLE proyectos   ADD COLUMN IF NOT EXISTS modalidad_id BIGINT REFERENCES modalidades(id);
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS modalidad_id BIGINT REFERENCES modalidades(id);
CREATE INDEX IF NOT EXISTS idx_sol_modalidad ON solicitudes (modalidad_id);

-- 3. Cuarto componente: Proyectos Estrategicos Territoriales (PET).
--    Los 3 existentes (TR/CAA/DIN) no se tocan.
INSERT INTO componentes (clave, nombre) VALUES
  ('PET', 'Proyectos Estratégicos Territoriales')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- 4. Modalidad del PDF oficial, ligada a PET.
INSERT INTO modalidades (clave, nombre, componente_id)
SELECT 'MOD-PEPFO', 'Proyectos Estratégicos Productivos y para el Fortalecimiento Organizativo', c.id
  FROM componentes c WHERE c.clave = 'PET'
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, componente_id = EXCLUDED.componente_id, activo = TRUE;

-- 5. Re-ligado de PEO: componente_id = PET, modalidad_id = MOD-PEPFO.
--    El prefijo_folio de PEO NO CAMBIA (sigue siendo 'PEO').
UPDATE proyectos p
   SET componente_id = c.id,
       modalidad_id  = m.id
  FROM componentes c, modalidades m
 WHERE p.clave = 'PEO'
   AND c.clave = 'PET'
   AND m.clave = 'MOD-PEPFO';
