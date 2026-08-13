-- 003_regla_gestion_riesgos.sql
-- El «PROGRAMA INSTITUCIONAL GESTIÓN DE RIESGOS» (2024) es emergente por su objeto
-- (administración de riesgos y protección de los sistemas de producción ante la
-- sequía: maíz para consumo humano, semilla forrajera, tinacos y viajes de agua),
-- pero su nombre no casa con ninguna de las reglas 10-50, así que el catch-all 900
-- lo dejaría en PRODUCTIVIDAD y `services.clasificacion --aplicar` revertiría el alta.
-- La clasificación no se edita a mano fila por fila (SPEC §6.1): se agrega la regla.

INSERT INTO analitica.programa_clasificacion_regla (orden, patron, clasificacion, criterio, fuente)
VALUES (
  25,
  'GESTI[OÓ]N DE RIESGOS|ADMINISTRACI[OÓ]N DE RIESGOS',
  'EMERGENTE',
  'Programa cuyo objeto declarado es la administración de riesgos y la protección de los '
  'sistemas de producción de alimentos y del sector forestal ante contingencias climatológicas. '
  'Es política de atención a emergencias, no de fomento a la productividad.',
  'Emergenes 2021-2024.xlsx, hoja «ResumenEstatalAdmón ok 2», renglón 2024 «Programa '
  'Institucional "Gestión de riesgos"» ($65,000,000).'
)
ON CONFLICT (orden) DO UPDATE
  SET patron = EXCLUDED.patron,
      clasificacion = EXCLUDED.clasificacion,
      criterio = EXCLUDED.criterio,
      fuente = EXCLUDED.fuente;
