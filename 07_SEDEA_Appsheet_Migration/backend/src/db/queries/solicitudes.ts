// Consultas SQL del modulo de ventanilla (build 6).
// Toda la logica de aislamiento por alcance vive en SQL (12.6.4): nunca se
// filtran filas en el cliente.
import type { PoolClient } from 'pg';
import { consultar, consultarUna } from '../pool.js';
import { condicionAlcanceSql, type AlcanceResuelto } from '../../servicios/alcance.js';

export interface FilaVentanilla {
  id: number;
  clave: string;
  nombre: string;
  regional_id: number;
  clave_folio: string;
  es_central: boolean;
}

/** Catalogos completos (sin filtrar por alcance: eso lo hace la ruta E40). */
export async function catalogosVentanilla() {
  const [programas, subprogramas, componentes, modalidades, proyectos, ventanillas, municipios, tiposApoyo] =
    await Promise.all([
      consultar<any>('SELECT id, clave, nombre FROM programas WHERE activo ORDER BY nombre'),
      consultar<any>(
        'SELECT id, programa_id, clave, nombre FROM subprogramas WHERE activo ORDER BY nombre'
      ),
      consultar<any>('SELECT id, clave, nombre FROM componentes WHERE activo ORDER BY clave'),
      consultar<any>(
        'SELECT id, clave, nombre, componente_id FROM modalidades WHERE activo ORDER BY nombre'
      ),
      consultar<any>(
        'SELECT id, clave, nombre, prefijo_folio, componente_id, modalidad_id FROM proyectos WHERE activo ORDER BY nombre'
      ),
      consultar<FilaVentanilla>(
        'SELECT id, clave, nombre, regional_id, clave_folio, es_central FROM ventanillas WHERE activo ORDER BY clave'
      ),
      consultar<any>(
        'SELECT id, nombre, regional_id, siglas_folio FROM municipios WHERE activo ORDER BY nombre'
      ),
      consultar<any>(
        `SELECT t.id, t.clave, t.nombre, t.unidad_medida, t.descripcion, t.proyecto_id,
                COALESCE(e.escalones, '[]'::json) AS escalones_cantidad
           FROM tipos_apoyo t
           LEFT JOIN LATERAL (
             SELECT json_agg(
                      json_build_object(
                        'superficie_desde', x.superficie_desde::float8,
                        'superficie_hasta', x.superficie_hasta::float8,
                        'cantidad',         x.cantidad::float8
                      ) ORDER BY x.superficie_hasta
                    ) AS escalones
               FROM reglas_cantidad_maxima_escalon x
              WHERE x.tipo_apoyo_id = t.id
           ) e ON TRUE
          WHERE t.activo
          ORDER BY t.nombre`
      )
    ]);

  return { programas, subprogramas, componentes, modalidades, proyectos, ventanillas, municipios, tiposApoyo };
}

/** Fila de `componentes` por id (solo activas). */
export async function componenteActivo(id: number) {
  return consultarUna<{ id: number; clave: string; nombre: string }>(
    'SELECT id, clave, nombre FROM componentes WHERE id = $1 AND activo',
    [id]
  );
}

/** Catalogos que participan en el alta, todos validados de una sola vez. */
export async function catalogosDelAlta(datos: {
  programa_id: number;
  subprograma_id: number | null;
  componente_id: number;
  proyecto_id: number;
  ventanilla_id: number;
}) {
  const [programa, subprograma, componente, proyecto, ventanilla] = await Promise.all([
    consultarUna<any>('SELECT id FROM programas WHERE id = $1 AND activo', [datos.programa_id]),
    datos.subprograma_id
      ? consultarUna<any>('SELECT id FROM subprogramas WHERE id = $1 AND activo', [
          datos.subprograma_id
        ])
      : Promise.resolve({ id: null }),
    consultarUna<any>('SELECT id, clave FROM componentes WHERE id = $1 AND activo', [
      datos.componente_id
    ]),
    consultarUna<any>(
      'SELECT id, clave, nombre, prefijo_folio, modalidad_id FROM proyectos WHERE id = $1 AND activo',
      [datos.proyecto_id]
    ),
    consultarUna<FilaVentanilla>(
      'SELECT id, clave, nombre, regional_id, clave_folio, es_central FROM ventanillas WHERE id = $1 AND activo',
      [datos.ventanilla_id]
    )
  ]);
  return { programa, subprograma, componente, proyecto, ventanilla };
}

