// Generación de Folio de Entrega con QR (Build 12).
//
// Formato: Carta HORIZONTAL, dos hojas por beneficiario — la hoja 1 con los
// datos y el QR, la hoja 2 solo con el folio gigante que sirve de separador en
// la mesa de entrega. Es el mismo documento que imprime la pantalla
// `pwa/src/componentes/FolioEntrega.tsx`, incluida la tabla de conceptos en
// cantidad + unidad fisica (kg, obra, ...) y NO en dinero: el folio se firma
// al recibir costales, y el monto solo confundia en ventanilla.
//
// `dibujarFolioEntrega()` esta separado de `generarFolioEntregaPdf()` a
// proposito: el mismo trazado se invoca una vez para el PDF individual y N
// veces dentro de un solo documento para la impresion en lote, de modo que un
// cambio de diseno no pueda quedar aplicado en uno y no en el otro.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { ETIQUETAS_NOMBRE_SOLICITANTE, type TipoPersona } from '@sedea/shared';
import { pool } from '../db/pool.js';
import { hayLogos, membrete } from './logos.js';

/** Un renglon del apoyo entregado: que es y cuanto, en unidades fisicas. */
export interface ConceptoFolio {
  nombre: string;
  cantidad: string;
  unidad: string;
}

export interface DatosFolioEntrega {
  solicitud_id: number;
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  /** Solo para persona moral / grupo; null en persona fisica. */
  representante_etiqueta: string | null;
  representante_nombre: string | null;
  programa_nombre: string;
  proyecto_nombre: string;
  regional_nombre: string;
  conceptos: ConceptoFolio[];
}

/** En BD varios de estos campos son cadena vacia, no NULL: ambos van a raya. */
function texto(valor: string | null | undefined): string {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? '—' : limpio;
}

/**
 * `cantidad` viene de un NUMERIC(_,3): 1.000 debe leerse "1" y 1.500 "1.5".
 * Sin esto el folio diria "Obra: 1.000" y el productor lo lee como mil.
 */
