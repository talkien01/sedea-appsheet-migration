// Resumen operativo de ingreso de solicitudes para el Dashboard.
// La pertenencia territorial se determina SIEMPRE por el municipio del predio
// (solicitudes.ubi_municipio_id). La ventanilla que capturo, incluida SEDEA
// Central, es solo el origen de captura y nunca una quinta Regional.
import { consultar, consultarUna } from '../pool.js';

const ZONA = 'America/Mexico_City';

export interface ResumenSolicitudesDashboard {
  regional_id: number | null;
  total_solicitudes: number;
  ingresadas_hoy: number;
  sin_dictamen: number;
  dictaminadas: number;
  autorizadas: number;
  pendientes_autorizacion: number;
  capturadas_central: number;
  por_municipio: Array<{
    municipio_id: number;
    municipio: string;
    total: number;
    hoy: number;
    sin_dictamen: number;
    dictaminadas: number;
    autorizadas: number;
  }>;
  por_capturista_hoy: Array<{
    usuario_id: number;
    usuario: string;
    nombre_completo: string;
    solicitudes: number;
  }>;
}

function filtroRegional(regionalId: number | null, parametros: unknown[]): string {
  if (regionalId === null) return '';
  parametros.push(regionalId);
  return `AND m.regional_id = $${parametros.length}`;
}

export async function resumenSolicitudesDashboard(
  regionalId: number | null
): Promise<ResumenSolicitudesDashboard> {
  const parametrosResumen: unknown[] = [];
  const regionalResumen = filtroRegional(regionalId, parametrosResumen);

  const resumen = await consultarUna<{
    total_solicitudes: number;
    ingresadas_hoy: number;
    sin_dictamen: number;
    dictaminadas: number;
    autorizadas: number;
    capturadas_central: number;
  }>(
    `SELECT
       count(*)::int AS total_solicitudes,
       count(*) FILTER (
         WHERE (s.recibida_en AT TIME ZONE '${ZONA}')::date =
               (now() AT TIME ZONE '${ZONA}')::date
       )::int AS ingresadas_hoy,
       count(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM dictamenes d WHERE d.solicitud_id = s.id)
       )::int AS sin_dictamen,
       count(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM dictamenes d WHERE d.solicitud_id = s.id)
       )::int AS dictaminadas,
       count(*) FILTER (WHERE s.autorizada_secretario = TRUE)::int AS autorizadas,
       count(*) FILTER (WHERE v.es_central = TRUE)::int AS capturadas_central
     FROM solicitudes s
     JOIN municipios m ON m.id = s.ubi_municipio_id
     JOIN ventanillas v ON v.id = s.ventanilla_id
     WHERE TRUE ${regionalResumen}`,
    parametrosResumen
  );

  const parametrosMunicipio: unknown[] = [];
  const regionalMunicipio = filtroRegional(regionalId, parametrosMunicipio);
  const porMunicipio = await consultar<{
    municipio_id: number;
    municipio: string;
    total: number;
    hoy: number;
    sin_dictamen: number;
    dictaminadas: number;
    autorizadas: number;
  }>(
    `SELECT
       m.id AS municipio_id,
       m.nombre AS municipio,
       count(*)::int AS total,
       count(*) FILTER (
         WHERE (s.recibida_en AT TIME ZONE '${ZONA}')::date =
               (now() AT TIME ZONE '${ZONA}')::date
       )::int AS hoy,
       count(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM dictamenes d WHERE d.solicitud_id = s.id)
       )::int AS sin_dictamen,
       count(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM dictamenes d WHERE d.solicitud_id = s.id)
       )::int AS dictaminadas,
       count(*) FILTER (WHERE s.autorizada_secretario = TRUE)::int AS autorizadas
     FROM solicitudes s
     JOIN municipios m ON m.id = s.ubi_municipio_id
     WHERE TRUE ${regionalMunicipio}
     GROUP BY m.id, m.nombre
     ORDER BY total DESC, m.nombre`,
    parametrosMunicipio
  );

  const parametrosCapturista: unknown[] = [];
  const regionalCapturista = filtroRegional(regionalId, parametrosCapturista);
  const porCapturista = await consultar<{
    usuario_id: number;
    usuario: string;
    nombre_completo: string;
    solicitudes: number;
  }>(
    `SELECT
       u.id AS usuario_id,
       u.usuario,
       u.nombre_completo,
       count(*)::int AS solicitudes
     FROM solicitudes s
     JOIN municipios m ON m.id = s.ubi_municipio_id
     JOIN usuarios u ON u.id = s.capturado_por
     WHERE (s.recibida_en AT TIME ZONE '${ZONA}')::date =
           (now() AT TIME ZONE '${ZONA}')::date
       ${regionalCapturista}
     GROUP BY u.id, u.usuario, u.nombre_completo
     ORDER BY solicitudes DESC, u.nombre_completo
     LIMIT 20`,
    parametrosCapturista
  );

  const total = Number(resumen?.total_solicitudes ?? 0);
  const autorizadas = Number(resumen?.autorizadas ?? 0);

  return {
    regional_id: regionalId,
    total_solicitudes: total,
    ingresadas_hoy: Number(resumen?.ingresadas_hoy ?? 0),
    sin_dictamen: Number(resumen?.sin_dictamen ?? 0),
    dictaminadas: Number(resumen?.dictaminadas ?? 0),
    autorizadas,
    pendientes_autorizacion: Math.max(0, total - autorizadas),
    capturadas_central: Number(resumen?.capturadas_central ?? 0),
    por_municipio: porMunicipio.map((fila) => ({
      municipio_id: Number(fila.municipio_id),
      municipio: fila.municipio,
      total: Number(fila.total),
      hoy: Number(fila.hoy),
      sin_dictamen: Number(fila.sin_dictamen),
      dictaminadas: Number(fila.dictaminadas),
      autorizadas: Number(fila.autorizadas)
    })),
    por_capturista_hoy: porCapturista.map((fila) => ({
      usuario_id: Number(fila.usuario_id),
      usuario: fila.usuario,
      nombre_completo: fila.nombre_completo,
      solicitudes: Number(fila.solicitudes)
    }))
  };
}
