// Consultas SQL del subsistema de staging. Toda la logica de filtrado,
// paginacion y aislamiento por Regional vive aqui para que las rutas queden
// delgadas y el SQL sea auditable en un solo lugar.
import { consultar, consultarUna } from '../pool.js';
import {
  FLAGS_BENEFICIARIO,
  FLAGS_CATALOGO,
  type EstadoRevision,
  type NivelAlerta,
  type ResumenStagingTabla
} from '@sedea/shared';

const ESTADOS: EstadoRevision[] = ['pendiente', 'aprobado', 'descartado', 'fusionado'];
const NIVELES: NivelAlerta[] = ['alta', 'media', 'ninguna'];

export const SELECT_STAGING_BENEFICIARIO = `
  SELECT s.*, r.nombre AS regional_nombre, m.nombre AS municipio_nombre,
         t.nombre AS tipo_apoyo_nombre
    FROM staging_beneficiarios s
    LEFT JOIN direcciones_regionales r ON r.id = s.regional_id
    LEFT JOIN municipios m ON m.id = s.municipio_id
    LEFT JOIN tipos_apoyo t ON t.id = s.tipo_apoyo_id
`;

/**
 * Condicion de aislamiento por Direccion Regional.
 * Un editor con Regional asignada ve solo su Regional; las filas sin Regional
 * resuelta (regional_id NULL) las puede revisar cualquiera, porque justamente
 * necesitan intervencion humana para asignarles una.
 */
export function condicionRegional(
  regional: number | null,
  parametros: unknown[],
  alias = 's'
): string | null {
  if (regional === null) return null;
  parametros.push(regional);
  return `(${alias}.regional_id = $${parametros.length} OR ${alias}.regional_id IS NULL)`;
}

interface FiltrosBeneficiarios {
  estado: EstadoRevision | 'todos';
  alerta?: string;
  nivel?: string;
  q?: string;
  importacion_id?: number;
  page: number;
  page_size: number;
}

/** Construye el WHERE de la lista de staging de padron. */
function whereBeneficiarios(
  filtros: FiltrosBeneficiarios,
  regional: number | null
): { where: string; parametros: unknown[] } {
  const condiciones: string[] = [];
  const parametros: unknown[] = [];

  const aislamiento = condicionRegional(regional, parametros);
  if (aislamiento) condiciones.push(aislamiento);

  if (filtros.estado !== 'todos') {
    parametros.push(filtros.estado);
    condiciones.push(`s.estado_revision = $${parametros.length}`);
  }
  if (filtros.alerta) {
    if (filtros.alerta === 'ninguna') {
      condiciones.push(`NOT (${FLAGS_BENEFICIARIO.map((f) => `s.${f}`).join(' OR ')})`);
    } else if ((FLAGS_BENEFICIARIO as readonly string[]).includes(filtros.alerta)) {
      condiciones.push(`s.${filtros.alerta}`);
    }
  }
  if (filtros.nivel) {
    parametros.push(filtros.nivel);
    condiciones.push(`s.nivel_alerta = $${parametros.length}`);
  }
  if (filtros.importacion_id) {
    parametros.push(filtros.importacion_id);
    condiciones.push(`s.importacion_id = $${parametros.length}`);
  }
  if (filtros.q && filtros.q.trim()) {
    parametros.push(`%${filtros.q.trim()}%`);
    const i = parametros.length;
    condiciones.push(
      `(unaccent(lower(coalesce(s.nombre_completo, ''))) LIKE unaccent(lower($${i}))
        OR unaccent(lower(coalesce(s.curp, ''))) LIKE unaccent(lower($${i}))
        OR unaccent(lower(coalesce(s.folio, ''))) LIKE unaccent(lower($${i})))`
    );
  }

  return {
    where: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
    parametros
  };
}

export async function listarStagingBeneficiarios(
  filtros: FiltrosBeneficiarios,
  regional: number | null
) {
  const { where, parametros } = whereBeneficiarios(filtros, regional);
  const totalFila = await consultarUna<{ total: number }>(
    `SELECT count(*)::int AS total FROM staging_beneficiarios s ${where}`,
    parametros
  );
  const total = totalFila?.total ?? 0;
  const desplazamiento = (filtros.page - 1) * filtros.page_size;
  const data = await consultar(
    `${SELECT_STAGING_BENEFICIARIO} ${where}
      ORDER BY s.nivel_alerta = 'ninguna', s.id
      LIMIT ${filtros.page_size} OFFSET ${desplazamiento}`,
    parametros
  );
  return {
    data,
    page: filtros.page,
    page_size: filtros.page_size,
    total,
    has_more: desplazamiento + data.length < total
  };
}

