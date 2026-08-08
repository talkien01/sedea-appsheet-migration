// Generacion del expediente PDF de evidencia de entrega (A4, pdfkit).
import PDFDocument from 'pdfkit';
import { rutaAbsolutaDesdeUrl } from './almacenamiento.js';
import { formatearFecha } from './csv.js';

export interface DatosExpediente {
  beneficiario: {
    id: number;
    folio: string;
    nombre_completo: string;
    curp: string | null;
    regional_nombre: string | null;
    municipio_nombre: string | null;
    colonia: string | null;
    seccion: string | null;
    tipo_apoyo_nombre: string | null;
    localidad?: string | null;
    domicilio?: string | null;
  };
  capturas: Array<{
    uuid: string;
    foto_url: string;
    lat: number;
    lng: number;
    precision_m: number;
    capturado_en: string;
    capturista: string | null;
    observaciones: string | null;
    cantidad_entregada: number | null;
  }>;
  generadoPor: string;
}

/** Devuelve el PDF completo como Buffer. */
export function generarExpedientePdf(datos: DatosExpediente): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    try {
      // bufferPages permite volver atras para escribir el pie en cada pagina.
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const trozos: Buffer[] = [];
      doc.on('data', (t: Buffer) => trozos.push(t));
      doc.on('end', () => resolver(Buffer.concat(trozos)));
      doc.on('error', rechazar);

      const b = datos.beneficiario;

      // Encabezado
      doc.fontSize(16).text('SEDEA - Expediente de evidencia de entrega', { align: 'center' });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .fillColor('#555')
        .text('Secretaria de Desarrollo Agropecuario del Estado de Queretaro', { align: 'center' });
      doc.moveDown(1);
      doc.fillColor('#000');

      // Datos del beneficiario
      doc.fontSize(12).text('Datos del beneficiario');
      doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      const campos: Array<[string, string]> = [
        ['Folio', b.folio],
        ['Nombre', b.nombre_completo],
        ['CURP', b.curp ?? 'No registrada'],
        ['Direccion Regional', b.regional_nombre ?? 'No registrada'],
        ['Municipio', b.municipio_nombre ?? 'No registrado'],
        ['Colonia', b.colonia ?? 'No registrada'],
        ['Seccion', b.seccion ?? 'No registrada'],
        ['Tipo de apoyo', b.tipo_apoyo_nombre ?? 'No registrado']
      ];
      doc.fontSize(10);
      for (const [etiqueta, valor] of campos) {
        doc.font('Helvetica-Bold').text(`${etiqueta}: `, { continued: true });
        doc.font('Helvetica').text(valor);
      }

      doc.moveDown(1);
      doc.fontSize(12).font('Helvetica-Bold').text(`Capturas registradas: ${datos.capturas.length}`);
      doc.font('Helvetica');
      doc.moveDown(0.5);

      if (datos.capturas.length === 0) {
        doc.fontSize(10).text('Este beneficiario aun no tiene evidencia capturada.');
      }

      for (const [indice, captura] of datos.capturas.entries()) {
        if (doc.y > 560) doc.addPage();

        doc.fontSize(11).font('Helvetica-Bold').text(`Captura ${indice + 1}`);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Fecha de captura: ${formatearFecha(captura.capturado_en)}`);
        doc.text(`Coordenadas: ${captura.lat.toFixed(6)}, ${captura.lng.toFixed(6)}`);
        doc.text(`Precision GPS: +/-${Math.round(captura.precision_m)} m`);
        doc.text(`Capturista: ${captura.capturista ?? 'No registrado'}`);
        if (captura.cantidad_entregada !== null && captura.cantidad_entregada !== undefined) {
          doc.text(`Cantidad entregada: ${captura.cantidad_entregada}`);
        }
        if (captura.observaciones) {
          doc.text(`Observaciones: ${captura.observaciones}`);
        }
        doc.moveDown(0.3);

        const rutaFoto = rutaAbsolutaDesdeUrl(captura.foto_url);
        if (rutaFoto) {
          try {
            doc.image(rutaFoto, { fit: [260, 200] });
          } catch {
            doc.fontSize(9).fillColor('#a00').text('[No se pudo incrustar la fotografia]');
            doc.fillColor('#000');
          }
        } else {
          doc.fontSize(9).fillColor('#a00').text('[Fotografia no disponible en el servidor]');
          doc.fillColor('#000');
        }
        doc.moveDown(1);
      }

      // Pie en todas las paginas
      const pie = `Generado el ${formatearFecha(new Date())} por ${datos.generadoPor}`;
      const rango = doc.bufferedPageRange();
      for (let i = rango.start; i < rango.start + rango.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .fillColor('#666')
          .text(pie, 40, 800, { width: 515, align: 'center', lineBreak: false });
      }

      doc.end();
    } catch (error) {
      rechazar(error);
    }
  });
}
