-- =====================================================================
-- Exportación completa del esquema analitica (SEDEA) para mapear
-- contra los campos del machote de fichas (F0001...F0536).
-- Correr una sola vez vía: docker exec -it sedea_db psql -U sedea_admin -d sedea -f exportar_analitica.sql
-- Genera CSVs en /tmp dentro del contenedor; luego copiarlos afuera con:
--   docker cp sedea_db:/tmp/analitica_export ./analitica_export
-- =====================================================================

\! mkdir -p /tmp/analitica_export

-- Catálogos (chicos, dan contexto a todo lo demás)
\copy (SELECT * FROM analitica.region ORDER BY region_id) TO '/tmp/analitica_export/00_region.csv' CSV HEADER
\copy (SELECT * FROM analitica.municipio ORDER BY region_id, municipio_id) TO '/tmp/analitica_export/01_municipio.csv' CSV HEADER
\copy (SELECT * FROM analitica.municipio_alias ORDER BY municipio_id) TO '/tmp/analitica_export/02_municipio_alias.csv' CSV HEADER
\copy (SELECT * FROM analitica.programa ORDER BY programa_id) TO '/tmp/analitica_export/03_programa.csv' CSV HEADER
\copy (SELECT * FROM analitica.programa_alias ORDER BY programa_id) TO '/tmp/analitica_export/04_programa_alias.csv' CSV HEADER

-- Núcleo: apoyos por municipio, año y programa (base de las fichas regionales/municipales)
\copy (
  SELECT am.*, p.nombre AS programa_nombre, p.categoria, m.nombre AS municipio_nombre, r.nombre AS region_nombre
  FROM analitica.apoyo_municipio am
  JOIN analitica.programa p USING (programa_id)
  JOIN analitica.municipio m USING (municipio_id)
  JOIN analitica.region r USING (region_id)
  ORDER BY r.nombre, m.nombre, am.anio, p.nombre
) TO '/tmp/analitica_export/05_apoyo_municipio_full.csv' CSV HEADER

-- Métricas adicionales por apoyo (toneladas, hectáreas, cabezas, etc.)
\copy (SELECT * FROM analitica.apoyo_metrica ORDER BY apoyo_id, metrica) TO '/tmp/analitica_export/06_apoyo_metrica.csv' CSV HEADER

-- Resumen estatal por programa y año (base de la ficha ESTATAL)
\copy (
  SELECT re.*, p.nombre AS programa_nombre, p.categoria
  FROM analitica.resumen_estatal re
  JOIN analitica.programa p USING (programa_id)
  ORDER BY re.anio, p.nombre
) TO '/tmp/analitica_export/07_resumen_estatal_full.csv' CSV HEADER

-- Detalle de obras/acciones (útil para 'top proyectos' o detalle por localidad)
\copy (
  SELECT a.*, p.nombre AS programa_nombre, m.nombre AS municipio_nombre
  FROM analitica.accion a
  JOIN analitica.programa p USING (programa_id)
  JOIN analitica.municipio m USING (municipio_id)
  ORDER BY a.anio, m.nombre
) TO '/tmp/analitica_export/08_accion_full.csv' CSV HEADER

-- Demografía de beneficiarios (OJO: solo por programa/año, NO por municipio)
\copy (
  SELECT bd.*, p.nombre AS programa_nombre
  FROM analitica.beneficiarios_demografia bd
  JOIN analitica.programa p USING (programa_id)
  ORDER BY bd.anio, p.nombre
) TO '/tmp/analitica_export/09_beneficiarios_demografia.csv' CSV HEADER

-- Vistas ya agregadas / listas para ficha
\copy (SELECT * FROM analitica.v_ficha_municipio ORDER BY anio, municipio, programa) TO '/tmp/analitica_export/10_v_ficha_municipio.csv' CSV HEADER
\copy (SELECT * FROM analitica.v_ficha_programa_anio ORDER BY anio, programa) TO '/tmp/analitica_export/11_v_ficha_programa_anio.csv' CSV HEADER
\copy (SELECT * FROM analitica.v_inversion_anual ORDER BY anio) TO '/tmp/analitica_export/12_v_inversion_anual.csv' CSV HEADER

-- Vistas 'oficial' (traen desglose H/M por componente, municipio y región - cubren huecos de demografía)
\copy (SELECT * FROM analitica.v_oficial_componente ORDER BY anio, componente) TO '/tmp/analitica_export/13_v_oficial_componente.csv' CSV HEADER
\copy (SELECT * FROM analitica.v_oficial_municipio ORDER BY anio, municipio_proyecto, componente) TO '/tmp/analitica_export/14_v_oficial_municipio.csv' CSV HEADER
\copy (SELECT * FROM analitica.v_oficial_region ORDER BY anio, regional, componente) TO '/tmp/analitica_export/15_v_oficial_region.csv' CSV HEADER

\echo 'Listo. Archivos en /tmp/analitica_export dentro del contenedor.'
\echo 'Cópialos afuera con: docker cp sedea_db:/tmp/analitica_export ./analitica_export'
