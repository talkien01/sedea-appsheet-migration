// Visor de "Evidencia de entregas": listado + metricas + catalogos de filtro
// sobre `entregas_apoyo` -- ver alcance en packages/shared/src/entregas.ts.
//
// Seguridad: los filtros de usuario van SIEMPRE como parametro ($N), nunca
// concatenados; `regionalForzada` (Regional del usuario) SIEMPRE gana sobre
// el filtro `regional_id` pedido, igual que en reportes.ts / beneficiarios.ts.
import { consultar } from '../pool.js';
import {
  LIMITE_EVIDENCIA_PANTALLA,
  type CatalogosEvidencia,
  type FilaEvidencia,
  type FiltrosEvidencia
} from '@sedea/shared';

/** Tope alto del Excel: no deberia alcanzarse con el volumen real de entregas
 * de un evento, pero evita una descarga descontrolada. */
const LIMITE_EVIDENCIA_EXCEL = 20000;

function condiciones(
  filtros: FiltrosEvidencia,
  regionalForzadaId: number | null
): { where: string; parametros: unknown[] } {
  const parametros: unknown[] = [];
  const partes: string[] = [];

  const agregar = (valor: unknown, expresion: string) => {
    if (valor === undefined || valor === null || valor === '') return;
    parametros.push(valor);
    partes.push(`${expresion} $${parametros.length}`);
  };

  if (regionalForzadaId !== null) {
    agregar(regionalForzadaId, 's.regional_id =');
  } else {
    agregar(filtros.regional_id, 's.regional_id =');
  }
  agregar(filtros.tipo_apoyo_id, 'sc.tipo_apoyo_id =');
  agregar(filtros.entregado_por, 'ea.entregado_por =');
  // Fechas: `desde`/`hasta` son fechas (YYYY-MM-DD); `hasta` es inclusivo
  // hasta el final del dia.
  agregar(filtros.desde, 'ea.entregado_en >=');
  if (filtros.hasta) {
    parametros.push(filtros.hasta);
    partes.push(`ea.entregado_en < ($${parametros.length}::date + INTERVAL '1 day')`);
  }

  return { where: partes.length ? `WHERE ${partes.join(' AND ')}` : '', parametros };
}

const FROM_EVIDENCIA = `
  FROM entregas_apoyo ea
  JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
  JOIN solicitudes s          ON s.id = sc.solicitud_id
  JOIN tipos_apoyo t          ON t.id = sc.tipo_apoyo_id
  JOIN usuarios u             ON u.id = ea.entregado_por
  LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
  LEFT JOIN municipios m      ON m.id = s.ubi_municipio_id`;

export async function listarEvidenciaEntregas(
  filtros: FiltrosEvidencia,
  regionalForzadaId: number | null,
  paraExcel = false
): Promise<{ filas: FilaEvidencia[]; total: number; con_gps: number; sin_gps: number; ultimas_24h: number }> {
  const { where, parametros } = condiciones(filtros, regionalForzadaId);

  const resumen = await consultar<{ total: string; con_gps: string; sin_gps: string; ultimas_24h: string }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ea.sin_gps = FALSE)::int AS con_gps,
            COUNT(*) FILTER (WHERE ea.sin_gps = TRUE)::int  AS sin_gps,
            COUNT(*) FILTER (WHERE ea.entregado_en >= now() - INTERVAL '24 hours')::int AS ultimas_24h
       ${FROM_EVIDENCIA}
       ${where}`,
    parametros
  );

  // El tamaño de pagina lo elige el usuario (25/50/100/200); el esquema Zod
  // ya lo topa a 200, aqui solo se aplica el default si no viene.
  const limite = paraExcel ? LIMITE_EVIDENCIA_EXCEL : filtros.limite ?? LIMITE_EVIDENCIA_PANTALLA;
  const offset = paraExcel ? 0 : filtros.offset ?? 0;
  const parametrosPagina = [...parametros, limite, offset];

  const filas = await consultar<{
    uuid: string;
    foto_url: string;
    folio: string;
    beneficiario: string;
    curp: string | null;
    regional: string;
    municipio: string | null;
    concepto: string;
    cantidad: string;
    unidad_medida: string | null;
    entregado_en: string;
    entregado_por: string;
    lat: number | null;
    lng: number | null;
    precision_m: number | null;
    sin_gps: boolean;
    observaciones: string | null;
  }>(
    `SELECT ea.uuid, ea.foto_url,
            s.folio,
            COALESCE(NULLIF(s.razon_social, ''), s.nombre_solicitante) AS beneficiario,
            s.curp,
            COALESCE(r.nombre, 'Sin Regional') AS regional,
            m.nombre AS municipio,
            t.nombre AS concepto,
            sc.cantidad::float8 AS cantidad,
            COALESCE(sc.unidad_medida, t.unidad_medida) AS unidad_medida,
            ea.entregado_en,
            u.nombre_completo AS entregado_por,
            ea.lat, ea.lng, ea.precision_m, ea.sin_gps, ea.observaciones
       ${FROM_EVIDENCIA}
       ${where}
      ORDER BY ea.entregado_en DESC
      LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
    parametrosPagina
  );

  return {
    filas: filas.map((f) => ({
      uuid: f.uuid,
      foto_url: f.foto_url,
      folio: f.folio,
      beneficiario: f.beneficiario,
      curp: f.curp,
      regional: f.regional,
      municipio: f.municipio,
      concepto: f.concepto,
      cantidad: Number(f.cantidad),
      unidad_medida: f.unidad_medida,
      entregado_en: f.entregado_en,
      entregado_por: f.entregado_por,
      lat: f.lat,
      lng: f.lng,
      precision_m: f.precision_m,
      sin_gps: f.sin_gps,
      observaciones: f.observaciones
    })),
    total: Number(resumen[0].total),
    con_gps: Number(resumen[0].con_gps),
    sin_gps: Number(resumen[0].sin_gps),
    ultimas_24h: Number(resumen[0].ultimas_24h)
  };
}

/** Catalogos para los selectores del visor, acotados a la Regional forzada.
 * Solo lista conceptos y personas que DE VERDAD aparecen en `entregas_apoyo`
 * (no el catalogo completo). */
export async function catalogosEvidenciaEntregas(
  regionalForzadaId: number | null
): Promise<CatalogosEvidencia> {
  const filtroRegional = regionalForzadaId !== null ? 'AND s.regional_id = $1' : '';
  const params = regionalForzadaId !== null ? [regionalForzadaId] : [];

  const [regionales, conceptos, entregadores] = await Promise.all([
    consultar<{ id: number; nombre: string }>(
      regionalForzadaId !== null
        ? 'SELECT id, nombre FROM direcciones_regionales WHERE id = $1 ORDER BY nombre'
        : 'SELECT id, nombre FROM direcciones_regionales ORDER BY nombre',
      params
    ),
    consultar<{ id: number; nombre: string }>(
      `SELECT DISTINCT t.id, t.nombre
         FROM entregas_apoyo ea
         JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
         JOIN solicitudes s ON s.id = sc.solicitud_id
         JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
        WHERE TRUE ${filtroRegional}
        ORDER BY t.nombre`,
      params
    ),
    consultar<{ id: number; nombre: string }>(
      `SELECT DISTINCT u.id, u.nombre_completo AS nombre
         FROM entregas_apoyo ea
         JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
         JOIN solicitudes s ON s.id = sc.solicitud_id
         JOIN usuarios u ON u.id = ea.entregado_por
        WHERE TRUE ${filtroRegional}
        ORDER BY nombre`,
      params
    )
  ]);

  return { regionales, conceptos, entregadores };
}
