// Modulo de Reportes: agregacion parametrizada sobre `solicitudes` vivas
// (resumen + matriz cruzada de hasta 2 dimensiones) y el padron con monto
// exacto por beneficiario -- ver alcance completo en
// packages/shared/src/reportes.ts.
//
// Seguridad: las dimensiones de agrupacion NUNCA salen de texto del usuario
// hacia el SQL -- se resuelven contra un mapa fijo (DIMENSION_SQL) igual que
// `expresionApellido`/otros mapas de esta base. Los filtros si son valores de
// usuario, pero siempre van como parametro ($N), nunca concatenados.
import { consultar } from '../pool.js';
import type {
  DimensionReporte,
  FilaPadron,
  FilaReporte,
  FiltrosComunesReporte
} from '@sedea/shared';

const DIMENSION_SQL: Record<DimensionReporte, { select: string; groupBy: string }> = {
  regional: { select: "COALESCE(r.nombre, 'Sin Regional')", groupBy: 'r.id, r.nombre' },
  municipio: { select: 'm.nombre', groupBy: 'm.id, m.nombre' },
  programa: { select: 'p.nombre', groupBy: 'p.id, p.nombre' },
  concepto: { select: 't.nombre', groupBy: 't.id, t.nombre' },
  anio: {
    select: "EXTRACT(YEAR FROM s.recibida_en)::text",
    groupBy: 'EXTRACT(YEAR FROM s.recibida_en)'
  }
};

/** Filtros comunes a resumen/matriz y padron -- misma logica, distintos alias
 * de tabla en cada consulta (aqui m./p./t./s., en el padron b./mu./p./t./s.). */
function condicionesComunes(
  filtros: FiltrosComunesReporte,
  regionalForzadaId: number | null,
  alias: { regional: string; municipio: string; programa: string; tipoApoyo: string; anio: string }
): { condiciones: string[]; parametros: unknown[] } {
  const parametros: unknown[] = [];
  const condiciones: string[] = [];

  const agregarFiltro = (valor: number | undefined, expresion: string) => {
    if (valor === undefined) return;
    parametros.push(valor);
    condiciones.push(`${expresion} $${parametros.length}`);
  };

  // Regional forzada (usuario con Regional asignada) SIEMPRE gana sobre el
  // filtro pedido -- mismo criterio que estadisticas.ts / beneficiarios.ts.
  if (regionalForzadaId !== null) {
    agregarFiltro(regionalForzadaId, `${alias.regional} =`);
  } else {
    agregarFiltro(filtros.regional_id, `${alias.regional} =`);
  }
  agregarFiltro(filtros.municipio_id, `${alias.municipio} =`);
  agregarFiltro(filtros.programa_id, `${alias.programa} =`);
  agregarFiltro(filtros.tipo_apoyo_id, `${alias.tipoApoyo} =`);
  agregarFiltro(filtros.anio, `${alias.anio} =`);

  return { condiciones, parametros };
}

