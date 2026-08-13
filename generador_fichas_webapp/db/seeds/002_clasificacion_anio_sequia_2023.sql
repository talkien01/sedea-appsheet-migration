-- 002_clasificacion_anio_sequia_2023.sql
-- Reclasificación ACOTADA a EMERGENTE de las entregas de pacas forrajeras y
-- suplementos que fueron respuesta a la sequía 2023.
--
-- Por qué no se cambia analitica.programa.clasificacion:
--   programa.clasificacion es un valor único por programa para todos los años y
--   services/clasificacion.py lo reescribe entero desde programa_clasificacion_regla
--   en cada corrida. Marcar "PACAS FORRAJERAS" como EMERGENTE ahí contaminaría las
--   entregas rutinarias del mismo programa en otros ejercicios (p. ej. PACAS Y
--   SUPLEMENTOS 2025) y el siguiente `--aplicar` lo borraría.
-- Por qué no se usa programa_clasificacion_regla.vigente_desde:
--   esa columna versiona *desde cuándo rige la regla*, no *a qué ejercicio del apoyo
--   aplica*; el consumidor (services/clasificacion.py) no la lee y su UPDATE no tiene
--   dimensión de año.
-- Mecanismo correcto: una excepción por (programa_id, anio) en
--   analitica.programa_clasificacion_anio, que vw_matriz_historica prefiere sobre
--   programa.clasificacion solo en ese año.

INSERT INTO analitica.programa_clasificacion_anio
  (programa_id, anio, clasificacion, criterio, fuente)
SELECT p.programa_id, 2023, 'EMERGENTE',
       'Entrega 2023 de pacas forrajeras/suplementos otorgada como respuesta a la contingencia '
       'de sequía 2023 (Programa de Protección y Desarrollo Agroalimentario, conceptos: pacas '
       'forrajeras para ganado, viajes de agua uso pecuario, alimentos concentrados). La '
       'clasificación base del catálogo se conserva en PRODUCTIVIDAD para el resto de los '
       'ejercicios, donde el mismo programa opera como entrega rutinaria.',
       'Emergenes 2021-2024.xlsx, hoja «ResumenEstatalAdmón ok», renglón «PACAS FORRAJERAS y '
       'viajes de agua (2)» del bloque TOTAL 2023 ($5,000,000 / 2,415 apoyos), y hoja '
       '«ResumenEstatalAdmón ok 2», renglón 2023 «Programa de Protección y Desarrollo '
       'Agroalimentario».'
FROM analitica.programa p
-- Solo los programas de PACAS forrajeras/suplementos (ids 40, 69, 115, 227, 610).
-- «EMPACADORA» (maquinaria) queda fuera a propósito: no es entrega de forraje.
WHERE p.nombre ~* 'PACAS'
ON CONFLICT (programa_id, anio) DO UPDATE
  SET clasificacion = EXCLUDED.clasificacion,
      criterio      = EXCLUDED.criterio,
      fuente        = EXCLUDED.fuente;
