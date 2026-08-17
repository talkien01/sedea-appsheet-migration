// Generacion del folio oficial de la Solicitud de Apoyo (12.5).
//
// Formato exacto, replicando el ejemplo real PEO-SJR-AME-0001-26:
//   {prefijo_proyecto}-{clave_regional}-{siglas_municipio}-{consecutivo}-{anio}
//
// El folio SIEMPRE lo calcula el backend (D41): si el body trae la clave
// `folio`, la ruta responde 422 campo_no_editable antes de llegar aqui.
import type { PoolClient } from 'pg';
import { siglasDesdeNombre } from '@sedea/shared';

export interface PartesFolio {
  /** proyectos.prefijo_folio, en mayusculas. */
  prefijo: string;
  /** ventanillas.clave_folio: identifica QUIEN recibio la solicitud. */
  claveRegional: string;
  /** municipios.siglas_folio de la UBICACION del apoyo (no del domicilio). */
  siglasMunicipio: string;
  /** Ultimos 2 digitos del anio en zona America/Mexico_City. */
  anio: number;
}

/**
 * Siglas del municipio: usa `siglas_folio` del catalogo y, si esta vacio,
 * el fallback determinista (Assumption 46) para que el sistema nunca falle
 * al generar un folio.
 */
export function siglasMunicipio(siglasFolio: string | null, nombre: string): string {
  const limpio = (siglasFolio ?? '').trim().toUpperCase();
  if (limpio.length === 3) return limpio;
  return siglasDesdeNombre(nombre);
}

/** Anio a 2 digitos en zona horaria de la Ciudad de Mexico. */
export function anioFolio(fecha = new Date()): number {
  const formateado = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric'
  }).format(fecha);
  return Number(formateado) % 100;
}

/**
 * Reserva atomicamente el siguiente consecutivo de la combinacion
 * (prefijo, clave_regional, siglas_municipio, anio). El consecutivo NUNCA se
 * reutiliza aunque la transaccion falle despues (Assumption 47): es el
 * comportamiento estandar de un contador y evita bloqueos entre ventanillas.
 */
export async function reservarConsecutivo(
  cliente: PoolClient,
  partes: PartesFolio
): Promise<number> {
  const { rows } = await cliente.query<{ consecutivo: number }>(
    `INSERT INTO solicitud_folios (prefijo, clave_regional, siglas_municipio, anio, consecutivo)
     VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (prefijo, clave_regional, siglas_municipio, anio)
     DO UPDATE SET consecutivo = solicitud_folios.consecutivo + 1
     RETURNING consecutivo`,
    [partes.prefijo, partes.claveRegional, partes.siglasMunicipio, partes.anio]
  );
  return Number(rows[0].consecutivo);
}

/** Arma el texto del folio con el consecutivo ya reservado. */
export function armarFolio(partes: PartesFolio, consecutivo: number): string {
  return [
    partes.prefijo.toUpperCase(),
    partes.claveRegional.toUpperCase(),
    partes.siglasMunicipio.toUpperCase(),
    String(consecutivo).padStart(4, '0'),
    String(partes.anio).padStart(2, '0')
  ].join('-');
}

/** Reserva el consecutivo y devuelve el folio listo para insertar. */
export async function generarFolio(cliente: PoolClient, partes: PartesFolio): Promise<string> {
  const consecutivo = await reservarConsecutivo(cliente, partes);
  return armarFolio(partes, consecutivo);
}
