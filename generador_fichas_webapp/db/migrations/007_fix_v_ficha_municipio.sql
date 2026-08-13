-- 007_fix_v_ficha_municipio.sql — corrige un defecto real de la vista existente:
-- omitía apoyo_federal, con lo que cualquier ficha construida sobre ella
-- presentaba "inversión" sin la parte federal (viola R3: monto total != estatal).
-- Se agrega la columna AL FINAL para no romper a ningún consumidor que lea por
-- posición; no se elimina ni se renombra nada.

CREATE OR REPLACE VIEW analitica.v_ficha_municipio AS
SELECT a.anio,
       m.nombre AS municipio,
       p.nombre AS programa,
       a.numero_apoyos,
       a.apoyo_estatal,
       a.apoyo_municipal,
       a.aportacion_productor,
       a.total,
       a.apoyo_federal
FROM analitica.apoyo_municipio a
JOIN analitica.municipio m USING (municipio_id)
JOIN analitica.programa p USING (programa_id);
