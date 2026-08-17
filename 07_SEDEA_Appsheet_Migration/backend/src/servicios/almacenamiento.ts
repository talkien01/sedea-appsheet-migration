// Almacenamiento de fotos en el filesystem del contenedor (volumen Docker).
// Unico driver implementado: STORAGE_DRIVER=local.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface FotoGuardada {
  /** Ruta publica servida por la API, ej. /media/2026/08/<uuid>.jpg */
  url: string;
  /** Ruta absoluta en disco. */
  rutaAbsoluta: string;
  hash: string;
  bytes: number;
}

/** Normaliza la imagen a JPEG (max 1600 px) y la escribe en /media/AAAA/MM/. */
export async function guardarFoto(buffer: Buffer, uuid: string): Promise<FotoGuardada> {
  const ahora = new Date();
  const anio = String(ahora.getUTCFullYear());
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');

  const directorio = path.join(config.directorioMedia, anio, mes);
  fs.mkdirSync(directorio, { recursive: true });

  let contenido = buffer;
  try {
    // sharp es opcional en la practica: si falla se guarda el original.
    const sharp = (await import('sharp')).default;
    contenido = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (error) {
    console.warn('No se pudo normalizar la imagen con sharp, se guarda el original:', (error as Error).message);
  }

  const nombre = `${uuid}.jpg`;
  const rutaAbsoluta = path.join(directorio, nombre);
  fs.writeFileSync(rutaAbsoluta, contenido);

  const hash = crypto.createHash('sha256').update(contenido).digest('hex');
  const url = `${config.rutaPublicaMedia}/${anio}/${mes}/${nombre}`;

  return { url, rutaAbsoluta, hash, bytes: contenido.length };
}

/** Extensiones aceptadas como adjunto de un documento de solicitud (E46). */
export const TIPOS_ADJUNTO_SOLICITUD: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

/**
 * Guarda el adjunto de un documento de solicitud en
 * /media/solicitudes/AAAA/MM/<uuid>.<ext> (D43). Reutiliza el mismo driver
 * `local` y el mismo MEDIA_DIR que las fotos de evidencia: solo cambia la
 * subcarpeta. El archivo se guarda tal cual llega (puede ser un PDF), sin
 * pasar por la normalizacion de imagenes.
 */
export function guardarAdjuntoSolicitud(
  buffer: Buffer,
  uuid: string,
  extension: string
): FotoGuardada {
  const ahora = new Date();
  const anio = String(ahora.getUTCFullYear());
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');

  const directorio = path.join(config.directorioMedia, 'solicitudes', anio, mes);
  fs.mkdirSync(directorio, { recursive: true });

  const nombre = `${uuid}.${extension}`;
  const rutaAbsoluta = path.join(directorio, nombre);
  fs.writeFileSync(rutaAbsoluta, buffer);

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const url = `${config.rutaPublicaMedia}/solicitudes/${anio}/${mes}/${nombre}`;

  return { url, rutaAbsoluta, hash, bytes: buffer.length };
}

/** Traduce una url publica /media/... a su ruta absoluta en disco. */
export function rutaAbsolutaDesdeUrl(url: string): string | null {
  if (!url.startsWith(config.rutaPublicaMedia)) return null;
  const relativa = url.slice(config.rutaPublicaMedia.length).replace(/^\/+/, '');
  const absoluta = path.join(config.directorioMedia, relativa);
  // Evita traversal fuera del directorio de medios.
  if (!absoluta.startsWith(config.directorioMedia)) return null;
  return fs.existsSync(absoluta) ? absoluta : null;
}

/** Asegura que exista el directorio de medios al arrancar. */
export function prepararAlmacenamiento(): void {
  fs.mkdirSync(config.directorioMedia, { recursive: true });
}
