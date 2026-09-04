// Contrato de la edicion correctiva de beneficiarios ya promovidos a
// produccion y de los endpoints de estadisticas del dashboard.
import { z } from 'zod';

/** Roles que pueden corregir datos de beneficiarios en produccion (D9). */
export const ROLES_CORRECCION = ['editor_datos', 'admin'] as const;
/** Roles con acceso al dashboard de estadisticas (D12). `director` se agrega
 * como perfil de solo consulta, forzado a su Regional cuando tiene una. */
export const ROLES_ESTADISTICAS = ['admin', 'auditor', 'editor_datos', 'director'] as const;

/**
 * Lista blanca ESTRICTA de campos editables (D7). Cualquier otra clave del
 * payload provoca 422 y no se aplica ningun cambio: se prefiere el fallo
 * ruidoso al descarte silencioso, para que la restriccion sea auditable.
 * CURP y folio estan bloqueados permanentemente (D8).
 */
export const CAMPOS_EDITABLES = [
  'colonia',
  'domicilio',
  'telefono',
  'seccion',
  'municipio_id'
] as const;
export type CampoEditable = (typeof CAMPOS_EDITABLES)[number];

/** Longitudes maximas de los campos de texto editables. */
export const LONGITUDES_MAXIMAS: Record<string, number> = {
  colonia: 120,
  domicilio: 200,
  seccion: 20,
  telefono: 20
};

export const ETIQUETAS_CAMPO: Record<string, string> = {
  colonia: 'Colonia',
  domicilio: 'Domicilio',
  telefono: 'Teléfono',
  seccion: 'Sección',
  municipio_id: 'Municipio',
  regional_id: 'Dirección Regional'
};

/**
 * Zod estricto: `.strict()` hace que cualquier clave desconocida (curp, folio,
 * nombre_completo, regional_id, ...) falle la validacion. El handler traduce
 * ese fallo al codigo `campo_no_editable`.
 */
export const esquemaEdicionBeneficiario = z
  .object({
    colonia: z.string().max(400).nullable().optional(),
    domicilio: z.string().max(400).nullable().optional(),
    telefono: z.string().max(40).nullable().optional(),
    seccion: z.string().max(400).nullable().optional(),
    municipio_id: z.number().int().positive().nullable().optional(),
    motivo: z.string().max(500).nullable().optional()
  })
  .strict();
export type EntradaEdicionBeneficiario = z.infer<typeof esquemaEdicionBeneficiario>;

/** Normaliza un telefono: se queda solo con los 10 digitos nacionales. */
export function normalizarTelefono(valor: string): string | null {
  const limpio = String(valor ?? '')
    .replace(/[\s\-()]/g, '')
    .replace(/^\+?52/, '');
  return /^\d{10}$/.test(limpio) ? limpio : null;
}

export interface CambioCampo {
  campo: string;
  anterior: unknown;
  nuevo: unknown;
}

export interface EntradaHistorialCorreccion {
  fecha: string;
  usuario: string | null;
  rol: string | null;
  motivo: string | null;
  cambios: CambioCampo[];
}

// ---------------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------------

export const esquemaFiltrosEstadisticas = z.object({
  regional_id: z.coerce.number().int().positive().optional(),
  municipio_id: z.coerce.number().int().positive().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional()
});

export interface CoberturaFila {
  total_beneficiarios: number;
  con_captura: number;
  sin_captura: number;
  porcentaje: number;
}

export interface RespuestaCobertura {
  global: CoberturaFila;
  por_regional: Array<CoberturaFila & { regional_id: number; regional: string }>;
  por_municipio: Array<
    CoberturaFila & { municipio_id: number; municipio: string; regional: string }
  >;
}

export interface RespuestaApoyos {
  total_capturas: number;
  total_beneficiarios: number;
  data: Array<{
    tipo_apoyo_id: number | null;
    clave: string | null;
    nombre: string;
    capturas: number;
    beneficiarios: number;
  }>;
  otros: { conceptos: number; capturas: number; beneficiarios: number } | null;
}

export interface RespuestaAvance {
  agrupacion: 'dia' | 'semana';
  desde: string;
  hasta: string;
  total_capturas: number;
  data: Array<{ periodo: string; capturas: number; beneficiarios: number; acumulado: number }>;
}

export interface RespuestaEstadisticasStaging {
  beneficiarios: {
    pendiente: number;
    aprobado: number;
    descartado: number;
    fusionado: number;
    total: number;
  };
  catalogos: {
    pendiente: number;
    aprobado: number;
    descartado: number;
    fusionado: number;
    total: number;
  };
}
