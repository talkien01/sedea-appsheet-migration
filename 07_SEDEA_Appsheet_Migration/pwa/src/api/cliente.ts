// Cliente HTTP unico contra la API. Todas las llamadas pasan por aqui para
// adjuntar el token y traducir los errores a mensajes en espanol.
import type {
  Beneficiario,
  PaginaBeneficiarios,
  RespuestaCatalogos,
  RespuestaLogin,
  RespuestaCaptura
} from '@sedea/shared';
import { obtenerSesion } from '../db/repositorios';

export const URL_API: string = import.meta.env.VITE_API_URL || '/api';
export const NOMBRE_APP: string = import.meta.env.VITE_APP_NOMBRE || 'SEDEA Campo';
export const URL_TILES: string =
  import.meta.env.VITE_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export class ErrorPeticion extends Error {
  estado: number;
  codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

async function tokenActual(): Promise<string | null> {
  const sesion = await obtenerSesion();
  return sesion?.token ?? null;
}

async function peticion<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const token = await tokenActual();
  const cabeceras = new Headers(opciones.headers);
  if (token) cabeceras.set('Authorization', `Bearer ${token}`);
  if (opciones.body && !(opciones.body instanceof FormData)) {
    cabeceras.set('Content-Type', 'application/json');
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_API}${ruta}`, { ...opciones, headers: cabeceras });
  } catch {
    throw new ErrorPeticion(0, 'sin_red', 'No hay conexion con el servidor.');
  }

  const tipo = respuesta.headers.get('content-type') ?? '';
  const cuerpo = tipo.includes('application/json') ? await respuesta.json() : null;

  if (!respuesta.ok) {
    const mensaje = cuerpo?.error?.mensaje ?? 'Ocurrio un error inesperado.';
    const codigo = cuerpo?.error?.codigo ?? 'error';
    throw new ErrorPeticion(respuesta.status, codigo, mensaje);
  }

  return cuerpo as T;
}

export const api = {
  async login(usuario: string, password: string): Promise<RespuestaLogin> {
    return peticion<RespuestaLogin>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    });
  },

  async salud(): Promise<{ ok: boolean }> {
    return peticion<{ ok: boolean }>('/health');
  },

  async catalogos(): Promise<RespuestaCatalogos> {
    return peticion<RespuestaCatalogos>('/catalogos');
  },

  async beneficiarios(pagina: number, tamano = 500, desde?: string | null): Promise<PaginaBeneficiarios> {
    const parametros = new URLSearchParams({ page: String(pagina), page_size: String(tamano) });
    if (desde) parametros.set('since', desde);
    return peticion<PaginaBeneficiarios>(`/beneficiarios?${parametros.toString()}`);
  },

  async beneficiario(id: number): Promise<Beneficiario> {
    return peticion<Beneficiario>(`/beneficiarios/${id}`);
  },

  async subirCaptura(formulario: FormData): Promise<RespuestaCaptura> {
    return peticion<RespuestaCaptura>('/capturas', { method: 'POST', body: formulario });
  },

  async auditoriaCapturas(parametros: URLSearchParams): Promise<{ data: any[]; total: number }> {
    return peticion<{ data: any[]; total: number }>(`/auditoria/capturas?${parametros.toString()}`);
  },

  async auditoriaGeojson(parametros: URLSearchParams): Promise<any> {
    return peticion<any>(`/auditoria/geojson?${parametros.toString()}`);
  },

  async capturasDeBeneficiario(id: number): Promise<{ data: any[] }> {
    return peticion<{ data: any[] }>(`/capturas?beneficiario_id=${id}&page_size=200`);
  }
};

/** Construye una URL descargable con el token en el query string. */
export async function urlConToken(ruta: string): Promise<string> {
  const token = await tokenActual();
  const separador = ruta.includes('?') ? '&' : '?';
  return `${ruta}${token ? `${separador}token=${encodeURIComponent(token)}` : ''}`;
}

/** URL absoluta de una foto de evidencia, con token para poder verla. */
export async function urlFoto(fotoUrl: string): Promise<string> {
  return urlConToken(fotoUrl);
}
