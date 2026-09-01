// Generación de Folio de Entrega con QR.
// Formato operativo V7: Carta VERTICAL, una hoja por beneficiario, dividida
// horizontalmente en dos comprobantes por una línea punteada de corte.
//
// Mitad superior: copia para expediente con datos, tabla, QR y firmas.
// Mitad inferior: talón operativo para el beneficiario, siguiendo el machote
// aprobado: folio grande, datos esenciales, costales y QR grande.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { ETIQUETAS_NOMBRE_SOLICITANTE, type TipoPersona } from '@sedea/shared';
import { pool } from '../db/pool.js';
import { hayLogosFolio, membreteFolioEntrega } from './logos.js';

const KG_POR_COSTAL = 25;

/** Un renglón del apoyo entregado en unidades físicas. */
export interface ConceptoFolio {
  nombre: string;
  cantidad: string;
  cantidad_numero: number;
  unidad: string;
  costales: string;
}

export interface DatosFolioEntrega {
  solicitud_id: number;
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  representante_etiqueta: string | null;
  representante_nombre: string | null;
  municipio_nombre: string;
  localidad_ejido: string;
  programa_nombre: string;
  componente_nombre: string;
  proyecto_nombre: string;
  regional_nombre: string;
  superficie_ha: string;
  conceptos: ConceptoFolio[];
}

function texto(valor: string | null | undefined): string {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? '—' : limpio;
}

function textoOpcional(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? null : limpio;
}

