// Logotipos oficiales para los PDF generados por el backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'logos');

/** Lockup general usado por otros documentos existentes. */
export const LOGO_SEDEA = path.join(directorio, 'sedea-horizontal.png');
export const LOGO_GOBIERNO = path.join(directorio, 'qro-gobierno.png');

/**
 * Membrete aprobado para el folio de entrega: SEDEA + GEQ + Unión Ganadera
 * ya normalizados al mismo tamaño visual y centrados en una sola franja.
 */
export const MEMBRETE_FOLIO_ENTREGA = path.join(directorio, 'folio-membrete.png');

const RELACION_SEDEA = 888 / 284;
const RELACION_GOBIERNO = 1076 / 304;
const RELACION_MEMBRETE_FOLIO = 1700 / 180;

let avisado = false;
let avisadoFolio = false;

export function hayLogos(): boolean {
  const existen = fs.existsSync(LOGO_SEDEA) && fs.existsSync(LOGO_GOBIERNO);
  if (!existen && !avisado) {
    avisado = true;
    console.warn(`No se encontraron los logos en ${directorio}; los PDF se generan sin encabezado grafico.`);
  }
  return existen;
}

export function hayLogosFolio(): boolean {
  const existe = fs.existsSync(MEMBRETE_FOLIO_ENTREGA);
  if (!existe && !avisadoFolio) {
    avisadoFolio = true;
    console.warn(`No se encontró el membrete del folio de entrega en ${directorio}.`);
  }
  return existe;
}

interface Doc {
  image(src: string, x: number, y: number, opciones: { width?: number; height?: number }): unknown;
}

/**
 * Membrete existente de SEDEA + Gobierno. Se conserva sin cambios para los
 * otros PDF del sistema.
 */
export function membrete(doc: Doc, x: number, y: number, ancho: number, altoSedea = 34): number {
  if (!hayLogos()) return y;

  const anchoSedea = altoSedea * RELACION_SEDEA;
  const altoGobierno = altoSedea * 0.62;
  const anchoGobierno = altoGobierno * RELACION_GOBIERNO;

  doc.image(LOGO_SEDEA, x, y, { width: anchoSedea, height: altoSedea });
  doc.image(LOGO_GOBIERNO, x + ancho - anchoGobierno, y + (altoSedea - altoGobierno) / 2, {
    width: anchoGobierno,
    height: altoGobierno
  });

  return y + altoSedea;
}

/**
 * Inserta el membrete aprobado del folio de entrega, centrado. `anchoMembrete`
 * controla el tamaño general sin alterar la proporción entre los tres logos.
 */
export function membreteFolioEntrega(
  doc: Doc,
  x: number,
  y: number,
  ancho: number,
  anchoMembrete = 300
): number {
  if (!hayLogosFolio()) return y;

  const alto = anchoMembrete / RELACION_MEMBRETE_FOLIO;
  const inicio = x + (ancho - anchoMembrete) / 2;
  doc.image(MEMBRETE_FOLIO_ENTREGA, inicio, y, { width: anchoMembrete, height: alto });

  return y + alto;
}
