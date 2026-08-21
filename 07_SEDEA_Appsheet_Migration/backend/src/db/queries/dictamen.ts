// Consultas del modulo de dictamen (Build 13, E56-E59).
//
// El `dictaminador` dictamina a nivel ESTATAL: aqui NO se aplica
// `regionalForzada` ni `leerAlcance` (A19-6).
import { pool } from '../pool.js';
import { documentosConProblema, type DetalleDocumento } from '../../servicios/predictamen.js';

const POR_PAGINA_MAX = 100;

export type FiltroEstadoBandeja =
  | 'negativo'
  | 'positivo'
  | 'error'
  | 'sin_predictamen'
  | 'dictaminadas'
  | 'todas';

export interface OpcionesBandeja {
  pagina: number;
  porPagina: number;
  estado: FiltroEstadoBandeja;
  q: string | null;
}

/**
 * `p` = ultimo pre-dictamen de la solicitud (mayor generado_en, desempate por
 * id mayor, D19-6). `d` = ultimo dictamen humano.
 */
const CTE_BASE = `
  WITH ultimo_pre AS (
    SELECT DISTINCT ON (solicitud_id)
           id, solicitud_id, estado, resumen, generado_en, modelo_usado, detalle
      FROM predictamenes_ia
     ORDER BY solicitud_id, generado_en DESC, id DESC
  ),
  ultimo_dic AS (
    SELECT DISTINCT ON (solicitud_id)
           id, solicitud_id, resultado, dictaminado_en, dictaminado_por
      FROM dictamenes
     ORDER BY solicitud_id, dictaminado_en DESC, id DESC
  ),
  docs AS (
    SELECT solicitud_id,
           count(*)::int AS documentos_total,
           count(*) FILTER (WHERE archivo_url IS NOT NULL)::int AS documentos_con_archivo
      FROM solicitud_documentos
     GROUP BY solicitud_id
  )
`;

interface FilaCruda {
  solicitud_id: number;
  folio: string;
  solicitante: string;
  recibida_en: string;
  documentos_total: number | null;
  documentos_con_archivo: number | null;
  pre_id: number | null;
  pre_estado: string | null;
  pre_resumen: string | null;
  pre_generado_en: string | null;
  pre_modelo: string | null;
  pre_detalle: DetalleDocumento[] | null;
  dic_id: number | null;
  dic_resultado: string | null;
  dic_en: string | null;
  dic_por_nombre: string | null;
}

/** Traduce el filtro `estado` a su condicion SQL y a su parametro. */
function condicionEstado(estado: FiltroEstadoBandeja): string {
  switch (estado) {
    case 'negativo':
    case 'positivo':
    case 'error':
      return `p.estado = '${estado}' AND d.id IS NULL`;
    case 'sin_predictamen':
      return 'p.id IS NULL AND d.id IS NULL';
    case 'dictaminadas':
      return 'd.id IS NOT NULL';
    // `todas` excluye las ya dictaminadas por un humano (E56).
    default:
      return 'd.id IS NULL';
  }
}

