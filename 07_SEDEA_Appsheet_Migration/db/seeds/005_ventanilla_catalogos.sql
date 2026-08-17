-- 005_ventanilla_catalogos.sql
-- Build 6: catalogos del modulo de ventanilla. Idempotente: se puede correr
-- muchas veces sobre una base con datos y siempre deja el mismo resultado.
-- No modifica ningun seed anterior.

-- ---------------------------------------------------------------------------
-- Programa y subprograma (1 fila cada uno).
-- ---------------------------------------------------------------------------
INSERT INTO programas (clave, nombre) VALUES
  ('PRG-2026', 'Apoyo al Campo Queretano 2026')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

INSERT INTO subprogramas (programa_id, clave, nombre)
SELECT p.id, 'SUB-IP', 'Impulso a la Productividad'
  FROM programas p WHERE p.clave = 'PRG-2026'
ON CONFLICT (programa_id, clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- ---------------------------------------------------------------------------
-- Los 3 componentes del programa.
-- ---------------------------------------------------------------------------
INSERT INTO componentes (clave, nombre) VALUES
  ('TR',  'Tecnificación del Riego'),
  ('CAA', 'Captación y Almacenamiento de Agua'),
  ('DIN', 'Dinamismo Agroalimentario')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- ---------------------------------------------------------------------------
-- Proyecto PEO. componente_id se deja en NULL a proposito (Assumption 45):
-- el anexo aplica con cualquier componente.
-- ---------------------------------------------------------------------------
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id) VALUES
  ('PEO', 'Proyectos Estratégicos para el Fortalecimiento Organizativo', 'PEO', NULL)
ON CONFLICT (clave) DO UPDATE SET
  nombre        = EXCLUDED.nombre,
  prefijo_folio = EXCLUDED.prefijo_folio,
  componente_id = NULL,
  activo        = TRUE;

-- ---------------------------------------------------------------------------
-- Clave de folio de cada Direccion Regional.
-- ---------------------------------------------------------------------------
UPDATE direcciones_regionales SET clave_folio = v.clave_folio
  FROM (VALUES
    ('REG-01', 'CAD'),
    ('REG-02', 'JAL'),
    ('REG-03', 'QRO'),
    ('REG-04', 'SJR')
  ) AS v(clave, clave_folio)
 WHERE direcciones_regionales.clave = v.clave;

-- ---------------------------------------------------------------------------
-- Las 5 ventanillas receptoras. La central (SEDEA) hereda REG-03 para los
-- beneficiarios que crea, porque beneficiarios.regional_id es NOT NULL
-- (Assumption 49), pero su segmento de folio es SED, distinguible de QRO.
-- ---------------------------------------------------------------------------
INSERT INTO ventanillas (clave, nombre, regional_id, clave_folio, es_central)
SELECT v.clave, v.nombre, r.id, v.clave_folio, v.es_central
  FROM (VALUES
    ('VEN-QRO', 'Regional Querétaro',       'REG-03', 'QRO', FALSE),
    ('VEN-SJR', 'Regional San Juan del Río','REG-04', 'SJR', FALSE),
    ('VEN-CAD', 'Regional Cadereyta',       'REG-01', 'CAD', FALSE),
    ('VEN-JAL', 'Regional Jalpan',          'REG-02', 'JAL', FALSE),
    ('VEN-SED', 'SEDEA (Central)',          'REG-03', 'SED', TRUE)
  ) AS v(clave, nombre, reg, clave_folio, es_central)
  JOIN direcciones_regionales r ON r.clave = v.reg
ON CONFLICT (clave) DO UPDATE SET
  nombre      = EXCLUDED.nombre,
  regional_id = EXCLUDED.regional_id,
  clave_folio = EXCLUDED.clave_folio,
  es_central  = EXCLUDED.es_central,
  activo      = TRUE;

-- ---------------------------------------------------------------------------
-- Siglas de folio de los municipios. Amealco se siembra explicitamente porque
-- es el caso del folio de ejemplo real (PEO-SJR-AME-0001-26); el resto se
-- llena con el MISMO fallback determinista de 12.5: sin acentos, mayusculas,
-- solo A-Z, primeros 3 caracteres, relleno con X si faltan.
-- ---------------------------------------------------------------------------
UPDATE municipios SET siglas_folio = 'AME' WHERE nombre LIKE 'Amealco%';

