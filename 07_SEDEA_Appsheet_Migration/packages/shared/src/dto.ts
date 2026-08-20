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
