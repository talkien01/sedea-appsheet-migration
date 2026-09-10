// Registro de entrega del apoyo (Parte 1: modelo + backend + precarga offline).
//
// El grano es el CONCEPTO, no la solicitud: garbanzo y avena de la misma
// solicitud se entregan por separado. Sin parcialidades: existe la entrega o no.
import { z } from 'zod';
import { esquemaUuidV4 } from './schemas.js';

/**
 * Quien puede registrar una entrega en campo. Parte 2: el personal de
 * ventanilla es quien acude fisicamente al evento a entregar el apoyo, asi que
 * `ventanilla` entra junto con `capturista`. Sin esto la pantalla de campo
 * apareceria en el menu de ventanilla y la cola se atoraria con 403 al
 * sincronizar.
 */
export const ROLES_ENTREGA = ['ventanilla', 'capturista', 'admin'] as const;

/**
 * Capacidad efectiva de entrega para un rol simple o multi-rol.
 *
 * Regla institucional para Directores Regionales: `auditor+ventanilla` sirve
 * para supervision + apoyo extraordinario en captura de SOLICITUDES, pero no
 * concede por si solo las funciones de preparar evento ni registrar entregas.
 *
 * `admin` y `capturista` conservan la capacidad de entrega aunque tambien
 * tengan `auditor`; una ventanilla ordinaria tambien la conserva.
 */
export function puedeGestionarEntregas(rol: string | null | undefined): boolean {
  const roles = String(rol ?? '').split('+').filter(Boolean);
  if (roles.includes('admin') || roles.includes('capturista')) return true;
  if (!roles.includes('ventanilla')) return false;
  return !roles.includes('auditor');
}

/** Los campos llegan por multipart, es decir siempre como texto. */
const numeroDesdeTexto = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return n;
});

/** Igual que arriba, pero para el campo `sin_gps` ('true'/'false' de texto). */
const booleanoDesdeTexto = z.union([z.boolean(), z.string()]).transform((v) => {
  if (typeof v === 'boolean') return v;
  return v.trim().toLowerCase() === 'true';
});

/**
 * Cuerpo de POST /api/entregas. Calcado de `esquemaCaptura`: mismo uuid de
 * cliente como clave de idempotencia y las mismas coordenadas.
 *
 * `lat`/`lng`/`precision_m` son opcionales porque el sitio de entrega puede no
 * tener señal ni vista al cielo suficiente para un GPS satelital (migracion
 * 036) -- pero solo si `sin_gps` viene confirmado explicitamente, nunca por
 * default silencioso (ver `.refine` abajo).
 */
export const esquemaEntregaApoyo = z
  .object({
    uuid: esquemaUuidV4,
    solicitud_concepto_id: numeroDesdeTexto.pipe(z.number().int().positive()),
    lat: numeroDesdeTexto.pipe(z.number().min(-90).max(90)).optional(),
    lng: numeroDesdeTexto.pipe(z.number().min(-180).max(180)).optional(),
    precision_m: numeroDesdeTexto.pipe(z.number().min(0).max(100000)).optional(),
    sin_gps: booleanoDesdeTexto.optional().default(false),
    entregado_en: z
      .string()
      .min(1)
      .refine((v) => !Number.isNaN(Date.parse(v)), {
        message: 'entregado_en debe ser una fecha ISO 8601 valida'
      }),
    observaciones: z.string().max(500).optional().nullable()
  })
  .refine((datos) => datos.sin_gps || (datos.lat !== undefined && datos.lng !== undefined && datos.precision_m !== undefined), {
    message: 'Faltan las coordenadas de la entrega (o confirma sin_gps si el GPS no estuvo disponible).',
    path: ['lat']
  });
export type EntradaEntregaApoyo = z.infer<typeof esquemaEntregaApoyo>;

export interface RespuestaEntregaApoyo {
  uuid: string;
  solicitud_concepto_id: number;
  foto_url: string;
  /** true cuando el uuid ya existia: el reintento de la cola no duplico nada. */
  duplicado: boolean;
}

/**
 * Un renglon del paquete de "preparar evento de entrega". Es exactamente lo
 * que la pantalla de campo (Parte 2) necesita para identificar al beneficiario
 * y su concepto SIN RED. `folio` es la llave de busqueda por QR.
 */
