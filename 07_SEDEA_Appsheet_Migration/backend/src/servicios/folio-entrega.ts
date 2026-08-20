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

async function obtenerDatosFolio(solicitudId: number): Promise<DatosFolioEntrega | null> {
  const { rows } = await pool.query<DatosFolioEntrega>(
    `SELECT
       s.folio,
       b.nombre_completo AS beneficiario_nombre,
       b.curp AS beneficiario_curp,
       p.nombre AS programa_nombre,
       pr.nombre AS proyecto_nombre,
       ta.nombre AS concepto_nombre,
       ta.monto_unitario AS monto,
       b.domicilio || ', ' || b.asentamiento || ', ' || m.nombre || ', ' || r.nombre AS domicilio_completo,
       r.nombre AS regional_nombre,
       TO_CHAR(s.fecha_registro, 'DD/MM/YYYY') AS fecha_emision
     FROM solicitudes s
     JOIN beneficiarios b ON b.solicitud_padre_id = s.id OR b.id = (SELECT id FROM beneficiarios WHERE solicitud_padre_id = s.id LIMIT 1)
     JOIN proyectos pr ON pr.id = s.proyecto_id
     JOIN componentes c ON c.id = pr.componente_id
     JOIN subprogramas sub ON sub.id = c.subprograma_id
     JOIN programas p ON p.id = sub.programa_id
     JOIN solicitud_conceptos sc ON sc.solicitud_id = s.id
     JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
     JOIN municipios m ON m.id = b.municipio_id
     JOIN direcciones_regionales r ON r.id = b.regional_id
     WHERE s.id = $1
     LIMIT 1`,
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

  doc.end();
  return Buffer.concat(chunks);
}
