// Registro de entrega del apoyo (Parte 1: modelo + backend + precarga offline).
//
// El grano es el CONCEPTO, no la solicitud: garbanzo y avena de la misma
// solicitud se entregan por separado. Sin parcialidades: existe la entrega o no.
import { z } from 'zod';
import { esquemaUuidV4 } from './schemas.js';

/** Quien puede registrar una entrega en campo: el mismo perfil que captura. */
export const ROLES_ENTREGA = ['capturista', 'admin'] as const;

/** Los campos llegan por multipart, es decir siempre como texto. */
const numeroDesdeTexto = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return n;
});

/**
 * Cuerpo de POST /api/entregas. Calcado de `esquemaCaptura`: mismo uuid de
 * cliente como clave de idempotencia y las mismas coordenadas.
 */
export const esquemaEntregaApoyo = z.object({
  uuid: esquemaUuidV4,
  solicitud_concepto_id: numeroDesdeTexto.pipe(z.number().int().positive()),
  lat: numeroDesdeTexto.pipe(z.number().min(-90).max(90)),
  lng: numeroDesdeTexto.pipe(z.number().min(-180).max(180)),
  precision_m: numeroDesdeTexto.pipe(z.number().min(0).max(100000)),
  entregado_en: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: 'entregado_en debe ser una fecha ISO 8601 valida'
    }),
  observaciones: z.string().max(500).optional().nullable()
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
