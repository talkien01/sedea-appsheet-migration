// Tipos y esquemas Zod para las 7 entidades de catalogos administrables (Build 10).
// Backend y PWA comparten estas definiciones para validacion consistente.
import { z } from 'zod';
// Re-exporta TipoApoyo desde dto.ts para evitar duplicacion.
import type { TipoApoyo } from './dto.js';

// =============================================================================
// ESQUEMAS POR ENTIDAD
// =============================================================================

// --- Programas --------------------------------------------------------------
export const esquemaProgramaAlta = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300)
}).strict();

export const esquemaProgramaEdicion = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional()
}).strict();

export interface Programa {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
}

// --- Subprogramas -----------------------------------------------------------
export const esquemaSubprogramaAlta = z.object({
  programa_id: z.number().int().positive(),
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300)
}).strict();

export const esquemaSubprogramaEdicion = z.object({
  programa_id: z.number().int().positive().optional(),
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional()
}).strict();

export interface Subprograma {
  id: number;
  programa_id: number;
  clave: string;
  nombre: string;
  activo: boolean;
}

// --- Componentes ------------------------------------------------------------
export const esquemaComponenteAlta = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300)
}).strict();

export const esquemaComponenteEdicion = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional()
}).strict();

export interface Componente {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
}

// --- Modalidades ------------------------------------------------------------
export const esquemaModalidadAlta = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300),
  componente_id: z.number().int().positive()
}).strict();

export const esquemaModalidadEdicion = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional(),
  componente_id: z.number().int().positive().optional()
}).strict();

export interface Modalidad {
  id: number;
  clave: string;
  nombre: string;
  componente_id: number;
  activo: boolean;
}

// --- Proyectos --------------------------------------------------------------
export const esquemaProyectoAlta = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300),
  prefijo_folio: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/),
  componente_id: z.number().int().positive().nullable().optional(),
  modalidad_id: z.number().int().positive().nullable().optional()
}).strict();

export const esquemaProyectoEdicion = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional(),
  prefijo_folio: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/).optional(),
  componente_id: z.number().int().positive().nullable().optional(),
  modalidad_id: z.number().int().positive().nullable().optional()
}).strict();

export interface Proyecto {
  id: number;
  clave: string;
  nombre: string;
  prefijo_folio: string;
  componente_id: number | null;
  modalidad_id: number | null;
  activo: boolean;
}

// --- Tipos de Apoyo ---------------------------------------------------------
export const esquemaTipoApoyoAlta = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()),
  nombre: z.string().trim().min(3).max(300),
  categoria: z.string().trim().max(200).nullable().optional(),
  unidad_medida: z.string().trim().max(100).nullable().optional()
}).strict();

export const esquemaTipoApoyoEdicion = z.object({
  clave: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i).transform(v => v.toUpperCase()).optional(),
  nombre: z.string().trim().min(3).max(300).optional(),
  categoria: z.string().trim().max(200).nullable().optional(),
  unidad_medida: z.string().trim().max(100).nullable().optional()
}).strict();

// TipoApoyo ya esta definido en dto.ts, se re-exporta alli

// --- Documentos Requeridos --------------------------------------------------
export const esquemaDocumentoRequeridoAlta = z.object({
  requisito: z.string().trim().min(3).max(300),
  componentes: z.array(z.string()).optional(),
  // F-13: validado en el servicio para devolver tipo_persona_invalido (479).
  tipos_persona: z.array(z.string()).optional(),
  proyecto_id: z.number().int().positive().nullable().optional(),
  apoyo_id: z.number().int().positive().nullable().optional(),
  apoyo_etiquetas: z.array(z.string()).optional(),
  apoyo_excluir_id: z.number().int().positive().nullable().optional(),
  apoyo_excluir_etiquetas: z.array(z.string()).optional(),
  orden: z.number().int().min(0).max(9999).optional().default(0)
}).strict();

export const esquemaDocumentoRequeridoEdicion = z.object({
  requisito: z.string().trim().min(3).max(300).optional(),
  componentes: z.array(z.string()).optional(),
  // F-13: validado en el servicio para devolver tipo_persona_invalido (479).
  tipos_persona: z.array(z.string()).optional(),
  proyecto_id: z.number().int().positive().nullable().optional(),
  apoyo_id: z.number().int().positive().nullable().optional(),
  apoyo_etiquetas: z.array(z.string()).optional(),
  apoyo_excluir_id: z.number().int().positive().nullable().optional(),
  apoyo_excluir_etiquetas: z.array(z.string()).optional(),
  orden: z.number().int().min(0).max(9999).optional()
}).strict();

export interface DocumentoRequerido {
  id: number;
  requisito: string;
  componentes: string[] | null;
  tipos_persona: string[] | null;
  proyecto_id: number | null;
  apoyo_id: number | null;
  apoyo_etiquetas: string[] | null;
  apoyo_excluir_id: number | null;
  apoyo_excluir_etiquetas: string[] | null;
  orden: number;
  activo: boolean;
}

