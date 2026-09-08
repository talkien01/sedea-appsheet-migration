// Modulo de Reportes (Beta): resumen agrupable de solicitudes VIVAS.
//
// Alcance deliberado de esta primera version:
//  - Un solo nivel de agrupacion a la vez (Regional / Municipio / Programa /
//    Concepto / Año) -- no tabla dinamica de varios niveles.
//  - Solo `solicitudes` en produccion, NUNCA el historico de CATALOGOS/PIIPC
//    (decision explicita del usuario).
//  - Exporta a Excel con formato, no CSV plano.
//
// Pendiente, anotado y NO construido en esta version: un modo "Detalle /
// Padron" (un renglon por beneficiario con su kg y monto) -- hoy
// `beneficiarios` no tiene una liga exacta (FK) a su fila de
// `solicitud_conceptos`, asi que el monto por beneficiario no se puede sacar
// sin ambiguedad. Hace falta agregar `solicitud_concepto_id` a
// `beneficiarios` (migracion aditiva + backfill) antes de construir ese modo.
import { z } from 'zod';

/**
 * Capacidad para entrar al modulo. admin y director SIEMPRE la tienen; el
 * resto (capturista, ventanilla, editor_datos...) la obtiene combinando
 * "+reportes" a su rol, persona por persona -- no es un rol base nuevo, es
 * aditivo (ver ETIQUETAS_ROL en usuarios.ts).
 */
export const ROLES_REPORTES = ['admin', 'director', 'reportes'] as const;

export function puedeVerReportes(rol: string | null | undefined): boolean {
  const rolesUsuario = String(rol ?? '')
    .split('+')
    .filter(Boolean);
  return (ROLES_REPORTES as readonly string[]).some((r) => rolesUsuario.includes(r));
}

export const DIMENSIONES_REPORTE = ['regional', 'municipio', 'programa', 'concepto', 'anio'] as const;
export type DimensionReporte = (typeof DIMENSIONES_REPORTE)[number];

export const ETIQUETAS_DIMENSION: Record<DimensionReporte, string> = {
  regional: 'Dirección Regional',
  municipio: 'Municipio',
  programa: 'Programa',
  concepto: 'Concepto de apoyo',
  anio: 'Año'
};

export const esquemaFiltrosReporte = z.object({
  agrupar_por: z.enum(DIMENSIONES_REPORTE),
  anio: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n >= 2000 && n <= 2100, {
      message: 'anio debe ser un año válido'
    })
    .optional(),
  regional_id: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .optional(),
  municipio_id: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .optional(),
  programa_id: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .optional(),
  tipo_apoyo_id: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .optional()
});
export type FiltrosReporte = z.infer<typeof esquemaFiltrosReporte>;

export interface FilaReporte {
  etiqueta: string;
  solicitudes: number;
  /** Suma de `cantidad` de los conceptos con unidad de medida capturada.
   * Puede mezclar unidades distintas (kg, obra, etc.) cuando la dimension NO
   * es "concepto" -- se muestra tal cual, como el propio Dashboard ya hace. */
  cantidad: number;
  /** Mismo criterio de autorizacion que el resto del sistema (Secretario O
   * autorizado_de_facto), aplicado a `monto_estatal`. */
  monto_autorizado: number;
}

export interface RespuestaReporte {
  dimension: DimensionReporte;
  filas: FilaReporte[];
}
