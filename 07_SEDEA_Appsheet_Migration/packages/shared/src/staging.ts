// Tipos y esquemas Zod del subsistema de staging / depuracion de datos.
// Compartidos entre el backend, el importador y la PWA para que las tres
// piezas hablen exactamente del mismo contrato.
import { z } from 'zod';

/** Roles con acceso a las pantallas y endpoints de depuracion. */
export const ROLES_STAGING = ['editor_datos', 'admin'] as const;

export type EstadoRevision = 'pendiente' | 'aprobado' | 'descartado' | 'fusionado';
export type NivelAlerta = 'alta' | 'media' | 'ninguna';

/** Los 6 flags de diagnostico del staging de padron. */
export const FLAGS_BENEFICIARIO = [
  'folio_duplicado',
  'curp_duplicada_mismo_concepto',
  'curp_duplicada_concepto_distinto',
  'sin_coordenadas',
  'sin_colonia',
  'concepto_no_reconocido'
] as const;
export type FlagBeneficiario = (typeof FLAGS_BENEFICIARIO)[number];

/** Flags del staging de catalogos. */
export const FLAGS_CATALOGO = [
  'clave_duplicada',
  'valor_duplicado',
  'concepto_no_reconocido'
] as const;
export type FlagCatalogo = (typeof FLAGS_CATALOGO)[number];

/** Etiquetas en espanol de cada flag (se usan en la PWA). */
export const ETIQUETAS_FLAG: Record<string, string> = {
  folio_duplicado: 'Folio duplicado',
  curp_duplicada_mismo_concepto: 'CURP duplicada · mismo concepto',
  curp_duplicada_concepto_distinto: 'CURP duplicada · concepto distinto',
  sin_coordenadas: 'Sin coordenadas',
  sin_colonia: 'Sin colonia',
  concepto_no_reconocido: 'Concepto no reconocido',
  clave_duplicada: 'Clave duplicada',
  valor_duplicado: 'Valor duplicado'
};

export const ETIQUETAS_ESTADO: Record<EstadoRevision, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  descartado: 'Descartado',
  fusionado: 'Fusionado'
};

export interface FilaStagingBeneficiario {
  id: number;
  importacion_id: number | null;
  archivo: string;
  fila_origen: number;
  folio: string | null;
  curp: string | null;
  nombre_completo: string | null;
  regional_texto: string | null;
  regional_id: number | null;
  regional_nombre?: string | null;
  municipio_texto: string | null;
  municipio_id: number | null;
  municipio_nombre?: string | null;
  colonia: string | null;
  seccion: string | null;
  localidad: string | null;
  domicilio: string | null;
  telefono: string | null;
  tipo_apoyo_texto: string | null;
  tipo_apoyo_id: number | null;
  tipo_apoyo_nombre?: string | null;
  cantidad_asignada: number | null;
  lat_proyecto: number | null;
  lng_proyecto: number | null;
  datos_extra: Record<string, unknown>;
  folio_duplicado: boolean;
  curp_duplicada_mismo_concepto: boolean;
  curp_duplicada_concepto_distinto: boolean;
  sin_coordenadas: boolean;
  sin_colonia: boolean;
  concepto_no_reconocido: boolean;
  nivel_alerta: NivelAlerta;
  estado_revision: EstadoRevision;
  revisado_por: number | null;
  revisado_en: string | null;
  motivo_revision: string | null;
  promovido_beneficiario_id: number | null;
  fusionado_en_id: number | null;
  creado_en: string;
  actualizado_en: string;
}

export interface FilaStagingCatalogo {
  id: number;
  importacion_id: number | null;
  archivo: string;
  fila_origen: number;
  grupo: string | null;
  clave: string | null;
  valor: string | null;
  padre_grupo: string | null;
  padre_clave: string | null;
  orden: number;
  datos_extra: Record<string, unknown>;
  clave_duplicada: boolean;
  valor_duplicado: boolean;
  concepto_no_reconocido: boolean;
  nivel_alerta: NivelAlerta;
  estado_revision: EstadoRevision;
  revisado_por: number | null;
  revisado_en: string | null;
  motivo_revision: string | null;
  promovido_catalogo_id: number | null;
  creado_en: string;
  actualizado_en: string;
}

export type MotivoRelacion = 'folio' | 'curp_mismo_concepto' | 'curp_concepto_distinto';

export interface ResumenStagingTabla {
  total: number;
  por_estado: Record<EstadoRevision, number>;
  por_alerta: Record<string, number>;
  por_nivel: Record<NivelAlerta, number>;
}

export interface ResumenStaging {
  beneficiarios: ResumenStagingTabla;
  catalogos: ResumenStagingTabla;
}

// ---------------------------------------------------------------------------
// Esquemas de consulta y de acciones
// ---------------------------------------------------------------------------

const estadoConsulta = z
  .enum(['pendiente', 'aprobado', 'descartado', 'fusionado', 'todos'])
  .default('pendiente');

export const esquemaConsultaStagingBeneficiarios = z.object({
  estado: estadoConsulta,
  alerta: z.enum([...FLAGS_BENEFICIARIO, 'ninguna']).optional(),
  nivel: z.enum(['alta', 'media', 'ninguna']).optional(),
  q: z.string().optional(),
  importacion_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50)
});

export const esquemaConsultaStagingCatalogos = z.object({
  estado: estadoConsulta,
  alerta: z.enum([...FLAGS_CATALOGO, 'ninguna']).optional(),
  nivel: z.enum(['alta', 'media', 'ninguna']).optional(),
  grupo: z.string().optional(),
  q: z.string().optional(),
  importacion_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50)
});

export const esquemaMotivoRevision = z.object({
  motivo: z.string().max(500).optional().nullable()
});

/** Columnas de datos que la fusion puede sobreescribir en la fila principal. */
export const CAMPOS_FUSIONABLES = [
  'folio',
  'curp',
  'nombre_completo',
  'colonia',
  'seccion',
  'localidad',
  'domicilio',
  'telefono',
  'cantidad_asignada',
  'lat_proyecto',
  'lng_proyecto'
] as const;

export const esquemaFusion = z.object({
  principal_id: z.coerce.number().int().positive(),
  secundarios_ids: z.array(z.coerce.number().int().positive()).min(1),
  campos: z.record(z.enum(CAMPOS_FUSIONABLES), z.any()).optional(),
  promover: z.boolean().optional().default(false),
  motivo: z.string().max(500).optional().nullable()
});
export type EntradaFusion = z.infer<typeof esquemaFusion>;
