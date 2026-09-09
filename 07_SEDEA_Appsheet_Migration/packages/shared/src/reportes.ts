// Modulo de Reportes: resumen agrupable de solicitudes VIVAS, con matriz
// cruzada (2 dimensiones), comparativo Solicitado/Autorizado/Entregado, y
// padron con monto exacto por beneficiario.
//
// Alcance deliberado, decidido junto con el usuario (2026-09-09) al revisar
// la v1 (un solo nivel de agrupacion, sin cruce, sin "entregado"):
//  - Hasta 2 dimensiones de agrupacion a la vez (matriz), no una tabla
//    dinamica de N niveles -- las combinaciones utiles son pocas (Regional,
//    Municipio, Programa, Concepto, Año) y una matriz de 2 ejes ya cubre
//    "comparar concepto vs concepto", "montos por categoria/regional/
//    municipio", etc.
//  - Solo `solicitudes` en produccion, NUNCA el historico de CATALOGOS/PIIPC
//    (misma decision explicita de la v1).
//  - Solicitado/Autorizado/Entregado: los 3 cortes en la misma fila, como ya
//    hace el Dashboard por concepto, pero aqui cruzado con cualquier
//    dimension. "Entregado" sale de `entregas_apoyo` (liga 1:1 a
//    `solicitud_conceptos`) -- la v1 nunca tocaba esa tabla.
//  - Padron con monto exacto: un renglon por beneficiario+concepto. Viable
//    porque `solicitud_conceptos.beneficiario_id` YA se llena en cada alta
//    (ver `insertarBeneficiarioDeSolicitud`/UPDATE en rutas/solicitudes.ts) --
//    la v1 daba por hecho que faltaba esa liga y por eso no se construyo.
//  - Exporta a Excel con formato, no CSV plano (igual que v1).
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

export const DIMENSIONES_REPORTE = [
  'regional',
  'municipio',
  'programa',
  'concepto',
  'anio',
  'capturista'
] as const;
export type DimensionReporte = (typeof DIMENSIONES_REPORTE)[number];

export const ETIQUETAS_DIMENSION: Record<DimensionReporte, string> = {
  regional: 'Dirección Regional',
  municipio: 'Municipio',
  programa: 'Programa',
  concepto: 'Concepto de apoyo',
  anio: 'Año',
  capturista: 'Capturista'
};

/** Filtros comunes a las 3 consultas (resumen/matriz, padron). */
const camposFiltrosComunes = {
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
    .optional(),
  /** Quien capturo la solicitud (`solicitudes.capturado_por`) -- pedido real:
   * "cuántas toneladas he subido con los beneficiarios que cargué". */
  capturista_id: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .optional()
};

export const esquemaFiltrosComunes = z.object(camposFiltrosComunes);
export type FiltrosComunesReporte = z.infer<typeof esquemaFiltrosComunes>;

export const esquemaFiltrosReporte = z
  .object({
    agrupar_por: z.enum(DIMENSIONES_REPORTE),
    // Segunda dimension opcional (matriz cruzada). Debe ser distinta de
    // `agrupar_por` -- cruzar una dimension consigo misma no aporta nada.
    agrupar_por_2: z.enum(DIMENSIONES_REPORTE).optional(),
    ...camposFiltrosComunes
  })
  .refine((f) => f.agrupar_por_2 === undefined || f.agrupar_por_2 !== f.agrupar_por, {
    message: 'agrupar_por_2 debe ser distinto de agrupar_por',
    path: ['agrupar_por_2']
  });
export type FiltrosReporte = z.infer<typeof esquemaFiltrosReporte>;

export interface FilaReporte {
  etiqueta: string;
  /** Solo presente cuando se pidio `agrupar_por_2` (matriz cruzada). */
  etiqueta2?: string;
  solicitudes: number;
  /** Suma de `cantidad` de los conceptos con unidad de medida capturada,
   * SIN filtrar por autorizacion (universo completo de lo solicitado).
   * Puede mezclar unidades distintas (kg, obra, etc.) cuando la dimension NO
   * es "concepto" -- se muestra tal cual, como el propio Dashboard ya hace. */
  cantidad: number;
  /** Igual que `cantidad`, pero solo de los conceptos con entrega registrada
   * (`entregas_apoyo`). */
  cantidad_entregada: number;
  /** Unidad de `cantidad`/`cantidad_entregada` (kg, pieza, obra, ha...) --
   * SOLO si todos los conceptos que entraron a esta fila comparten la misma
   * unidad. Si la fila mezcla unidades distintas (ej. agrupado por Municipio
   * sin filtrar Concepto), viaja `null`: mostrar una unidad ahi seria
   * inventarsela. */
  unidad_medida: string | null;
  /** Suma de `monto_estatal` de TODO lo solicitado, autorizado o no. */
  monto_solicitado: number;
  /** Mismo criterio de autorizacion que el resto del sistema (Secretario O
   * autorizado_de_facto), aplicado a `monto_estatal`. */
  monto_autorizado: number;
  /** Suma de `monto_estatal` de los conceptos con entrega registrada. */
  monto_entregado: number;
}

export interface RespuestaReporte {
  dimension: DimensionReporte;
  dimension2?: DimensionReporte;
  filas: FilaReporte[];
}

export interface FilaPadron {
  beneficiario: string;
  curp: string | null;
  regional: string;
  municipio: string;
  concepto: string;
  cantidad: number;
  unidad_medida: string | null;
  monto_estatal: number;
  entregado: boolean;
}

export interface RespuestaPadron {
  filas: FilaPadron[];
  /** true si la consulta se corto en LIMITE_FILAS_PADRON -- el Excel siempre
   * trae todo, sin este limite. */
  truncado: boolean;
}
