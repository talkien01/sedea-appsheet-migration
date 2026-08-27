// Cliente HTTP unico contra la API. Todas las llamadas pasan por aqui para
// adjuntar el token y traducir los errores a mensajes en espanol.
import type {
  Beneficiario,
  CambioCampo,
  CambioUsuario,
  PaginaUsuarios,
  PerfilUsuario,
  RespuestaAltaUsuario,
  RespuestaLoteUsuarios,
  RespuestaResetPassword,
  RespuestaResetPasswordLote,
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
  ResumenStaging,
  MetricasDictamen,
  RespuestaBandejaDictamen,
  RespuestaDetalleDictamen,
  ResultadoPredictaminar,
  VeredictoDocumento,
  DatosCurpQr,
  EstadoSesionEscaneoRespuesta,
  ResultadoEscaneoMovilCuerpo,
  SesionEscaneoCreada,
  ResultadoReinicioDatos,
  PaqueteEventoEntrega,
  RespuestaEntregaApoyo
} from '@sedea/shared';
import { obtenerSesion } from '../db/repositorios';

export const URL_API: string = import.meta.env.VITE_API_URL || '/api';
export const NOMBRE_APP: string = import.meta.env.VITE_APP_NOMBRE || 'SISPACQ ver. 5.0';
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

