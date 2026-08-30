import { peticion, URL_API, ErrorPeticion } from './cliente';
import { obtenerSesion } from '../db/repositorios';

export interface CatalogoRegionalDigitalizacion {
  id: string;
  clave: string;
  nombre: string;
}

export interface CatalogoMunicipioDigitalizacion {
  id: string;
  clave: string;
  nombre: string;
  regional_id: string;
}

export interface CatalogosDigitalizacion {
  regionales: CatalogoRegionalDigitalizacion[];
  municipios: CatalogoMunicipioDigitalizacion[];
  regional_forzada_id: number | null;
}

export interface SolicitudDigitalizacion {
  id: number | string;
  folio: string;
  nombre_solicitante: string;
  ubi_municipio_id: number | string;
  municipio: string;
  regional_id: number | string;
  regional: string;
  componente_id: number | string;
  componente: string;
  en_lote: boolean;
  caratula_generada: boolean;
  digitalizado: boolean;
  incidencia: boolean;
}

export interface PaginaDigitalizacion {
  items: SolicitudDigitalizacion[];
  pagina: number;
  limite: number;
  total: number;
  paginas: number;
}

export interface LoteDigitalizacion {
  id: number | string;
  codigo: string;
  nombre: string;
  filtro_regional_id: number | string | null;
  filtro_municipio_id: number | string | null;
  estado: string;
  creado_en: string;
  creado_por: number | string;
  creado_por_nombre: string;
  solicitudes: number;
  caratulas_generadas: number;
  digitalizados: number;
  incidencias: number;
}

interface SeleccionDigitalizacion {
  solicitud_ids: number[];
  seleccionadas: number;
  total_filtradas: number;
  cantidad: string;
}

interface LoteCreadoDigitalizacion {
  id: string;
  codigo: string;
  nombre: string;
  solicitudes: number;
}

function filtrosQuery(filtros: {
  regionalId?: string;
  municipioId?: string;
  q?: string;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (filtros.regionalId) p.set('regional_id', filtros.regionalId);
  if (filtros.municipioId) p.set('municipio_id', filtros.municipioId);
  if (filtros.q?.trim()) p.set('q', filtros.q.trim());
  return p;
}

async function descargarPdf(ruta: string, cuerpo?: unknown): Promise<Blob> {
  const sesion = await obtenerSesion();
  const cabeceras = new Headers();
  if (sesion?.token) cabeceras.set('Authorization', `Bearer ${sesion.token}`);
  cabeceras.set('Content-Type', 'application/json');

  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_API}${ruta}`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo ?? {})
    });
  } catch {
    throw new ErrorPeticion(0, 'sin_red', 'No hay conexión con el servidor.');
  }

  if (!respuesta.ok) {
    let datos: any = null;
    try {
      datos = await respuesta.json();
    } catch {
      // El backend normalmente devuelve JSON; si no, usamos mensaje seguro.
    }
    throw new ErrorPeticion(
      respuesta.status,
      datos?.error?.codigo ?? 'error',
      datos?.error?.mensaje ?? 'No se pudo generar el PDF de carátulas.'
    );
  }

  return respuesta.blob();
}

export const apiDigitalizacion = {
  catalogos(): Promise<CatalogosDigitalizacion> {
    return peticion<CatalogosDigitalizacion>('/digitalizacion/catalogos');
  },

  solicitudes(
    filtros: { regionalId?: string; municipioId?: string; q?: string },
    pagina = 1,
    limite = 50
  ): Promise<PaginaDigitalizacion> {
    const p = filtrosQuery(filtros);
    p.set('estado', 'pendiente');
    p.set('pagina', String(pagina));
    p.set('limite', String(limite));
    return peticion<PaginaDigitalizacion>(`/digitalizacion/solicitudes?${p.toString()}`);
  },

  seleccion(
    filtros: { regionalId?: string; municipioId?: string; q?: string },
    cantidad: 10 | 20 | 30 | 50 | 100 | 200 | 'todas'
  ): Promise<SeleccionDigitalizacion> {
    const p = filtrosQuery(filtros);
    p.set('cantidad', String(cantidad));
    return peticion<SeleccionDigitalizacion>(`/digitalizacion/seleccion?${p.toString()}`);
  },

  lotes(regionalId?: string): Promise<{ items: LoteDigitalizacion[] }> {
    const p = new URLSearchParams();
    if (regionalId) p.set('regional_id', regionalId);
    const consulta = p.toString();
    return peticion<{ items: LoteDigitalizacion[] }>(
      `/digitalizacion/lotes${consulta ? `?${consulta}` : ''}`
    );
  },

  crearLote(entrada: {
    nombre: string;
    solicitudIds: number[];
    regionalId?: string;
    municipioId?: string;
    criterios?: Record<string, unknown>;
  }): Promise<LoteCreadoDigitalizacion> {
    return peticion<LoteCreadoDigitalizacion>('/digitalizacion/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nombre: entrada.nombre,
        solicitud_ids: entrada.solicitudIds,
        filtro_regional_id: entrada.regionalId || null,
        filtro_municipio_id: entrada.municipioId || null,
        criterios: entrada.criterios ?? {}
      })
    });
  },

  caratulas(loteId: number, solicitudIds?: number[]): Promise<Blob> {
    return descargarPdf(
      `/digitalizacion/lotes/${loteId}/caratulas`,
      solicitudIds?.length ? { solicitud_ids: solicitudIds } : {}
    );
  }
};
