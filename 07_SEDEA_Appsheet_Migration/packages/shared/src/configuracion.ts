// Configuracion de plazos de ingreso de solicitudes.
// Backend y PWA comparten estas definiciones para validar igual de los dos lados.
import { z } from 'zod';

/** Fecha en formato ISO corto `YYYY-MM-DD` (la columna en BD es `date`). */
const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD.');

/**
 * Alta de un plazo NUEVO. Al crearse queda activo y desactiva al anterior:
 * solo puede haber un plazo activo a la vez (invariante que ya asume
 * `GET /api/configuracion/plazo-solicitudes`).
 */
export const esquemaPlazoAlta = z
  .object({
    fecha_inicio: fechaIso,
    fecha_fin: fechaIso
  })
  .strict()
  .refine((v) => v.fecha_fin > v.fecha_inicio, {
    message: 'La fecha de fin debe ser posterior a la fecha de inicio.',
    path: ['fecha_fin']
  });

/**
 * Cambio de estado de un plazo existente. Sirve para el caso "quiero cerrar la
 * captura ya, sin definir todavia la siguiente ventana" (`{activo:false}`) y
 * para reabrir una ventana anterior (`{activo:true}`, que desactiva a la que
 * estuviera activa para no romper la invariante de un solo plazo activo).
 */
export const esquemaPlazoEstado = z.object({ activo: z.boolean() }).strict();

export type PlazoAlta = z.infer<typeof esquemaPlazoAlta>;
export type PlazoEstado = z.infer<typeof esquemaPlazoEstado>;

/** Una fila del historial de `configuracion_plazos`. Fechas siempre `YYYY-MM-DD`. */
export interface PlazoSolicitudes {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

/** Respuesta del endpoint publico `GET /api/configuracion/plazo-solicitudes`. */
export interface PlazoVigente {
  activo: boolean;
  fecha_inicio?: string;
  fecha_fin?: string;
  dias_restantes?: number;
  vencido?: boolean;
}