export async function obtenerStagingBeneficiario(id: number) {
  return consultarUna<any>(`${SELECT_STAGING_BENEFICIARIO} WHERE s.id = $1`, [id]);
}

/**
 * Candidatos relacionados con una fila: mismo folio o misma CURP, tanto en el
 * propio staging como en produccion. El motivo distingue si el concepto de
 * apoyo coincide, porque un beneficiario puede recibir apoyos distintos (D2).
 */
export async function relacionadasDeBeneficiario(fila: any) {
  const staging = await consultar(
    `${SELECT_STAGING_BENEFICIARIO}
      WHERE s.id <> $1
        AND (
          (coalesce(nullif(btrim(s.folio), ''), '#') = coalesce(nullif(btrim($2), ''), '##'))
          OR (upper(coalesce(nullif(btrim(s.curp), ''), '#')) = upper(coalesce(nullif(btrim($3), ''), '##')))
        )
      ORDER BY s.id`,
    [fila.id, fila.folio ?? '', fila.curp ?? '']
  );

  const conMotivo = staging.map((otra: any) => ({
    ...otra,
    motivo_relacion: motivoRelacion(fila, otra),
    origen: 'staging'
  }));

  const produccion = await consultar(
    `SELECT b.id, b.folio, b.curp, b.nombre_completo, b.regional_id, r.nombre AS regional_nombre,
            b.municipio_id, m.nombre AS municipio_nombre, b.colonia, b.seccion, b.localidad,
            b.domicilio, b.telefono, b.tipo_apoyo_id, t.nombre AS tipo_apoyo_nombre,
            b.cantidad_asignada, b.actualizado_en
       FROM beneficiarios b
       LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
       LEFT JOIN municipios m ON m.id = b.municipio_id
       LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
      WHERE (coalesce(nullif(btrim(b.folio), ''), '#') = coalesce(nullif(btrim($1), ''), '##'))
         OR (upper(coalesce(nullif(btrim(b.curp), ''), '#')) = upper(coalesce(nullif(btrim($2), ''), '##')))
      ORDER BY b.id`,
    [fila.folio ?? '', fila.curp ?? '']
  );

  const produccionConMotivo = produccion.map((otra: any) => ({
    ...otra,
    motivo_relacion: motivoRelacion(fila, otra),
    origen: 'produccion'
  }));

  return { staging: conMotivo, produccion: produccionConMotivo };
}