export async function bandejaDictamen(opciones: OpcionesBandeja) {
  const porPagina = Math.min(Math.max(1, opciones.porPagina), POR_PAGINA_MAX);
  const pagina = Math.max(1, opciones.pagina);
  const parametros: unknown[] = [];
  const condiciones = [condicionEstado(opciones.estado)];

  if (opciones.q && opciones.q.trim().length >= 2) {
    parametros.push(`%${opciones.q.trim()}%`);
    condiciones.push(`(s.folio ILIKE $${parametros.length} OR s.nombre_solicitante ILIKE $${parametros.length})`);
  }

  const where = `WHERE ${condiciones.join(' AND ')}`;
  const desde = `
    FROM solicitudes s
    LEFT JOIN ultimo_pre p ON p.solicitud_id = s.id
    LEFT JOIN ultimo_dic d ON d.solicitud_id = s.id
    LEFT JOIN docs dc      ON dc.solicitud_id = s.id
    LEFT JOIN usuarios u   ON u.id = d.dictaminado_por
    ${where}
  `;

  const { rows: conteo } = await pool.query<{ total: number }>(
    `${CTE_BASE} SELECT count(*)::int AS total ${desde}`,
    parametros
  );
  const total = conteo[0]?.total ?? 0;

  parametros.push(porPagina, (pagina - 1) * porPagina);
  const { rows } = await pool.query<FilaCruda>(
    `${CTE_BASE}
     SELECT s.id AS solicitud_id, s.folio, s.nombre_solicitante AS solicitante, s.recibida_en,
            dc.documentos_total, dc.documentos_con_archivo,
            p.id AS pre_id, p.estado AS pre_estado, p.resumen AS pre_resumen,
            p.generado_en AS pre_generado_en, p.modelo_usado AS pre_modelo, p.detalle AS pre_detalle,
            d.id AS dic_id, d.resultado AS dic_resultado, d.dictaminado_en AS dic_en,
            u.nombre_completo AS dic_por_nombre
     ${desde}
     -- Orden fijo D19-7: negativo -> error -> sin pre-dictamen -> positivo,
     -- y dentro de cada grupo la mas vieja primero.
     ORDER BY CASE
                WHEN d.id IS NOT NULL THEN 4
                WHEN p.estado = 'negativo' THEN 0
                WHEN p.estado = 'error' THEN 1
                WHEN p.id IS NULL THEN 2
                ELSE 3
              END,
              s.recibida_en ASC, s.id ASC
     LIMIT $${parametros.length - 1} OFFSET $${parametros.length}`,
    parametros
  );

  return {
    total,
    pagina,
    por_pagina: porPagina,
    filas: rows.map((f) => ({
      solicitud_id: Number(f.solicitud_id),
      folio: f.folio,
      solicitante: f.solicitante,
      recibida_en: f.recibida_en,
      documentos_total: Number(f.documentos_total ?? 0),
      documentos_con_archivo: Number(f.documentos_con_archivo ?? 0),
      predictamen: f.pre_id
        ? {
            id: Number(f.pre_id),
            estado: f.pre_estado as 'positivo' | 'negativo' | 'error',
            resumen: f.pre_resumen,
            generado_en: f.pre_generado_en as string,
            modelo_usado: f.pre_modelo as string,
            documentos_con_problema: documentosConProblema(f.pre_detalle ?? [])
          }
        : null,
      dictamen: f.dic_id
        ? {
            id: Number(f.dic_id),
            resultado: f.dic_resultado as 'positivo' | 'negativo',
            dictaminado_en: f.dic_en as string,
            dictaminado_por_nombre: f.dic_por_nombre
          }
        : null
    }))
  };
}

/** Ultimo pre-dictamen de una solicitud (mayor generado_en, desempate por id). */
export async function ultimoPredictamen(solicitudId: number) {
  const { rows } = await pool.query<{
    id: number;
    estado: string;
    resumen: string | null;
    generado_en: string;
    modelo_usado: string;
    detalle: DetalleDocumento[];
  }>(
    `SELECT id, estado, resumen, generado_en, modelo_usado, detalle
       FROM predictamenes_ia
      WHERE solicitud_id = $1
      ORDER BY generado_en DESC, id DESC
      LIMIT 1`,
    [solicitudId]
  );
  return rows[0] ?? null;
}

/** Detalle completo de la solicitud para E57. */
export async function detalleDictamen(solicitudId: number) {
  const { rows: solicitudes } = await pool.query<{
    id: number;
    folio: string;
    solicitante: string;
    curp: string | null;
    tipo_persona: string;
    componente: string | null;
    recibida_en: string;
  }>(
    `SELECT s.id, s.folio, s.nombre_solicitante AS solicitante, s.curp, s.tipo_persona,
            c.nombre AS componente, s.recibida_en
       FROM solicitudes s
       LEFT JOIN componentes c ON c.id = s.componente_id
      WHERE s.id = $1`,
    [solicitudId]
  );
  const solicitud = solicitudes[0] ?? null;
  if (!solicitud) return null;

  const { rows: documentos } = await pool.query<{
    solicitud_documento_id: number;
    documento_requerido_id: number | null;
    requisito: string;
    recibido: boolean;
    archivo_url: string | null;
    archivo_nombre: string | null;
  }>(
    `SELECT id AS solicitud_documento_id, documento_requerido_id, requisito,
            recibido, archivo_url, archivo_nombre
       FROM solicitud_documentos
      WHERE solicitud_id = $1
      ORDER BY id`,
    [solicitudId]
  );

  const predictamen = await ultimoPredictamen(solicitudId);
  const porDocumento = new Map<number, DetalleDocumento>();
  for (const d of predictamen?.detalle ?? []) {
    porDocumento.set(Number(d.solicitud_documento_id), d);
  }

  const { rows: dictamenes } = await pool.query<{
    id: number;
    resultado: string;
    nota: string | null;
    detalle: Array<{ documento_requerido_id: number; veredicto: string }>;
    coincide_con_ia: boolean | null;
    dictaminado_en: string;
    dictaminado_por_nombre: string | null;
  }>(
    `SELECT d.id, d.resultado, d.nota, d.detalle, d.coincide_con_ia, d.dictaminado_en,
            u.nombre_completo AS dictaminado_por_nombre
       FROM dictamenes d
       LEFT JOIN usuarios u ON u.id = d.dictaminado_por
      WHERE d.solicitud_id = $1
      ORDER BY d.dictaminado_en DESC, d.id DESC
      LIMIT 1`,
    [solicitudId]
  );
  const dictamen = dictamenes[0] ?? null;
  const veredictoHumano = new Map<number, string>();
  for (const item of dictamen?.detalle ?? []) {
    veredictoHumano.set(Number(item.documento_requerido_id), item.veredicto);
  }

  const { rows: historial } = await pool.query<{
    id: number;
    estado: string;
    generado_en: string;
    modelo_usado: string;
  }>(
    `SELECT id, estado, generado_en, modelo_usado
       FROM predictamenes_ia
      WHERE solicitud_id = $1
      ORDER BY generado_en DESC, id DESC
      LIMIT 20`,
    [solicitudId]
  );

  return {
    solicitud,
    documentos: documentos.map((d) => {
      const ia = porDocumento.get(Number(d.solicitud_documento_id)) ?? null;
      const humano =
        d.documento_requerido_id !== null && veredictoHumano.has(Number(d.documento_requerido_id))
          ? { veredicto: veredictoHumano.get(Number(d.documento_requerido_id)) }
          : null;
      return {
        solicitud_documento_id: Number(d.solicitud_documento_id),
        documento_requerido_id: d.documento_requerido_id === null ? null : Number(d.documento_requerido_id),
        requisito: d.requisito,
        recibido: d.recibido,
        archivo_url: d.archivo_url,
        archivo_nombre: d.archivo_nombre,
        ia: ia
          ? {
              presente: ia.presente,
              legible: ia.legible,
              curp_coincide: ia.curp_coincide,
              curp_leida: ia.curp_leida,
              observacion: ia.observacion
            }
          : null,
        humano
      };
    }),
    predictamen: predictamen
      ? {
          id: Number(predictamen.id),
          estado: predictamen.estado,
          resumen: predictamen.resumen,
          generado_en: predictamen.generado_en,
          modelo_usado: predictamen.modelo_usado
        }
      : null,
    dictamen: dictamen
      ? {
          id: Number(dictamen.id),
          resultado: dictamen.resultado,
          nota: dictamen.nota,
          coincide_con_ia: dictamen.coincide_con_ia,
          dictaminado_en: dictamen.dictaminado_en,
          dictaminado_por_nombre: dictamen.dictaminado_por_nombre
        }
      : null,
    historial_predictamenes: historial.map((h) => ({
      id: Number(h.id),
      estado: h.estado,
      generado_en: h.generado_en,
      modelo_usado: h.modelo_usado
    }))
  };
}