function cantidadTexto(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

function superficieTexto(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('es-MX', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

function esUnidadKg(unidad: string | null | undefined): boolean {
  const limpia = (unidad ?? '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '');
  return ['KG', 'KGS', 'KILOGRAMO', 'KILOGRAMOS'].includes(limpia);
}

/** Solo muestra costales cuando la cantidad corresponde exactamente a sacos de 25 kg. */
function costalesTexto(cantidad: number, unidad: string | null | undefined): string {
  if (!esUnidadKg(unidad) || !Number.isFinite(cantidad) || cantidad <= 0) return '—';
  const costales = cantidad / KG_POR_COSTAL;
  const entero = Math.round(costales);
  return Math.abs(costales - entero) < 1e-9 ? String(entero) : '—';
}

interface FilaFolio {
  solicitud_id: number;
  folio: string;
  tipo_persona: string;
  nombre_solicitante: string;
  razon_social: string | null;
  curp: string | null;
  programa_nombre: string | null;
  componente_nombre: string | null;
  proyecto_nombre: string | null;
  regional_nombre: string | null;
  municipio_nombre: string | null;
  ubi_localidad: string | null;
  ubi_ejido: string | null;
  agr_superficie_total_ha: number | null;
  agr_superficie_siembra_ha: number | null;
}

interface FilaConcepto {
  solicitud_id: number;
  tipo_apoyo: string | null;
  cantidad: number;
  unidad_medida: string | null;
}

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
            c.nombre AS componente_nombre,
            pr.nombre AS proyecto_nombre,
            r.nombre AS regional_nombre,
            m.nombre AS municipio_nombre,
            s.ubi_localidad,
            s.ubi_ejido,
            s.agr_superficie_total_ha::float8 AS agr_superficie_total_ha,
            s.agr_superficie_siembra_ha::float8 AS agr_superficie_siembra_ha
       FROM solicitudes s
       JOIN proyectos pr ON pr.id = s.proyecto_id
       JOIN programas p ON p.id = s.programa_id
       JOIN componentes c ON c.id = s.componente_id
       LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
       LEFT JOIN municipios m ON m.id = s.ubi_municipio_id
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
    const cantidadNumero = Number(c.cantidad);
    lista.push({
      nombre: texto(c.tipo_apoyo),
      cantidad: cantidadTexto(cantidadNumero),
      cantidad_numero: cantidadNumero,
      unidad: texto(c.unidad_medida),
      costales: costalesTexto(cantidadNumero, c.unidad_medida)
    });
    porSolicitud.set(Number(c.solicitud_id), lista);
  }

  const porId = new Map<number, DatosFolioEntrega>();
  for (const s of rows) {
    const id = Number(s.solicitud_id);
    const esMoralOGrupo = s.tipo_persona === 'moral' || s.tipo_persona === 'grupo';
    const nombre = esMoralOGrupo && s.razon_social ? s.razon_social : s.nombre_solicitante;
    const mostrarRepresentante =
      esMoralOGrupo && !!s.razon_social && !!(s.nombre_solicitante ?? '').trim();

    const localidad = textoOpcional(s.ubi_localidad);
    const ejido = textoOpcional(s.ubi_ejido);
    const localidadEjido =
      localidad && ejido && localidad.toUpperCase() !== ejido.toUpperCase()
        ? `${localidad} / ${ejido}`
        : (localidad ?? ejido ?? '—');

    const superficieBase =
      Number(s.agr_superficie_total_ha ?? 0) > 0
        ? s.agr_superficie_total_ha
        : s.agr_superficie_siembra_ha;

    porId.set(id, {
      solicitud_id: id,
      folio: s.folio,
      beneficiario_nombre: texto(nombre),
      beneficiario_curp: texto(s.curp),
      representante_etiqueta: mostrarRepresentante
        ? ETIQUETAS_NOMBRE_SOLICITANTE[s.tipo_persona as TipoPersona]
        : null,
      representante_nombre: mostrarRepresentante ? s.nombre_solicitante : null,
      municipio_nombre: texto(s.municipio_nombre),
      localidad_ejido: localidadEjido,
      programa_nombre: texto(s.programa_nombre),
      componente_nombre: texto(s.componente_nombre),
      proyecto_nombre: texto(s.proyecto_nombre),
      regional_nombre: texto(s.regional_nombre),
      superficie_ha: superficieTexto(superficieBase),
      conceptos: porSolicitud.get(id) ?? []
    });
  }

  return solicitudIds
    .map((id) => porId.get(id))
    .filter((d): d is DatosFolioEntrega => d !== undefined);
}

// Carta vertical: 612 x 792 puntos.
const ANCHO_HOJA = 612;
const ALTO_HOJA = 792;
const CORTE_Y = ALTO_HOJA / 2;
const MARGEN_X = 34;
const ANCHO_UTIL = ANCHO_HOJA - MARGEN_X * 2;

export async function qrDeFolio(folio: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(folio, {
    width: 500,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64');
}

type Doc = InstanceType<typeof PDFDocument>;

function renglon(
  doc: Doc,
  etiqueta: string,
  valor: string,
  x: number,
  y: number,
  ancho: number,
  tamano = 7.2
): void {
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(tamano)
    .text(`${etiqueta}: `, x, y, { continued: true, lineBreak: false });
  doc
    .font('Helvetica')
    .text(valor, { width: ancho - 88, lineBreak: false, ellipsis: true });
}

function dibujarTablaConceptos(
  doc: Doc,
  datos: DatosFolioEntrega,
  x: number,
  y: number,
  ancho: number
): void {
  const columnas = [296, 56, 52, 65, ancho - 296 - 56 - 52 - 65];
  const encabezados = ['CONCEPTO DE APOYO', 'CANTIDAD', 'UNIDAD', 'COSTALES', 'SUPERFICIE\n(HA)'];
  const altoEncabezado = 18;
  const altoFila = 15;

  let cx = x;
  doc.font('Helvetica-Bold').fontSize(6.5);
  encabezados.forEach((titulo, i) => {
    doc.rect(cx, y, columnas[i], altoEncabezado).fillAndStroke('#eeeeee', '#999999');
    doc
      .fillColor('#000000')
      .text(titulo, cx + 2, y + 4, {
        width: columnas[i] - 4,
        height: altoEncabezado - 4,
        align: 'center',
        lineBreak: true
      });
    cx += columnas[i];
  });

  const filas = datos.conceptos.length > 0 ? datos.conceptos : [{
    nombre: 'Sin concepto registrado',
    cantidad: '—',
    cantidad_numero: 0,
    unidad: '—',
    costales: '—'
  }];

  let fy = y + altoEncabezado;
  doc.fontSize(7).font('Helvetica');

  for (const c of filas.slice(0, 5)) {
    const valores = [c.nombre, c.cantidad, c.unidad, c.costales, datos.superficie_ha];
    cx = x;
    valores.forEach((valor, i) => {
      doc.rect(cx, fy, columnas[i], altoFila).stroke('#aaaaaa');
      doc
        .fillColor('#000000')
        .font(i === 3 && valor !== '—' ? 'Helvetica-Bold' : 'Helvetica')
        .text(valor, cx + 2, fy + 4, {
          width: columnas[i] - 4,
          align: i === 0 ? 'left' : 'center',
          lineBreak: false,
          ellipsis: true
        });
      cx += columnas[i];
    });
    fy += altoFila;
  }
}

function totalCostales(datos: DatosFolioEntrega): number | null {
  let total = 0;
  let alguno = false;
  for (const concepto of datos.conceptos) {
    if (concepto.costales === '—') continue;
    const n = Number(concepto.costales);
    if (!Number.isFinite(n)) continue;
    total += n;
    alguno = true;
  }
  return alguno ? total : null;
}

function resumenApoyoInferior(datos: DatosFolioEntrega): string {
  if (datos.conceptos.length === 0) return 'APOYO REGISTRADO';
  if (datos.conceptos.length === 1) {
    const c = datos.conceptos[0];
    return `${c.cantidad} ${c.unidad} DE ${c.nombre}`.toUpperCase();
  }
  return datos.conceptos
    .map((c) => `${c.cantidad} ${c.unidad} ${c.nombre}`.toUpperCase())
    .join(' / ');
}

function cuerpoFolioInferior(doc: Doc, folio: string): number {
  doc.font('Helvetica-Bold');
  let cuerpo = 40;
  const anchoMaximo = ANCHO_UTIL * 0.97;
  while (cuerpo > 22) {
    doc.fontSize(cuerpo);
    if (doc.widthOfString(folio) <= anchoMaximo) break;
    cuerpo -= 0.5;
  }
  return cuerpo;
}

/** Dibuja exactamente una hoja Carta vertical para un beneficiario. */
export function dibujarFolioEntrega(doc: Doc, datos: DatosFolioEntrega, qr: Buffer): void {
  // ---------------- Mitad superior: copia para expediente ----------------
  if (hayLogosFolio()) {
    membreteFolioEntrega(doc, MARGEN_X, 18, ANCHO_UTIL, 330);
  }

  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .text('FOLIO DE ENTREGA DE APOYO', MARGEN_X, 63, {
      width: ANCHO_UTIL,
      align: 'center'
    });

  doc
    .fontSize(6.5)
    .text('COPIA PARA EXPEDIENTE', MARGEN_X, 79, {
      width: ANCHO_UTIL,
      align: 'center'
    });

  const yBanner = 92;
  const anchoFecha = 105;
  doc.rect(MARGEN_X, yBanner, ANCHO_UTIL - anchoFecha, 22).fillAndStroke('#eeeeee', '#aaaaaa');
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('FOLIO ', MARGEN_X + 4, yBanner + 7, { continued: true, lineBreak: false });
  doc
    .font('Courier-Bold')
    .fontSize(12.5)
    .text(datos.folio, { lineBreak: false });

  const xFecha = MARGEN_X + ANCHO_UTIL - anchoFecha;
  doc.rect(xFecha, yBanner, anchoFecha, 22).stroke('#aaaaaa');
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .text('FECHA DE ENTREGA', xFecha, yBanner + 4, { width: anchoFecha, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(7)
    .text('____ / ____ / 2026', xFecha, yBanner + 12, { width: anchoFecha, align: 'center' });

  const xDatos = MARGEN_X + 2;
  const anchoDatos = 365;
  let y = 128;
  renglon(doc, 'BENEFICIARIO', datos.beneficiario_nombre, xDatos, y, anchoDatos);
  y += 12;
  if (datos.representante_nombre) {
    renglon(
      doc,
      (datos.representante_etiqueta ?? 'REPRESENTANTE').toUpperCase(),
      datos.representante_nombre,
      xDatos,
      y,
      anchoDatos
    );
    y += 12;
  }
  renglon(doc, 'CURP', datos.beneficiario_curp, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'MUNICIPIO', datos.municipio_nombre, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'LOCALIDAD / EJIDO', datos.localidad_ejido, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'DIRECCIÓN REGIONAL', datos.regional_nombre, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'PROGRAMA', datos.programa_nombre, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'COMPONENTE', datos.componente_nombre, xDatos, y, anchoDatos);
  y += 12;
  renglon(doc, 'PROYECTO', datos.proyecto_nombre, xDatos, y, anchoDatos);

  const qrSuperior = 102;
  doc.image(qr, ANCHO_HOJA - MARGEN_X - qrSuperior - 4, 127, {
    width: qrSuperior,
    height: qrSuperior
  });

  dibujarTablaConceptos(doc, datos, MARGEN_X, 246, ANCHO_UTIL);

  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .text('RECIBÍ DE CONFORMIDAD ', MARGEN_X, 329, { continued: true });
  doc
    .font('Helvetica')
    .text('el apoyo descrito en este documento, correspondiente al folio señalado.');

  const yFirma = 350;
  doc.moveTo(190, yFirma).lineTo(315, yFirma).lineWidth(0.7).stroke('#666666');
  doc.moveTo(458, yFirma).lineTo(552, yFirma).lineWidth(0.7).stroke('#666666');
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(5.8)
    .text('FIRMA O HUELLA DEL BENEFICIARIO', 160, yFirma + 5, { width: 185, align: 'center' });
  doc
    .text('NOMBRE / FIRMA DE QUIEN ENTREGA', 420, yFirma + 5, { width: 170, align: 'center' });

  // Guía de corte al centro de la hoja.
  doc
    .save()
    .dash(8, { space: 4 })
    .moveTo(28, CORTE_Y)
    .lineTo(ANCHO_HOJA - 28, CORTE_Y)
    .lineWidth(1)
    .stroke('#666666')
    .undash()
    .restore();

  // ---------------- Mitad inferior: talón del beneficiario ----------------
  if (hayLogosFolio()) {
    membreteFolioEntrega(doc, MARGEN_X, CORTE_Y + 18, ANCHO_UTIL, 330);
  }

  const cuerpo = cuerpoFolioInferior(doc, datos.folio);
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(cuerpo)
    .text(datos.folio, MARGEN_X, CORTE_Y + 77, {
      width: ANCHO_UTIL,
      align: 'center',
      lineBreak: false
    });

  const xIzq = 48;
  const anchoIzq = 300;
  const yBase = CORTE_Y + 157;

  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .text(datos.beneficiario_nombre.toUpperCase(), xIzq, yBase, {
      width: anchoIzq,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });

  doc
    .fontSize(11)
    .text(`MUNICIPIO: ${datos.municipio_nombre.toUpperCase()}`, xIzq, yBase + 34, {
      width: anchoIzq,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });
  doc
    .text(`LOCALIDAD: ${datos.localidad_ejido.toUpperCase()}`, xIzq, yBase + 54, {
      width: anchoIzq,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });

  doc
    .fontSize(10.5)
    .text(resumenApoyoInferior(datos), xIzq, yBase + 88, {
      width: anchoIzq,
      align: 'center',
      lineBreak: true
    });

  const costales = totalCostales(datos);
  if (costales !== null) {
    doc
      .fontSize(20)
      .text(String(costales), xIzq, yBase + 135, { width: anchoIzq, align: 'center' });
    doc
      .fontSize(13.5)
      .text('COSTALES', xIzq, yBase + 165, { width: anchoIzq, align: 'center' });
  }

  const qrInferior = 190;
  const xQr = ANCHO_HOJA - MARGEN_X - qrInferior - 2;
  const yQr = yBase - 12;
  doc.rect(xQr - 12, yQr - 10, qrInferior + 24, qrInferior + 24).stroke('#aaaaaa');
  doc.image(qr, xQr, yQr, { width: qrInferior, height: qrInferior });
}

function nuevoDocumento(): Doc {
  return new PDFDocument({
    size: 'LETTER',
    layout: 'portrait',
    margin: 0,
    autoFirstPage: true
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

export async function generarFolioEntregaPdf(solicitudId: number): Promise<Buffer> {
  const [datos] = await obtenerDatosFolios([solicitudId]);
  if (!datos) throw new Error('Solicitud no encontrada');

  const doc = nuevoDocumento();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  dibujarFolioEntrega(doc, datos, await qrDeFolio(datos.folio));
  return finalizar(doc, chunks);
}

/** Un PDF multipágina: una hoja Carta vertical por beneficiario. */
export async function generarFolioEntregaLotePdf(
  solicitudIds: number[]
): Promise<{ pdf: Buffer; folios: string[] }> {
  const lote = await obtenerDatosFolios(solicitudIds);
  if (lote.length === 0) throw new Error('Solicitud no encontrada');

  const doc = nuevoDocumento();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  for (let i = 0; i < lote.length; i++) {
    if (i > 0) doc.addPage();
    dibujarFolioEntrega(doc, lote[i], await qrDeFolio(lote[i].folio));
  }

  return { pdf: await finalizar(doc, chunks), folios: lote.map((d) => d.folio) };
}
