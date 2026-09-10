// Visor de "Evidencia de entregas": listado + catalogos en JSON. El Excel se
// baja aparte con `urlConToken` (igual que el padron de Reportes).
import { peticion } from './cliente';
import type { CatalogosEvidencia, FiltrosEvidencia, RespuestaEvidencia } from '@sedea/shared';

export function armarQueryEvidencia(filtros: Partial<FiltrosEvidencia>): string {
  const p = new URLSearchParams();
  if (filtros.regional_id) p.set('regional_id', String(filtros.regional_id));
  if (filtros.tipo_apoyo_id) p.set('tipo_apoyo_id', String(filtros.tipo_apoyo_id));
  if (filtros.entregado_por) p.set('entregado_por', String(filtros.entregado_por));
  if (filtros.desde) p.set('desde', filtros.desde);
  if (filtros.hasta) p.set('hasta', filtros.hasta);
  if (filtros.offset) p.set('offset', String(filtros.offset));
  if (filtros.limite) p.set('limite', String(filtros.limite));
  return p.toString();
}

export async function catalogosEvidencia(): Promise<CatalogosEvidencia> {
  return peticion<CatalogosEvidencia>('/entregas/evidencia/catalogos');
}

export async function listarEvidencia(filtros: Partial<FiltrosEvidencia>): Promise<RespuestaEvidencia> {
  const query = armarQueryEvidencia(filtros);
  return peticion<RespuestaEvidencia>(`/entregas/evidencia${query ? `?${query}` : ''}`);
}
