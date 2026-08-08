// Promocion de filas de staging a las tablas de produccion.
// Toda promocion es transaccional: escritura en produccion + cambio de estado
// de la fila de staging + bitacora ocurren juntos o no ocurren.
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { ErrorApi, errorValidacion } from '../plugins/errores.js';

/** Ejecuta una funcion dentro de una transaccion. */
export async function enTransaccion<T>(fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}

/** Error 409: la fila ya fue revisada por alguien mas. */
export function errorConflicto(mensaje = 'Esta fila ya fue revisada.'): ErrorApi {
  return new ErrorApi(409, 'estado_invalido', mensaje);
}

/**
 * Inserta o actualiza el beneficiario de produccion a partir de una fila de
 * staging. La clave de upsert es el folio (misma que el build 1); si la fila
 * no trae folio se genera uno estable a partir de su id de staging.
 *
 * lat_proyecto/lng_proyecto no son columnas de beneficiarios: viajan dentro de
 * datos_extra junto con las columnas no mapeadas del archivo (Assumption 22).
 */
export async function promoverBeneficiario(
  cliente: PoolClient,
  fila: any,
  importacionId: number | null
): Promise<number> {
  if (!fila.nombre_completo || !String(fila.nombre_completo).trim()) {
    throw errorValidacion('La fila no tiene nombre del beneficiario: no se puede promover.');
  }
  if (!fila.regional_id) {
    throw errorValidacion(
      'La Dirección Regional de la fila no está resuelta: corrígela antes de promover.'
    );
  }

  const folio =
    fila.folio && String(fila.folio).trim() !== '' ? String(fila.folio).trim() : `IMP-${fila.id}`;

  const datosExtra = {
    ...(fila.datos_extra ?? {}),
    lat_proyecto: fila.lat_proyecto ?? null,
    lng_proyecto: fila.lng_proyecto ?? null,
    staging_id: fila.id,
    archivo_origen: fila.archivo
  };

  const { rows } = await cliente.query<{ id: number }>(
    `INSERT INTO beneficiarios (
        folio, curp, nombre_completo, regional_id, municipio_id, colonia, seccion,
        localidad, domicilio, telefono, tipo_apoyo_id, cantidad_asignada,
        datos_extra, origen_import_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
     ON CONFLICT (folio) DO UPDATE SET
        curp = EXCLUDED.curp,
        nombre_completo = EXCLUDED.nombre_completo,
        regional_id = EXCLUDED.regional_id,
        municipio_id = EXCLUDED.municipio_id,
        colonia = EXCLUDED.colonia,
        seccion = EXCLUDED.seccion,
        localidad = EXCLUDED.localidad,
        domicilio = EXCLUDED.domicilio,
        telefono = EXCLUDED.telefono,
        tipo_apoyo_id = EXCLUDED.tipo_apoyo_id,
        cantidad_asignada = EXCLUDED.cantidad_asignada,
        datos_extra = beneficiarios.datos_extra || EXCLUDED.datos_extra,
        actualizado_en = now()
     RETURNING id`,
    [
      folio,
      fila.curp || null,
      String(fila.nombre_completo).trim(),
      fila.regional_id,
      fila.municipio_id,
      fila.colonia || null,
      fila.seccion || null,
      fila.localidad || null,
      fila.domicilio || null,
      fila.telefono || null,
      fila.tipo_apoyo_id,
      fila.cantidad_asignada,
      JSON.stringify(datosExtra),
      importacionId
    ]
  );

  return rows[0].id;
}

/** Inserta o actualiza la entrada de catalogo correspondiente a una fila de staging. */
export async function promoverCatalogo(cliente: PoolClient, fila: any): Promise<number> {
  if (!fila.grupo || !fila.clave || !fila.valor) {
    throw errorValidacion('La fila de catálogo necesita grupo, clave y valor para promoverse.');
  }
  const { rows } = await cliente.query<{ id: number }>(
    `INSERT INTO catalogos (grupo, clave, valor, padre_grupo, padre_clave, orden)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (grupo, clave, COALESCE(padre_clave, '')) DO UPDATE SET
       valor = EXCLUDED.valor,
       padre_grupo = EXCLUDED.padre_grupo,
       orden = EXCLUDED.orden,
       activo = TRUE
     RETURNING id`,
    [fila.grupo, fila.clave, fila.valor, fila.padre_grupo || null, fila.padre_clave || null, fila.orden ?? 0]
  );
  return rows[0].id;
}

