// Reinicio de datos de prueba: vaciado IRREVERSIBLE de todo lo capturado.
//
// Las tablas y la frase de confirmacion viven en @sedea/shared (fuente unica de
// verdad, compartida con scripts/reiniciar_datos_prueba.sql). Aqui solo esta la
// mecanica: contar, dejar rastro en la bitacora, vaciar.
import {
  FRASE_CONFIRMACION_REINICIO,
  TABLAS_REINICIO_DATOS_PRUEBA,
  sqlTruncateReinicio,
  type ResultadoReinicioDatos
} from '@sedea/shared';
import { pool } from '../db/pool.js';
import { ErrorApi } from '../plugins/errores.js';

/**
 * Las tablas son constantes del codigo, nunca entrada del usuario, pero se
 * valida el identificador de todos modos: si alguien agrega una entrada rara a
 * la lista compartida no se convierte en una inyeccion de SQL.
 */
const IDENTIFICADOR_VALIDO = /^[a-z_][a-z0-9_]*$/;

function tablasValidadas(): readonly string[] {
  for (const tabla of TABLAS_REINICIO_DATOS_PRUEBA) {
    if (!IDENTIFICADOR_VALIDO.test(tabla)) {
      throw new ErrorApi(
        500,
        'error_interno',
        `Nombre de tabla invalido en la lista de reinicio: ${tabla}`
      );
    }
  }
  return TABLAS_REINICIO_DATOS_PRUEBA;
}

/** 422 si la frase tecleada no coincide EXACTAMENTE con la esperada. */
export function exigirFraseConfirmacion(frase: unknown): void {
  if (typeof frase !== 'string' || frase !== FRASE_CONFIRMACION_REINICIO) {
    throw new ErrorApi(
      422,
      'confirmacion_invalida',
      `Para ejecutar esta operacion hay que escribir exactamente: ${FRASE_CONFIRMACION_REINICIO}`
    );
  }
}

/** Cuenta las filas de cada tabla ANTES de borrar, para devolver evidencia. */
async function contarFilas(
  cliente: { query: (texto: string) => Promise<{ rows: Array<{ n: string }> }> },
  tablas: readonly string[]
): Promise<Record<string, number>> {
  const conteos: Record<string, number> = {};
  for (const tabla of tablas) {
    const { rows } = await cliente.query(`SELECT count(*)::text AS n FROM ${tabla}`);
    conteos[tabla] = Number(rows[0]?.n ?? 0);
  }
  return conteos;
}

/**
 * Ejecuta el reinicio completo.
 *
 * Orden deliberado:
 *   1. Contar filas (evidencia para el admin).
 *   2. Escribir `reiniciar_datos_prueba` en auditoria_log y COMMIT del rastro
 *      ANTES de borrar nada. Si el truncate falla a medias, el rastro ya quedo.
 *   3. TRUNCATE en su propia transaccion.
 *
 * `auditoria_log` no esta en la lista de tablas a vaciar y solo referencia
 * `usuarios`, asi que el registro sobrevive al truncate.
 */
export async function reiniciarDatosPrueba(opciones: {
  usuarioId: number;
  usuarioNombre: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<ResultadoReinicioDatos> {
  const tablas = tablasValidadas();
  const conteos = await contarFilas(pool as never, tablas);
  const total = Object.values(conteos).reduce((suma, n) => suma + n, 0);
  const ejecutadoEn = new Date().toISOString();

  // Paso 2: rastro PRIMERO, en su propia transaccion ya confirmada.
  // Aqui no se usa registrarAuditoria() a proposito: esa funcion se traga los
  // errores, y para una operacion destructiva queremos que si no se puede
  // dejar rastro, NO se borre nada.
  await pool.query(
    `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip, user_agent)
     VALUES ($1, 'reiniciar_datos_prueba', 'sistema', NULL, $2::jsonb, $3::inet, $4)`,
    [
      opciones.usuarioId,
      JSON.stringify({
        ejecutado_por: opciones.usuarioNombre,
        ejecutado_en: ejecutadoEn,
        tablas: [...tablas],
        filas_previas: conteos,
        total_filas_previas: total,
        irreversible: true,
        media_sin_tocar: true
      }),
      opciones.ip,
      opciones.userAgent
    ]
  );

  // Paso 3: el vaciado. Una sola sentencia: el ciclo de FK entre
  // beneficiarios y solicitudes obliga a que vayan juntas.
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(sqlTruncateReinicio(tablas));
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }

  return {
    ok: true,
    ejecutado_en: ejecutadoEn,
    ejecutado_por: opciones.usuarioNombre,
    filas_borradas: conteos,
    total_filas_borradas: total,
    media_sin_tocar: true
  };
}
