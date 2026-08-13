-- 006_vistas.sql — las 6 vistas nuevas. Aditivas: ninguna vista v_* se toca.
-- Reglas aplicadas: R1 (nada se rellena), R2 (apoyos != beneficiarios únicos),
-- R3 (5 columnas de dinero), R4 (años sin datos no se generan), R5 (trazabilidad).

-- 1) Matriz histórica: unión de los 3 silos por época.
CREATE OR REPLACE VIEW analitica.vw_matriz_historica AS
WITH curp_agg AS (
  SELECT anio, municipio_id, programa_id, count(DISTINCT curp_hash) AS beneficiarios_unicos
  FROM analitica.beneficiario_curp
  GROUP BY anio, municipio_id, programa_id
),
base AS (
  -- 2023-2025 (y cualquier año que se cargue en apoyo_municipio)
  SELECT
    am.anio::int                                   AS anio,
    m.municipio_id::int                            AS municipio_id,
    m.nombre                                       AS municipio,
    coalesce(am.municipio_usado, m.nombre)         AS municipio_usado,
    am.fuente_municipio                            AS fuente_municipio,
    am.programa_id::int                            AS programa_id,
    p.nombre                                       AS programa,
    p.clasificacion                                AS clasificacion,
    'apoyo_municipio'::text                        AS origen,
    sum(am.numero_apoyos)::int                     AS numero_apoyos,
    sum(am.apoyo_federal)                          AS federal,
    sum(am.apoyo_estatal)                          AS estatal,
    sum(am.apoyo_municipal)                        AS municipal,
    sum(am.aportacion_productor)                   AS beneficiario,
    sum(am.total)                                  AS total,
    max(am.fuente_archivo)                         AS fuente_archivo,
    max(am.fuente_hoja)                            AS fuente_hoja
  FROM analitica.apoyo_municipio am
  JOIN analitica.municipio m USING (municipio_id)
  JOIN analitica.programa p USING (programa_id)
  GROUP BY 1,2,3,4,5,6,7,8

  UNION ALL

  -- 2009-2021: tabla accion. No tiene aportación municipal: va NULL, no 0 (R1).
  SELECT
    a.anio::int,
    m.municipio_id::int,
    m.nombre,
    coalesce(a.municipio_usado, m.nombre),
    a.fuente_municipio,
    a.programa_id::int,
    p.nombre,
    p.clasificacion,
    'accion'::text,
    count(*)::int,
    sum(a.inv_federal),
    sum(a.inv_estatal),
    NULL::numeric,
    sum(a.inv_beneficiario),
    sum(a.inv_total),
    max(a.fuente_archivo),
    NULL::text
  FROM analitica.accion a
  JOIN analitica.municipio m USING (municipio_id)
  JOIN analitica.programa p USING (programa_id)
  GROUP BY 1,2,3,4,5,6,7,8

  UNION ALL

  -- 2026: fuente autorizada v_oficial_municipio (dictaminado).
  -- Solo trae estatal y total: federal/municipal/beneficiario van NULL (A5).
  SELECT
    o.anio::int,
    m.municipio_id::int,
    m.nombre,
    o.municipio_proyecto,
    CASE WHEN m.nombre = o.municipio_proyecto THEN 'EXPLICITO' ELSE 'ALIAS' END,
    p.programa_id::int,
    coalesce(p.nombre, o.componente),
    coalesce(p.clasificacion, 'NO_CLASIFICADO'),
    'oficial_2026'::text,
    sum(o.apoyos)::int,
    NULL::numeric,
    sum(o.estatal_dictaminado),
    NULL::numeric,
    NULL::numeric,
    sum(o.total_dictaminado),
    'oficial.solicitud'::text,
    'v_oficial_municipio'::text
  FROM analitica.v_oficial_municipio o
  LEFT JOIN analitica.municipio m
         ON m.nombre = o.municipio_proyecto
         OR m.municipio_id = (SELECT ma.municipio_id FROM analitica.municipio_alias ma
                               WHERE ma.alias = o.municipio_proyecto LIMIT 1)
  LEFT JOIN analitica.programa p
         ON p.nombre = o.componente
         OR p.programa_id = (SELECT pa.programa_id FROM analitica.programa_alias pa
                              WHERE pa.alias = o.componente LIMIT 1)
  GROUP BY 1,2,3,4,5,6,7,8
)
SELECT
  b.anio,
  m.region_id::int          AS region_id,
  r.nombre                  AS region,
  b.municipio_id,
  b.municipio,
  b.municipio_usado,
  b.fuente_municipio,
  b.programa_id,
  b.programa,
  b.clasificacion,
  b.origen,
  b.numero_apoyos,
  c.beneficiarios_unicos::int AS beneficiarios_unicos,
  b.federal,
  b.estatal,
  b.municipal,
  b.beneficiario,
  b.total,
  b.fuente_archivo,
  b.fuente_hoja
FROM base b
LEFT JOIN analitica.municipio m ON m.municipio_id = b.municipio_id
LEFT JOIN analitica.region r ON r.region_id = m.region_id
LEFT JOIN curp_agg c ON c.anio = b.anio
                    AND c.municipio_id = b.municipio_id
                    AND c.programa_id IS NOT DISTINCT FROM b.programa_id;