/** Ids de `documentos_requeridos` que SI pertenecen al checklist de la solicitud. */
export async function documentosRequeridosDeSolicitud(solicitudId: number): Promise<Set<number>> {
  const { rows } = await pool.query<{ documento_requerido_id: number | null }>(
    'SELECT documento_requerido_id FROM solicitud_documentos WHERE solicitud_id = $1',
    [solicitudId]
  );
  return new Set(
    rows.map((r) => (r.documento_requerido_id === null ? null : Number(r.documento_requerido_id)))
      .filter((v): v is number => v !== null)
  );
}

/** Metricas de la cabecera de /dictamen (E59). */
export async function metricasDictamen() {
  const { rows } = await pool.query<{
    negativos: number;
    positivos: number;
    errores: number;
    sin_predictamen: number;
    dictaminadas: number;
  }>(
    `${CTE_BASE}
     SELECT
       count(*) FILTER (WHERE d.id IS NULL AND p.estado = 'negativo')::int AS negativos,
       count(*) FILTER (WHERE d.id IS NULL AND p.estado = 'positivo')::int AS positivos,
       count(*) FILTER (WHERE d.id IS NULL AND p.estado = 'error')::int    AS errores,
       count(*) FILTER (WHERE d.id IS NULL AND p.id IS NULL)::int          AS sin_predictamen,
       count(*) FILTER (WHERE d.id IS NOT NULL)::int                       AS dictaminadas
     FROM solicitudes s
     LEFT JOIN ultimo_pre p ON p.solicitud_id = s.id
     LEFT JOIN ultimo_dic d ON d.solicitud_id = s.id`
  );
  const m = rows[0];

  const { rows: coincidencias } = await pool.query<{ total: number; coinciden: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE coincide_con_ia = true)::int AS coinciden
       FROM dictamenes
      WHERE coincide_con_ia IS NOT NULL`
  );
  const c = coincidencias[0];
  const porcentaje = c.total > 0 ? Math.round((c.coinciden / c.total) * 100) : 0;

  return {
    // "Pendientes" = todo lo que sigue sin veredicto humano.
    pendientes: Number(m.negativos) + Number(m.positivos) + Number(m.errores) + Number(m.sin_predictamen),
    negativos: Number(m.negativos),
    positivos: Number(m.positivos),
    sin_predictamen: Number(m.sin_predictamen),
    dictaminadas: Number(m.dictaminadas),
    coincidencia_ia: { total: Number(c.total), coinciden: Number(c.coinciden), porcentaje }
  };
}
