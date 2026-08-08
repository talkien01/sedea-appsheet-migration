-- 002_catalogos_demo.sql
-- Catalogos base del estado de Queretaro. Idempotente.
--
-- Las 4 Direcciones Regionales y su reparto de municipios son los REALES
-- (hoja REGION / MUNICIPIO del catalogo oficial), no datos ficticios: se
-- corrigieron las 3 Regionales inventadas del build 1 por decision D6 del SPEC.
-- Las colonias, secciones y estatus siguen siendo datos de demostracion.

-- 4 Direcciones Regionales reales.
INSERT INTO direcciones_regionales (clave, nombre) VALUES
  ('REG-01', 'Cadereyta'),
  ('REG-02', 'Jalpan'),
  ('REG-03', 'Querétaro'),
  ('REG-04', 'San Juan del Río')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- Cualquier Regional sobrante de un seed anterior se desactiva (nunca se
-- borra: podria estar referenciada por usuarios o beneficiarios historicos).
UPDATE direcciones_regionales SET activo = FALSE
 WHERE clave NOT IN ('REG-01', 'REG-02', 'REG-03', 'REG-04');

-- 18 municipios de Queretaro con su Regional real (clave INEGI).
-- Primero se reubican los que ya existan (una base del build 1 los tenia en
-- otra Regional), y luego se insertan los que falten.
WITH reales(clave, nombre, reg) AS (VALUES
  ('22001', 'Amealco de Bonfil',   'REG-04'),
  ('22002', 'Pinal de Amoles',     'REG-02'),
  ('22003', 'Arroyo Seco',         'REG-02'),
  ('22004', 'Cadereyta de Montes', 'REG-01'),
  ('22005', 'Colón',               'REG-01'),
  ('22006', 'Corregidora',         'REG-03'),
  ('22007', 'Ezequiel Montes',     'REG-01'),
  ('22008', 'Huimilpan',           'REG-03'),
  ('22009', 'Jalpan de Serra',     'REG-02'),
  ('22010', 'Landa de Matamoros',  'REG-02'),
  ('22011', 'El Marqués',          'REG-03'),
  ('22012', 'Pedro Escobedo',      'REG-04'),
  ('22013', 'Peñamiller',          'REG-01'),
  ('22014', 'Querétaro',           'REG-03'),
  ('22015', 'San Joaquín',         'REG-01'),
  ('22016', 'San Juan del Río',    'REG-04'),
  ('22017', 'Tequisquiapan',       'REG-04'),
  ('22018', 'Tolimán',             'REG-01')
)
UPDATE municipios m
   SET nombre = v.nombre, regional_id = r.id, activo = TRUE
  FROM reales v
  JOIN direcciones_regionales r ON r.clave = v.reg
 WHERE m.clave = v.clave;

INSERT INTO municipios (clave, nombre, regional_id)
SELECT v.clave, v.nombre, r.id
FROM (VALUES
  ('22001', 'Amealco de Bonfil',   'REG-04'),
  ('22002', 'Pinal de Amoles',     'REG-02'),
  ('22003', 'Arroyo Seco',         'REG-02'),
  ('22004', 'Cadereyta de Montes', 'REG-01'),
  ('22005', 'Colón',               'REG-01'),
  ('22006', 'Corregidora',         'REG-03'),
  ('22007', 'Ezequiel Montes',     'REG-01'),
  ('22008', 'Huimilpan',           'REG-03'),
  ('22009', 'Jalpan de Serra',     'REG-02'),
  ('22010', 'Landa de Matamoros',  'REG-02'),
  ('22011', 'El Marqués',          'REG-03'),
  ('22012', 'Pedro Escobedo',      'REG-04'),
  ('22013', 'Peñamiller',          'REG-01'),
  ('22014', 'Querétaro',           'REG-03'),
  ('22015', 'San Joaquín',         'REG-01'),
  ('22016', 'San Juan del Río',    'REG-04'),
  ('22017', 'Tequisquiapan',       'REG-04'),
  ('22018', 'Tolimán',             'REG-01')
) AS v(clave, nombre, reg)
JOIN direcciones_regionales r ON r.clave = v.reg
WHERE NOT EXISTS (SELECT 1 FROM municipios m WHERE m.clave = v.clave);

-- Municipios de un seed anterior que ya no forman parte del catalogo real.
UPDATE municipios SET activo = FALSE WHERE clave NOT LIKE '22%';

-- Tipos de apoyo de demostracion del build 1. El catalogo real de 152
-- conceptos vive en 004_tipos_apoyo_apoyo.sql (claves AP-001 .. AP-152).
INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida) VALUES
  ('TA-MAIZ',    'Semilla de maiz mejorada',      'agricola',       'kg'),
  ('TA-FERT',    'Fertilizante granulado',        'agricola',       'kg'),
  ('TA-AVES',    'Paquete de aves de postura',    'pecuario',       'pieza'),
  ('TA-BORREGO', 'Paquete ovino',                 'pecuario',       'pieza'),
  ('TA-TRACTOR', 'Servicio de maquinaria agricola','maquinaria',    'ha'),
  ('TA-CISTERNA','Cisterna de captacion de agua',  'infraestructura','pieza')
ON CONFLICT (clave) DO NOTHING;

-- Dos colonias por municipio.
INSERT INTO catalogos (grupo, clave, valor, padre_grupo, padre_clave, orden)
SELECT 'colonia',
       'COL-' || m.clave || '-' || c.n,
       c.nombre,
       'municipio',
       m.clave,
       c.n
FROM municipios m
CROSS JOIN (VALUES (1, 'Centro'), (2, 'Barrio La Cruz')) AS c(n, nombre)
ON CONFLICT DO NOTHING;

-- Dos secciones por colonia.
INSERT INTO catalogos (grupo, clave, valor, padre_grupo, padre_clave, orden)
SELECT 'seccion',
       c.clave || '-S' || s.n,
       'Seccion ' || lpad(s.n::text, 2, '0'),
       'colonia',
       c.clave,
       s.n
FROM catalogos c
CROSS JOIN (VALUES (1), (2)) AS s(n)
WHERE c.grupo = 'colonia'
ON CONFLICT DO NOTHING;

-- Estatus de entrega (catalogo plano).
INSERT INTO catalogos (grupo, clave, valor, orden) VALUES
  ('estatus_entrega', 'ENTREGADO', 'Entregado', 1),
  ('estatus_entrega', 'PARCIAL',   'Entrega parcial', 2),
  ('estatus_entrega', 'PENDIENTE', 'Pendiente', 3)
ON CONFLICT DO NOTHING;