/** Municipio activo con sus siglas de folio. */
export async function municipioActivo(id: number) {
  return consultarUna<{
    id: number;
    nombre: string;
    siglas_folio: string | null;
    regional_id: number;
  }>(
    'SELECT id, nombre, siglas_folio, regional_id FROM municipios WHERE id = $1 AND activo',
    [id]
  );
}

/**
 * Conceptos de apoyo activos entre los ids pedidos.
 *
 * `proyecto_id` (migracion 026) viaja junto con la clave y el nombre del
 * proyecto dueño para que el alta pueda armar un mensaje de rechazo que diga
 * a que proyecto pertenece de verdad el concepto. Va en NULL en los conceptos
 * sin proyecto definido, que no tienen ninguna restriccion.
 */
export async function tiposApoyoActivos(ids: number[]) {
  if (ids.length === 0) return [];
  return consultar<{
    id: number;
    nombre: string;
    unidad_medida: string | null;
    proyecto_id: number | null;
    proyecto_clave: string | null;
    proyecto_nombre: string | null;
  }>(
    `SELECT t.id, t.nombre, t.unidad_medida, t.proyecto_id,
            p.clave  AS proyecto_clave,
            p.nombre AS proyecto_nombre
       FROM tipos_apoyo t
       LEFT JOIN proyectos p ON p.id = t.proyecto_id
      WHERE t.id = ANY($1::bigint[]) AND t.activo`,
    [ids]
  );
}

/**
 * Conceptos que YA tienen una solicitud registrada con esta misma CURP.
 *
 * Regla de negocio (incidente real de ventanilla: se estuvo a punto de
 * duplicar una solicitud): la misma CURP no puede repetir el MISMO concepto
 * (`tipo_apoyo_id`), sin importar el estado de la solicitud previa —pendiente,
 * dictaminada positivo o dictaminada negativo cuentan igual—. La misma CURP
 * con OTRO concepto si es legitima y no aparece aqui. Es el mismo criterio con
 * el que Depuracion distingue `curp_mismo_concepto` de `curp_concepto_distinto`.
 *
 * `curp` debe llegar ya normalizada (trim + MAYUSCULAS); la comparacion en SQL
 * vuelve a aplicar `upper(btrim(...))` sobre la columna porque los datos
 * migrados no garantizan ese formato.
 *
 * Se devuelve la solicitud MAS ANTIGUA por concepto: es la que ventanilla debe
 * buscar en papel para saber que ya se capturo.
 */
/**
 * `tiposApoyoIds` vacio = sin filtro, devuelve TODOS los conceptos que esa
 * CURP ya tiene solicitados (aviso temprano, en cuanto la CURP se completa,
 * antes de que se elija ningun concepto en la tabla). Con la lista puesta,
 * filtra solo a esos ids (uso: cruzar contra las filas ya elegidas).
 */
export async function conceptosDuplicadosPorCurp(curp: string, tiposApoyoIds: number[] = []) {
  if (!curp) return [];
  const filtroConcepto = tiposApoyoIds.length > 0 ? 'AND sc.tipo_apoyo_id = ANY($2::bigint[])' : '';
  return consultar<{
    tipo_apoyo_id: string;
    tipo_apoyo: string | null;
    solicitud_id: string;
    folio: string;
    recibida_en: string;
  }>(
    `SELECT DISTINCT ON (sc.tipo_apoyo_id)
            sc.tipo_apoyo_id, ta.nombre AS tipo_apoyo,
            s.id AS solicitud_id, s.folio, s.recibida_en
       FROM solicitud_conceptos sc
       JOIN solicitudes s ON s.id = sc.solicitud_id
       LEFT JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
      WHERE upper(btrim(coalesce(s.curp, ''))) = $1
        ${filtroConcepto}
      ORDER BY sc.tipo_apoyo_id, s.recibida_en, s.id`,
    filtroConcepto ? [curp, tiposApoyoIds] : [curp]
  );
}

