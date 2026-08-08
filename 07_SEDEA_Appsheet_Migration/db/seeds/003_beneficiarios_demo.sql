-- 003_beneficiarios_demo.sql
-- 30 beneficiarios ficticios distribuidos entre las 3 Regionales y sus municipios.
-- Datos totalmente inventados: no corresponden a personas reales.

WITH nombres(n, nombre) AS (VALUES
  (1,  'Maria Guadalupe Hernandez Rivera'),
  (2,  'Jose Antonio Martinez Olvera'),
  (3,  'Juana Perez Trejo'),
  (4,  'Ricardo Alberto Sanchez Nieves'),
  (5,  'Ana Laura Resendiz Gomez'),
  (6,  'Pedro Ignacio Ramirez Ledesma'),
  (7,  'Rosa Elena Cabrera Mendoza'),
  (8,  'Miguel Angel Guerrero Pacheco'),
  (9,  'Silvia Patricia Ugalde Chavez'),
  (10, 'Fernando Javier Bocanegra Lira'),
  (11, 'Leticia Anaya Morales'),
  (12, 'Salvador de Jesus Rangel Vega'),
  (13, 'Margarita Feregrino Suarez'),
  (14, 'Hector Manuel Alvarez Zamora'),
  (15, 'Veronica Jimenez Aguilar'),
  (16, 'Raul Eduardo Montes Barrera'),
  (17, 'Claudia Ivette Nunez Salinas'),
  (18, 'Alfonso Gerardo Puga Yanez'),
  (19, 'Beatriz Adriana Rico Camacho'),
  (20, 'Sergio Alonso Tovar Escobedo'),
  (21, 'Gloria Estela Vazquez Loyola'),
  (22, 'Jorge Luis Ibarra Zuniga'),
  (23, 'Norma Angelica Delgado Rojas'),
  (24, 'Enrique Alejandro Solis Padilla'),
  (25, 'Teresa de Jesus Bautista Cruz'),
  (26, 'Gustavo Adolfo Herrera Pena'),
  (27, 'Alicia Fernanda Zarate Robles'),
  (28, 'Martin Osvaldo Cortes Villagran'),
  (29, 'Elizabeth Guzman Arteaga'),
  (30, 'Ramon Efrain Maldonado Tapia')
),
muni AS (
  SELECT id, clave, regional_id, row_number() OVER (ORDER BY clave) AS rn
  FROM municipios
),
total AS (SELECT count(*)::int AS t FROM muni),
apoyos AS (
  SELECT id, row_number() OVER (ORDER BY clave) AS rn FROM tipos_apoyo
),
total_apoyos AS (SELECT count(*)::int AS t FROM apoyos),
base AS (
  SELECT
    nb.n,
    nb.nombre,
    m.id  AS municipio_id,
    m.clave AS municipio_clave,
    m.regional_id,
    'COL-' || m.clave || '-' || (((nb.n - 1) % 2) + 1) AS colonia_clave,
    (((nb.n - 1) % 2) + 1) AS seccion_n,
    a.id AS tipo_apoyo_id
  FROM nombres nb
  CROSS JOIN total
  CROSS JOIN total_apoyos ta
  JOIN muni m   ON m.rn = ((nb.n - 1) % total.t) + 1
  JOIN apoyos a ON a.rn = ((nb.n - 1) % ta.t) + 1
)
INSERT INTO beneficiarios (
  folio, curp, nombre_completo, regional_id, municipio_id, colonia, seccion,
  localidad, domicilio, telefono, tipo_apoyo_id, cantidad_asignada, datos_extra
)
SELECT
  'BEN-' || lpad(b.n::text, 4, '0'),
  'DEMO' || lpad(b.n::text, 6, '0') || 'HQTRRR0' || (b.n % 10),
  b.nombre,
  b.regional_id,
  b.municipio_id,
  col.valor,
  'Seccion ' || lpad(b.seccion_n::text, 2, '0'),
  'Localidad ' || lpad(b.n::text, 2, '0'),
  'Calle Ficticia ' || (b.n * 7) || ', s/n',
  '442' || lpad((1000000 + b.n * 13)::text, 7, '0'),
  b.tipo_apoyo_id,
  round((50 + b.n * 3.5)::numeric, 3),
  jsonb_build_object('origen', 'seed_demo', 'ciclo_agricola', '2026')
FROM base b
JOIN catalogos col ON col.grupo = 'colonia' AND col.clave = b.colonia_clave
ON CONFLICT (folio) DO NOTHING;