// =============================================================================
// TIPO UNION Y REGISTRO DE ENTIDADES
// =============================================================================

export type EntidadCatalogo =
  | Programa
  | Subprograma
  | Componente
  | Modalidad
  | Proyecto
  | TipoApoyo
  | DocumentoRequerido;

export type NombreEntidad =
  | 'programas'
  | 'subprogramas'
  | 'componentes'
  | 'modalidades'
  | 'proyectos'
  | 'tipos_apoyo'
  | 'documentos_requeridos';

/** Registro de entidades para el patron generico del backend. */
export interface DefinicionCatalogo {
  tabla: string;
  etiqueta: string;
  campoClave: 'clave' | null;
  camposTexto: string[];
  camposEnteros: string[];
  camposArreglo: string[];
  padres: { campo: string; tabla: string; obligatorio: boolean }[];
  inmutables: string[];
  hijos: { entidad: NombreEntidad; campo: string }[];
}

export const REGISTRO_ENTIDADES: Record<NombreEntidad, DefinicionCatalogo> = {
  programas: {
    tabla: 'programas',
    etiqueta: 'Programas',
    campoClave: 'clave',
    camposTexto: ['nombre'],
    camposEnteros: [],
    camposArreglo: [],
    padres: [],
    inmutables: ['clave'],
    hijos: [{ entidad: 'subprogramas', campo: 'programa_id' }]
  },
  subprogramas: {
    tabla: 'subprogramas',
    etiqueta: 'Subprogramas',
    campoClave: 'clave',
    camposTexto: ['nombre'],
    camposEnteros: ['programa_id'],
    camposArreglo: [],
    padres: [{ campo: 'programa_id', tabla: 'programas', obligatorio: true }],
    inmutables: ['clave'],
    hijos: []
  },
  componentes: {
    tabla: 'componentes',
    etiqueta: 'Componentes',
    campoClave: 'clave',
    camposTexto: ['nombre'],
    camposEnteros: [],
    camposArreglo: [],
    padres: [],
    inmutables: ['clave'],
    hijos: [
      { entidad: 'modalidades', campo: 'componente_id' },
      { entidad: 'proyectos', campo: 'componente_id' }
    ]
  },
  modalidades: {
    tabla: 'modalidades',
    etiqueta: 'Modalidades',
    campoClave: 'clave',
    camposTexto: ['nombre'],
    camposEnteros: ['componente_id'],
    camposArreglo: [],
    padres: [{ campo: 'componente_id', tabla: 'componentes', obligatorio: true }],
    inmutables: ['clave'],
    hijos: [{ entidad: 'proyectos', campo: 'modalidad_id' }]
  },
  proyectos: {
    tabla: 'proyectos',
    etiqueta: 'Proyectos',
    campoClave: 'clave',
    camposTexto: ['nombre', 'prefijo_folio'],
    camposEnteros: ['componente_id', 'modalidad_id'],
    camposArreglo: [],
    padres: [
      { campo: 'componente_id', tabla: 'componentes', obligatorio: false },
      { campo: 'modalidad_id', tabla: 'modalidades', obligatorio: false }
    ],
    inmutables: ['clave', 'prefijo_folio'],
    hijos: [{ entidad: 'documentos_requeridos', campo: 'proyecto_id' }]
  },
  tipos_apoyo: {
    tabla: 'tipos_apoyo',
    etiqueta: 'Conceptos de apoyo',
    campoClave: 'clave',
    camposTexto: ['nombre', 'categoria', 'unidad_medida'],
    camposEnteros: [],
    camposArreglo: [],
    padres: [],
    inmutables: ['clave'],
    hijos: [{ entidad: 'documentos_requeridos', campo: 'apoyo_id' }]
  },
  documentos_requeridos: {
    tabla: 'documentos_requeridos',
    etiqueta: 'Reglas de documentos',
    campoClave: null,
    camposTexto: ['requisito'],
    camposEnteros: ['proyecto_id', 'apoyo_id', 'apoyo_excluir_id', 'orden'],
    camposArreglo: ['componentes', 'tipos_persona', 'apoyo_etiquetas', 'apoyo_excluir_etiquetas'],
    padres: [
      { campo: 'proyecto_id', tabla: 'proyectos', obligatorio: false },
      { campo: 'apoyo_id', tabla: 'tipos_apoyo', obligatorio: false },
      { campo: 'apoyo_excluir_id', tabla: 'tipos_apoyo', obligatorio: false }
    ],
    inmutables: [],
    hijos: []
  }
};

// =============================================================================
// UTILIDADES
// =============================================================================

/** Normaliza una clave: trim + mayusculas. */
export function normalizarClave(valor: string): string {
  return valor.trim().toUpperCase();
}

/** Valida que un valor sea una clave valida segun el patron del SPEC. */
export function validarClave(valor: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]*$/.test(valor.trim().toUpperCase());
}
