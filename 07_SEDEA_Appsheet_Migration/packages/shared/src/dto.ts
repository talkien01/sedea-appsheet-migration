// DTOs compartidos entre la API y la PWA.
// Mantener este archivo como unica fuente de verdad de los contratos evita
// la desalineacion entre la cola de sincronizacion y el endpoint de upsert.

// Build 6: se agrega el rol 'ventanilla' (D34); los 4 anteriores siguen igual.
// Build 12: multi-rol permitido con "+" (ej. "capturista+ventanilla")
export type Rol = string;

export interface PerfilUsuario {
  id: number;
  usuario: string;
  nombre_completo: string;
  rol: Rol;
  regional_id: number | null;
  regional_nombre: string | null;
  /**
   * Build 4: el perfil viaja con el estado de la cuenta. Son opcionales para
   * no romper las sesiones ya guardadas en IndexedDB antes de esta version.
   */
  debe_cambiar_password?: boolean;
  activo?: boolean;
}

export interface RespuestaLogin {
  token: string;
  usuario: PerfilUsuario;
}

export interface DireccionRegional {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
}

export interface Municipio {
  id: number;
  clave: string;
  nombre: string;
  regional_id: number;
  activo: boolean;
}

export interface TipoApoyo {
  id: number;
  clave: string;
  nombre: string;
  categoria: string | null;
  unidad_medida: string | null;
  /**
   * Descripcion homologada del concepto (migracion 024). Se muestra en modo
   * lectura en la tabla de conceptos de la solicitud; solo se edita desde el
   * catalogo, para que sea identica en todos los solicitantes del concepto.
   */
  descripcion: string | null;
  activo: boolean;
}

export interface EntradaCatalogo {
  id: number;
  grupo: string;
  clave: string;
  valor: string;
  padre_grupo: string | null;
  padre_clave: string | null;
  orden: number;
  activo: boolean;
}

export interface RespuestaCatalogos {
  regionales: DireccionRegional[];
  municipios: Municipio[];
  tipos_apoyo: TipoApoyo[];
  catalogos: EntradaCatalogo[];
}

export interface Beneficiario {
  id: number;
  folio: string;
  curp: string | null;
  nombre_completo: string;
  regional_id: number;
  regional_nombre?: string | null;
  municipio_id: number | null;
  municipio_nombre?: string | null;
  colonia: string | null;
  seccion: string | null;
  localidad: string | null;
  domicilio: string | null;
  telefono: string | null;
  tipo_apoyo_id: number | null;
  tipo_apoyo_nombre?: string | null;
  cantidad_asignada: number | null;
  datos_extra: Record<string, unknown>;
  total_capturas?: number;
  actualizado_en: string;
}

export interface PaginaBeneficiarios {
  data: Beneficiario[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface CapturaServidor {
  uuid: string;
  beneficiario_id: number;
  usuario_id: number;
  foto_url: string;
  lat: number;
  lng: number;
  precision_m: number;
  tipo_apoyo_id: number | null;
  cantidad_entregada: number | null;
  observaciones: string | null;
  capturado_en: string;
  sincronizado_en: string;
  estado_sync: string;
  capturista?: string;
  beneficiario?: Partial<Beneficiario>;
}

export interface RespuestaCaptura {
  uuid: string;
  foto_url: string;
  duplicado: boolean;
}

export interface ErrorApi {
  error: {
    codigo: string;
    mensaje: string;
    detalles?: unknown;
  };
}

/** Estado de la cola offline (vive solo en IndexedDB). */
export type EstadoCapturaLocal = 'pendiente' | 'sincronizando' | 'sincronizada' | 'error';

// ---------------------------------------------------------------------------
// Build 13: pre-dictaminacion con IA y dictamen humano (SPEC seccion 19).
// ---------------------------------------------------------------------------

/** Estado global del pre-dictamen de IA. `error` no es un veredicto (A19-5). */
export type EstadoPredictamen = 'positivo' | 'negativo' | 'error';

/** Veredicto humano por documento en el detalle del dictamen. */
export type VeredictoDocumento = 'ok' | 'falta' | 'ilegible';

/** Un objeto por cada fila de `solicitud_documentos` de la solicitud. */
export interface DetallePredictamenDocumento {
  solicitud_documento_id: number;
  documento_requerido_id: number | null;
  requisito: string;
  archivo_url: string | null;
  presente: boolean;
  legible: boolean;
  curp_coincide: boolean | null;
  curp_leida: string | null;
  observacion: string;
}

export interface Predictamen {
  id: number;
  estado: EstadoPredictamen;
  resumen: string | null;
  generado_en: string;
  modelo_usado: string;
  documentos_con_problema?: number;
}

export interface DictamenHumano {
  id: number;
  resultado: 'positivo' | 'negativo';
  dictaminado_en: string;
  dictaminado_por_nombre?: string | null;
}

/** Fila de la bandeja de dictamen (E56). No existe `tiene_expediente`. */
export interface FilaBandejaDictamen {
  solicitud_id: number;
  folio: string;
  solicitante: string;
  recibida_en: string;
  documentos_total: number;
  documentos_con_archivo: number;
  predictamen: Predictamen | null;
  dictamen: DictamenHumano | null;
}

export interface RespuestaBandejaDictamen {
  total: number;
  pagina: number;
  por_pagina: number;
  filas: FilaBandejaDictamen[];
}

/** Documento tal como lo devuelve el detalle E57. */
export interface DocumentoDictamen {
  solicitud_documento_id: number;
  documento_requerido_id: number | null;
  requisito: string;
  recibido: boolean;
  archivo_url: string | null;
  archivo_nombre: string | null;
  ia: {
    presente: boolean;
    legible: boolean;
    curp_coincide: boolean | null;
    curp_leida: string | null;
    observacion: string;
  } | null;
  humano: { veredicto: VeredictoDocumento } | null;
}

export interface RespuestaDetalleDictamen {
  solicitud: {
    id: number;
    folio: string;
    solicitante: string;
    curp: string | null;
    tipo_persona: string;
    componente: string | null;
    recibida_en: string;
  };
  documentos: DocumentoDictamen[];
  predictamen: Predictamen | null;
  dictamen: (DictamenHumano & { nota: string | null; coincide_con_ia: boolean | null }) | null;
  historial_predictamenes: Array<{
    id: number;
    estado: EstadoPredictamen;
    generado_en: string;
    modelo_usado: string;
  }>;
}

export interface ResultadoPredictaminar {
  solicitud_id: number;
  predictamen_id: number;
  estado: EstadoPredictamen;
  resumen: string | null;
  documentos_evaluados: number;
  documentos_con_archivo: number;
}

export interface MetricasDictamen {
  pendientes: number;
  negativos: number;
  positivos: number;
  sin_predictamen: number;
  dictaminadas: number;
  coincidencia_ia: { total: number; coinciden: number; porcentaje: number };
}