function cantidadTexto(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

interface FilaFolio {
  solicitud_id: number;
  folio: string;
  tipo_persona: string;
  nombre_solicitante: string;
  razon_social: string | null;
  curp: string | null;
  programa_nombre: string | null;
  proyecto_nombre: string | null;
  regional_nombre: string | null;
}

interface FilaConcepto {
  solicitud_id: number;
  tipo_apoyo: string | null;
  cantidad: number;
  unidad_medida: string | null;
}

/**
 * Carga los datos de N folios en dos consultas (no 2N): la impresion en lote
 * puede pedir cientos de solicitudes y una consulta por folio ahogaria al pool.
 * Devuelve las filas en el MISMO orden que `solicitudIds`.
 */
export async function obtenerDatosFolios(solicitudIds: number[]): Promise<DatosFolioEntrega[]> {
  if (solicitudIds.length === 0) return [];

  const { rows } = await pool.query<FilaFolio>(
    `SELECT s.id AS solicitud_id,
            s.folio,
            s.tipo_persona,
            s.nombre_solicitante,
            s.razon_social,
            s.curp,
            p.nombre AS programa_nombre,
            pr.nombre AS proyecto_nombre,
            r.nombre AS regional_nombre
       FROM solicitudes s
       JOIN proyectos pr ON pr.id = s.proyecto_id
       JOIN programas p ON p.id = s.programa_id
       LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
      WHERE s.id = ANY($1::bigint[])`,
    [solicitudIds]
  );

  const { rows: conceptos } = await pool.query<FilaConcepto>(
    `SELECT sc.solicitud_id, ta.nombre AS tipo_apoyo,
            sc.cantidad::float8 AS cantidad, sc.unidad_medida
       FROM solicitud_conceptos sc
       LEFT JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
      WHERE sc.solicitud_id = ANY($1::bigint[])
      ORDER BY sc.solicitud_id, sc.orden`,
    [solicitudIds]
  );

  const porSolicitud = new Map<number, ConceptoFolio[]>();
  for (const c of conceptos) {
    const lista = porSolicitud.get(Number(c.solicitud_id)) ?? [];
    lista.push({
      nombre: texto(c.tipo_apoyo),
      cantidad: cantidadTexto(c.cantidad),
      unidad: texto(c.unidad_medida)
    });
    porSolicitud.set(Number(c.solicitud_id), lista);
  }

  const porId = new Map<number, DatosFolioEntrega>();
  for (const s of rows) {
    const id = Number(s.solicitud_id);
    // Mismo criterio que la caratula de expediente: para persona moral o grupo
    // manda la razon social, y `nombre_solicitante` pasa a ser el representante.
    const esMoralOGrupo = s.tipo_persona === 'moral' || s.tipo_persona === 'grupo';
    const nombre = esMoralOGrupo && s.razon_social ? s.razon_social : s.nombre_solicitante;
    const mostrarRepresentante =
      esMoralOGrupo && !!s.razon_social && !!(s.nombre_solicitante ?? '').trim();

    porId.set(id, {
      solicitud_id: id,
      folio: s.folio,
      beneficiario_nombre: texto(nombre),
      beneficiario_curp: texto(s.curp),
      representante_etiqueta: mostrarRepresentante
        ? ETIQUETAS_NOMBRE_SOLICITANTE[s.tipo_persona as TipoPersona]
        : null,
      representante_nombre: mostrarRepresentante ? s.nombre_solicitante : null,
      programa_nombre: texto(s.programa_nombre),
      proyecto_nombre: texto(s.proyecto_nombre),
      regional_nombre: texto(s.regional_nombre),
      conceptos: porSolicitud.get(id) ?? []
    });
  }

  return solicitudIds
    .map((id) => porId.get(id))
    .filter((d): d is DatosFolioEntrega => d !== undefined);
}

/** Carta horizontal en puntos PDF (792 x 612) con margenes de ~10mm. */
const MARGEN = 28;
const ANCHO_HOJA = 792;
const ALTO_HOJA = 612;
const ANCHO_UTIL = ANCHO_HOJA - MARGEN * 2;

/** El QR se pre-renderiza aparte porque `qrcode` es asincrono y PDFKit no. */
export async function qrDeFolio(folio: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(folio, {
    width: 200,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64');
}

type Doc = InstanceType<typeof PDFDocument>;

/** Tabla de conceptos: concepto | cantidad | unidad. Devuelve la Y final. */
function dibujarConceptos(doc: Doc, datos: DatosFolioEntrega, x: number, y: number, ancho: number): number {
  const colCant = 70;
  const colUnidad = 110;
  const colNombre = ancho - colCant - colUnidad;
  const columnas = [colNombre, colCant, colUnidad];
  const altoFila = 16;

  doc.fontSize(8).font('Helvetica-Bold');
  let cx = x;
  const encabezados = ['CONCEPTO', 'CANTIDAD', 'UNIDAD DE MEDIDA'];
  encabezados.forEach((titulo, i) => {
    doc.rect(cx, y, columnas[i], altoFila).fillAndStroke('#f5f5f5', '#999999');
    doc.fillColor('#000000').text(titulo, cx + 4, y + 4, {
      width: columnas[i] - 8,
      align: i === 1 ? 'right' : 'left',
      lineBreak: false
    });
    cx += columnas[i];
  });

  let fy = y + altoFila;
  doc.fontSize(9).font('Helvetica');

  if (datos.conceptos.length === 0) {
    doc.rect(x, fy, ancho, altoFila).stroke('#999999');
    doc.fillColor('#000000').text('Sin conceptos registrados', x + 4, fy + 4, {
      width: ancho - 8,
      lineBreak: false
    });
    return fy + altoFila;
  }

  for (const c of datos.conceptos) {
    const celdas = [c.nombre, c.cantidad, c.unidad];
    cx = x;
    celdas.forEach((valor, i) => {
      doc.rect(cx, fy, columnas[i], altoFila).stroke('#999999');
      doc.fillColor('#000000').text(valor, cx + 4, fy + 4, {
        width: columnas[i] - 8,
        align: i === 1 ? 'right' : 'left',
        // Sin salto: una fila de alto fijo mantiene alineadas las tres
        // columnas; un concepto larguisimo se recorta en vez de desfasar.
        lineBreak: false,
        ellipsis: true
      });
      cx += columnas[i];
    });
    fy += altoFila;
  }
  return fy;
}

/**
 * Traza UN folio de entrega completo (sus dos hojas) en el documento recibido.
 *
 * Asume que `doc` ya esta posicionado en una pagina Carta horizontal en blanco
 * y deja el cursor al final de la hoja 2; quien llame decide si agrega otra
 * pagina para el siguiente folio. No llama a `doc.end()`.
 */
export function dibujarFolioEntrega(doc: Doc, datos: DatosFolioEntrega, qr: Buffer): void {
  // ---------------- Hoja 1: datos + QR ----------------
  // Membrete: los logotipos oficiales sustituyen al rotulo naranja "SEDEA" y a
  // la linea "Secretaría de Desarrollo Agropecuario", que el propio lockup ya
  // trae impresa. Si los PNG faltaran se vuelve al rotulo tipografico, para
  // que un folio de entrega nunca deje de imprimirse por un archivo ausente.
  if (hayLogos()) {
    const yFin = membrete(doc, MARGEN, MARGEN, ANCHO_UTIL, 30);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold')
      .text('FOLIO DE ENTREGA DE APOYO', MARGEN, yFin + 10, { width: ANCHO_UTIL, align: 'center' });
  } else {
    doc.fillColor('#FF5A1F').fontSize(20).font('Helvetica-Bold')
      .text('SEDEA', MARGEN, MARGEN, { width: ANCHO_UTIL, align: 'center' });
    doc.fillColor('#000000').fontSize(10).font('Helvetica')
      .text('Secretaría de Desarrollo Agropecuario', { width: ANCHO_UTIL, align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold')
      .text('FOLIO DE ENTREGA DE APOYO', { width: ANCHO_UTIL, align: 'center' });
  }

  const yLinea = doc.y + 6;
  doc.moveTo(MARGEN, yLinea).lineTo(MARGEN + ANCHO_UTIL, yLinea).lineWidth(2).stroke('#000000');

  // Banner del folio: el dato con el que se busca el expediente en la mesa de
  // entrega, asi que ocupa su propia franja de ancho completo.
  const yBanner = yLinea + 12;
  const altoBanner = 52;
  doc.rect(MARGEN, yBanner, ANCHO_UTIL, altoBanner).fill('#f5f5f5');
  doc.fillColor('#444444').fontSize(8).font('Helvetica-Bold')
    .text('FOLIO', MARGEN, yBanner + 6, { width: ANCHO_UTIL, align: 'center', characterSpacing: 2 });
  // El folio puede crecer (prefijo de proyecto + consecutivo): se reduce el
  // cuerpo si a 30pt no cabria a lo ancho, en vez de desbordar la hoja.
  const cuerpoBanner = Math.min(30, (ANCHO_UTIL / Math.max(datos.folio.length, 1)) * 1.6);
  doc.fillColor('#000000').fontSize(cuerpoBanner).font('Courier-Bold')
    .text(datos.folio, MARGEN, yBanner + 19, { width: ANCHO_UTIL, align: 'center', lineBreak: false });

  // Cuerpo en tres columnas: beneficiario | apoyo | QR. En horizontal el ancho
  // sobra y el alto escasea, por eso no se apilan.
  const yCuerpo = yBanner + altoBanner + 18;
  const anchoQr = 150;
  const separacion = 20;
  const anchoRestante = ANCHO_UTIL - anchoQr - separacion * 2;
  const anchoCol1 = anchoRestante / 3;
  const anchoCol2 = (anchoRestante / 3) * 2;
  const xCol1 = MARGEN;
  const xCol2 = xCol1 + anchoCol1 + separacion;
  const xQr = xCol2 + anchoCol2 + separacion;

  const seccion = (titulo: string, x: number, ancho: number): number => {
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
      .text(titulo, x, yCuerpo, { width: ancho });
    const y = doc.y + 4;
    doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(1).stroke('#cccccc');
    return y + 8;
  };

  const renglon = (etiqueta: string, valor: string, x: number, ancho: number, y: number): number => {
    doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold')
      .text(`${etiqueta}: `, x, y, { width: ancho, continued: true });
    doc.font('Helvetica').text(valor);
    return doc.y + 4;
  };

  let y1 = seccion('DATOS DEL BENEFICIARIO', xCol1, anchoCol1);
  y1 = renglon('Nombre', datos.beneficiario_nombre, xCol1, anchoCol1, y1);
  if (datos.representante_nombre) {
    y1 = renglon(
      datos.representante_etiqueta ?? 'Representante',
      datos.representante_nombre,
      xCol1,
      anchoCol1,
      y1
    );
  }
  y1 = renglon('CURP', datos.beneficiario_curp, xCol1, anchoCol1, y1);
  renglon('Regional', datos.regional_nombre, xCol1, anchoCol1, y1);

  let y2 = seccion('DATOS DEL APOYO', xCol2, anchoCol2);
  y2 = renglon('Programa', datos.programa_nombre, xCol2, anchoCol2, y2);
  y2 = renglon('Proyecto', datos.proyecto_nombre, xCol2, anchoCol2, y2);
  dibujarConceptos(doc, datos, xCol2, y2 + 4, anchoCol2);

  doc.image(qr, xQr, yCuerpo, { width: anchoQr, height: anchoQr });
  doc.fillColor('#000000').fontSize(8).font('Helvetica-Oblique')
    .text('Escanee este código QR para verificar la entrega del apoyo', xQr, yCuerpo + anchoQr + 6, {
      width: anchoQr,
      align: 'center'
    });

  const yPie = ALTO_HOJA - MARGEN - 24;
  doc.moveTo(MARGEN, yPie).lineTo(MARGEN + ANCHO_UTIL, yPie).lineWidth(1).stroke('#cccccc');
  doc.fillColor('#000000').fontSize(8).font('Helvetica-Oblique')
    .text('Este documento debe presentarse al momento de recibir el apoyo', MARGEN, yPie + 8, {
      width: ANCHO_UTIL,
      align: 'center'
    });

  // ---------------- Hoja 2: folio gigante ----------------
  doc.addPage();
  // Courier avanza 0.6em por glifo: N caracteres miden 0.6 * N * cuerpo.
  // Despejando para el ancho util (dejando ~10% de aire) sale el factor 1.5.
  const cuerpoGigante = (ANCHO_UTIL / Math.max(datos.folio.length, 1)) * 1.5;
  doc.fillColor('#000000').font('Courier-Bold').fontSize(cuerpoGigante);
  const alturaTexto = doc.currentLineHeight();
  doc.text(datos.folio, MARGEN, (ALTO_HOJA - alturaTexto) / 2, {
    width: ANCHO_UTIL,
    align: 'center',
    lineBreak: false
  });
}

/** Documento nuevo en Carta horizontal, ya listo para el primer folio. */
function nuevoDocumento(): Doc {
  return new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: MARGEN, autoFirstPage: true });
}

/** Cierra el documento y devuelve el buffer completo. */
async function finalizar(doc: Doc, chunks: Buffer[]): Promise<Buffer> {
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

export async function generarFolioEntregaPdf(solicitudId: number): Promise<Buffer> {
  const [datos] = await obtenerDatosFolios([solicitudId]);
  if (!datos) throw new Error('Solicitud no encontrada');

  const doc = nuevoDocumento();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  dibujarFolioEntrega(doc, datos, await qrDeFolio(datos.folio));
  return finalizar(doc, chunks);
}

/**
 * Un solo PDF con los folios de N solicitudes, dos hojas por folio y salto de
 * pagina entre beneficiarios. Los ids llegan ya filtrados por el endpoint
 * (alcance regional + autorizacion del Secretario): aqui no se decide quien
 * entra, solo se dibuja.
 */
export async function generarFolioEntregaLotePdf(
  solicitudIds: number[]
): Promise<{ pdf: Buffer; folios: string[] }> {
  const lote = await obtenerDatosFolios(solicitudIds);
  if (lote.length === 0) throw new Error('Solicitud no encontrada');

  const doc = nuevoDocumento();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  for (let i = 0; i < lote.length; i++) {
    // La primera pagina ya existe; a partir del segundo folio hay que abrirla.
    if (i > 0) doc.addPage();
    dibujarFolioEntrega(doc, lote[i], await qrDeFolio(lote[i].folio));
  }

  return { pdf: await finalizar(doc, chunks), folios: lote.map((d) => d.folio) };
}