export { peticion };

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

  /** Evidencia de la entrega fisica de UN concepto (mismo multipart que las capturas). */
  async subirEntrega(formulario: FormData): Promise<RespuestaEntregaApoyo> {
    return peticion<RespuestaEntregaApoyo>('/entregas', { method: 'POST', body: formulario });
  },

  /** Paquete de trabajo del evento de entrega, para guardarlo en IndexedDB. */
  async prepararEventoEntrega(
    tipoApoyoId: number,
    regionalId?: number | null
  ): Promise<PaqueteEventoEntrega> {
    const parametros = new URLSearchParams({ tipo_apoyo_id: String(tipoApoyoId) });
    if (regionalId) parametros.set('regional_id', String(regionalId));
    return peticion<PaqueteEventoEntrega>(`/entregas/preparar-evento?${parametros.toString()}`);
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
    /** Build 5: ausente ⇒ el backend genera la temporal automatica. */
    modo_password?: 'automatica' | 'manual';
    password_manual?: string;
  }): Promise<RespuestaAltaUsuario> {
    return peticion<RespuestaAltaUsuario>('/usuarios', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /**
   * Plantilla CSV del alta en lote. Se pide al backend (y no se arma aqui)
   * para que columnas y ejemplo salgan de la misma fuente que las lee.
   */
  async plantillaUsuariosLote(): Promise<Blob> {
    const token = await tokenActual();
    const respuesta = await fetch(`${URL_API}/usuarios/plantilla-lote.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    if (!respuesta.ok) {
      throw new ErrorPeticion(respuesta.status, 'error', 'No fue posible generar la plantilla.');
    }
    return respuesta.blob();
  },

  /**
   * Alta en lote. El backend responde 200 con el detalle fila por fila incluso
   * cuando algunas fallan: los 4xx son solo del archivo completo.
   */
  async crearUsuariosLote(
    archivo: File,
    passwordComun?: string | null
  ): Promise<RespuestaLoteUsuarios> {
    const formulario = new FormData();
    formulario.append('archivo', archivo);
    // Solo se manda cuando el admin eligio contrasena comun; sin el campo, el
    // backend sigue generando una aleatoria por fila (comportamiento por defecto).
    if (passwordComun) formulario.append('password_comun', passwordComun);
    return peticion<RespuestaLoteUsuarios>('/usuarios/lote', {
      method: 'POST',
      body: formulario
    });
  },

  async editarUsuario(
    id: number,
    cambios: Record<string, unknown>
  ): Promise<{ ok: true; usuario: UsuarioAdmin; cambios: CambioUsuario[] }> {
    return peticion(`/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
  },

  async resetearPassword(
    id: number,
    opciones?: { motivo?: string; modo_password?: 'automatica' | 'manual'; password_manual?: string }
  ): Promise<RespuestaResetPassword> {
    const cuerpo: Record<string, unknown> = { motivo: opciones?.motivo || null };
    // Solo se envia el modo cuando el actor lo eligio; sin el, el backend
    // aplica `automatica` (retrocompatible con el build 4).
    if (opciones?.modo_password) cuerpo.modo_password = opciones.modo_password;
    if (opciones?.modo_password === 'manual') cuerpo.password_manual = opciones.password_manual;
    return peticion<RespuestaResetPassword>(`/usuarios/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /**
   * Reseteo en lote de usuarios que YA EXISTEN. El backend responde 200 con el
   * detalle por id incluso cuando alguno falla; el unico 4xx es el de la
   * contrasena manual invalida, que se rechaza sin resetear a nadie.
   */
  async resetearPasswordLote(
    ids: number[],
    opciones?: { motivo?: string; modo_password?: 'automatica' | 'manual'; password_manual?: string }
  ): Promise<RespuestaResetPasswordLote> {
    const cuerpo: Record<string, unknown> = { ids, motivo: opciones?.motivo || null };
    if (opciones?.modo_password) cuerpo.modo_password = opciones.modo_password;
    if (opciones?.modo_password === 'manual') cuerpo.password_manual = opciones.password_manual;
    return peticion<RespuestaResetPasswordLote>('/usuarios/reset-password-lote', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /**
   * OPERACION DESTRUCTIVA E IRREVERSIBLE. Vacia todos los datos capturados.
   * Solo rol admin. La frase debe ser exactamente FRASE_CONFIRMACION_REINICIO:
   * el backend la vuelve a validar, este cliente no es el unico candado.
   */
  async reiniciarDatosPrueba(confirmacion: string): Promise<ResultadoReinicioDatos> {
    return peticion<ResultadoReinicioDatos>('/admin/reiniciar-datos-prueba', {
      method: 'POST',
      body: JSON.stringify({ confirmacion })
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

  /** Eliminación lógica de usuario (papelera). Solo admin. */
  async eliminarUsuario(id: number): Promise<{ ok: true; usuario: { id: number; usuario: string; eliminado: boolean } }> {
    return peticion(`/usuarios/${id}/eliminar`, {
      method: 'POST'
    });
  },

  /** Restaurar usuario desde papelera. Solo admin. */
  async restaurarUsuario(id: number): Promise<{ ok: true; usuario: { id: number; usuario: string; eliminado: boolean } }> {
    return peticion(`/usuarios/${id}/restaurar`, {
      method: 'POST'
    });
  },

  /**
   * Cambio de la propia contrasena (11.4). En el flujo obligatorio se llama
   * SIN `password_actual`: el body ni siquiera incluye la clave (D25).
   */
  async cambiarMiPassword(
    passwordActual: string | null,
    passwordNueva: string
  ): Promise<{ ok: true; debe_cambiar_password: false }> {
    const cuerpo: Record<string, unknown> = { password_nueva: passwordNueva };
    if (passwordActual !== null) cuerpo.password_actual = passwordActual;
    return peticion('/mi-cuenta/password', {
      method: 'PATCH',
      body: JSON.stringify(cuerpo)
    });
  },

  // ------------------------------------------------------------------------
  // Build 10: Administracion de catalogos jerarquicos (E49-E54).
  // Solo admin y editor_datos pueden acceder.
  // ------------------------------------------------------------------------
  async catalogosArbol(parametros?: URLSearchParams): Promise<any> {
    const qs = parametros ? `?${parametros.toString()}` : '';
    return peticion(`/admin/catalogos/arbol${qs}`);
  },

  async catalogosEntidad(entidad: string, parametros?: URLSearchParams): Promise<any> {
    const qs = parametros ? `?${parametros.toString()}` : '';
    return peticion(`/admin/catalogos/${entidad}${qs}`);
  },

  async crearCatalogo(entidad: string, datos: Record<string, unknown>): Promise<any> {
    return peticion(`/admin/catalogos/${entidad}`, {
      method: 'POST',
      body: JSON.stringify(datos)
    });
  },

  async editarCatalogo(entidad: string, id: number, datos: Record<string, unknown>): Promise<any> {
    return peticion(`/admin/catalogos/${entidad}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(datos)
    });
  },

  async cambiarEstadoCatalogo(entidad: string, id: number, activo: boolean): Promise<any> {
    return peticion(`/admin/catalogos/${entidad}/${id}/estado`, {
      method: 'POST',
      body: JSON.stringify({ activo })
    });
  },

  async catalogosReferencias(): Promise<any> {
    return peticion('/admin/catalogos/referencias');
  },

  // ------------------------------------------------------------------------
  // Build 13: pre-dictaminacion con IA y dictamen humano (E55-E59).
  // Solo `dictaminador` y `admin`. Siempre en linea.
  // ------------------------------------------------------------------------
  async dictamenBandeja(parametros: URLSearchParams): Promise<RespuestaBandejaDictamen> {
    return peticion<RespuestaBandejaDictamen>(`/dictamen/bandeja?${parametros.toString()}`);
  },

  async dictamenMetricas(): Promise<MetricasDictamen> {
    return peticion<MetricasDictamen>('/dictamen/metricas');
  },

  async dictamenDetalle(solicitudId: number): Promise<RespuestaDetalleDictamen> {
    return peticion<RespuestaDetalleDictamen>(`/dictamen/${solicitudId}`);
  },

  /** Disparo MANUAL en lote (maximo 20 solicitudes). Nunca automatico. */
  async predictaminar(
    solicitudIds: number[]
  ): Promise<{ ok: true; resultados: ResultadoPredictaminar[] }> {
    return peticion('/dictamen/predictaminar', {
      method: 'POST',
      body: JSON.stringify({ solicitud_ids: solicitudIds })
    });
  },

  /** Confirmacion HUMANA: `resultado` siempre explicito, nunca copiado de la IA. */
  async confirmarDictamen(
    solicitudId: number,
    cuerpo: {
      resultado: 'positivo' | 'negativo';
      nota: string | null;
      detalle: Array<{ documento_requerido_id: number; veredicto: VeredictoDocumento }>;
    }
  ): Promise<{ ok: true; dictamen: { id: number; coincide_con_ia: boolean | null } }> {
    return peticion(`/dictamen/${solicitudId}/confirmar`, {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  // --- E60: escaneo del CURP con un celular vinculado ----------------------

  /** Abre la sesion que el escritorio pinta como QR. */
  async abrirSesionEscaneo(): Promise<SesionEscaneoCreada> {
    return peticion<SesionEscaneoCreada>('/escaneo-curp/sesiones', { method: 'POST' });
  },

  /** Sondeo del escritorio mientras espera al celular. */
  async estadoSesionEscaneo(token: string): Promise<EstadoSesionEscaneoRespuesta> {
    return peticion<EstadoSesionEscaneoRespuesta>(
      `/escaneo-curp/sesiones/${encodeURIComponent(token)}`
    );
  },

  /**
   * Entrega del celular. Es la UNICA llamada de la app que va sin token de
   * sesion: la pantalla `/escaneo-movil/:token` se abre en un telefono donde
   * nadie inicio sesion, y el token de la URL hace de credencial.
   */
  async entregarEscaneoMovil(
    token: string,
    textoQr: string
  ): Promise<{ ok: true; datos: DatosCurpQr }> {
    return peticion(`/escaneo-curp/sesiones/${encodeURIComponent(token)}/resultado`, {
      method: 'POST',
      body: JSON.stringify({ texto_qr: textoQr } satisfies ResultadoEscaneoMovilCuerpo)
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