-- 2) Emergentes vs Productividad
CREATE OR REPLACE VIEW analitica.vw_matriz_emer_prod AS
WITH agg AS (
  SELECT anio, region_id, region, municipio_id, municipio, clasificacion,
         count(DISTINCT programa_id)::int AS programas,
         sum(numero_apoyos)::int          AS numero_apoyos,
         sum(federal)                     AS federal,
         sum(estatal)                     AS estatal,
         sum(municipal)                   AS municipal,
         sum(beneficiario)                AS beneficiario,
         sum(total)                       AS total
  FROM analitica.vw_matriz_historica
  GROUP BY 1,2,3,4,5,6
)
SELECT a.*,
       CASE WHEN sum(a.total) OVER (PARTITION BY a.anio, a.municipio_id) IN (0) THEN NULL
            ELSE round(100.0 * a.total /
                 nullif(sum(a.total) OVER (PARTITION BY a.anio, a.municipio_id), 0), 2)
       END AS pct_total_del_anio_municipio
FROM agg a;

-- 3) Aportaciones Federal / Estatal / Municipal / Beneficiario
CREATE OR REPLACE VIEW analitica.vw_matriz_aportaciones AS
SELECT
  anio,
  CASE WHEN municipio_id IS NULL THEN 'DESCONOCIDO'
       WHEN region_id IS NULL THEN 'ESTATAL'
       ELSE 'MUNICIPIO' END                                   AS ambito,
  region,
  municipio_id,
  municipio,
  programa_id,
  programa,
  clasificacion,
  federal, estatal, municipal, beneficiario, total,
  round(100.0 * federal      / nullif(total,0), 2)            AS pct_federal,
  round(100.0 * estatal      / nullif(total,0), 2)            AS pct_estatal,
  round(100.0 * municipal    / nullif(total,0), 2)            AS pct_municipal,
  round(100.0 * beneficiario / nullif(total,0), 2)            AS pct_beneficiario,
  -- R1: si una parte es desconocida, la suma es desconocida (NULL), no cero.
  (federal + estatal + municipal + beneficiario)              AS suma_partes,
  -- cuadra = NULL cuando no se puede verificar (algún componente o el total es NULL).
  CASE WHEN total IS NULL
         OR federal IS NULL OR estatal IS NULL
         OR municipal IS NULL OR beneficiario IS NULL THEN NULL
       ELSE abs((federal + estatal + municipal + beneficiario) - total) <= 1.00
  END                                                         AS cuadra
FROM analitica.vw_matriz_historica;

-- 4) Género y edad por CURP (R6: las inválidas se cuentan aparte)
CREATE OR REPLACE VIEW analitica.vw_genero_edad AS
WITH base AS (
  SELECT bc.anio,
         CASE WHEN bc.municipio_id IS NULL THEN 'DESCONOCIDO' ELSE 'MUNICIPIO' END AS ambito,
         r.nombre AS region,
         bc.municipio_id,
         m.nombre AS municipio,
         bc.programa_id,
         p.nombre AS programa,
         bc.genero,
         bc.rango_edad,
         bc.curp_valida,
         bc.curp_hash
  FROM analitica.beneficiario_curp bc
  LEFT JOIN analitica.municipio m ON m.municipio_id = bc.municipio_id
  LEFT JOIN analitica.region r ON r.region_id = m.region_id
  LEFT JOIN analitica.programa p ON p.programa_id = bc.programa_id
),
agg AS (
  SELECT anio, ambito, region, municipio_id, municipio, programa_id, programa,
         genero, rango_edad,
         count(DISTINCT curp_hash)::int                                        AS personas,
         count(DISTINCT curp_hash) FILTER (WHERE curp_valida)::int             AS curps_validas,
         count(DISTINCT curp_hash) FILTER (WHERE NOT curp_valida)::int         AS curps_invalidas
  FROM base
  GROUP BY 1,2,3,4,5,6,7,8,9
)
SELECT a.*,
       round(100.0 * a.personas /
             nullif(sum(a.personas) OVER (PARTITION BY a.anio, a.municipio_id, a.programa_id), 0), 2)
         AS pct_del_grupo
FROM agg a;

-- 5) Incidencias enriquecidas
CREATE OR REPLACE VIEW analitica.vw_incidencias AS
SELECT i.incidencia_id, i.tipo, i.severidad, i.entidad, i.entidad_id, i.anio,
       i.municipio_id, m.nombre AS municipio, r.region_id, r.nombre AS region,
       i.programa_id, p.nombre AS programa,
       i.descripcion, i.valor_origen, i.accion_sugerida,
       i.fuente_archivo, i.fuente_hoja, i.fila_origen, i.resuelta, i.detectada_en
FROM analitica.incidencia_carga i
LEFT JOIN analitica.municipio m ON m.municipio_id = i.municipio_id
LEFT JOIN analitica.region r ON r.region_id = m.region_id
LEFT JOIN analitica.programa p ON p.programa_id = i.programa_id;

-- 6) Insumos de Glosa con bandera de completitud (R7)
CREATE OR REPLACE VIEW analitica.vw_insumos_glosa AS
SELECT g.*,
       m.nombre AS municipio,
       r.nombre AS region,
       p.nombre AS programa,
       (g.fuente_tabla IS NOT NULL AND g.fuente_vista IS NOT NULL
        AND g.fuente_archivo IS NOT NULL AND g.fuente_hoja IS NOT NULL
        AND g.criterio_calculo IS NOT NULL AND g.fecha_corte IS NOT NULL
        AND g.responsable IS NOT NULL AND g.verificado) AS completo
FROM analitica.glosa_insumo g
LEFT JOIN analitica.municipio m ON m.municipio_id = g.municipio_id
LEFT JOIN analitica.region r ON r.region_id = g.region_id
LEFT JOIN analitica.programa p ON p.programa_id = g.programa_id;
