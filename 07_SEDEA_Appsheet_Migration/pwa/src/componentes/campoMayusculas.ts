// Homologacion a MAYUSCULAS de los campos de texto libre.
//
// Es el mismo patron que ya usan el CURP de SeccionSolicitante y el
// prefijo_folio de FormCatalogo: el valor se guarda en mayusculas en el
// estado (`aMayusculas` en el onChange) y el input se pinta en mayusculas
// mientras se escribe (`ESTILO_MAYUSCULAS`), para que lo que el capturista
// ve sea exactamente lo que se guarda.
//
// NO aplica a correo (los correos van en minusculas), telefono, CP,
// coordenadas ni a ningun campo numerico o de catalogo.
import type { CSSProperties } from 'react';

/** Convierte a mayusculas sin tocar acentos ni la enie. */
export function aMayusculas(valor: string): string {
  return valor.toUpperCase();
}

/** El input se ve en mayusculas mientras se escribe. */
export const ESTILO_MAYUSCULAS: CSSProperties = { textTransform: 'uppercase' };