/** Escribe una entrada de bitacora dentro de la misma transaccion. */
export async function bitacoraEnTransaccion(
  cliente: PoolClient,
  datos: {
    usuarioId: number | null;
    accion: string;
    entidad: string;
    entidadId: number | string;
    detalle: Record<string, unknown>;
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await cliente.query(
    `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::inet,$7)`,
    [
      datos.usuarioId,
      datos.accion,
      datos.entidad,
      String(datos.entidadId),
      JSON.stringify(datos.detalle),
      datos.ip ?? null,
      datos.userAgent ?? null
    ]
  );
}

/**
 * Recalcula los 6 flags de diagnostico de una fila de staging comparandola
 * contra el resto del staging pendiente y contra produccion. Se usa tras una
 * fusion, cuando los datos de la fila principal pueden haber cambiado.
 */
export async function recalcularFlags(cliente: PoolClient, id: number): Promise<void> {
  await cliente.query(
    `WITH fila AS (SELECT * FROM staging_beneficiarios WHERE id = $1),
     calc AS (
       SELECT
         (SELECT coalesce(bool_or(TRUE), FALSE) FROM staging_beneficiarios o, fila f
            WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
              AND nullif(btrim(f.folio), '') IS NOT NULL
              AND upper(unaccent(btrim(o.folio))) = upper(unaccent(btrim(f.folio))))
         OR (SELECT coalesce(bool_or(TRUE), FALSE) FROM beneficiarios b, fila f
            WHERE nullif(btrim(f.folio), '') IS NOT NULL
              AND upper(unaccent(btrim(b.folio))) = upper(unaccent(btrim(f.folio)))) AS folio_dup,

         (SELECT coalesce(bool_or(TRUE), FALSE) FROM staging_beneficiarios o, fila f
            WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
              AND nullif(btrim(f.curp), '') IS NOT NULL
              AND upper(btrim(o.curp)) = upper(btrim(f.curp))
              AND coalesce(o.tipo_apoyo_id::text, upper(unaccent(coalesce(o.tipo_apoyo_texto, ''))))
                = coalesce(f.tipo_apoyo_id::text, upper(unaccent(coalesce(f.tipo_apoyo_texto, ''))))) AS curp_mismo,

         (SELECT coalesce(bool_or(TRUE), FALSE) FROM staging_beneficiarios o, fila f
            WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
              AND nullif(btrim(f.curp), '') IS NOT NULL
              AND upper(btrim(o.curp)) = upper(btrim(f.curp))
              AND coalesce(o.tipo_apoyo_id::text, upper(unaccent(coalesce(o.tipo_apoyo_texto, ''))))
               <> coalesce(f.tipo_apoyo_id::text, upper(unaccent(coalesce(f.tipo_apoyo_texto, ''))))) AS curp_distinto,

         (SELECT f.lat_proyecto IS NULL OR f.lng_proyecto IS NULL
                 OR f.lat_proyecto NOT BETWEEN -90 AND 90
                 OR f.lng_proyecto NOT BETWEEN -180 AND 180
                 OR (f.lat_proyecto = 0 AND f.lng_proyecto = 0) FROM fila f) AS sin_coord,
         (SELECT nullif(btrim(coalesce(f.colonia, '')), '') IS NULL FROM fila f) AS sin_col,
         (SELECT f.tipo_apoyo_id IS NULL FROM fila f) AS sin_concepto
     )
     UPDATE staging_beneficiarios s
        SET folio_duplicado = c.folio_dup,
            curp_duplicada_mismo_concepto = c.curp_mismo,
            curp_duplicada_concepto_distinto = c.curp_distinto,
            sin_coordenadas = c.sin_coord,
            sin_colonia = c.sin_col,
            concepto_no_reconocido = c.sin_concepto,
            nivel_alerta = CASE
              WHEN c.folio_dup OR c.curp_mismo THEN 'alta'
              WHEN c.curp_distinto OR c.sin_coord OR c.sin_col OR c.sin_concepto THEN 'media'
              ELSE 'ninguna' END,
            actualizado_en = now()
       FROM calc c
      WHERE s.id = $1`,
    [id]
  );
}
