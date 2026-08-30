// Digitalizacion V1 / Fase 2: caratula QR persistente para expediente fisico.
// Toda la composicion se mantiene centrada en hoja Carta vertical.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface DatosCaratulaDigitalizacion {
  solicitud_id: number;
  folio: string;
  beneficiario: string;
  municipio: string;
  regional: string;
  lote_codigo: string;
  lote_nombre: string;
  token: string;
}

type Doc = InstanceType<typeof PDFDocument>;

const ANCHO_CARTA = 612;
const ALTO_CARTA = 792;
const MARGEN = 36;
const ANCHO_UTIL = ANCHO_CARTA - MARGEN * 2;
// 300 pt = 10.58 cm. Es el tamano inicial aprobado para prueba fisica.
const QR_PUNTOS = 300;

function limpio(valor: unknown, reemplazo = '—'): string {
  const texto = String(valor ?? '').trim();
  return texto === '' ? reemplazo : texto;
}

/** El QR no contiene PII: solo namespace, version y token persistente. */
export function payloadQrExpediente(token: string): string {
  return `SISPACQ:EXP:1:${token.replaceAll('-', '')}`;
}

async function qrComoPng(token: string): Promise<Buffer> {
  return QRCode.toBuffer(payloadQrExpediente(token), {
    type: 'png',
    errorCorrectionLevel: 'H',
    width: 1000,
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' }
  });
}

function textoCentrado(
  doc: Doc,
  texto: string,
  y: number,
  opciones?: { tamano?: number; negrita?: boolean; alto?: number }
): number {
  const tamano = opciones?.tamano ?? 12;
  const alto = opciones?.alto ?? tamano * 1.45;
  doc
    .fillColor('#000000')
    .font(opciones?.negrita ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(tamano)
    .text(texto, MARGEN, y, {
      width: ANCHO_UTIL,
      height: alto,
      align: 'center',
      ellipsis: true
    });
  return y + alto;
}

function etiquetaValor(
  doc: Doc,
  etiqueta: string,
  valor: string,
  y: number,
  tamanoValor = 14
): number {
  y = textoCentrado(doc, etiqueta, y, { tamano: 8, negrita: true, alto: 11 });
  y = textoCentrado(doc, limpio(valor), y + 1, {
    tamano: tamanoValor,
    negrita: true,
    alto: tamanoValor * 1.55
  });
  return y + 3;
}

function dibujarRevisionOpcional(doc: Doc, y: number): void {
  textoCentrado(doc, 'REVISIÓN FÍSICA (OPCIONAL)', y, { tamano: 8, negrita: true, alto: 12 });

  const opciones = ['PENDIENTE', 'COMPLETO', 'CON FALTANTES'];
  const anchos = [95, 95, 125];
  const separacion = 16;
  const total = anchos.reduce((a, b) => a + b, 0) + separacion * (opciones.length - 1);
  let x = (ANCHO_CARTA - total) / 2;
  const yFila = y + 17;

  doc.font('Helvetica').fontSize(8).fillColor('#000000');
  opciones.forEach((opcion, indice) => {
    doc.rect(x, yFila + 1, 9, 9).lineWidth(0.8).stroke('#000000');
    doc.text(opcion, x + 14, yFila, {
      width: anchos[indice] - 14,
      height: 12,
      align: 'left',
      lineBreak: false
    });
    x += anchos[indice] + separacion;
  });
}

function dibujarCaratula(doc: Doc, datos: DatosCaratulaDigitalizacion, qr: Buffer): void {
  let y = 44;
  y = textoCentrado(doc, 'SEDEA · SISPACQ', y, { tamano: 13, negrita: true, alto: 18 });
  y = textoCentrado(doc, 'EXPEDIENTE DE SOLICITUD', y + 6, {
    tamano: 18,
    negrita: true,
    alto: 25
  });

  y = etiquetaValor(doc, 'FOLIO', datos.folio, y + 10, 19);
  y = etiquetaValor(doc, 'BENEFICIARIO', datos.beneficiario, y, 14);
  y = etiquetaValor(doc, 'MUNICIPIO', datos.municipio, y, 12);
  y = etiquetaValor(doc, 'REGIONAL', datos.regional, y, 12);

  // El QR domina visualmente la hoja y se mantiene despejado.
  const xQr = (ANCHO_CARTA - QR_PUNTOS) / 2;
  const yQr = Math.max(278, y + 4);
  doc.image(qr, xQr, yQr, { width: QR_PUNTOS, height: QR_PUNTOS });

  let yPie = yQr + QR_PUNTOS + 15;
  yPie = etiquetaValor(doc, 'LOTE', datos.lote_codigo, yPie, 11);
  if (datos.lote_nombre && datos.lote_nombre !== datos.lote_codigo) {
    yPie = textoCentrado(doc, limpio(datos.lote_nombre), yPie - 1, {
      tamano: 9,
      alto: 14
    }) + 3;
  }

  yPie = textoCentrado(
    doc,
    'ESTA HOJA DEBE PERMANECER COMO PRIMERA HOJA DEL EXPEDIENTE',
    yPie + 3,
    { tamano: 9, negrita: true, alto: 18 }
  );

  // Solo ayuda al armado fisico. El sistema no exige esta marca para digitalizar.
  dibujarRevisionOpcional(doc, Math.min(yPie + 5, ALTO_CARTA - 54));
}

function nuevoDocumento(): Doc {
  return new PDFDocument({
    size: 'LETTER',
    layout: 'portrait',
    margin: MARGEN,
    autoFirstPage: true,
    info: {
      Title: 'Carátulas QR de expedientes SISPACQ',
      Subject: 'Digitalización de expedientes físicos'
    }
  });
}

async function finalizar(doc: Doc, chunks: Buffer[]): Promise<Buffer> {
  const listo = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  doc.end();
  await listo;
  return Buffer.concat(chunks);
}

export async function generarCaratulasDigitalizacionPdf(
  caratulas: DatosCaratulaDigitalizacion[]
): Promise<Buffer> {
  if (caratulas.length === 0) throw new Error('No hay carátulas para generar.');

  const doc = nuevoDocumento();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  for (let i = 0; i < caratulas.length; i++) {
    if (i > 0) doc.addPage();
    const datos = caratulas[i];
    dibujarCaratula(doc, datos, await qrComoPng(datos.token));
  }

  return finalizar(doc, chunks);
}