export async function generarReporteSolicitudes(
  dimension: DimensionReporte,
  dimension2: DimensionReporte | undefined,
  filtros: FiltrosComunesReporte,
  regionalForzadaId: number | null
): Promise<FilaReporte[]> {
  // Igual que el Dashboard (por_concepto): solo conceptos con unidad de
  // medida capturada entran a las sumas -- excluye conceptos sin magnitud
  // fisica definida (ej. si algun dia hay uno de "asesoria").
  const { condiciones, parametros } = condicionesComunes(filtros, regionalForzadaId, {
    regional: 'm.regional_id',
    municipio: 'm.id',
    programa: 'p.id',
    tipoApoyo: 't.id',
    anio: 'EXTRACT(YEAR FROM s.recibida_en)'
  });
  condiciones.unshift('t.unidad_medida IS NOT NULL');

  const { select, groupBy } = DIMENSION_SQL[dimension];
  const segundaDimension = dimension2 ? DIMENSION_SQL[dimension2] : null;
  const selectEtiqueta2 = segundaDimension ? `, ${segundaDimension.select} AS etiqueta2` : '';
  const groupByCompleto = segundaDimension ? `${groupBy}, ${segundaDimension.groupBy}` : groupBy;
  const ordenPor = segundaDimension ? 'etiqueta, etiqueta2' : 'etiqueta';

  // "Entregado": EXISTS por fila de solicitud_conceptos contra
  // entregas_apoyo (liga 1:1, ver migracion de evidencia de campo) -- la v1
  // de Reportes nunca sumaba esto, solo lo tenia el Dashboard por concepto.
  const filas = await consultar<{
    etiqueta: string;
    etiqueta2: string | null;
    solicitudes: string;
    cantidad: string;
    cantidad_entregada: string;
    monto_solicitado: string;
    monto_autorizado: string;
    monto_entregado: string;
  }>(
    `SELECT
       ${select} AS etiqueta${selectEtiqueta2},
       count(DISTINCT s.id)::int AS solicitudes,
       COALESCE(SUM(sc.cantidad), 0)::float8 AS cantidad,
       COALESCE(SUM(sc.cantidad) FILTER (
         WHERE EXISTS (SELECT 1 FROM entregas_apoyo ea WHERE ea.solicitud_concepto_id = sc.id)
       ), 0)::float8 AS cantidad_entregada,
       COALESCE(SUM(sc.monto_estatal), 0)::float8 AS monto_solicitado,
       COALESCE(SUM(sc.monto_estatal) FILTER (
         WHERE s.autorizada_secretario = TRUE OR t.autorizado_de_facto = TRUE
       ), 0)::float8 AS monto_autorizado,
       COALESCE(SUM(sc.monto_estatal) FILTER (
         WHERE EXISTS (SELECT 1 FROM entregas_apoyo ea WHERE ea.solicitud_concepto_id = sc.id)
       ), 0)::float8 AS monto_entregado
     FROM solicitudes s
     JOIN municipios m ON m.id = s.ubi_municipio_id
     LEFT JOIN direcciones_regionales r ON r.id = m.regional_id
     JOIN programas p ON p.id = s.programa_id
     JOIN solicitud_conceptos sc ON sc.solicitud_id = s.id
     JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
     WHERE ${condiciones.join(' AND ')}
     GROUP BY ${groupByCompleto}
     ORDER BY ${ordenPor}`,
    parametros
  );

  return filas.map((f) => ({
    etiqueta: f.etiqueta,
    ...(f.etiqueta2 !== null && f.etiqueta2 !== undefined ? { etiqueta2: f.etiqueta2 } : {}),
    solicitudes: Number(f.solicitudes),
    cantidad: Number(f.cantidad),
    cantidad_entregada: Number(f.cantidad_entregada),
    monto_solicitado: Number(f.monto_solicitado),
    monto_autorizado: Number(f.monto_autorizado),
    monto_entregado: Number(f.monto_entregado)
  }));
}

/** Tope de filas del padron mostradas EN PANTALLA -- el Excel siempre trae
 * todo (ver LIMITE_FILAS_PADRON_EXCEL), la pantalla es solo vista previa. */
const LIMITE_FILAS_PADRON_PANTALLA = 500;
/** Tope de seguridad del Excel -- no deberia alcanzarse con el volumen actual
 * de beneficiarios, pero evita una descarga descontrolada si algun dia crece
 * mucho mas de lo esperado. */
const LIMITE_FILAS_PADRON_EXCEL = 20000;