/** Listado paginado con el aislamiento por alcance aplicado en SQL (E43). */
export async function listarSolicitudes(params: {
  alcance: AlcanceResuelto;
  regional_id: number | null;
  q: string | null;
  componente_id: number | null;
  municipio_id: number | null;
  ventanilla_id: number | null;
  desde: string | null;
  hasta: string | null;
  page: number;
  page_size: number;
}) {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  const alcance = condicionAlcanceSql(params.alcance, i, params.regional_id);
  condiciones.push(alcance.sql);
  valores.push(...alcance.valores);
  i += alcance.valores.length;

  if (params.q) {
    condiciones.push(
      `(s.folio ILIKE $${i} OR s.nombre_solicitante ILIKE $${i} OR coalesce(s.curp,'') ILIKE $${i})`
    );
    valores.push(`%${params.q}%`);
    i++;
  }
  if (params.componente_id) {
    condiciones.push(`s.componente_id = $${i}`);
    valores.push(params.componente_id);
    i++;
  }
  if (params.municipio_id) {
    condiciones.push(`s.ubi_municipio_id = $${i}`);
    valores.push(params.municipio_id);
    i++;
  }
  if (params.ventanilla_id) {
    condiciones.push(`s.ventanilla_id = $${i}`);
    valores.push(params.ventanilla_id);
    i++;
  }
  if (params.desde) {
    condiciones.push(`s.recibida_en >= $${i}::timestamptz`);
    valores.push(params.desde);
    i++;
  }
  if (params.hasta) {
    condiciones.push(`s.recibida_en <= $${i}::timestamptz`);
    valores.push(params.hasta);
    i++;
  }

  const donde = condiciones.join(' AND ');

  const total = await consultarUna<{ n: string }>(
    `SELECT count(*)::text AS n FROM solicitudes s WHERE ${donde}`,
    valores
  );

  const data = await consultar<any>(
    `SELECT s.id, s.folio, s.recibida_en, s.nombre_solicitante, s.tipo_persona,
            c.clave AS componente, p.clave AS proyecto, v.clave AS ventanilla,
            m.nombre AS municipio,
            u.nombre_completo AS capturado_por_nombre,
            (SELECT count(*) FROM solicitud_conceptos sc WHERE sc.solicitud_id = s.id)::int AS conceptos,
            coalesce((SELECT sum(sc.monto_total) FROM solicitud_conceptos sc
                       WHERE sc.solicitud_id = s.id), 0)::float8 AS monto_total,
            (SELECT count(*) FROM solicitud_documentos sd
              WHERE sd.solicitud_id = s.id AND sd.recibido)::int AS docs_recibidos,
            (SELECT count(*) FROM solicitud_documentos sd
              WHERE sd.solicitud_id = s.id)::int AS docs_total
       FROM solicitudes s
       JOIN componentes c  ON c.id = s.componente_id
       JOIN proyectos p    ON p.id = s.proyecto_id
       JOIN ventanillas v  ON v.id = s.ventanilla_id
       LEFT JOIN municipios m ON m.id = s.ubi_municipio_id
       LEFT JOIN usuarios u ON u.id = s.capturado_por
      WHERE ${donde}
      ORDER BY s.recibida_en DESC, s.id DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...valores, params.page_size, (params.page - 1) * params.page_size]
  );

  return {
    data: data.map((f) => ({
      id: Number(f.id),
      folio: f.folio,
      recibida_en: f.recibida_en,
      nombre_solicitante: f.nombre_solicitante,
      tipo_persona: f.tipo_persona,
      componente: f.componente,
      proyecto: f.proyecto,
      ventanilla: f.ventanilla,
      municipio: f.municipio,
      capturado_por_nombre: f.capturado_por_nombre,
      conceptos: f.conceptos,
      monto_total: f.monto_total,
      documentos_recibidos: `${f.docs_recibidos}/${f.docs_total}`
    })),
    total: Number(total?.n ?? 0)
  };
}

/** Cabecera de una solicitud (sin filtrar: el alcance lo revisa la ruta). */
export async function obtenerSolicitud(id: number) {
  return consultarUna<any>(
    `SELECT s.*, c.clave AS componente, c.nombre AS componente_nombre,
            p.clave AS proyecto, p.nombre AS proyecto_nombre,
            v.clave AS ventanilla, v.nombre AS ventanilla_nombre,
            pr.nombre AS programa_nombre, sp.nombre AS subprograma_nombre,
            mu.nombre AS ubi_municipio, md.nombre AS dom_municipio,
            mu.regional_id AS ubi_municipio_regional_id,
            u.usuario AS capturado_por_usuario,
            u.nombre_completo AS capturado_por_nombre,
            m.clave AS modalidad, m.nombre AS modalidad_nombre,
            dr.nombre AS regional_nombre,
            ua.usuario AS autorizada_secretario_por_usuario
       FROM solicitudes s
       JOIN componentes c ON c.id = s.componente_id
       JOIN proyectos p   ON p.id = s.proyecto_id
       JOIN ventanillas v ON v.id = s.ventanilla_id
       JOIN programas pr  ON pr.id = s.programa_id
       LEFT JOIN subprogramas sp ON sp.id = s.subprograma_id
       LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
       LEFT JOIN municipios md ON md.id = s.dom_municipio_id
       LEFT JOIN usuarios u ON u.id = s.capturado_por
       LEFT JOIN modalidades m ON m.id = s.modalidad_id
       LEFT JOIN direcciones_regionales dr ON dr.id = s.regional_id
       LEFT JOIN usuarios ua ON ua.id = s.autorizada_secretario_por
      WHERE s.id = $1`,
    [id]
  );
}

export async function conceptosDeSolicitud(solicitudId: number) {
  return consultar<any>(
    `SELECT sc.id, sc.orden, sc.tipo_apoyo_id, ta.nombre AS tipo_apoyo, sc.descripcion,
            sc.cantidad::float8 AS cantidad, sc.unidad_medida,
            sc.monto_estatal::float8 AS monto_estatal,
            sc.monto_productor::float8 AS monto_productor,
            sc.monto_total::float8 AS monto_total,
            sc.beneficiario_id
       FROM solicitud_conceptos sc
       LEFT JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
      WHERE sc.solicitud_id = $1
      ORDER BY sc.orden`,
    [solicitudId]
  );
}

export async function documentosDeSolicitud(solicitudId: number) {
  return consultar<any>(
    `SELECT id, documento_requerido_id, requisito, recibido, archivo_url, archivo_nombre,
            observaciones
       FROM solicitud_documentos
      WHERE solicitud_id = $1
      ORDER BY id`,
    [solicitudId]
  );
}

export async function beneficiariosDeSolicitud(solicitudId: number) {
  return consultar<any>(
    `SELECT b.id, b.folio, ta.nombre AS tipo_apoyo, m.nombre AS municipio
       FROM beneficiarios b
       LEFT JOIN tipos_apoyo ta ON ta.id = b.tipo_apoyo_id
       LEFT JOIN municipios m ON m.id = b.municipio_id
      WHERE b.solicitud_id = $1
      ORDER BY b.id`,
    [solicitudId]
  );
}

/** Una fila del checklist, verificando que pertenezca a la solicitud (E45/E46). */
export async function documentoDeSolicitud(solicitudId: number, docId: number) {
  return consultarUna<any>(
    `SELECT id, solicitud_id, documento_requerido_id, requisito, recibido, archivo_url,
            archivo_nombre, observaciones
       FROM solicitud_documentos
      WHERE id = $1 AND solicitud_id = $2`,
    [docId, solicitudId]
  );
}

/** Inserta un beneficiario derivado de un concepto de la solicitud (D39/D40). */
export async function insertarBeneficiarioDeSolicitud(
  cliente: PoolClient,
  datos: {
    folio: string;
    curp: string | null;
    nombre_completo: string;
    regional_id: number;
    municipio_id: number;
    colonia: string | null;
    localidad: string | null;
    domicilio: string | null;
    telefono: string | null;
    tipo_apoyo_id: number;
    cantidad_asignada: number;
    solicitud_id: number;
    datos_extra: Record<string, unknown>;
  }
): Promise<number> {
  const { rows } = await cliente.query<{ id: string }>(
    `INSERT INTO beneficiarios (
        folio, curp, nombre_completo, regional_id, municipio_id, colonia, localidad,
        domicilio, telefono, tipo_apoyo_id, cantidad_asignada, datos_extra,
        origen_import_id, solicitud_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NULL,$13)
     RETURNING id`,
    [
      datos.folio,
      datos.curp,
      datos.nombre_completo,
      datos.regional_id,
      datos.municipio_id,
      datos.colonia,
      datos.localidad,
      datos.domicilio,
      datos.telefono,
      datos.tipo_apoyo_id,
      datos.cantidad_asignada,
      JSON.stringify(datos.datos_extra),
      datos.solicitud_id
    ]
  );
  return Number(rows[0].id);
}
