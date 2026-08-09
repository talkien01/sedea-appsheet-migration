// Cliente HTTP unico contra la API. Todas las llamadas pasan por aqui para
// adjuntar el token y traducir los errores a mensajes en espanol.
import type {
  Beneficiario,
  CambioCampo,
  CambioUsuario,
  PaginaUsuarios,
  PerfilUsuario,
  RespuestaAltaUsuario,
  RespuestaResetPassword,
  UsuarioAdmin,
  EntradaHistorialCorreccion,
  FilaStagingBeneficiario,
  PaginaBeneficiarios,
  RespuestaApoyos,
  RespuestaAvance,
  RespuestaCatalogos,
  RespuestaCobertura,
  RespuestaEstadisticasStaging,
  RespuestaLogin,
  RespuestaCaptura,
  ResumenStaging
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

/**
 * Manejadores globales de sesion (build 4). El cliente HTTP no conoce React
 * Router, asi que la App registra aqui que hacer cuando el backend exige el
 * cambio de contrasena o avisa de una cuenta desactivada.
 */
interface ManejadoresSesion {
  alCambioRequerido: () => void;
  alCuentaDesactivada: (mensaje: string) => void;
}

let manejadores: ManejadoresSesion | null = null;

export function registrarManejadoresSesion(nuevos: ManejadoresSesion): void {
  manejadores = nuevos;
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

    // Guarda global: el backend bloquea todo mientras la contrasena temporal
    // no se cambie, y anula el token si la cuenta se desactiva.
    if (respuesta.status === 403 && codigo === 'cambio_password_requerido') {
      manejadores?.alCambioRequerido();
    }
    if (respuesta.status === 401 && codigo === 'cuenta_desactivada') {
      manejadores?.alCuentaDesactivada(
        'Tu cuenta está desactivada. Contacta al administrador.'
      );
    }

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
  },

  // ------------------------------------------------------------------------
  // Depuracion / staging (roles editor_datos y admin). Siempre en linea.
  // ------------------------------------------------------------------------
  async stagingResumen(): Promise<ResumenStaging> {
    return peticion<ResumenStaging>('/staging/resumen');
  },

  async stagingBeneficiarios(parametros: URLSearchParams): Promise<PaginaStaging> {
    return peticion<PaginaStaging>(`/staging/beneficiarios?${parametros.toString()}`);
  },

  async stagingBeneficiario(id: number): Promise<DetalleStaging> {
    return peticion<DetalleStaging>(`/staging/beneficiarios/${id}`);
  },

  async stagingAprobar(id: number, motivo?: string): Promise<{ ok: true; beneficiario_id: number }> {
    return peticion(`/staging/beneficiarios/${id}/aprobar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivo || null })
    });
  },

  async stagingDescartar(id: number, motivo?: string): Promise<{ ok: true }> {
    return peticion(`/staging/beneficiarios/${id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivo || null })
    });
  },

  async stagingFusionar(cuerpo: {
    principal_id: number;
    secundarios_ids: number[];
    promover?: boolean;
    motivo?: string | null;
  }): Promise<{ ok: true; principal_id: number; fusionados: number[]; beneficiario_id: number | null }> {
    return peticion('/staging/beneficiarios/fusionar', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  async stagingCatalogos(parametros: URLSearchParams): Promise<PaginaStaging> {
    return peticion<PaginaStaging>(`/staging/catalogos?${parametros.toString()}`);
  },

  async stagingCatalogoAprobar(id: number): Promise<{ ok: true; catalogo_id: number }> {
    return peticion(`/staging/catalogos/${id}/aprobar`, { method: 'POST', body: JSON.stringify({}) });
  },

  async stagingCatalogoDescartar(id: number): Promise<{ ok: true }> {
    return peticion(`/staging/catalogos/${id}/descartar`, { method: 'POST', body: JSON.stringify({}) });
  },

  // ------------------------------------------------------------------------
  // Correccion de datos en produccion (roles editor_datos y admin).
  // ------------------------------------------------------------------------
  async correccionesBuscar(parametros: URLSearchParams): Promise<{
    data: any[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  }> {
    return peticion(`/correcciones/beneficiarios?${parametros.toString()}`);
  },

  async correccionesBeneficiario(id: number): Promise<any> {
    return peticion(`/correcciones/beneficiarios/${id}`);
  },

  async correccionesHistorial(id: number): Promise<{ data: EntradaHistorialCorreccion[] }> {
    return peticion(`/correcciones/beneficiarios/${id}/historial`);
  },

  /** PATCH con la lista blanca: solo se envian los campos modificados. */
  async editarBeneficiario(
    id: number,
    cambios: Record<string, unknown>
  ): Promise<{ ok: true; beneficiario: any; cambios: CambioCampo[] }> {
    return peticion(`/beneficiarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios)
    });
  },

  // ------------------------------------------------------------------------
  // Estadisticas del dashboard (roles admin, auditor y editor_datos).
  // ------------------------------------------------------------------------
  async estadisticasCobertura(parametros: URLSearchParams): Promise<RespuestaCobertura> {
    return peticion<RespuestaCobertura>(`/estadisticas/cobertura?${parametros.toString()}`);
  },

  async estadisticasApoyos(parametros: URLSearchParams): Promise<RespuestaApoyos> {
    return peticion<RespuestaApoyos>(`/estadisticas/apoyos?${parametros.toString()}`);
  },

  async estadisticasAvance(parametros: URLSearchParams): Promise<RespuestaAvance> {
    return peticion<RespuestaAvance>(`/estadisticas/avance?${parametros.toString()}`);
  },

  async estadisticasStaging(): Promise<RespuestaEstadisticasStaging> {
    return peticion<RespuestaEstadisticasStaging>('/estadisticas/staging');
  },

  // ------------------------------------------------------------------------
  // Administracion de usuarios (roles admin y editor_datos). Siempre en linea:
  // nada de esto se guarda en IndexedDB.
  // ------------------------------------------------------------------------
  async perfil(): Promise<{ usuario: PerfilUsuario }> {
    return peticion<{ usuario: PerfilUsuario }>('/auth/me');
  },

  async usuarios(parametros: URLSearchParams): Promise<PaginaUsuarios> {
    return peticion<PaginaUsuarios>(`/usuarios?${parametros.toString()}`);
  },

  async crearUsuario(cuerpo: {
    usuario: string;
    nombre_completo: string;
    rol: string;
    regional_id?: number | null;
  }): Promise<RespuestaAltaUsuario> {
    return peticion<RespuestaAltaUsuario>('/usuarios', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  async editarUsuario(
    id: number,
    cambios: Record<string, unknown>
  ): Promise<{ ok: true; usuario: UsuarioAdmin; cambios: CambioUsuario[] }> {
    return peticion(`/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
  },

  async resetearPassword(id: number, motivo?: string): Promise<RespuestaResetPassword> {
    return peticion<RespuestaResetPassword>(`/usuarios/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivo || null })
    });
  },

  async cambiarActivoUsuario(
    id: number,
    activo: boolean,
    motivo?: string
  ): Promise<{ ok: true; usuario: { id: number; usuario: string; activo: boolean } }> {
    return peticion(`/usuarios/${id}/activo`, {
      method: 'PATCH',
      body: JSON.stringify({ activo, motivo: motivo || null })
    });
  },

  async cambiarMiPassword(
    passwordActual: string,
    passwordNueva: string
  ): Promise<{ ok: true; debe_cambiar_password: false }> {
    return peticion('/mi-cuenta/password', {
      method: 'PATCH',
      body: JSON.stringify({ password_actual: passwordActual, password_nueva: passwordNueva })
    });
  }
};

/** Pagina generica de las listas de staging. */
export interface PaginaStaging {
  data: any[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface DetalleStaging {
  fila: FilaStagingBeneficiario;
  relacionadas: { staging: any[]; produccion: any[] };
}

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
