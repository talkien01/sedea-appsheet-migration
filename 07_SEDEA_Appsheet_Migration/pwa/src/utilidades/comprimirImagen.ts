// Compresion de fotografias en el cliente, compartida entre CapturaFoto.tsx
// (fotos nuevas) y sync/motor.ts (fotos YA encoladas que quedaron pesadas por
// el bug de abajo, capturadas antes de este fix).
//
// A proposito NUNCA se regresa el archivo original sin comprimir: un JPEG de
// camara sin comprimir puede pesar 5-15 MB en iPhones recientes, y eso
// satura la memoria del navegador a media subida en senal movil -- en la
// practica se ve identico a "se quedo pegado para siempre" (bug real de
// campo, 2026-09-22: 122 entregas nunca lograban ni un solo intento real).
export const LADO_MAXIMO = 1600;
export const CALIDAD = 0.75;
/** Tope final: por debajo del limite del servidor (8 MB), con margen. */
export const PESO_MAXIMO_BYTES = 4 * 1024 * 1024;

/** Dibuja una imagen ya decodificada (bitmap o <img>) en un canvas y la recomprime. */
function dibujarYComprimir(
  fuente: CanvasImageSource,
  anchoOriginal: number,
  altoOriginal: number
): Promise<Blob | null> {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(anchoOriginal, altoOriginal));
  const ancho = Math.round(anchoOriginal * escala);
  const alto = Math.round(altoOriginal * escala);

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext('2d');
  if (!contexto) return Promise.resolve(null);
  contexto.drawImage(fuente, 0, 0, ancho, alto);

  return new Promise<Blob | null>((resolver) => {
    lienzo.toBlob(resolver, 'image/jpeg', CALIDAD);
  });
}

/** Intento 1: createImageBitmap (rapido, pero con huecos de soporte en iOS Safari segun version/formato). */
async function comprimirConBitmap(archivo: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(archivo);
  try {
    return await dibujarYComprimir(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Intento 2 (respaldo): decodificar con un <img> normal. Mas compatible que
 * createImageBitmap en iOS Safari para ciertos JPEG/HEIC de camara -- es el
 * mismo mecanismo que ya usa la vista previa, asi que si esto tambien falla
 * es porque el archivo en si esta corrupto o el dispositivo no puede con el.
 */
async function comprimirConImg(archivo: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    await new Promise<void>((resolver, rechazar) => {
      img.onload = () => resolver();
      img.onerror = () => rechazar(new Error('No se pudo decodificar la imagen.'));
      img.src = url;
    });
    return await dibujarYComprimir(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Redimensiona y recomprime la imagen. Lanza si no se pudo procesar o si,
 * incluso comprimida, sigue pesando demasiado -- nunca regresa el original.
 */
export async function comprimirImagen(archivo: Blob): Promise<Blob> {
  let resultado: Blob | null = null;
  try {
    resultado = await comprimirConBitmap(archivo);
  } catch {
    // createImageBitmap no soportado o fallo con este archivo: se intenta
    // el respaldo antes de rendirse.
  }
  if (!resultado) {
    resultado = await comprimirConImg(archivo);
  }
  if (!resultado) {
    throw new Error('No fue posible procesar la imagen en este dispositivo.');
  }
  if (resultado.size > PESO_MAXIMO_BYTES) {
    throw new Error('La fotografía sigue pesando demasiado incluso comprimida.');
  }
  return resultado;
}
