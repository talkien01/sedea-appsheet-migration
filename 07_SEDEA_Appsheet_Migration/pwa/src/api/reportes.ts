// Modulo de Reportes: catalogos de filtros + el resumen/matriz + el padron,
// en JSON. La exportacion a Excel se resuelve aparte con `urlConToken`
// (cliente.ts), igual que el PDF de solicitud-completa -- es una descarga de
// archivo, no una respuesta JSON.
import { peticion } from './cliente';
import type {
  DimensionReporte,
  FiltrosComunesReporte,
  FiltrosReporte,
  RespuestaPadron,
  RespuestaReporte
} from '@sedea/shared';

export interface CatalogosReporte {
  regionales: Array<{ id: number; nombre: string }>;
  municipios: Array<{ id: number; nombre: string; regional_id: number | null }>;
  programas: Array<{ id: number; nombre: string }>;
  conceptos: Array<{ id: number; nombre: string; unidad_medida: string | null }>;
  capturistas: Array<{ id: number; nombre: string }>;
}

export async function catalogosReporte(): Promise<CatalogosReporte> {
  return peticion<CatalogosReporte>('/reportes/catalogos');
}

/** Arma el query string compartido por la pantalla y la exportacion a Excel
 * (resumen/matriz). */
export function armarQueryReporte(
  filtros: Partial<FiltrosReporte> & { agrupar_por: DimensionReporte }
): string {
  const parametros = new URLSearchParams();
  parametros.set('agrupar_por', filtros.agrupar_por);
  if (filtros.agrupar_por_2) parametros.set('agrupar_por_2', filtros.agrupar_por_2);
  if (filtros.anio) parametros.set('anio', String(filtros.anio));
  if (filtros.regional_id) parametros.set('regional_id', String(filtros.regional_id));
  if (filtros.municipio_id) parametros.set('municipio_id', String(filtros.municipio_id));
  if (filtros.programa_id) parametros.set('programa_id', String(filtros.programa_id));
  if (filtros.tipo_apoyo_id) parametros.set('tipo_apoyo_id', String(filtros.tipo_apoyo_id));
  if (filtros.capturista_id) parametros.set('capturista_id', String(filtros.capturista_id));
  return parametros.toString();
}

export async function generarReporte(
  filtros: Partial<FiltrosReporte> & { agrupar_por: DimensionReporte }
): Promise<RespuestaReporte> {
  return peticion<RespuestaReporte>(`/reportes/solicitudes?${armarQueryReporte(filtros)}`);
}

/** Arma el query string compartido por la pantalla y la exportacion a Excel
 * (padron -- sin dimension de agrupacion, es un detalle plano). */
export function armarQueryPadron(filtros: Partial<FiltrosComunesReporte>): string {
  const parametros = new URLSearchParams();
  if (filtros.anio) parametros.set('anio', String(filtros.anio));
  if (filtros.regional_id) parametros.set('regional_id', String(filtros.regional_id));
  if (filtros.municipio_id) parametros.set('municipio_id', String(filtros.municipio_id));
  if (filtros.programa_id) parametros.set('programa_id', String(filtros.programa_id));
  if (filtros.tipo_apoyo_id) parametros.set('tipo_apoyo_id', String(filtros.tipo_apoyo_id));
  if (filtros.capturista_id) parametros.set('capturista_id', String(filtros.capturista_id));
  return parametros.toString();
}

export async function generarPadron(filtros: Partial<FiltrosComunesReporte>): Promise<RespuestaPadron> {
  return peticion<RespuestaPadron>(`/reportes/padron?${armarQueryPadron(filtros)}`);
}