UPDATE municipios
   SET siglas_folio = rpad(
         substr(
           regexp_replace(
             translate(upper(nombre), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
             '[^A-Z]', '', 'g'
           ), 1, 3), 3, 'X')
 WHERE siglas_folio IS NULL OR length(siglas_folio) <> 3;

-- ---------------------------------------------------------------------------
-- Las 42 reglas de documentacion: 34 de la hoja DOCUMENTACION + 8 del anexo
-- PEO. La clave natural para la idempotencia es
-- (requisito, tipos_persona, proyecto_id): las filas 32-34 comparten texto a
-- proposito y se distinguen por el tipo de persona.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS tmp_reglas_documentos;
CREATE TEMP TABLE tmp_reglas_documentos (
  requisito               TEXT,
  componentes             TEXT[],
  tipos_persona           TEXT[],
  es_peo                  BOOLEAN,
  apoyo_etiquetas         TEXT[],
  apoyo_excluir_etiquetas TEXT[],
  orden                   INTEGER
);

INSERT INTO tmp_reglas_documentos VALUES
  -- 1..34: hoja DOCUMENTACION (SRT del Excel real => componente TR).
  ('Acreditar pertenencia a grupo de productores', ARRAY['DIN'], ARRAY['grupo'], FALSE, ARRAY['TRACTORES','PESCA'], NULL, 1),
  ('Acta constitutiva', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 2),
  ('Acta que acredite al representante legal con facultades vigentes', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 3),
  ('CURP', ARRAY['DIN','CAA','TR'], ARRAY['fisica'], FALSE, NULL, NULL, 4),
  ('CURP del representante de grupo de productores', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 5),
  ('CURP del representante legal', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 6),
  ('Comprobante de domicilio (vigencia no mayor a 3 meses)', ARRAY['DIN','CAA','TR'], ARRAY['fisica'], FALSE, NULL, NULL, 7),
  ('Comprobante de domicilio de la persona moral y/o representante legal', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 8),
  ('Comprobante de domicilio del representante de grupo de productores', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 9),
  ('Constancia de situación fiscal', ARRAY['DIN','CAA','TR'], ARRAY['fisica'], FALSE, NULL, NULL, 10),
  ('Constancia de situación fiscal de la persona moral', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 11),
  ('Constancia de situación fiscal del representante de grupo de productores', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 12),
  ('Constancia Unidad de Producción Pecuaria (UPP)', ARRAY['DIN'], ARRAY['fisica','grupo','moral'], FALSE, ARRAY['PROYECTOS PECUARIOS'], NULL, 13),
  ('Copia del título de concesión de derechos de agua vigente o resolución positiva', ARRAY['TR'], ARRAY['fisica','grupo','moral'], FALSE, NULL, NULL, 14),
  ('Cotizaciones', ARRAY['DIN','TR','CAA'], ARRAY['fisica','moral','grupo'], FALSE, NULL, ARRAY['FERTILIZANTES','MATERIAL VEGETATIVO','SEMILLA','PAQUETE TECNOLOGICO'], 15),
  ('Croquis de localización del predio con referencias', ARRAY['DIN'], ARRAY['fisica','moral','grupo'], FALSE, NULL, NULL, 16),
  ('Dictámenes zoosanitarios', ARRAY['DIN'], ARRAY['fisica','grupo','moral'], FALSE, ARRAY['PROYECTOS PECUARIOS'], NULL, 17),
  ('Documento que acredite la integración del grupo de productores, con representante designado', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 18),
  ('Evidencia fotográfica', ARRAY['DIN'], ARRAY['fisica','grupo','moral'], FALSE, ARRAY['REHABILITACION DE INVERNADEROS'], NULL, 19),
  ('Factura del insumo', ARRAY['DIN'], ARRAY['fisica','grupo','moral'], FALSE, ARRAY['FERTILIZANTES','MATERIAL VEGETATIVO','SEMILLA','PAQUETE TECNOLOGICO'], NULL, 20),
  ('Fotografías de la fuente de abastecimiento de agua / medidor volumétrico', ARRAY['TR'], ARRAY['fisica','grupo','moral'], FALSE, NULL, NULL, 21),
  ('Identificación oficial vigente con fotografía', ARRAY['DIN','CAA','TR'], ARRAY['fisica'], FALSE, NULL, NULL, 22),
  ('Identificación oficial vigente del representante del grupo de productores', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 23),
  ('Identificación oficial vigente del representante legal', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 24),
  ('Instrumento público que acredite propiedad/usufructo/posesión del predio', ARRAY['DIN','CAA','TR'], ARRAY['fisica','grupo'], FALSE, NULL, ARRAY['PESCA','APICULTURA'], 25),
  ('Instrumento público que acredite propiedad/usufructo/posesión del predio (grupo)', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 26),
  ('Listado de integrantes del grupo de productores', ARRAY['CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 27),
  ('Permiso de pesca vigente', ARRAY['DIN'], ARRAY['fisica','grupo','moral'], FALSE, ARRAY['PESCA'], NULL, 28),
  ('Proyecto Ejecutivo', ARRAY['TR','CAA'], ARRAY['fisica','grupo','moral'], FALSE, NULL, NULL, 29),
  ('Relación de beneficiarios directos de la persona moral, con documentos de cada uno', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 30),
  ('Relación de beneficiarios directos del grupo de productores, con documentos de cada uno', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 31),
  ('Solicitud en original', ARRAY['DIN','CAA','TR'], ARRAY['fisica'], FALSE, NULL, NULL, 32),
  ('Solicitud en original', ARRAY['DIN','TR'], ARRAY['moral'], FALSE, NULL, NULL, 33),
  ('Solicitud en original', ARRAY['DIN','TR','CAA'], ARRAY['grupo'], FALSE, NULL, NULL, 34),
  -- 35..42: anexo PEO. componentes NULL = aplican con cualquier componente.
  ('Solicitud mediante escrito libre dirigida al Titular de la Secretaría', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 35),
  ('Ficha técnica', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 36),
  ('Acta de integración del grupo de productores', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 37),
  ('Identificación oficial vigente con fotografía del representante', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 38),
  ('CURP del representante', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 39),
  ('Constancia de Situación Fiscal del representante', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 40),
  ('Comprobante de domicilio del representante', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 41),
  ('Relación de beneficiarios directos', NULL, ARRAY['grupo'], TRUE, NULL, NULL, 42);

-- Actualiza las reglas que ya existian (mismo texto, tipo de persona y proyecto).
UPDATE documentos_requeridos d
   SET componentes             = t.componentes,
       apoyo_etiquetas         = t.apoyo_etiquetas,
       apoyo_excluir_etiquetas = t.apoyo_excluir_etiquetas,
       orden                   = t.orden,
       activo                  = TRUE
  FROM tmp_reglas_documentos t
  LEFT JOIN proyectos p ON p.clave = 'PEO'
 WHERE d.requisito = t.requisito
   AND d.tipos_persona IS NOT DISTINCT FROM t.tipos_persona
   AND d.proyecto_id IS NOT DISTINCT FROM (CASE WHEN t.es_peo THEN p.id ELSE NULL END);

-- Inserta las que falten.
INSERT INTO documentos_requeridos
  (requisito, componentes, tipos_persona, proyecto_id, apoyo_etiquetas, apoyo_excluir_etiquetas, orden)
SELECT t.requisito, t.componentes, t.tipos_persona,
       CASE WHEN t.es_peo THEN p.id ELSE NULL END,
       t.apoyo_etiquetas, t.apoyo_excluir_etiquetas, t.orden
  FROM tmp_reglas_documentos t
  LEFT JOIN proyectos p ON p.clave = 'PEO'
 WHERE NOT EXISTS (
   SELECT 1 FROM documentos_requeridos d
    WHERE d.requisito = t.requisito
      AND d.tipos_persona IS NOT DISTINCT FROM t.tipos_persona
      AND d.proyecto_id IS NOT DISTINCT FROM (CASE WHEN t.es_peo THEN p.id ELSE NULL END)
 );

-- Cualquier regla sobrante de una carga previa se desactiva (nunca se borra:
-- puede estar referenciada por solicitudes ya recibidas).
UPDATE documentos_requeridos d
   SET activo = FALSE
 WHERE d.activo
   AND NOT EXISTS (
   SELECT 1
     FROM tmp_reglas_documentos t
     LEFT JOIN proyectos p ON p.clave = 'PEO'
    WHERE d.requisito = t.requisito
      AND d.tipos_persona IS NOT DISTINCT FROM t.tipos_persona
      AND d.proyecto_id IS NOT DISTINCT FROM (CASE WHEN t.es_peo THEN p.id ELSE NULL END)
 );

DROP TABLE tmp_reglas_documentos;
