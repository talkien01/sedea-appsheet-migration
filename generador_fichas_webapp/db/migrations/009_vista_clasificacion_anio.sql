-- 009_vista_clasificacion_anio.sql — la matriz usa la clasificación EFECTIVA:
-- la excepción por ejercicio de analitica.programa_clasificacion_anio gana sobre
-- analitica.programa.clasificacion, y solo en el año declarado.
--
-- Es un CREATE OR REPLACE de vw_matriz_historica: mismas columnas, mismo orden,
-- mismos tipos que 006_vistas.sql. Las otras 5 vistas se derivan de esta y por lo
-- tanto heredan la clasificación efectiva sin tocarlas.

CREATE OR REPLACE VIEW analitica.vw_matriz_historica AS
WITH curp_agg AS (
  SELECT anio, municipio_id, programa_id, count(DISTINCT curp_hash) AS beneficiarios_unicos
  FROM analitica.beneficiario_curp
  GROUP BY anio, municipio_id, programa_id
),
base AS (
  SELECT
    am.anio::int                                   AS anio,
    m.municipio_id::int                            AS municipio_id,
    m.nombre                                       AS municipio,
    coalesce(am.municipio_usado, m.nombre)         AS municipio_usado,
    am.fuente_municipio                            AS fuente_municipio,
    am.programa_id::int                            AS programa_id,
    p.nombre                                       AS programa,
    coalesce(ca.clasificacion, p.clasificacion)    AS clasificacion,
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
  LEFT JOIN analitica.programa_clasificacion_anio ca
         ON ca.programa_id = am.programa_id AND ca.anio = am.anio
  GROUP BY 1,2,3,4,5,6,7,8

  UNION ALL

  SELECT
    a.anio::int,
    m.municipio_id::int,
    m.nombre,
    coalesce(a.municipio_usado, m.nombre),
    a.fuente_municipio,
    a.programa_id::int,
    p.nombre,
    coalesce(ca.clasificacion, p.clasificacion),
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
  LEFT JOIN analitica.programa_clasificacion_anio ca
         ON ca.programa_id = a.programa_id AND ca.anio = a.anio
  GROUP BY 1,2,3,4,5,6,7,8

  UNION ALL

  SELECT
    o.anio::int,
    m.municipio_id::int,
    m.nombre,
    o.municipio_proyecto,
    CASE WHEN m.nombre = o.municipio_proyecto THEN 'EXPLICITO' ELSE 'ALIAS' END,
    p.programa_id::int,
    coalesce(p.nombre, o.componente),
    coalesce(ca.clasificacion, p.clasificacion, 'NO_CLASIFICADO'),
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
  LEFT JOIN analitica.programa_clasificacion_anio ca
         ON ca.programa_id = p.programa_id AND ca.anio = o.anio
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
