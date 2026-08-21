// Generación de Folio de Entrega con QR (Build 12).
// PDF A4 con datos del beneficiario + QR con el folio oficial.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { pool } from '../db/pool.js';

interface DatosFolioEntrega {
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  programa_nombre: string;
  proyecto_nombre: string;
  concepto_nombre: string;
  monto: number;
  domicilio_completo: string;
  regional_nombre: string;
  fecha_emision: string;
}

// La solicitud es la fuente de verdad: `beneficiarios` es derivado y puede no
// existir todavia, asi que todos los joins auxiliares son LEFT JOIN.
// El monto no vive en `tipos_apoyo`: se suma de `solicitud_conceptos`.
async function obtenerDatosFolio(solicitudId: number): Promise<DatosFolioEntrega | null> {
  const { rows } = await pool.query<DatosFolioEntrega>(
    `SELECT
       s.folio,
       s.nombre_solicitante AS beneficiario_nombre,
       coalesce(s.curp, '') AS beneficiario_curp,
       p.nombre AS programa_nombre,
       pr.nombre AS proyecto_nombre,
       coalesce(cn.conceptos, '') AS concepto_nombre,
       coalesce(cn.monto, 0)::float8 AS monto,
       -- El domicilio particular (2.2) es opcional; si viene vacio se usa la
       -- ubicacion del apoyo (4.1), cuyo municipio es NOT NULL.
       coalesce(
         nullif(concat_ws(', ',
           nullif(concat_ws(' ', s.dom_vialidad, s.dom_localidad), ''),
           nullif(s.dom_asentamiento, ''),
           md.nombre,
           nullif(s.dom_cp, '')
         ), ''),
         concat_ws(', ',
           nullif(s.ubi_localidad, ''),
           nullif(s.ubi_ejido, ''),
           mu.nombre
         )
       ) AS domicilio_completo,
       coalesce(r.nombre, '') AS regional_nombre,
       TO_CHAR(s.recibida_en, 'DD/MM/YYYY') AS fecha_emision
     FROM solicitudes s
     JOIN proyectos pr ON pr.id = s.proyecto_id
     JOIN programas p ON p.id = s.programa_id
     LEFT JOIN municipios md ON md.id = s.dom_municipio_id
     LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
     LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
     LEFT JOIN LATERAL (
       SELECT string_agg(ta.nombre, ', ' ORDER BY sc.orden) AS conceptos,
              sum(sc.monto_total) AS monto
         FROM solicitud_conceptos sc
         LEFT JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
        WHERE sc.solicitud_id = s.id
     ) cn ON TRUE
     WHERE s.id = $1`,
    [solicitudId]
  );
  return rows[0] || null;
}

export async function generarFolioEntregaPdf(solicitudId: number): Promise<Buffer> {
  const datos = await obtenerDatosFolio(solicitudId);
  if (!datos) throw new Error('Solicitud no encontrada');

  // Generar QR con el folio
  const qrDataUrl = await QRCode.toDataURL(datos.folio, {
    width: 200,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
  const qrImage = qrDataUrl.replace('data:image/png;base64,', '');

  // Crear PDF
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(chunk));

  // Encabezado
  doc.fontSize(16).font('Helvetica-Bold').text('SEDEA', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text('Secretaría de Desarrollo Agropecuario', { align: 'center' });
  doc.fontSize(14).font('Helvetica-Bold').text('FOLIO DE ENTREGA DE APOYO', { align: 'center' });
  doc.moveDown(0.5);

  // Folio destacado
  doc.fontSize(18).font('Helvetica-Bold').text(`Folio: ${datos.folio}`, { align: 'center' });
  doc.moveDown(1);

  // Datos del beneficiario
  doc.fontSize(12).font('Helvetica-Bold').text('DATOS DEL BENEFICIARIO');
  doc.fontSize(11).font('Helvetica').text(`Nombre: ${datos.beneficiario_nombre}`);
  doc.text(`CURP: ${datos.beneficiario_curp}`);
  doc.text(`Domicilio: ${datos.domicilio_completo}`);
  doc.text(`Regional: ${datos.regional_nombre}`);
  doc.moveDown(0.5);

  // Datos del apoyo
  doc.fontSize(12).font('Helvetica-Bold').text('DATOS DEL APOYO');
  doc.fontSize(11).font('Helvetica').text(`Programa: ${datos.programa_nombre}`);
  doc.text(`Proyecto: ${datos.proyecto_nombre}`);
  doc.text(`Concepto: ${datos.concepto_nombre}`);
  doc.text(`Monto: $${datos.monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`);
  doc.moveDown(1);

  // QR centrado
  const pageWidth = doc.page.width;
  const qrSize = 150;
  const qrX = (pageWidth - qrSize) / 2;
  doc.image(Buffer.from(qrImage, 'base64'), qrX, doc.y, { width: qrSize });
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica-Oblique').text(
    'Escanee este código QR para verificar la entrega del apoyo',
    { align: 'center' }
  );
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica').text(
    `Fecha de emisión: ${datos.fecha_emision}`,
    { align: 'center' }
  );

  // Pie de página
  doc.fontSize(8).font('Helvetica-Oblique').text(
    'Este documento debe presentarse al momento de recibir el apoyo',
    { align: 'center' }
  );

  // PDFKit vacia el stream de forma asincrona: hay que esperar el 'end' o el
  // buffer sale truncado/vacio.
  const listo = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  doc.end();
  await listo;
  return Buffer.concat(chunks);
}