export interface ConceptoPorEntregar {
  /** PK de solicitud_conceptos: lo que se manda a POST /api/entregas. */
  solicitud_concepto_id: number;
  solicitud_id: number;
  /** Folio de la solicitud. Llave de busqueda por QR en campo. */
  folio: string;
  beneficiario_id: number | null;
  beneficiario_nombre: string;
  curp: string | null;
  regional_id: number | null;
  regional_nombre: string | null;
  municipio_nombre: string | null;
  tipo_apoyo_id: number;
  tipo_apoyo_nombre: string;
  concepto_descripcion: string | null;
  cantidad: number;
  unidad_medida: string | null;
}

/** Respuesta de GET /api/entregas/preparar-evento. */
export interface PaqueteEventoEntrega {
  /** Momento en que el servidor armo el paquete (ISO 8601). */
  generado_en: string;
  filtro: {
    tipo_apoyo_id: number;
    tipo_apoyo_nombre: string;
    regional_id: number | null;
    regional_nombre: string | null;
  };
  total: number;
  conceptos: ConceptoPorEntregar[];
}

// ---------------------------------------------------------------------------
// Visor de "Evidencia de entregas": lo que hasta ahora NO existia -- las fotos
// de entrega (`entregas_apoyo`) se subian y guardaban pero ninguna pantalla
// las mostraba (a diferencia del Expediente de la Parte 1). Listado filtrable
// + panel de detalle + exportacion, acotado por Regional.
// ---------------------------------------------------------------------------

/** Quien puede VER la evidencia de entregas (revision/supervision, no captura
 * de campo). admin/director SIEMPRE; auditor como rol de supervision; el resto
 * combinando "+reportes" a su rol. Siempre acotado a la Regional del usuario. */
export const ROLES_VER_EVIDENCIA_ENTREGAS = ['admin', 'director', 'auditor', 'reportes'] as const;

export function puedeVerEvidenciaEntregas(rol: string | null | undefined): boolean {
  const roles = String(rol ?? '')
    .split('+')
    .filter(Boolean);
  return (ROLES_VER_EVIDENCIA_ENTREGAS as readonly string[]).some((r) => roles.includes(r));
}

/** Opciones del selector "Mostrar por página" del visor. */
export const OPCIONES_POR_PAGINA_EVIDENCIA = [25, 50, 100, 200] as const;
/** Por defecto y tope duro del tamaño de pagina. El Excel exporta TODO el
 * filtro, sin este tope (igual que el padron de Reportes). */
export const LIMITE_EVIDENCIA_PANTALLA = 50;
const LIMITE_EVIDENCIA_MAXIMO = 200;

const idOpcionalDesdeTexto = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive())
  .optional();

export const esquemaFiltrosEvidencia = z.object({
  regional_id: idOpcionalDesdeTexto,
  tipo_apoyo_id: idOpcionalDesdeTexto,
  entregado_por: idOpcionalDesdeTexto,
  /** Rango de fechas de entrega (ISO date, ambos inclusivos). */
  desde: z.string().optional(),
  hasta: z.string().optional(),
  /** Paginacion de la pantalla; el Excel la ignora. */
  offset: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(0))
    .optional(),
  /** Tamaño de pagina de la pantalla (25/50/100/200). Se topa a
   * LIMITE_EVIDENCIA_MAXIMO en el backend; el Excel lo ignora. */
  limite: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(1).max(LIMITE_EVIDENCIA_MAXIMO))
    .optional()
});
export type FiltrosEvidencia = z.infer<typeof esquemaFiltrosEvidencia>;

export interface FilaEvidencia {
  uuid: string;
  foto_url: string;
  folio: string;
  beneficiario: string;
  curp: string | null;
  regional: string;
  municipio: string | null;
  concepto: string;
  cantidad: number;
  unidad_medida: string | null;
  entregado_en: string;
  entregado_por: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  sin_gps: boolean;
  observaciones: string | null;
}

export interface RespuestaEvidencia {
  filas: FilaEvidencia[];
  /** Total del filtro completo (para "142 entregas con evidencia"). */
  total: number;
  con_gps: number;
  sin_gps: number;
  ultimas_24h: number;
}

export interface CatalogosEvidencia {
  regionales: Array<{ id: number; nombre: string }>;
  conceptos: Array<{ id: number; nombre: string }>;
  entregadores: Array<{ id: number; nombre: string }>;
}
