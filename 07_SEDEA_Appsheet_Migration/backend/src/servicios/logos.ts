// Logotipos oficiales para el encabezado de los PDF (PDFKit).
//
// RESOLUCION DE RUTA. Los PNG viven en backend/assets/logos/ y NO en el
// assets/ de la raiz del monorepo, por una razon concreta: el Dockerfile del
// backend solo hace COPY de backend/, packages/shared/ y db/, asi que un
// assets/ en la raiz simplemente no existiria dentro del contenedor.
//
// Puestos ahi, la misma ruta relativa sirve en desarrollo y en produccion sin
// ningun paso de build: tsc emite a dist/ conservando rootDir, de modo que
// tanto backend/src/servicios/ como backend/dist/servicios/ cuelgan dos
// niveles por debajo de backend/. '../../assets/logos' resuelve en los dos.
//
//   dev    backend/src/servicios/logos.ts   -> backend/assets/logos
//   docker backend/dist/servicios/logos.js  -> backend/assets/logos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'logos');

/** Lockup completo de SEDEA. Es el logo PRINCIPAL del documento. */
export const LOGO_SEDEA = path.join(directorio, 'sedea-horizontal.png');
/** Gobierno del Estado. Acompana, en segundo plano. */
export const LOGO_GOBIERNO = path.join(directorio, 'qro-gobierno.png');

/** Proporciones reales de los recortes, para calcular el alto sin deformar. */
const RELACION_SEDEA = 888 / 284;
const RELACION_GOBIERNO = 1076 / 304;

let avisado = false;

/** Los logos son decorativos: si faltan, el PDF debe salir igual. */
export function hayLogos(): boolean {
  const existen = fs.existsSync(LOGO_SEDEA) && fs.existsSync(LOGO_GOBIERNO);
  if (!existen && !avisado) {
    avisado = true;
    console.warn(`No se encontraron los logos en ${directorio}; los PDF se generan sin encabezado grafico.`);
  }
  return existen;
}

interface Doc {
  image(src: string, x: number, y: number, opciones: { width?: number; height?: number }): unknown;
}

/**
 * Pinta el membrete en la primera pagina: SEDEA a la izquierda y, mas chico,
 * Gobierno del Estado alineado a la derecha. Devuelve la Y donde termina el
 * bloque, para que quien lo llama siga escribiendo debajo.
 *
 * `altoSedea` manda: el de Gobierno se calcula proporcional para que ambos
 * queden opticamente parejos sin que el segundo domine.
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
