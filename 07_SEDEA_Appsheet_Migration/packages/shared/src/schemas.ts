// Esquemas Zod compartidos: se usan tanto para validar en el servidor como
// para validar antes de encolar en el cliente.
import { z } from 'zod';

export const esquemaLogin = z.object({
  usuario: z.string().min(1, 'El usuario es obligatorio').max(80),
  password: z.string().min(1, 'La contrasena es obligatoria').max(200)
});
export type EntradaLogin = z.infer<typeof esquemaLogin>;

/** UUID v4 generado en el cliente: clave de idempotencia de la sincronizacion. */
export const esquemaUuidV4 = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'El uuid debe ser v4'
  );

/** Convierte los campos multipart (siempre texto) al tipo esperado. */
const numeroDesdeTexto = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return n;
});

export const esquemaCaptura = z.object({
  uuid: esquemaUuidV4,
  beneficiario_id: numeroDesdeTexto.pipe(z.number().int().positive()),
  lat: numeroDesdeTexto.pipe(z.number().min(-90).max(90)),
  lng: numeroDesdeTexto.pipe(z.number().min(-180).max(180)),
  precision_m: numeroDesdeTexto.pipe(z.number().min(0).max(100000)),
  capturado_en: z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'capturado_en debe ser una fecha ISO 8601 valida'
  }),
  tipo_apoyo_id: z
    .union([numeroDesdeTexto.pipe(z.number().int().positive()), z.null()])
    .optional()
    .nullable(),
  cantidad_entregada: z
    .union([numeroDesdeTexto.pipe(z.number()), z.null()])
    .optional()
    .nullable(),
  observaciones: z.string().max(500).optional().nullable()
});
export type EntradaCaptura = z.infer<typeof esquemaCaptura>;

export const esquemaConsultaBeneficiarios = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(200),
  regional_id: z.coerce.number().int().positive().optional(),
  municipio_id: z.coerce.number().int().positive().optional(),
  colonia: z.string().optional(),
  seccion: z.string().optional(),
  q: z.string().optional(),
  since: z.string().optional()
});

export const esquemaConsultaAuditoria = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(50),
  regional_id: z.coerce.number().int().positive().optional(),
  municipio_id: z.coerce.number().int().positive().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  q: z.string().optional()
});

/** Roles con acceso al panel de auditoria. */
export const ROLES_AUDITORIA = ['auditor', 'admin'] as const;
/** Roles que pueden crear capturas. */
export const ROLES_CAPTURA = ['capturista', 'admin'] as const;
