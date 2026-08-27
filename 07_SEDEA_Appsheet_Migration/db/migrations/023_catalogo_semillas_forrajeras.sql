-- 023_catalogo_semillas_forrajeras.sql
-- Alta del arbol de catalogo para "Semillas para el establecimiento de
-- cultivos forrajeros" (avena y garbanzo), Programa Apoyo al Campo
-- Queretano 2026. Los tipos_apoyo CFA-AVENA/CFG-GARBANZO ya existian
-- (migracion 022); aqui se completa la jerarquia Subprograma -> Componente
-- -> Proyectos y las reglas de documentos requeridos, siguiendo exactamente
-- las claves del instructivo oficial (Pasos_Alta_Avena_Garbanzo.docx).
--
-- Aditiva e idempotente (ON CONFLICT DO UPDATE / WHERE NOT EXISTS).

-- Subprograma
INSERT INTO subprogramas (programa_id, clave, nombre, activo)
SELECT p.id, 'SUB-CONT', 'Prevención y atención a contingencias', TRUE
FROM programas p WHERE p.clave = 'PRG-2026'
ON CONFLICT (programa_id, clave) DO UPDATE
  SET nombre = EXCLUDED.nombre, activo = EXCLUDED.activo;

-- Componente
INSERT INTO componentes (clave, nombre, activo) VALUES
  ('CONT', 'Atención a contingencias del sector agroalimentario', TRUE)
ON CONFLICT (clave) DO UPDATE
  SET nombre = EXCLUDED.nombre, activo = EXCLUDED.activo;

-- Proyectos (avena y garbanzo), ligados al componente CONT
INSERT INTO proyectos (clave, nombre, prefijo_folio, componente_id, modalidad_id, activo)
SELECT v.clave, v.nombre, v.prefijo_folio, c.id, NULL, TRUE
FROM (VALUES
    ('CFA', 'Compra y distribución de semilla de avena para cultivos forrajeros', 'CFA'),
    ('CFG', 'Compra y distribución de semilla de garbanzo para cultivos forrajeros', 'CFG')
  ) AS v(clave, nombre, prefijo_folio)
JOIN componentes c ON c.clave = 'CONT'
ON CONFLICT (clave) DO UPDATE
  SET nombre = EXCLUDED.nombre, prefijo_folio = EXCLUDED.prefijo_folio,
      componente_id = EXCLUDED.componente_id, activo = TRUE;

-- Documentos requeridos: los 6 requisitos oficiales, texto verbatim del
-- documento "Requisitos de acceso para los beneficiarios". Aplican al
-- componente CONT completo (avena y garbanzo por igual); el ultimo solo a
-- persona moral/grupo, que es como se organizan los beneficiarios de este
-- proyecto.
INSERT INTO documentos_requeridos (requisito, componentes, tipos_persona, orden, activo)
SELECT r.requisito, ARRAY['CONT'], r.tipos_persona, r.orden, TRUE
FROM (VALUES
    ('Solicitud en original;', NULL::text[], 100),
    ('Identificación oficial vigente con fotografía del solicitante (INE o pasaporte);', NULL::text[], 101),
    ('Clave única de registro de población (CURP);', NULL::text[], 102),
    ('Comprobante de domicilio con una vigencia no mayor a 03 (tres) meses de la fecha de la solicitud (recibo de luz, teléfono, agua, comprobante de pago del Impuesto Predial o constancia de residencia expedida por la autoridad competente);', NULL::text[], 103),
    ('Croquis de localización del predio con referencias; y', NULL::text[], 104),
    ('documento que justifique que el predio donde se desarrollará el proyecto o superficie a beneficiar pertenece o está en posesión de un integrante de la persona moral y está ubicado dentro del Estado, pudiendo ser, Instrumento Público que acredite la legal propiedad, tales como, donación, compraventa, título de propiedad; certificado parcelario; contrato privado con el que se acredite contar con la legítima posesión del inmueble, tales como, usufructo, arrendamiento, comodato, promesa de venta, en el caso de dichos contratos privados, éstos deberán estar notariados y/o certificados ante fedatario público; para zonas consideradas oficialmente como indígenas, podrán comprobar la acreditación de la propiedad con una constancia de posesión o minuta del predio, emitida por autoridad local obedeciendo a sus usos y costumbres; cualquier otro supuesto se podrá acreditar con constancia de posesión, lo que quedará a consideración del Comité Técnico Dictaminador.', ARRAY['moral','grupo'], 105)
  ) AS r(requisito, tipos_persona, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM documentos_requeridos d
  WHERE d.requisito = r.requisito AND d.componentes = ARRAY['CONT']
);
