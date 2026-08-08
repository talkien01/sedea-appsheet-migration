// Agregaciones SQL del dashboard. Solo lectura: no hay tablas de metricas
// precalculadas, todo se resuelve con COUNT/GROUP BY sobre las tablas vivas
// (Assumption 38).
import { consultar, consultarUna } from '../pool.js';
import type {
  RespuestaApoyos,
  RespuestaAvance,
  RespuestaCobertura,
  RespuestaEstadisticasStaging
} from '@sedea/shared';

export interface FiltrosEstadisticas {
  regional_id: number | null;
  municipio_id: number | null;
  desde: string | null;
  hasta: string | null;
}

/** Redondea a un decimal; 0 si no hay universo. */
function porcentaje(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

/**
 * Condicion de fecha sobre capturas. Los filtros de fecha NUNCA excluyen
 * beneficiarios del denominador: aplican solo al numerador (Assumption 36).
 */
function condicionFechaCapturas(filtros: FiltrosEstadisticas, parametros: unknown[]): string {
  const partes: string[] = [];
  if (filtros.desde) {
    parametros.push(filtros.desde);
    partes.push(`c.capturado_en >= $${parametros.length}::date`);
  }
  if (filtros.hasta) {
    parametros.push(filtros.hasta);
    partes.push(`c.capturado_en < ($${parametros.length}::date + INTERVAL '1 day')`);
  }
  return partes.length ? `AND ${partes.join(' AND ')}` : '';
}

/** Condicion geografica sobre beneficiarios. */
function condicionGeografica(filtros: FiltrosEstadisticas, parametros: unknown[]): string {
  const partes: string[] = [];
  if (filtros.regional_id) {
    parametros.push(filtros.regional_id);
    partes.push(`b.regional_id = $${parametros.length}`);
  }
  if (filtros.municipio_id) {
    parametros.push(filtros.municipio_id);
    partes.push(`b.municipio_id = $${parametros.length}`);
  }
  return partes.length ? `WHERE ${partes.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// E30 - Cobertura de captura
// ---------------------------------------------------------------------------
export async function cobertura(filtros: FiltrosEstadisticas): Promise<RespuestaCobertura> {
  const parametros: unknown[] = [];
  const fecha = condicionFechaCapturas(filtros, parametros);
  const geo = condicionGeografica(filtros, parametros);

  // "Con evidencia" = al menos una captura (Assumption 37).
  const base = `
    SELECT b.id, b.regional_id, b.municipio_id,
           EXISTS (SELECT 1 FROM capturas c WHERE c.beneficiario_id = b.id ${fecha}) AS con_captura
      FROM beneficiarios b
      ${geo}
  `;

  const global = await consultarUna<{ total: number; con: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE con_captura)::int AS con FROM (${base}) t`,
    parametros
  );
  const total = global?.total ?? 0;
  const con = global?.con ?? 0;

  // Se parte de direcciones_regionales para que las 4 Regionales aparezcan
  // siempre, aunque una no tenga beneficiarios todavia.
  const porRegional = await consultar<any>(
    `SELECT r.id AS regional_id, r.nombre AS regional,
            count(t.id)::int AS total_beneficiarios,
            count(*) FILTER (WHERE t.con_captura)::int AS con_captura
       FROM direcciones_regionales r
       LEFT JOIN (${base}) t ON t.regional_id = r.id
      WHERE r.activo
      GROUP BY r.id, r.nombre
      ORDER BY r.nombre`,
    parametros
  );

  const porMunicipio = await consultar<any>(
    `SELECT m.id AS municipio_id, m.nombre AS municipio, r.nombre AS regional,
            count(t.id)::int AS total_beneficiarios,
            count(*) FILTER (WHERE t.con_captura)::int AS con_captura
       FROM municipios m
       LEFT JOIN direcciones_regionales r ON r.id = m.regional_id
       JOIN (${base}) t ON t.municipio_id = m.id
      WHERE m.activo
      GROUP BY m.id, m.nombre, r.nombre`,
    parametros
  );

  const conPorcentaje = (fila: any) => {
    const totalFila = Number(fila.total_beneficiarios ?? 0);
    const conFila = Number(fila.con_captura ?? 0);
    return {
      ...fila,
      total_beneficiarios: totalFila,
      con_captura: conFila,
      sin_captura: totalFila - conFila,
      porcentaje: porcentaje(conFila, totalFila)
    };
  };

  return {
    global: {
      total_beneficiarios: total,
      con_captura: con,
      sin_captura: total - con,
      porcentaje: porcentaje(con, total)
    },
    por_regional: porRegional.map(conPorcentaje),
    // Los municipios mas rezagados primero.
    por_municipio: porMunicipio
      .map(conPorcentaje)
      .sort((a: any, b: any) => a.porcentaje - b.porcentaje || a.municipio.localeCompare(b.municipio))
  };
}