async function padronSolicitudes(
  filtros: FiltrosComunesReporte,
  regionalForzadaId: number | null,
  limite: number
): Promise<FilaPadron[]> {
  const { condiciones, parametros } = condicionesComunes(filtros, regionalForzadaId, {
    regional: 'b.regional_id',
    municipio: 'b.municipio_id',
    programa: 'p.id',
    tipoApoyo: 't.id',
    anio: 'EXTRACT(YEAR FROM s.recibida_en)'
  });
  condiciones.unshift('t.unidad_medida IS NOT NULL');
  parametros.push(limite);

  const filas = await consultar<{
    beneficiario: string;
    curp: string | null;
    regional: string;
    municipio: string;
    concepto: string;
    cantidad: string;
    unidad_medida: string | null;
    monto_estatal: string;
    entregado: boolean;
  }>(
    // INNER JOIN a beneficiarios a proposito: sin esa liga (solo posible en
    // datos anteriores a que se empezara a llenar `beneficiario_id`, ver
    // comentario de alcance) no hay padron individual que mostrar para esa
    // fila -- sigue contando en el resumen/matriz, que no depende de esta
    // liga.
    `SELECT
       b.nombre_completo AS beneficiario,
       b.curp,
       COALESCE(r.nombre, 'Sin Regional') AS regional,
       mu.nombre AS municipio,
       t.nombre AS concepto,
       sc.cantidad::float8 AS cantidad,
       t.unidad_medida,
       sc.monto_estatal::float8 AS monto_estatal,
       EXISTS (SELECT 1 FROM entregas_apoyo ea WHERE ea.solicitud_concepto_id = sc.id) AS entregado
     FROM solicitud_conceptos sc
     JOIN beneficiarios b ON b.id = sc.beneficiario_id
     JOIN solicitudes s ON s.id = b.solicitud_id
     JOIN municipios mu ON mu.id = b.municipio_id
     LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
     JOIN programas p ON p.id = s.programa_id
     JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY mu.nombre, beneficiario
     LIMIT $${parametros.length}`,
    parametros
  );

  return filas.map((f) => ({
    beneficiario: f.beneficiario,
    curp: f.curp,
    regional: f.regional,
    municipio: f.municipio,
    concepto: f.concepto,
    cantidad: Number(f.cantidad),
    unidad_medida: f.unidad_medida,
    monto_estatal: Number(f.monto_estatal),
    entregado: f.entregado
  }));
}

/** Padron para la pantalla: acotado, con bandera si se corto. */
export async function generarPadronPantalla(
  filtros: FiltrosComunesReporte,
  regionalForzadaId: number | null
): Promise<{ filas: FilaPadron[]; truncado: boolean }> {
  const filas = await padronSolicitudes(filtros, regionalForzadaId, LIMITE_FILAS_PADRON_PANTALLA + 1);
  const truncado = filas.length > LIMITE_FILAS_PADRON_PANTALLA;
  return { filas: truncado ? filas.slice(0, LIMITE_FILAS_PADRON_PANTALLA) : filas, truncado };
}

/** Padron para el Excel: mismo filtro, tope alto (ver LIMITE_FILAS_PADRON_EXCEL). */
export async function generarPadronExcel(
  filtros: FiltrosComunesReporte,
  regionalForzadaId: number | null
): Promise<FilaPadron[]> {
  return padronSolicitudes(filtros, regionalForzadaId, LIMITE_FILAS_PADRON_EXCEL);
}

export interface CatalogosReporte {
  regionales: Array<{ id: number; nombre: string }>;
  municipios: Array<{ id: number; nombre: string; regional_id: number | null }>;
  programas: Array<{ id: number; nombre: string }>;
  conceptos: Array<{ id: number; nombre: string; unidad_medida: string | null }>;
}

/** Listas para los filtros de la pantalla, acotadas a la Regional forzada. */
export async function catalogosReporte(regionalForzadaId: number | null): Promise<CatalogosReporte> {
  const parametrosMunicipio: unknown[] = [];
  const filtroRegional = regionalForzadaId !== null ? 'WHERE regional_id = $1' : '';
  if (regionalForzadaId !== null) parametrosMunicipio.push(regionalForzadaId);

  const [regionales, municipios, programas, conceptos] = await Promise.all([
    consultar<{ id: number; nombre: string }>(
      regionalForzadaId !== null
        ? 'SELECT id, nombre FROM direcciones_regionales WHERE id = $1 ORDER BY nombre'
        : 'SELECT id, nombre FROM direcciones_regionales ORDER BY nombre',
      regionalForzadaId !== null ? [regionalForzadaId] : []
    ),
    consultar<{ id: number; nombre: string; regional_id: number | null }>(
      `SELECT id, nombre, regional_id FROM municipios ${filtroRegional} ORDER BY nombre`,
      parametrosMunicipio
    ),
    consultar<{ id: number; nombre: string }>('SELECT id, nombre FROM programas ORDER BY nombre'),
    consultar<{ id: number; nombre: string; unidad_medida: string | null }>(
      "SELECT id, nombre, unidad_medida FROM tipos_apoyo WHERE unidad_medida IS NOT NULL ORDER BY nombre"
    )
  ]);

  return { regionales, municipios, programas, conceptos };
}