function norm(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Determina por que dos filas se consideran relacionadas. */
function motivoRelacion(fila: any, otra: any): string {
  if (norm(fila.folio) && norm(fila.folio) === norm(otra.folio)) return 'folio';
  const conceptoA = fila.tipo_apoyo_id ?? norm(fila.tipo_apoyo_texto ?? fila.tipo_apoyo_nombre);
  const conceptoB = otra.tipo_apoyo_id ?? norm(otra.tipo_apoyo_texto ?? otra.tipo_apoyo_nombre);
  return conceptoA && conceptoB && String(conceptoA) === String(conceptoB)
    ? 'curp_mismo_concepto'
    : 'curp_concepto_distinto';
}

// ---------------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------------

interface FiltrosCatalogos {
  estado: EstadoRevision | 'todos';
  alerta?: string;
  nivel?: string;
  grupo?: string;
  q?: string;
  importacion_id?: number;
  page: number;
  page_size: number;
}

export async function listarStagingCatalogos(filtros: FiltrosCatalogos) {
  const condiciones: string[] = [];
  const parametros: unknown[] = [];

  if (filtros.estado !== 'todos') {
    parametros.push(filtros.estado);
    condiciones.push(`c.estado_revision = $${parametros.length}`);
  }
  if (filtros.alerta) {
    if (filtros.alerta === 'ninguna') {
      condiciones.push(`NOT (${FLAGS_CATALOGO.map((f) => `c.${f}`).join(' OR ')})`);
    } else if ((FLAGS_CATALOGO as readonly string[]).includes(filtros.alerta)) {
      condiciones.push(`c.${filtros.alerta}`);
    }
  }
  if (filtros.nivel) {
    parametros.push(filtros.nivel);
    condiciones.push(`c.nivel_alerta = $${parametros.length}`);
  }
  if (filtros.grupo) {
    parametros.push(filtros.grupo);
    condiciones.push(`c.grupo = $${parametros.length}`);
  }
  if (filtros.importacion_id) {
    parametros.push(filtros.importacion_id);
    condiciones.push(`c.importacion_id = $${parametros.length}`);
  }
  if (filtros.q && filtros.q.trim()) {
    parametros.push(`%${filtros.q.trim()}%`);
    const i = parametros.length;
    condiciones.push(
      `(unaccent(lower(coalesce(c.clave, ''))) LIKE unaccent(lower($${i}))
        OR unaccent(lower(coalesce(c.valor, ''))) LIKE unaccent(lower($${i})))`
    );
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const totalFila = await consultarUna<{ total: number }>(
    `SELECT count(*)::int AS total FROM staging_catalogos c ${where}`,
    parametros
  );
  const total = totalFila?.total ?? 0;
  const desplazamiento = (filtros.page - 1) * filtros.page_size;
  const data = await consultar(
    `SELECT c.* FROM staging_catalogos c ${where}
      ORDER BY c.id LIMIT ${filtros.page_size} OFFSET ${desplazamiento}`,
    parametros
  );
  return {
    data,
    page: filtros.page,
    page_size: filtros.page_size,
    total,
    has_more: desplazamiento + data.length < total
  };
}

export async function obtenerStagingCatalogo(id: number) {
  return consultarUna<any>('SELECT c.* FROM staging_catalogos c WHERE c.id = $1', [id]);
}

export async function relacionadasDeCatalogo(fila: any) {
  const staging = await consultar(
    `SELECT c.* FROM staging_catalogos c
      WHERE c.id <> $1 AND c.grupo IS NOT DISTINCT FROM $2 AND c.clave IS NOT DISTINCT FROM $3
      ORDER BY c.id`,
    [fila.id, fila.grupo, fila.clave]
  );
  const produccion = await consultar(
    `SELECT id, grupo, clave, valor, padre_grupo, padre_clave, orden, activo
       FROM catalogos WHERE grupo = $1 AND clave = $2 ORDER BY id`,
    [fila.grupo, fila.clave]
  );
  return { staging, produccion };
}

// ---------------------------------------------------------------------------
// Resumen (E16) - reutilizado tambien por /api/estadisticas/staging (E33)
// ---------------------------------------------------------------------------

/** Cuenta filas por estado, por flag y por nivel de alerta de una tabla de staging. */
export async function resumenTabla(
  tabla: 'staging_beneficiarios' | 'staging_catalogos',
  regional: number | null
): Promise<ResumenStagingTabla> {
  const flags =
    tabla === 'staging_beneficiarios' ? [...FLAGS_BENEFICIARIO] : [...FLAGS_CATALOGO];
  const parametros: unknown[] = [];
  // El aislamiento por Regional solo aplica al staging de padron.
  const aislamiento =
    tabla === 'staging_beneficiarios' ? condicionRegional(regional, parametros) : null;
  const where = aislamiento ? `WHERE ${aislamiento}` : '';

  const fila = await consultarUna<any>(
    `SELECT count(*)::int AS total,
            ${ESTADOS.map(
              (e) => `count(*) FILTER (WHERE s.estado_revision = '${e}')::int AS estado_${e}`
            ).join(',\n            ')},
            ${NIVELES.map(
              (n) => `count(*) FILTER (WHERE s.nivel_alerta = '${n}')::int AS nivel_${n}`
            ).join(',\n            ')},
            ${flags.map((f) => `count(*) FILTER (WHERE s.${f})::int AS flag_${f}`).join(',\n            ')}
       FROM ${tabla} s ${where}`,
    parametros
  );

  const por_estado = Object.fromEntries(
    ESTADOS.map((e) => [e, Number(fila?.[`estado_${e}`] ?? 0)])
  ) as ResumenStagingTabla['por_estado'];
  const por_nivel = Object.fromEntries(
    NIVELES.map((n) => [n, Number(fila?.[`nivel_${n}`] ?? 0)])
  ) as ResumenStagingTabla['por_nivel'];
  const por_alerta = Object.fromEntries(
    flags.map((f) => [f, Number(fila?.[`flag_${f}`] ?? 0)])
  );

  return { total: Number(fila?.total ?? 0), por_estado, por_alerta, por_nivel };
}