// ---------------------------------------------------------------------------
// E31 - Distribucion por tipo de apoyo
// ---------------------------------------------------------------------------
export async function apoyos(
  filtros: FiltrosEstadisticas,
  limite: number
): Promise<RespuestaApoyos> {
  const parametros: unknown[] = [];
  const condiciones: string[] = [];
  if (filtros.regional_id) {
    parametros.push(filtros.regional_id);
    condiciones.push(`b.regional_id = $${parametros.length}`);
  }
  if (filtros.municipio_id) {
    parametros.push(filtros.municipio_id);
    condiciones.push(`b.municipio_id = $${parametros.length}`);
  }
  if (filtros.desde) {
    parametros.push(filtros.desde);
    condiciones.push(`c.capturado_en >= $${parametros.length}::date`);
  }
  if (filtros.hasta) {
    parametros.push(filtros.hasta);
    condiciones.push(`c.capturado_en < ($${parametros.length}::date + INTERVAL '1 day')`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const filas = await consultar<any>(
    `SELECT c.tipo_apoyo_id, t.clave, coalesce(t.nombre, 'Sin concepto') AS nombre,
            count(*)::int AS capturas,
            count(DISTINCT c.beneficiario_id)::int AS beneficiarios
       FROM capturas c
       JOIN beneficiarios b ON b.id = c.beneficiario_id
       LEFT JOIN tipos_apoyo t ON t.id = c.tipo_apoyo_id
       ${where}
      GROUP BY c.tipo_apoyo_id, t.clave, t.nombre
      ORDER BY capturas DESC, nombre ASC`,
    parametros
  );

  const totalFila = await consultarUna<{ capturas: number; beneficiarios: number }>(
    `SELECT count(*)::int AS capturas, count(DISTINCT c.beneficiario_id)::int AS beneficiarios
       FROM capturas c JOIN beneficiarios b ON b.id = c.beneficiario_id ${where}`,
    parametros
  );

  const principales = filas.slice(0, limite);
  const resto = filas.slice(limite);
  const otros = resto.length
    ? {
        conceptos: resto.length,
        capturas: resto.reduce((acumulado, f) => acumulado + Number(f.capturas), 0),
        beneficiarios: resto.reduce((acumulado, f) => acumulado + Number(f.beneficiarios), 0)
      }
    : null;

  return {
    total_capturas: totalFila?.capturas ?? 0,
    total_beneficiarios: totalFila?.beneficiarios ?? 0,
    data: principales.map((f) => ({
      tipo_apoyo_id: f.tipo_apoyo_id,
      clave: f.clave ?? null,
      nombre: f.nombre,
      capturas: Number(f.capturas),
      beneficiarios: Number(f.beneficiarios)
    })),
    otros
  };
}

// ---------------------------------------------------------------------------
// E32 - Avance en el tiempo
// ---------------------------------------------------------------------------
const ZONA = 'America/Mexico_City';

export async function avance(
  filtros: FiltrosEstadisticas,
  agrupacion: 'dia' | 'semana',
  desde: string,
  hasta: string
): Promise<RespuestaAvance> {
  const parametros: unknown[] = [desde, hasta];
  const condiciones: string[] = [
    `(c.capturado_en AT TIME ZONE '${ZONA}')::date >= $1::date`,
    `(c.capturado_en AT TIME ZONE '${ZONA}')::date <= $2::date`
  ];
  if (filtros.regional_id) {
    parametros.push(filtros.regional_id);
    condiciones.push(`b.regional_id = $${parametros.length}`);
  }
  if (filtros.municipio_id) {
    parametros.push(filtros.municipio_id);
    condiciones.push(`b.municipio_id = $${parametros.length}`);
  }

  const truncado =
    agrupacion === 'semana'
      ? `date_trunc('week', (c.capturado_en AT TIME ZONE '${ZONA}'))::date`
      : `(c.capturado_en AT TIME ZONE '${ZONA}')::date`;

  const serie =
    agrupacion === 'semana'
      ? `SELECT generate_series(date_trunc('week', $1::timestamp), date_trunc('week', $2::timestamp), INTERVAL '1 week')::date AS periodo`
      : `SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS periodo`;

  // Zero-fill obligatorio: la serie de periodos manda, las capturas se pegan.
  const filas = await consultar<any>(
    `WITH periodos AS (${serie}),
     datos AS (
       SELECT ${truncado} AS periodo, count(*)::int AS capturas,
              count(DISTINCT c.beneficiario_id)::int AS beneficiarios
         FROM capturas c
         JOIN beneficiarios b ON b.id = c.beneficiario_id
        WHERE ${condiciones.join(' AND ')}
        GROUP BY 1
     )
     SELECT to_char(p.periodo, 'YYYY-MM-DD') AS periodo,
            coalesce(d.capturas, 0) AS capturas,
            coalesce(d.beneficiarios, 0) AS beneficiarios
       FROM periodos p
       LEFT JOIN datos d ON d.periodo = p.periodo
      ORDER BY p.periodo`,
    parametros
  );

  let acumulado = 0;
  const data = filas.map((fila) => {
    acumulado += Number(fila.capturas);
    return {
      periodo: fila.periodo,
      capturas: Number(fila.capturas),
      beneficiarios: Number(fila.beneficiarios),
      acumulado
    };
  });

  return {
    agrupacion,
    desde,
    hasta,
    total_capturas: data.reduce((suma, f) => suma + f.capturas, 0),
    data
  };
}

// ---------------------------------------------------------------------------
// E33 - Estado del staging
// ---------------------------------------------------------------------------
export async function estadoStaging(
  regional: number | null
): Promise<RespuestaEstadisticasStaging> {
  const { resumenTabla } = await import('./staging.js');
  const beneficiarios = await resumenTabla('staging_beneficiarios', regional);
  const catalogos = await resumenTabla('staging_catalogos', regional);
  return {
    beneficiarios: { ...beneficiarios.por_estado, total: beneficiarios.total },
    catalogos: { ...catalogos.por_estado, total: catalogos.total }
  };
}
