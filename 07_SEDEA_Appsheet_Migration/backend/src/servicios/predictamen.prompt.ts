// System prompt y armado de los bloques de entrada del pre-dictamen (SPEC 19.5.3).
//
// Una llamada al modelo por DOCUMENTO con archivo (D19-11): el modelo recibe un
// solo archivo y el nombre del requisito al que ese archivo dice corresponder.
// No hay segmentacion ni adivinanza de limites entre documentos.
import path from 'node:path';

/** Prompt de sistema, literal. Fase 1: presencia, legibilidad y CURP. Nada mas (D19-3). */
export const SYSTEM_PREDICTAMEN = [
  'Eres un asistente de la Secretaría de Desarrollo Agropecuario de Querétaro. Recibes UN archivo',
  'escaneado que ventanilla adjuntó como soporte de UN documento requerido de una solicitud de apoyo, y',
  'el nombre de ese documento requerido. Determina: (1) si el archivo corresponde a ese documento',
  'requerido y por lo tanto el documento está presente, (2) si es legible (no borroso, no cortado, no',
  'en blanco). Además, si en el archivo es visible una CURP (típicamente en la identificación oficial o',
  'en la constancia de CURP), transcríbela exactamente como aparece y compárala con la CURP capturada.',
  'Si el archivo no muestra ninguna CURP, `curp_coincide` y `curp_leida` deben ser null. No evalúes',
  'vigencias, montos, superficies ni ningún otro contenido. Si el archivo no corresponde al documento',
  'requerido que se te indica, `presente` es false. Responde ÚNICAMENTE con un objeto JSON válido, sin',
  'texto antes ni después, con esta forma: {"presente":boolean,"legible":boolean,',
  '"curp_coincide":boolean|null,"curp_leida":string|null,"observacion":string}'
].join(' ');

/** Media types aceptados, deducidos de la extension de la url publica del archivo. */
const MEDIA_POR_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

/** Devuelve el media type del adjunto o null si la extension no es de las aceptadas (A19-4). */
export function mediaTypeDeUrl(url: string): string | null {
  const extension = path.extname(url.split('?')[0]).toLowerCase();
  return MEDIA_POR_EXTENSION[extension] ?? null;
}

export interface ContextoDocumento {
  requisito: string;
  curpCapturada: string | null;
  tipoPersona: string;
  folio: string;
}

/** Bloque de texto que acompana al archivo: requisito, CURP capturada, persona y folio. */
export function textoDeContexto(ctx: ContextoDocumento): string {
  return [
    `Documento requerido: ${ctx.requisito}`,
    `CURP capturada en la solicitud: ${ctx.curpCapturada ?? 'no capturada'}`,
    `Tipo de persona: ${ctx.tipoPersona}`,
    `Folio: ${ctx.folio}`,
    'Responde solo con el objeto JSON indicado.'
  ].join('\n');
}

/**
 * Arma el contenido del mensaje `user`: primero el archivo (documento o imagen
 * segun su media type), despues el bloque de texto con el contexto.
 */
export function bloquesDeDocumento(
  base64: string,
  mediaType: string,
  ctx: ContextoDocumento
): unknown[] {
  const bloqueArchivo =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  return [bloqueArchivo, { type: 'text', text: textoDeContexto(ctx) }];
}
