-- 008_emergentes.sql — soporte para la carga de programas EMERGENTES 2021-2024.
-- Aditiva: no toca ninguna tabla, columna ni vista preexistente.
--
-- Motivación (diagnóstico previo):
--   1. Había 0 apoyos clasificados EMERGENTE para 2022-2026 aunque sí existieron
--      programas emergentes reales (sequía, seguros catastróficos, emergente pecuario).
--   2. Dos programas del periodo no estaban en el catálogo.
--   3. Parte de lo emergente solo existe como AGREGADO (sin padrón folio por folio);
--      eso se marca explícitamente y nunca se mezcla en silencio con datos de folio (R1/R8).

-- ---------------------------------------------------------------------------
-- 1) Granularidad y observaciones del dato en apoyo_municipio
-- ---------------------------------------------------------------------------
-- granularidad = FOLIO   -> la fila se derivó de un padrón folio por folio
-- granularidad = AGREGADO-> la fila viene de un resumen; NO hay padrón individual
ALTER TABLE analitica.apoyo_municipio
  ADD COLUMN IF NOT EXISTS granularidad text,
  ADD COLUMN IF NOT EXISTS observaciones text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'apoyo_municipio_granularidad_chk') THEN
    ALTER TABLE analitica.apoyo_municipio
      ADD CONSTRAINT apoyo_municipio_granularidad_chk
      CHECK (granularidad IS NULL OR granularidad IN ('FOLIO','AGREGADO'));
  END IF;
END$$;

COMMENT ON COLUMN analitica.apoyo_municipio.granularidad IS
  'FOLIO = derivado de padrón individual; AGREGADO = solo hay resumen, no existe padrón folio por folio.';
COMMENT ON COLUMN analitica.apoyo_municipio.observaciones IS
  'Nota de auditoría de la fila (p. ej. que es un agregado sin folio individual).';

-- ---------------------------------------------------------------------------
-- 2) Clasificación EMERGENTE/PRODUCTIVIDAD acotada por ejercicio
-- ---------------------------------------------------------------------------
-- analitica.programa_clasificacion_regla (006/seed 001) decide
-- analitica.programa.clasificacion, que es UN valor por programa para TODOS los
-- años: no tiene dimensión de ejercicio y services/clasificacion.py la reescribe
-- completa en cada corrida. Por eso no sirve para "estas pacas forrajeras fueron
-- respuesta a la sequía 2023 pero las de otros años son entrega rutinaria".
-- Esta tabla es la excepción por ejercicio; gana sobre programa.clasificacion
-- solo en los años declarados, y services/clasificacion.py nunca la toca.
CREATE TABLE IF NOT EXISTS analitica.programa_clasificacion_anio (
  regla_id      serial PRIMARY KEY,
  programa_id   int  NOT NULL REFERENCES analitica.programa(programa_id),
  anio          int  NOT NULL,
  clasificacion text NOT NULL CHECK (clasificacion IN ('EMERGENTE','PRODUCTIVIDAD')),
  criterio      text NOT NULL CHECK (char_length(criterio) >= 20),
  fuente        text NOT NULL,
  vigente_desde date NOT NULL DEFAULT current_date,
  UNIQUE (programa_id, anio)
);

COMMENT ON TABLE analitica.programa_clasificacion_anio IS
  'Excepción de clasificación acotada a un ejercicio. Prevalece sobre programa.clasificacion '
  'únicamente en el año declarado. Se usa para eventos (sequía 2023) que reclasifican una '
  'entrega concreta sin contaminar las entregas rutinarias del mismo programa en otros años.';

-- ---------------------------------------------------------------------------
-- 3) Programas emergentes faltantes en el catálogo
-- ---------------------------------------------------------------------------
INSERT INTO analitica.programa (nombre, clasificacion, clasificacion_criterio,
                                clasificacion_fuente, clasificado_en)
SELECT v.nombre, 'EMERGENTE', v.criterio, v.fuente, now()
FROM (VALUES
  ('PROGRAMA INSTITUCIONAL EMERGENTE POR SEQUÍA PARA PRODUCTORES DEL CAMPO',
   'Programa institucional de atención a la contingencia de sequía 2023 (maíz para consumo '
   'humano). Casa además con las reglas 10 (EMERGENTE) y 20 (SEQUÍA) de '
   'analitica.programa_clasificacion_regla.',
   'Oficio de autorización 2023GEQ00040, proyecto 2023-00007, Secretaría de Finanzas, '
   '24 de enero de 2023.'),
  ('PROGRAMA INSTITUCIONAL GESTIÓN DE RIESGOS',
   'Programa institucional 2024 de administración de riesgos y protección a los sistemas de '
   'producción de alimentos (maíz para consumo humano, semilla forrajera, tinacos y viajes de '
   'agua) derivado de la contingencia de sequía.',
   'Emergenes 2021-2024.xlsx, hoja «ResumenEstatalAdmón ok 2», fila 2024.')
) AS v(nombre, criterio, fuente)
WHERE NOT EXISTS (
  SELECT 1 FROM analitica.programa p WHERE upper(p.nombre) = upper(v.nombre)
);
