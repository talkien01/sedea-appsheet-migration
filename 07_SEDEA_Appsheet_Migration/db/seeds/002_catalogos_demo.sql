-- 002_catalogos_demo.sql
-- Catalogos de demostracion (Direcciones Regionales, municipios de Queretaro,
-- tipos de apoyo, colonias y secciones). Idempotente.

INSERT INTO direcciones_regionales (clave, nombre) VALUES
  ('REG-01', 'Regional Centro'),
  ('REG-02', 'Regional Sierra Gorda'),
  ('REG-03', 'Regional Bajio')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO municipios (clave, nombre, regional_id)
SELECT v.clave, v.nombre, r.id
FROM (VALUES
  ('22014', 'Queretaro',              'REG-01'),
  ('22006', 'Corregidora',            'REG-01'),
  ('22011', 'El Marques',             'REG-01'),
  ('22008', 'Huimilpan',              'REG-01'),
  ('22007', 'Jalpan de Serra',        'REG-02'),
  ('22013', 'Pinal de Amoles',        'REG-02'),
  ('22003', 'Arroyo Seco',            'REG-02'),
  ('22012', 'Penamiller',             'REG-02'),
  ('22015', 'San Juan del Rio',       'REG-03'),
  ('22016', 'Tequisquiapan',          'REG-03'),
  ('22002', 'Amealco de Bonfil',      'REG-03'),
  ('22005', 'Cadereyta de Montes',    'REG-03')
) AS v(clave, nombre, reg)
JOIN direcciones_regionales r ON r.clave = v.reg
ON CONFLICT (clave, regional_id) DO NOTHING;

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
