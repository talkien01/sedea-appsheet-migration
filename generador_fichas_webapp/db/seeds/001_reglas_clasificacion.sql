-- Reglas de clasificación Emergentes/Productividad (orden ascendente; gana la primera que casa).
-- Reclasificar = actualizar estas reglas y volver a correr `python -m services.clasificacion --aplicar`.

INSERT INTO analitica.programa_clasificacion_regla (orden, patron, clasificacion, criterio, fuente)
VALUES
  (10, 'EMERGENTE', 'EMERGENTE',
   'El nombre del programa declara explícitamente que es un programa emergente.',
   'Nomenclatura oficial de programas SEDEA (analitica.programa)'),
  (20, 'CONTINGENCIA|SINIESTR|SEQU[IÍ]A|HELADA|DESASTRE|ATÍPIC|ATIPIC|AFECTACION|AFECTACIÓN', 'EMERGENTE',
   'Atiende un evento climatológico o siniestro: gasto reactivo, no de fomento a la productividad.',
   'Criterio de política pública SEDEA confirmado con el área (2026-08-12)'),
  (30, 'SEGURO ', 'EMERGENTE',
   'Los seguros agrícolas y pecuarios catastróficos cubren pérdidas, no incrementan capacidad productiva.',
   'Criterio de política pública SEDEA confirmado con el área (2026-08-12)'),
  (40, 'LIQUID[EÉ]Z|APOYO ECON[OÓ]MICO PARA LIQUID', 'EMERGENTE',
   'Apoyo de liquidez: transferencia para sostener al productor ante una caída, no inversión productiva.',
   'Criterio de política pública SEDEA confirmado con el área (2026-08-12)'),
  (50, 'SANIDAD|INOCUIDAD|BRIGADAS COMUNITARIAS', 'EMERGENTE',
   'Sanidad e inocuidad operan como contención de riesgo fitozoosanitario.',
   'Criterio de política pública SEDEA confirmado con el área (2026-08-12)'),
  (900, '.*', 'PRODUCTIVIDAD',
   'Regla por defecto: todo lo que no cae en un supuesto emergente se contabiliza como productividad, y se marca con incidencia PROGRAMA_CLASIFICADO_POR_DEFECTO para revisión humana.',
   'Acuerdo de trabajo: catch-all auditable, nunca silencioso')
ON CONFLICT (orden) DO UPDATE
  SET patron = EXCLUDED.patron,
      clasificacion = EXCLUDED.clasificacion,
      criterio = EXCLUDED.criterio,
      fuente = EXCLUDED.fuente;
