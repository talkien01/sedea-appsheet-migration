// Cliente HTTP del modulo de ventanilla (build 6).
//
// Pantallas EN LINEA (D32): nada de lo que pasa por aqui se guarda en la base
// local del navegador ni entra en la cola de sincronizacion offline. Si no hay
// red, la pantalla muestra el aviso y no llama a estas funciones.
import type {
  CatalogosVentanilla,
  ConflictoCurpConcepto,
  DetalleSolicitudApi,
  DocumentoRequeridoCalculado,
  DocumentoSolicitud,
  PaginaSolicitudes,
  RespuestaAltaSolicitud,
  TipoPersona
} from '@sedea/shared';
import { URL_API, ErrorPeticion } from './cliente';
import { obtenerSesion } from '../db/repositorios';

async function token(): Promise<string | null> {
  return (await obtenerSesion())?.token ?? null;
}

async function peticion<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras = new Headers(opciones.headers);
  const jwt = await token();
  if (jwt) cabeceras.set('Authorization', `Bearer ${jwt}`);
  if (opciones.body && !(opciones.body instanceof FormData)) {
    cabeceras.set('Content-Type', 'application/json');
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_API}${ruta}`, { ...opciones, headers: cabeceras });
  } catch {
    throw new ErrorPeticion(0, 'sin_red', 'No hay conexión con el servidor.');
  }

  const tipo = respuesta.headers.get('content-type') ?? '';
  const cuerpo = tipo.includes('application/json') ? await respuesta.json() : null;

  if (!respuesta.ok) {
    // El mensaje del backend ya viene en espanol: se muestra tal cual (12.8.2).
    throw new ErrorPeticion(
      respuesta.status,
      cuerpo?.error?.codigo ?? 'error',
      cuerpo?.error?.mensaje ?? 'Ocurrió un error inesperado.'
    );
  }
  return cuerpo as T;
}

export const apiSolicitudes = {
  /** E40 - catalogos ya filtrados al alcance del usuario. */
  catalogos(): Promise<CatalogosVentanilla> {
    return peticion<CatalogosVentanilla>('/solicitudes/catalogos');
  },

  /** E41 - checklist dinamico de documentos. */
  documentosRequeridos(cuerpo: {
    componente_id: number;
    tipo_persona: TipoPersona;
    proyecto_id?: number | null;
    tipos_apoyo_ids?: number[];
  }): Promise<{ documentos: DocumentoRequeridoCalculado[]; total: number }> {
    return peticion('/solicitudes/documentos-requeridos', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /**
   * Aviso en vivo de CURP duplicada: por cada concepto elegido dice si esa
   * CURP ya tiene una solicitud previa con ese mismo concepto. Es solo lectura;
   * el bloqueo real lo hace E42 con `curp_concepto_duplicado`.
   */
  verificarCurpConcepto(cuerpo: {
    curp: string;
    tipos_apoyo_ids: number[];
  }): Promise<{ conflictos: ConflictoCurpConcepto[] }> {
    return peticion('/solicitudes/verificar-curp-concepto', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /** E42 - alta. El folio lo genera el backend (D41): nunca se envia. */
  crear(cuerpo: Record<string, unknown>): Promise<RespuestaAltaSolicitud> {
    return peticion<RespuestaAltaSolicitud>('/solicitudes', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /** E43 - listado paginado. */
  listar(parametros: URLSearchParams): Promise<PaginaSolicitudes> {
    return peticion<PaginaSolicitudes>(`/solicitudes?${parametros.toString()}`);
  },

  /** E44 - detalle completo. */
  detalle(id: number): Promise<DetalleSolicitudApi> {
    return peticion<DetalleSolicitudApi>(`/solicitudes/${id}`);
  },

  /**
   * Datos para la pantalla del Folio de entrega. Es la MISMA carga que
   * `detalle()`, pero por una ruta que exige la Autorización del Secretario:
   * si falta, responde 403 `autorizacion_secretario_pendiente`. El candado no
   * puede estar en `detalle()` porque el Detalle sí debe verse siempre.
   */
  folio(id: number): Promise<DetalleSolicitudApi> {
    return peticion<DetalleSolicitudApi>(`/solicitudes/${id}/folio`);
  },

  /** Captura (o corrige) la autorización del Secretario. Solo admin. */
  autorizacionSecretario(
    id: number,
    cuerpo: { autorizada: boolean; nota?: string | null }
  ): Promise<{ ok: true; solicitud: Record<string, unknown> }> {
    return peticion(`/solicitudes/${id}/autorizacion-secretario`, {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  /** E45 - marcar recibido / observaciones de un documento. */
  actualizarDocumento(
    id: number,
    docId: number,
    cambios: { recibido?: boolean; observaciones?: string | null }
  ): Promise<{ ok: true; documento: DocumentoSolicitud }> {
    return peticion(`/solicitudes/${id}/documentos/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios)
    });
  },

  /** E46 - adjuntar archivo (JPG/PNG/WEBP/PDF). */
  subirArchivo(
    id: number,
    docId: number,
    archivo: File
  ): Promise<{ ok: true; documento: DocumentoSolicitud }> {
    const formulario = new FormData();
    formulario.append('archivo', archivo);
    return peticion(`/solicitudes/${id}/documentos/${docId}/archivo`, {
      method: 'POST',
      body: formulario
    });
  },

  /** E47 - alcance de un usuario (solo admin). */
  alcance(usuarioId: number): Promise<{
    usuario_id: number;
    rol: string;
    municipios: 'todos' | { id: number; nombre: string }[];
    componentes: 'todos' | { id: number; clave: string; nombre: string }[];
  }> {
    return peticion(`/usuarios/${usuarioId}/alcance`);
  },

  /** E48 - reemplazo completo del alcance (solo admin). */
  guardarAlcance(
    usuarioId: number,
    cuerpo: { municipios: 'todos' | number[]; componentes: 'todos' | number[] }
  ): Promise<{ ok: true }> {
    return peticion(`/usuarios/${usuarioId}/alcance`, {
      method: 'PUT',
      body: JSON.stringify(cuerpo)
    });
  }
};
