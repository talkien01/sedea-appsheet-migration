// Replica fiel del documento oficial "SOLICITUD DE APOYO" del Programa
// Institucional Apoyo al Campo Queretano (3 paginas, A4).
//
// Mismo patron que folio-entrega.ts: PDFKit, se arma en memoria y se devuelve
// como Buffer. El texto legal se copia del formato oficial en papel sin
// parafrasear; la unica correccion autorizada es el espacio faltante en las
// concatenaciones del original ("comercialesilicitas" -> "comerciales
// ilicitas", "deQueretaro" -> "de Queretaro", etc.). No se cambia ninguna
// palabra.
import PDFDocument from 'pdfkit';
import { pool } from '../db/pool.js';
import { hayLogos, membrete } from './logos.js';

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

interface FilaComponente {
  id: number;
  clave: string;
  nombre: string;
}

interface FilaVentanillaPdf {
  id: number;
  nombre: string;
}

interface FilaConceptoPdf {
  tipo_apoyo: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad_medida: string | null;
  monto_estatal: number;
  monto_productor: number;
  monto_total: number;
}

interface FilaDictamenPdf {
  resultado: string;
  nota: string | null;
  dictaminado_por_nombre: string | null;
  dictaminado_en: string;
}

export interface DatosSolicitudCompleta {
  solicitud: Record<string, any>;
  componentes: FilaComponente[];
  ventanillas: FilaVentanillaPdf[];
  conceptos: FilaConceptoPdf[];
  dictamen: FilaDictamenPdf | null;
}

