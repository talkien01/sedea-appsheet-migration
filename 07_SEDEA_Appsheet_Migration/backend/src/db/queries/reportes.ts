// Modulo de Reportes (Beta): agregacion parametrizada sobre `solicitudes`
// vivas. Un solo nivel de agrupacion a la vez -- ver comentario de alcance en
// packages/shared/src/reportes.ts.
//
// Seguridad: la dimension de agrupacion NUNCA sale de texto del usuario hacia
// el SQL -- se resuelve contra un mapa fijo (DIMENSION_SQL) igual que
// `expresionApellido`/otros mapas de esta base. Los filtros si son valores de
// usuario, pero siempre van como parametro ($N), nunca concatenados.
import { consultar } from '../pool.js';
import type { DimensionReporte, FilaReporte, FiltrosReporte } from '@sedea/shared';

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

export async function generarReporteSolicitudes(
  dimension: DimensionReporte,
  filtros: FiltrosReporte,
  regionalForzadaId: number | null
): Promise<FilaReporte[]> {
  const parametros: unknown[] = [];
  // Igual que el Dashboard (por_concepto): solo conceptos con unidad de
  // medida capturada entran a la suma de `cantidad` -- excluye conceptos sin
  // magnitud fisica definida (ej. si algun dia hay uno de "asesoria").
  const condiciones: string[] = ['t.unidad_medida IS NOT NULL'];

  const agregarFiltro = (valor: number | undefined, expresion: string) => {
    if (valor === undefined) return;
    parametros.push(valor);
    condiciones.push(`${expresion} $${parametros.length}`);
  };

  // Regional forzada (usuario con Regional asignada) SIEMPRE gana sobre el
  // filtro pedido -- mismo criterio que estadisticas.ts / beneficiarios.ts.
  if (regionalForzadaId !== null) {
    agregarFiltro(regionalForzadaId, 'm.regional_id =');
  } else {
    agregarFiltro(filtros.regional_id, 'm.regional_id =');
  }
  agregarFiltro(filtros.municipio_id, 'm.id =');
  agregarFiltro(filtros.programa_id, 'p.id =');
  agregarFiltro(filtros.tipo_apoyo_id, 't.id =');
  agregarFiltro(filtros.anio, 'EXTRACT(YEAR FROM s.recibida_en) =');

  const { select, groupBy } = DIMENSION_SQL[dimension];

  const filas = await consultar<{
    etiqueta: string;
    solicitudes: string;
    cantidad: string;
    monto_autorizado: string;
  }>(
    `SELECT
       ${select} AS etiqueta,
       count(DISTINCT s.id)::int AS solicitudes,
       COALESCE(SUM(sc.cantidad), 0)::float8 AS cantidad,
       COALESCE(SUM(sc.monto_estatal) FILTER (
         WHERE s.autorizada_secretario = TRUE OR t.autorizado_de_facto = TRUE
       ), 0)::float8 AS monto_autorizado
     FROM solicitudes s
     JOIN municipios m ON m.id = s.ubi_municipio_id
     LEFT JOIN direcciones_regionales r ON r.id = m.regional_id
     JOIN programas p ON p.id = s.programa_id
     JOIN solicitud_conceptos sc ON sc.solicitud_id = s.id
     JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
     WHERE ${condiciones.join(' AND ')}
     GROUP BY ${groupBy}
     ORDER BY etiqueta`,
    parametros
  );

  return filas.map((f) => ({
    etiqueta: f.etiqueta,
    solicitudes: Number(f.solicitudes),
    cantidad: Number(f.cantidad),
    monto_autorizado: Number(f.monto_autorizado)
  }));
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
