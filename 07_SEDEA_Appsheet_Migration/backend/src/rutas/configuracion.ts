// Configuración de plazos para ingreso de solicitudes (Build 12).
// Endpoint público de lectura del plazo vigente + administración del plazo
// (alta e historial), solo para rol `admin` estricto.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { esquemaPlazoAlta, esquemaPlazoEstado } from '@sedea/shared';
import { pool } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';

/**
 * Guarda de rol ESTRICTA: solo `admin`. Mismo criterio que /api/admin: abrir o
 * cerrar la ventanilla de captura para todo el estado no es tarea de captura
 * ni de edición de datos. Se usa `split('+')` porque los usuarios multi-rol
 * guardan el rol como `ventanilla+dictaminador`.
 */
async function soloAdmin(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (!usuario.rol.split('+').includes('admin')) {
    throw new ErrorApi(
      403,
      'rol_no_autorizado',
      'Solo un administrador puede configurar el plazo de solicitudes.'
    );
  }
}

/** Traduce un fallo de Zod al formato de error del contrato (422). */
function traducirFalloZod(error: ZodError): ErrorApi {
  const primero = error.issues[0];
  return new ErrorApi(422, 'payload_invalido', primero?.message ?? 'Datos inválidos.');
}

/**
 * Las fechas se leen como texto `YYYY-MM-DD` con to_char: la columna es `date`
 * y dejar que el driver la convierta a Date arrastra el desfase de zona horaria
 * hasta el navegador.
 */
const SELECT_PLAZO = `
  SELECT id,
         to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
         to_char(fecha_fin, 'YYYY-MM-DD')    AS fecha_fin,
         activo,
         creado_en,
         actualizado_en
    FROM configuracion_plazos`;

export default async function rutasConfiguracion(app: FastifyInstance): Promise<void> {
  const soloAdministrador = { preHandler: [app.autenticar, soloAdmin] };

  // ---------------------------------------------------------------------------
  // Lectura pública del plazo vigente. La consume TimerPlazo.tsx en el paso 1 de
  // Nueva Solicitud. NO se toca: su contrato se mantiene tal cual.
  // ---------------------------------------------------------------------------
  app.get('/api/configuracion/plazo-solicitudes', async (_peticion, respuesta) => {
    const { rows } = await pool.query<{
      fecha_inicio: string;
      fecha_fin: string;
      activo: boolean;
    }>(
      `SELECT fecha_inicio, fecha_fin, activo
       FROM configuracion_plazos
       WHERE activo = true
       ORDER BY id DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      return respuesta.send({ activo: false });
    }

    const plazo = rows[0];
    const hoy = new Date();
    const fin = new Date(plazo.fecha_fin);
    const diasRestantes = Math.max(0, Math.ceil((fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)));

    respuesta.send({
      activo: true,
      fecha_inicio: plazo.fecha_inicio,
      fecha_fin: plazo.fecha_fin,
      dias_restantes: diasRestantes,
      vencido: diasRestantes === 0
    });
  });

  // ---------------------------------------------------------------------------
  // Historial completo de plazos, más reciente primero.
  // ---------------------------------------------------------------------------
  app.get('/api/configuracion/plazos', soloAdministrador, async (_peticion, respuesta) => {
    const { rows } = await pool.query(`${SELECT_PLAZO} ORDER BY id DESC`);
    return respuesta.status(200).send({ datos: rows });
  });

  // ---------------------------------------------------------------------------
  // Alta de un plazo NUEVO. Queda activo y desactiva al anterior en la MISMA
  // transacción: solo puede haber un plazo activo a la vez, que es justo lo que
  // asume la consulta de /plazo-solicitudes.
  // ---------------------------------------------------------------------------
  app.post('/api/configuracion/plazos', soloAdministrador, async (peticion, respuesta) => {
    const parseado = esquemaPlazoAlta.safeParse(peticion.body ?? {});
    if (!parseado.success) throw traducirFalloZod(parseado.error);
    const { fecha_inicio, fecha_fin } = parseado.data;

    const cliente = await pool.connect();
    let creado;
    try {
      await cliente.query('BEGIN');
      await cliente.query('UPDATE configuracion_plazos SET activo = false WHERE activo = true');
      const { rows } = await cliente.query(
        `INSERT INTO configuracion_plazos (fecha_inicio, fecha_fin, activo)
         VALUES ($1::date, $2::date, true)
         RETURNING id,
                   to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
                   to_char(fecha_fin, 'YYYY-MM-DD')    AS fecha_fin,
                   activo, creado_en, actualizado_en`,
        [fecha_inicio, fecha_fin]
      );
      await cliente.query('COMMIT');
      creado = rows[0];
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }

    await registrarAuditoria(peticion, {
      usuarioId: peticion.usuario?.id ?? null,
      accion: 'plazo_solicitudes_creado',
      entidad: 'configuracion_plazos',
      entidadId: creado.id,
      detalle: { fecha_inicio, fecha_fin }
    });

    return respuesta.status(201).send({ ok: true, plazo: creado });
  });

  // ---------------------------------------------------------------------------
  // Cambio de estado de un plazo existente. Resuelve el caso "cerrar la captura
  // ya, sin definir todavía la siguiente ventana" ({activo:false}) y el de
  // reabrir una ventana anterior ({activo:true}), que desactiva a la que
  // estuviera activa para conservar la invariante de un solo plazo activo.
  // ---------------------------------------------------------------------------
  app.patch('/api/configuracion/plazos/:id', soloAdministrador, async (peticion, respuesta) => {
    const id = Number((peticion.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(422, 'payload_invalido', 'El id del plazo no es válido.');
    }

    const parseado = esquemaPlazoEstado.safeParse(peticion.body ?? {});
    if (!parseado.success) throw traducirFalloZod(parseado.error);
    const { activo } = parseado.data;

    const cliente = await pool.connect();
    let actualizado;
    try {
      await cliente.query('BEGIN');
      if (activo) {
        await cliente.query(
          'UPDATE configuracion_plazos SET activo = false WHERE activo = true AND id <> $1',
          [id]
        );
      }
      const { rows } = await cliente.query(
        `UPDATE configuracion_plazos SET activo = $2 WHERE id = $1
         RETURNING id,
                   to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
                   to_char(fecha_fin, 'YYYY-MM-DD')    AS fecha_fin,
                   activo, creado_en, actualizado_en`,
        [id, activo]
      );
      await cliente.query('COMMIT');
      actualizado = rows[0];
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }

    if (!actualizado) {
      throw new ErrorApi(404, 'plazo_no_encontrado', 'No existe el plazo solicitado.');
    }

    await registrarAuditoria(peticion, {
      usuarioId: peticion.usuario?.id ?? null,
      accion: activo ? 'plazo_solicitudes_activado' : 'plazo_solicitudes_desactivado',
      entidad: 'configuracion_plazos',
      entidadId: id,
      detalle: {
        fecha_inicio: actualizado.fecha_inicio,
        fecha_fin: actualizado.fecha_fin
      }
    });

    return respuesta.status(200).send({ ok: true, plazo: actualizado });
  });
}