async function obtenerDatos(solicitudId: number): Promise<DatosSolicitudCompleta | null> {
  const { rows: sol } = await pool.query<Record<string, any>>(
    `SELECT s.*,
            TO_CHAR(s.recibida_en, 'DD/MM/YYYY')       AS recibida_fecha,
            TO_CHAR(s.fecha_nacimiento, 'DD/MM/YYYY')  AS fecha_nacimiento_fmt,
            c.clave  AS componente_clave,
            pr.nombre AS programa_nombre,
            sp.nombre AS subprograma_nombre,
            p.nombre  AS proyecto_nombre,
            v.nombre  AS ventanilla_nombre,
            mu.nombre AS ubi_municipio_nombre,
            md.nombre AS dom_municipio_nombre,
            u.nombre_completo AS capturado_por_nombre
       FROM solicitudes s
       JOIN componentes c  ON c.id  = s.componente_id
       JOIN proyectos p    ON p.id  = s.proyecto_id
       JOIN ventanillas v  ON v.id  = s.ventanilla_id
       JOIN programas pr   ON pr.id = s.programa_id
       LEFT JOIN subprogramas sp ON sp.id = s.subprograma_id
       LEFT JOIN municipios mu   ON mu.id = s.ubi_municipio_id
       LEFT JOIN municipios md   ON md.id = s.dom_municipio_id
       LEFT JOIN usuarios u      ON u.id  = s.capturado_por
      WHERE s.id = $1`,
    [solicitudId]
  );
  if (!sol[0]) return null;

  // El catalogo de componentes se consulta en vivo: si manana se da de alta
  // PET u otro componente, aparece solo en el formato (no hay lista fija).
  const { rows: componentes } = await pool.query<FilaComponente>(
    'SELECT id, clave, nombre FROM componentes WHERE activo ORDER BY clave'
  );
  const { rows: ventanillas } = await pool.query<FilaVentanillaPdf>(
    'SELECT id, nombre FROM ventanillas WHERE activo ORDER BY clave'
  );
  const { rows: conceptos } = await pool.query<FilaConceptoPdf>(
    `SELECT ta.nombre AS tipo_apoyo, sc.descripcion,
            sc.cantidad::float8        AS cantidad,
            sc.unidad_medida,
            sc.monto_estatal::float8   AS monto_estatal,
            sc.monto_productor::float8 AS monto_productor,
            sc.monto_total::float8     AS monto_total
       FROM solicitud_conceptos sc
       LEFT JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
      WHERE sc.solicitud_id = $1
      ORDER BY sc.orden`,
    [solicitudId]
  );
  // Dictamen HUMANO de la solicitud (tabla `dictamenes`). No confundir con
  // `predictamenes_ia`, que es la sugerencia de la IA sobre los documentos y
  // nunca es veredicto. Si no hay dictamen, la seccion 7 va en blanco para
  // llenarse a mano.
  const { rows: dictamen } = await pool.query<FilaDictamenPdf>(
    `SELECT d.resultado, d.nota,
            u.nombre_completo AS dictaminado_por_nombre,
            TO_CHAR(d.dictaminado_en, 'DD/MM/YYYY') AS dictaminado_en
       FROM dictamenes d
       LEFT JOIN usuarios u ON u.id = d.dictaminado_por
      WHERE d.solicitud_id = $1
      ORDER BY d.dictaminado_en DESC, d.id DESC
      LIMIT 1`,
    [solicitudId]
  );

  return {
    solicitud: sol[0],
    componentes,
    ventanillas,
    conceptos,
    dictamen: dictamen[0] ?? null
  };
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

const PIE_LEGAL =
  '"Este programa es público, ajeno a cualquier partido político. Queda prohibido el uso para fines distintos a los establecidos en el programa"';

const AVISO_PRIVACIDAD_7 =
  'Autorizo que mis datos personales sean empleados para el trámite de la solicitud. Otorgo el consentimiento para que sean transferidos en caso de ser necesario y dar cumplimiento conforme a lo previsto en los artículos 16 fracción II, 59 y 61 de la Ley de Protección de Datos Personales en Posesión de Sujetos Obligados del Estado de Querétaro; así como a las obligaciones de transparencia y acceso a la información pública de conformidad con la Ley del Estado de Querétaro.';

const AVISO_PRIVACIDAD_7_PORTAL =
  '"En cumplimiento a las Leyes de Protección de Datos Personales, Usted puede consultar el aviso de privacidad a través del portal de Internet http://sedea.queretaro.gob.mx"';

const AVISO_PRIVACIDAD_COMPROBANTE =
  'Autorizo que mis datos personales sean empleados para el trámite de la solicitud. Otorgo el consentimiento para que sean transferidos en caso de ser necesario y dar cumplimiento conforme a lo previsto en los artículos 16 fracción II, 59 y 61 de la Ley de Protección de Datos Personales en Posesión de Sujetos Obligados del Estado de Querétaro; así como a las obligaciones de transparencia y acceso a la información pública de conformidad con la Ley del Estado de Querétaro. "En cumplimiento a las Leyes de Protección de Datos Personales, Usted puede consultar el aviso de privacidad a través del portal de Internet https://sedea.queretaro.gob.mx"';

const DECLARACIONES: Array<[string, string]> = [
  ['a.', 'Que no realizó actividades productivas ni comerciales ilícitas.'],
  ['b.', 'Que no tengo procesos pendientes con la Secretaría de Desarrollo Agropecuario.'],
  [
    'c.',
    'Que aplicaré los apoyos únicamente para los fines autorizados, y que en caso de incumplimiento de mi parte, la consecuencia será la devolución del recurso y los productos financieros generados; incluso la pérdida permanente del derecho a la obtención de apoyos por parte de la Secretaría de Desarrollo Agropecuario.'
  ],
  [
    'd.',
    'Manifiesto que los datos en la solicitud son verídicos y me comprometo a cumplir con los ordenamientos establecidos en las Reglas de Operación del Programa Institucional "Apoyo al Campo Queretano".'
  ],
  [
    'e.',
    'Expreso mi total y cabal compromiso, para realizar las inversiones y/o trabajos que me correspondan, para ejecutar las acciones del proyecto en caso de ser autorizado y hasta la conclusión del mismo.'
  ],
  [
    'f.',
    'Que proporcionaré la información que sea requerida en caso de supervisión o auditoría que realicen las instancias correspondientes.'
  ],
  [
    'g.',
    'La presentación de la solicitud y el expediente correspondientes, no implica la autorización ni el pago de los apoyos por parte de la Secretaría de Desarrollo Agropecuario.'
  ]
];

/** Vacio -> cadena vacia (en el formato en papel el hueco se deja en blanco). */
function txt(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const s = String(valor).trim();
  return s === 'null' ? '' : s;
}

function num(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

function pesos(valor: unknown): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 'colonia' -> 'Colonia'. Los enums viven en minusculas en la BD. */
function capitalizar(valor: unknown): string {
  const s = txt(valor);
  return s === '' ? '' : s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Primitivas de dibujo
// ---------------------------------------------------------------------------

const MARGEN = 36;
const ANCHO = 595.28 - MARGEN * 2; // 523.28

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Encabezado repetido en las 3 paginas. Devuelve la Y donde sigue el cuerpo.
 *
 * En la primera pagina los logotipos oficiales van DENTRO de la misma banda de
 * 46 pt, ocupando el hueco de las tres lineas de texto que hacian de membrete
 * ("SECRETARÍA DE DESARROLLO AGROPECUARIO / QUERÉTARO / Gobierno del Estado").
 * Sustituirlas en su sitio en vez de apilar el membrete encima es deliberado:
 * este PDF es una replica fiel del formato en papel y cualquier corrimiento
 * vertical se arrastraria por las tres paginas. La Y de retorno no cambia.
 *
 * Las paginas 2 y 3 conservan el membrete tipografico: el grafico solo va en
 * la primera, como en la papeleria oficial.
 */
function encabezado(doc: Doc, folio: string, fechaRecepcion: string, primera = false): number {
  const y = MARGEN;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text(`FOLIO: ${folio}`, MARGEN, y + 8, { width: 200 });

  const xDer = MARGEN + ANCHO - 250;
  const conLogos = primera && hayLogos();

  if (conLogos) {
    membrete(doc, xDer, y, 250, 28);
  } else {
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('SECRETARÍA DE DESARROLLO AGROPECUARIO', xDer, y, { width: 250, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('QUERÉTARO', xDer, y + 11, { width: 250, align: 'right' });
    doc.font('Helvetica').fontSize(7);
    doc.text('Gobierno del Estado', xDer, y + 21, { width: 250, align: 'right' });
  }

  doc.font('Helvetica').fontSize(8).fillColor('#000');
  doc.text(`Fecha de recepción: ${fechaRecepcion}`, xDer, y + 32, { width: 250, align: 'right' });

  const yLinea = y + 46;
  doc.moveTo(MARGEN, yLinea).lineTo(MARGEN + ANCHO, yLinea).lineWidth(0.8).strokeColor('#000').stroke();
  return yLinea + 8;
}

/** Pie legal fijo al fondo de la pagina. */
function pieLegal(doc: Doc): void {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text(PIE_LEGAL, MARGEN, 841.89 - MARGEN - 20, { width: ANCHO, align: 'center' });
}

/** Barra de titulo de seccion (fondo gris, texto negro en negritas). */
function barra(doc: Doc, y: number, titulo: string, alto = 15): number {
  doc.rect(MARGEN, y, ANCHO, alto).fillAndStroke('#d9d9d9', '#000');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
  doc.text(titulo, MARGEN + 4, y + alto / 2 - 4.5, { width: ANCHO - 8 });
  return y + alto;
}

/** Casilla cuadrada; marcada dibuja una X. */
function casilla(doc: Doc, x: number, y: number, marcada: boolean, lado = 9): void {
  doc.rect(x, y, lado, lado).lineWidth(0.8).strokeColor('#000').stroke();
  if (marcada) {
    doc.font('Helvetica-Bold').fontSize(lado).fillColor('#000');
    doc.text('X', x + 1.2, y + 0.5, { width: lado, lineBreak: false });
  }
}

/**
 * Campo "Etiqueta: valor" dentro de una celda con marco. Devuelve la Y final.
 * El valor vacio deja el hueco en blanco, igual que el formato en papel.
 */
function campo(
  doc: Doc,
  x: number,
  y: number,
  ancho: number,
  etiqueta: string,
  valor: string,
  alto = 16
): void {
  doc.rect(x, y, ancho, alto).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
  const anchoEtiqueta = doc.widthOfString(etiqueta) + 3;
  doc.text(etiqueta, x + 3, y + alto / 2 - 3.5, { width: anchoEtiqueta, lineBreak: false });
  // El valor SIEMPRE cabe en un renglon: se encoge hasta 5.5pt y, si aun asi no
  // entra, se recorta. Dejarlo envolver rompia el marco de la celda.
  const disponible = Math.max(ancho - anchoEtiqueta - 6, 10);
  let tam = 8;
  doc.font('Helvetica').fontSize(tam);
  while (tam > 5.5 && doc.widthOfString(valor) > disponible) {
    tam -= 0.5;
    doc.fontSize(tam);
  }
  let visible = valor;
  while (visible.length > 1 && doc.widthOfString(visible) > disponible) {
    visible = visible.slice(0, -2);
  }
  if (visible !== valor && visible.length > 1) visible = `${visible.slice(0, -3)}...`;
  doc.text(visible, x + 3 + anchoEtiqueta, y + alto / 2 - tam / 2 - 0.5, {
    width: disponible,
    lineBreak: false
  });
}

/**
 * Fila de tabla con celdas de anchos dados. El alto crece con el contenido: los
 * nombres de los conceptos de apoyo son largos ("CAA: CONSTRUCCION DE OLLA PARA
 * ALMACENAMIENTO DE AGUA") y con alto fijo se salian del marco encimandose con
 * la fila siguiente.
 */
function filaTabla(
  doc: Doc,
  x: number,
  y: number,
  anchos: number[],
  celdas: string[],
  opciones: { negritas?: boolean; alto?: number; fondo?: string; tam?: number } = {}
): number {
  const altoMinimo = opciones.alto ?? 16;
  const tam = opciones.tam ?? 7;
  doc.font(opciones.negritas ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);

  let altoTexto = 0;
  for (let i = 0; i < anchos.length; i++) {
    const h = doc.heightOfString(celdas[i] ?? '', { width: anchos[i] - 4, align: 'center' });
    if (h > altoTexto) altoTexto = h;
  }
  const alto = Math.max(altoMinimo, altoTexto + 6);

  let cx = x;
  for (let i = 0; i < anchos.length; i++) {
    if (opciones.fondo) {
      doc.rect(cx, y, anchos[i], alto).fillAndStroke(opciones.fondo, '#000');
    } else {
      doc.rect(cx, y, anchos[i], alto).lineWidth(0.5).strokeColor('#000').stroke();
    }
    doc
      .fillColor('#000')
      .font(opciones.negritas ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(tam);
    const h = doc.heightOfString(celdas[i] ?? '', { width: anchos[i] - 4, align: 'center' });
    doc.text(celdas[i] ?? '', cx + 2, y + (alto - h) / 2, {
      width: anchos[i] - 4,
      align: 'center'
    });
    cx += anchos[i];
  }
  return y + alto;
}

// ---------------------------------------------------------------------------
// Paginas
// ---------------------------------------------------------------------------

function pagina1(doc: Doc, d: DatosSolicitudCompleta): void {
  const s = d.solicitud;
  let y = encabezado(doc, txt(s.folio), txt(s.recibida_fecha), true);

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000');
  doc.text('SOLICITUD DE APOYO', MARGEN, y, { width: ANCHO, align: 'center' });
  y += 16;
  doc.fontSize(10);
  doc.text('PROGRAMA INSTITUCIONAL APOYO AL CAMPO QUERETANO 2026', MARGEN, y, {
    width: ANCHO,
    align: 'center'
  });
  y += 13;
  doc.fontSize(9.5);
  doc.text(`SUBPROGRAMA ${txt(s.subprograma_nombre).toUpperCase()}`, MARGEN, y, {
    width: ANCHO,
    align: 'center'
  });
  y += 16;

  // Componentes: uno por fila, con casilla a la derecha. Catalogo en vivo.
  for (const c of d.componentes) {
    doc.rect(MARGEN, y, ANCHO, 14).lineWidth(0.5).strokeColor('#000').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#000');
    doc.text(`Componente ${c.nombre} (${c.clave})`, MARGEN + 4, y + 3.5, {
      width: ANCHO - 40,
      lineBreak: false,
      ellipsis: true
    });
    casilla(doc, MARGEN + ANCHO - 16, y + 2.5, Number(c.id) === Number(s.componente_id));
    y += 14;
  }
  y += 6;

  // --- 1. VENTANILLA RECEPTORA ---------------------------------------------
  y = barra(doc, y, '1. VENTANILLA RECEPTORA');
  const anchoVent = ANCHO / d.ventanillas.length;
  const anchosVent = d.ventanillas.map(() => anchoVent);
  let vx = MARGEN;
  for (const v of d.ventanillas) {
    const marcada = Number(v.id) === Number(s.ventanilla_id);
    doc.rect(vx, y, anchoVent, 22).fillAndStroke(marcada ? '#bfbfbf' : '#ffffff', '#000');
    doc
      .fillColor('#000')
      .font(marcada ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7);
    doc.text(v.nombre, vx + 2, y + 5, { width: anchoVent - 4, align: 'center' });
    if (marcada) {
      doc.font('Helvetica-Bold').fontSize(7);
      doc.text('X', vx + 2, y + 14, { width: anchoVent - 4, align: 'center', lineBreak: false });
    }
    vx += anchoVent;
  }
  void anchosVent;
  y += 22 + 6;

  // --- 2. DATOS DEL SOLICITANTE --------------------------------------------
  y = barra(doc, y, '2. DATOS DEL SOLICITANTE Y/O REPRESENTANTE DEL GRUPO');

  // 2.1 tipo de persona
  doc.rect(MARGEN, y, ANCHO, 15).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('2.1 PERSONALES', MARGEN + 3, y + 4, { width: 70, lineBreak: false });
  const tipos: Array<[string, string]> = [
    ['Persona fisica:', 'fisica'],
    ['Persona moral sin fines de lucro:', 'moral'],
    ['Grupo de productores:', 'grupo']
  ];
  let tx = MARGEN + 78;
  doc.font('Helvetica').fontSize(7.5);
  for (const [etiqueta, valor] of tipos) {
    const w = doc.widthOfString(etiqueta);
    doc.font('Helvetica').fontSize(7.5).fillColor('#000');
    doc.text(etiqueta, tx, y + 4, { width: w + 2, lineBreak: false });
    casilla(doc, tx + w + 4, y + 3, txt(s.tipo_persona) === valor, 8);
    tx += w + 18;
  }
  y += 15;

  campo(
    doc,
    MARGEN,
    y,
    ANCHO,
    'Nombre (s) y Apellidos del solicitante, representante de grupo y/o representante legal:',
    txt(s.nombre_solicitante),
    17
  );
  y += 17;

  campo(doc, MARGEN, y, ANCHO * 0.3, 'Sexo:', txt(s.sexo));
  campo(doc, MARGEN + ANCHO * 0.3, y, ANCHO * 0.7, 'Fecha de nacimiento:', txt(s.fecha_nacimiento_fmt));
  y += 16;
  campo(doc, MARGEN, y, ANCHO * 0.55, 'Correo electrónico:', txt(s.correo));
  campo(doc, MARGEN + ANCHO * 0.55, y, ANCHO * 0.45, 'Número de teléfono:', txt(s.telefono));
  y += 16;
  campo(doc, MARGEN, y, ANCHO, 'CURP:', txt(s.curp));
  y += 16;
  campo(
    doc,
    MARGEN,
    y,
    ANCHO,
    'Si es persona moral o grupo de productores, agregar nombre o razón social:',
    txt(s.razon_social)
  );
  y += 16;
  campo(
    doc,
    MARGEN,
    y,
    ANCHO,
    'Número de integrantes de la persona moral o grupo de productores:',
    num(s.num_integrantes)
  );
  y += 16 + 4;

  // 2.2 Domicilio
  y = barra(doc, y, '2.2 DOMICÍLIO PARTICULAR', 14);
  campo(doc, MARGEN, y, ANCHO * 0.32, 'Municipio:', txt(s.dom_municipio_nombre));
  campo(doc, MARGEN + ANCHO * 0.32, y, ANCHO * 0.26, 'Localidad:', txt(s.dom_localidad));
  campo(doc, MARGEN + ANCHO * 0.58, y, ANCHO * 0.26, 'Delegación:', txt(s.dom_delegacion));
  campo(doc, MARGEN + ANCHO * 0.84, y, ANCHO * 0.16, 'C.P.:', txt(s.dom_cp));
  y += 16;
  campo(doc, MARGEN, y, ANCHO * 0.5, 'Tipo de asentamiento humano:', capitalizar(s.dom_tipo_asentamiento));
  campo(doc, MARGEN + ANCHO * 0.5, y, ANCHO * 0.5, 'Nombre del asentamiento humano:', txt(s.dom_asentamiento));
  y += 16;
  campo(doc, MARGEN, y, ANCHO, 'Tipo de vialidad del domicilio:', capitalizar(s.dom_tipo_vialidad));
  y += 16;
  campo(doc, MARGEN, y, ANCHO * 0.6, 'Nombre de la vialidad y número:', txt(s.dom_vialidad));
  // El modelo actual no captura numero exterior/interior por separado: van en
  // blanco, para llenarse a mano si hiciera falta.
  campo(doc, MARGEN + ANCHO * 0.6, y, ANCHO * 0.2, 'Número exterior:', '');
  campo(doc, MARGEN + ANCHO * 0.8, y, ANCHO * 0.2, 'Número interior:', '');
  y += 16 + 4;

  // --- 3. ACTIVIDAD ECONÓMICA ----------------------------------------------
  y = barra(doc, y, '3. ACTIVIDAD ECONÓMICA');

  // Agricola
  doc.rect(MARGEN, y, ANCHO, 16).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('Agrícola', MARGEN + 3, y + 4.5, { width: 40, lineBreak: false });
  casilla(doc, MARGEN + 42, y + 3.5, s.act_agricola === true, 8);
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('Superficie total (ha)', MARGEN + 60, y + 5, { width: 90, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(num(s.agr_superficie_total_ha), MARGEN + 152, y + 4.5, { width: 80, lineBreak: false });
  y += 16;
  campo(doc, MARGEN, y, ANCHO * 0.28, 'Superficie de siembra (ha):', num(s.agr_superficie_siembra_ha));
  campo(doc, MARGEN + ANCHO * 0.28, y, ANCHO * 0.18, 'Temporal (ha):', num(s.agr_temporal_ha));
  campo(doc, MARGEN + ANCHO * 0.46, y, ANCHO * 0.16, 'Riego (ha):', num(s.agr_riego_ha));
  campo(doc, MARGEN + ANCHO * 0.62, y, ANCHO * 0.38, 'Cultivo principal:', txt(s.agr_cultivo_principal));
  y += 16;

  // Ganadera
  doc.rect(MARGEN, y, ANCHO, 16).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('Ganadera', MARGEN + 3, y + 4.5, { width: 45, lineBreak: false });
  casilla(doc, MARGEN + 46, y + 3.5, s.act_ganadera === true, 8);
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('Tipo de ganado:', MARGEN + 62, y + 5, { width: 70, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(txt(s.gan_tipo_ganado), MARGEN + 128, y + 4.5, { width: 100, lineBreak: false, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('No. de cabezas/colmenas:', MARGEN + 232, y + 5, { width: 110, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(num(s.gan_num_cabezas), MARGEN + 338, y + 4.5, { width: 50, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('Superficie de agostaderos:', MARGEN + 388, y + 5, { width: 110, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(num(s.gan_superficie_agostadero_ha), MARGEN + 490, y + 4.5, { width: 32, lineBreak: false });
  y += 16;
  campo(doc, MARGEN, y, ANCHO, 'Producción:', capitalizar(s.gan_produccion));
  y += 16;

  // Acuicola / Pesca
  doc.rect(MARGEN, y, ANCHO, 16).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('Acuícola', MARGEN + 3, y + 4.5, { width: 42, lineBreak: false });
  casilla(doc, MARGEN + 44, y + 3.5, s.act_acuicola === true, 8);
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('Especies:', MARGEN + 60, y + 5, { width: 45, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(txt(s.acu_especies), MARGEN + 104, y + 4.5, { width: ANCHO - 110, lineBreak: false, ellipsis: true });
  y += 16;
  doc.rect(MARGEN, y, ANCHO, 16).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('Pesca', MARGEN + 3, y + 4.5, { width: 42, lineBreak: false });
  casilla(doc, MARGEN + 44, y + 3.5, s.act_pesca === true, 8);
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('Especies:', MARGEN + 60, y + 5, { width: 45, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(txt(s.pes_especies), MARGEN + 104, y + 4.5, { width: ANCHO - 110, lineBreak: false, ellipsis: true });

  pieLegal(doc);
}

function pagina2(doc: Doc, d: DatosSolicitudCompleta): void {
  const s = d.solicitud;
  let y = encabezado(doc, txt(s.folio), txt(s.recibida_fecha));

  // --- 4. DATOS DEL APOYO ---------------------------------------------------
  y = barra(doc, y, '4. DATOS DEL APOYO');
  const descripcion =
    txt(s.descripcion_proyecto) ||
    d.conceptos
      .map((c) => txt(c.descripcion) || txt(c.tipo_apoyo))
      .filter((t) => t !== '')
      .join('; ');
  doc.rect(MARGEN, y, ANCHO, 58).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('Descripción del proyecto:', MARGEN + 4, y + 4, { width: ANCHO - 8 });
  doc.font('Helvetica').fontSize(8);
  doc.text(descripcion, MARGEN + 4, y + 15, { width: ANCHO - 8, height: 40, ellipsis: true });
  y += 58 + 4;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text(
    'Número de beneficiarios directos (familiares, Integrantes de Persona Moral o Grupo de Beneficiarios)',
    MARGEN,
    y,
    { width: ANCHO }
  );
  y += 12;
  const anchosBen = [ANCHO * 0.5, ANCHO * 0.25, ANCHO * 0.25];
  y = filaTabla(doc, MARGEN, y, anchosBen, ['', 'HOMBRES', 'MUJERES'], {
    negritas: true,
    fondo: '#d9d9d9',
    alto: 14
  });
  y = filaTabla(
    doc,
    MARGEN,
    y,
    anchosBen,
    ['Total de beneficiarios', num(s.ben_hombres_total), num(s.ben_mujeres_total)],
    { alto: 14 }
  );
  y = filaTabla(
    doc,
    MARGEN,
    y,
    anchosBen,
    [
      'Beneficiarios con discapacidad',
      num(s.ben_hombres_discapacidad),
      num(s.ben_mujeres_discapacidad)
    ],
    { alto: 14 }
  );
  y = filaTabla(
    doc,
    MARGEN,
    y,
    anchosBen,
    [
      'Beneficiarios con lengua indígena',
      num(s.ben_hombres_lengua_indigena),
      num(s.ben_mujeres_lengua_indigena)
    ],
    { alto: 14 }
  );
  y += 6;

  // --- 4.1 UBICACIÓN DEL APOYO ---------------------------------------------
  y = barra(doc, y, '4.1 UBICACIÓN DEL APOYO', 14);
  campo(doc, MARGEN, y, ANCHO, 'Municipio:', txt(s.ubi_municipio_nombre));
  y += 16;
  campo(doc, MARGEN, y, ANCHO * 0.5, 'Localidad:', txt(s.ubi_localidad));
  campo(doc, MARGEN + ANCHO * 0.5, y, ANCHO * 0.5, 'Ejido:', txt(s.ubi_ejido));
  y += 16;
  campo(doc, MARGEN, y, ANCHO, 'Coordenadas Geográficas:', txt(s.ubi_coordenadas) || 'null,');
  y += 16 + 6;

  // --- 5. CONCEPTO DE APOYO -------------------------------------------------
  y = barra(doc, y, '5. CONCEPTO DE APOYO');
  const anchosCon = [
    ANCHO * 0.16,
    ANCHO * 0.22,
    ANCHO * 0.11,
    ANCHO * 0.12,
    ANCHO * 0.13,
    ANCHO * 0.14,
    ANCHO * 0.12
  ];
  y = filaTabla(
    doc,
    MARGEN,
    y,
    anchosCon,
    [
      'CONCEPTO',
      'DESCRIPCIÓN',
      'CANTIDAD SOLICITADA',
      'UNIDAD DE MEDIDA',
      'APOYO ESTATAL ($)',
      'APORTACIÓN DEL PRODUCTOR ($)',
      'INVERSIÓN TOTAL'
    ],
    { negritas: true, fondo: '#d9d9d9', alto: 26, tam: 5.5 }
  );
  for (const c of d.conceptos) {
    y = filaTabla(
      doc,
      MARGEN,
      y,
      anchosCon,
      [
        txt(c.tipo_apoyo),
        txt(c.descripcion),
        num(c.cantidad),
        txt(c.unidad_medida),
        pesos(c.monto_estatal),
        pesos(c.monto_productor),
        pesos(c.monto_total)
      ],
      { alto: 16, tam: 6 }
    );
  }
  if (d.conceptos.length === 0) {
    y = filaTabla(doc, MARGEN, y, anchosCon, ['', '', '', '', '', '', ''], { alto: 16 });
  }
  y += 6;

  // --- OBSERVACIONES --------------------------------------------------------
  doc.rect(MARGEN, y, ANCHO, 34).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('OBSERVACIONES (Opcional)', MARGEN + 4, y + 3, { width: ANCHO - 8 });
  doc.font('Helvetica').fontSize(8);
  doc.text(txt(s.observaciones), MARGEN + 4, y + 14, { width: ANCHO - 8, height: 18, ellipsis: true });
  y += 34 + 6;

  // --- 6. DECLARACIONES -----------------------------------------------------
  y = barra(doc, y, '6. DECLARACIONES DEL SOLICITANTE');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
  doc.text('Declaro bajo protesta de decir verdad', MARGEN + 2, y + 4, { width: ANCHO });
  y += 15;
  for (const [letra, texto] of DECLARACIONES) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
    doc.text(letra, MARGEN + 4, y, { width: 12, lineBreak: false });
    doc.font('Helvetica').fontSize(7);
    doc.text(texto, MARGEN + 18, y, { width: ANCHO - 22, align: 'justify' });
    y = doc.y + 2.5;
  }

  // --- Firmas (se llenan a mano en papel) ----------------------------------
  // Cierran la pagina 2 justo despues de las declaraciones; el pie legal
  // sigue anclado al fondo de la hoja.
  y += 26;
  const mitad = ANCHO / 2;
  doc.moveTo(MARGEN + 20, y).lineTo(MARGEN + mitad - 20, y).lineWidth(0.8).strokeColor('#000').stroke();
  doc.moveTo(MARGEN + mitad + 20, y).lineTo(MARGEN + ANCHO - 20, y).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  doc.text('Nombre y firma del solicitante', MARGEN + 20, y + 4, { width: mitad - 40, align: 'center' });
  doc.text('Nombre y firma del funcionario\nreceptor de la solicitud', MARGEN + mitad + 20, y + 4, {
    width: mitad - 40,
    align: 'center'
  });

  pieLegal(doc);
}

function pagina3(doc: Doc, d: DatosSolicitudCompleta): void {
  const s = d.solicitud;
  let y = encabezado(doc, txt(s.folio), txt(s.recibida_fecha));

  // --- 7. DICTAMEN ----------------------------------------------------------
  doc.rect(MARGEN, y, ANCHO, 15).fillAndStroke('#bfbfbf', '#000');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8.5);
  doc.text('DATOS PARA LLENAR POR EL ÁREA OPERATIVA DE LA SEDEA', MARGEN + 4, y + 3.5, {
    width: ANCHO - 8,
    align: 'center'
  });
  y += 15;
  y = barra(doc, y, '7. DICTAMEN DE LA SOLICITUD');

  const dic = d.dictamen;
  doc.rect(MARGEN, y, ANCHO, 16).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
  doc.text('POSITIVA', MARGEN + 60, y + 4.5, { width: 50, lineBreak: false });
  casilla(doc, MARGEN + 106, y + 3.5, dic?.resultado === 'positivo', 9);
  doc.text('NEGATIVA', MARGEN + 320, y + 4.5, { width: 55, lineBreak: false });
  casilla(doc, MARGEN + 372, y + 3.5, dic?.resultado === 'negativo', 9);
  y += 16 + 4;

  const anchosDic = [
    ANCHO * 0.24,
    ANCHO * 0.14,
    ANCHO * 0.15,
    ANCHO * 0.16,
    ANCHO * 0.17,
    ANCHO * 0.14
  ];
  y = filaTabla(
    doc,
    MARGEN,
    y,
    anchosDic,
    [
      'CONCEPTO',
      'CANTIDAD SOLICITADA',
      'UNIDAD DE MEDIDA',
      'APOYO ESTATAL ($)',
      'APORTACIÓN DEL PRODUCTOR ($)',
      'INVERSIÓN TOTAL'
    ],
    { negritas: true, fondo: '#d9d9d9', alto: 26, tam: 6 }
  );
  // Con dictamen registrado se imprimen los conceptos ya resueltos; sin el, la
  // fila va vacia para llenarse a mano en papel.
  if (dic) {
    for (const c of d.conceptos) {
      y = filaTabla(
        doc,
        MARGEN,
        y,
        anchosDic,
        [
          txt(c.tipo_apoyo),
          num(c.cantidad),
          txt(c.unidad_medida),
          pesos(c.monto_estatal),
          pesos(c.monto_productor),
          pesos(c.monto_total)
        ],
        { alto: 16, tam: 6 }
      );
    }
  }
  if (!dic || d.conceptos.length === 0) {
    y = filaTabla(doc, MARGEN, y, anchosDic, ['', '', '', '', '', ''], { alto: 18 });
  }
  y += 8;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
  doc.text('OBSERVACIONES (Opcional):', MARGEN, y, { width: 130, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  if (dic?.nota) {
    doc.text(txt(dic.nota), MARGEN + 132, y - 1, { width: ANCHO - 134, height: 10, ellipsis: true });
  }
  y += 12;
  // Tres renglones en blanco para llenar a mano.
  for (let i = 0; i < 3; i++) {
    doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).lineWidth(0.5).strokeColor('#000').stroke();
    y += 14;
  }
  y += 14;

  doc.moveTo(MARGEN + 100, y).lineTo(MARGEN + ANCHO - 100, y).lineWidth(0.8).strokeColor('#000').stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  if (dic?.dictaminado_por_nombre) {
    doc.text(txt(dic.dictaminado_por_nombre), MARGEN + 100, y - 11, {
      width: ANCHO - 200,
      align: 'center',
      lineBreak: false
    });
  }
  doc.text('Nombre y firma del funcionario que realizó el dictamen', MARGEN + 100, y + 3, {
    width: ANCHO - 200,
    align: 'center'
  });
  y += 20;

  doc.font('Helvetica').fontSize(6.2).fillColor('#000');
  doc.text(AVISO_PRIVACIDAD_7, MARGEN, y, { width: ANCHO, align: 'justify' });
  y = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(6.2);
  doc.text(AVISO_PRIVACIDAD_7_PORTAL, MARGEN, y, { width: ANCHO, align: 'justify' });
  y = doc.y + 6;

  // --- COMPROBANTE DEL BENEFICIARIO ----------------------------------------
  // Linea de corte: en papel el ciudadano se lleva esta mitad inferior.
  doc.save().dash(3, { space: 3 });
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).lineWidth(0.6).strokeColor('#666').stroke();
  doc.restore();
  y += 8;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  doc.text(`FOLIO: ${txt(s.folio)}`, MARGEN, y, { width: 200 });
  y += 14;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('COMPROBANTE DEL BENEFICIARIO', MARGEN, y, { width: ANCHO, align: 'center' });
  y += 16;

  campo(doc, MARGEN, y, ANCHO * 0.45, 'Nombre del beneficiario:', txt(s.nombre_solicitante));
  // A diferencia del formato en papel (que dejaba estos dos huecos en blanco),
  // el sistema SI sabe quien recibio la solicitud y cuando: se imprime resuelto.
  campo(
    doc,
    MARGEN + ANCHO * 0.45,
    y,
    ANCHO * 0.55,
    'Datos del funcionario receptor de la solicitud:',
    txt(s.capturado_por_nombre)
  );
  y += 16;
  campo(doc, MARGEN, y, ANCHO, 'Fecha de recepción:', txt(s.recibida_fecha));
  y += 16 + 4;

  doc.font('Helvetica').fontSize(6.2).fillColor('#000');
  doc.text(AVISO_PRIVACIDAD_COMPROBANTE, MARGEN, y, { width: ANCHO, align: 'justify' });
  y = doc.y + 5;
  doc.font('Helvetica').fontSize(7.5);
  doc.text(
    'La presentación de la solicitud y el expediente correspondientes no implica la autorización ni el pago de los apoyos por parte de la SEDEA.',
    MARGEN,
    y,
    { width: ANCHO, align: 'justify' }
  );

  pieLegal(doc);
}

// ---------------------------------------------------------------------------
// Entrada publica
// ---------------------------------------------------------------------------

export async function generarSolicitudCompletaPdf(solicitudId: number): Promise<Buffer> {
  const datos = await obtenerDatos(solicitudId);
  if (!datos) throw new Error('Solicitud no encontrada');

  // autoFirstPage + addPage explicitos: exactamente 3 paginas. `margin: 0`
  // evita que un texto largo dispare un salto de pagina automatico y rompa la
  // paginacion fija del formato oficial (cada bloque ya viene acotado).
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
  const trozos: Buffer[] = [];
  doc.on('data', (t) => trozos.push(t as Buffer));

  pagina1(doc, datos);
  doc.addPage({ size: 'A4', margin: 0 });
  pagina2(doc, datos);
  doc.addPage({ size: 'A4', margin: 0 });
  pagina3(doc, datos);

  const listo = new Promise<void>((resolver, rechazar) => {
    doc.on('end', () => resolver());
    doc.on('error', rechazar);
  });
  doc.end();
  await listo;
  return Buffer.concat(trozos);
}
