// Lectura de QR via BarcodeDetector (Shape Detection API) cuando el
// navegador lo trae -- le pide la deteccion al motor NATIVO del sistema
// operativo (en Chrome/Android es el mismo ML Kit que usan las apps nativas
// de Google, el mismo tipo de motor que probablemente usa AppSheet) en vez
// de decodificar cuadro por cuadro en JS con jsQR. Mucho mas tolerante a
// angulo/perspectiva, ruido de impresion y enfoque imperfecto -- y mas
// barato en bateria, porque corre en codigo nativo, no en el hilo de JS.
//
// Cobertura real (2026-09): Chrome/Chromium en Android SI la trae. Safari y
// CUALQUIER navegador en iPhone (Chrome, Firefox, etc. -- todos corren sobre
// el motor de Apple por regla de la App Store) NO la trae. Donde no esta
// disponible, quien llama debe seguir usando jsQR sin ningun cambio -- por
// eso `leerQrNativo` devuelve `undefined` (no `null`) para "no se pudo ni
// intentar", distinto de `null` = "si se intento, no hay QR en la imagen".
//
// Se usa tanto para el video en vivo (le pasamos el <video> directo, sin
// pasar por canvas) como para la foto de respaldo (le pasamos el Blob/File
// directo, la API lo acepta nativamente).

/** Los tipos de BarcodeDetector no vienen en lib.dom (API todavia no
 * estandar en TypeScript/todos los navegadores) -- declaracion minima. */
declare global {
  interface DetectedBarcode {
    rawValue: string;
  }
  class BarcodeDetector {
    constructor(options?: { formats?: string[] });
    detect(imagen: ImageBitmapSource): Promise<DetectedBarcode[]>;
  }
}

let detector: BarcodeDetector | null | undefined;

/** true si el navegador soporta lectura nativa de QR. */
export function soportaLecturaNativaQr(): boolean {
  return typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined';
}

function obtenerDetector(): BarcodeDetector | null {
  if (detector !== undefined) return detector;
  if (!soportaLecturaNativaQr()) {
    detector = null;
    return detector;
  }
  try {
    detector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    detector = null;
  }
  return detector;
}

/**
 * Intenta leer un QR con el detector nativo del sistema.
 * - `undefined`: el navegador no lo soporta, no se pudo crear, O la
 *   deteccion tiro un error real -- quien llama debe recurrir a jsQR.
 *   IMPORTANTE: un error de `detect()` NUNCA debe tratarse como "0
 *   codigos encontrados" -- bug real (2026-09, Samsung Galaxy S24+): pasarle
 *   un `File`/`Blob` crudo a `detect()` puede fallar (no todas las
 *   implementaciones aceptan ese tipo de fuente igual que un <video> o un
 *   ImageBitmap) y el catch original devolvia `null` ("si se intento, no
 *   hay QR") en vez de `undefined` -- la foto de respaldo nunca caia a
 *   jsQR y se quedaba muda, mientras el video en vivo (que SI le pasa un
 *   <video>, fuente sin ambiguedad) funcionaba bien.
 * - `null`: SI se intentó Y la promesa resolvió sin error, pero no se
 *   encontró ningún QR en la imagen.
 * - `string`: el texto crudo decodificado.
 */
export async function leerQrNativo(fuente: ImageBitmapSource): Promise<string | null | undefined> {
  const d = obtenerDetector();
  if (!d) return undefined;
  try {
    const codigos = await d.detect(fuente);
    return codigos[0]?.rawValue ?? null;
  } catch {
    return undefined;
  }
}
