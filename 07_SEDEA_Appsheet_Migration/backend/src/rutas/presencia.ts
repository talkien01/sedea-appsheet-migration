// Monitor de presencia en vivo.
//
// Dos endpoints con permisos MUY distintos:
//   POST /api/presencia        -> cualquier usuario autenticado reporta LA SUYA.
//   GET  /api/admin/presencia  -> solo admin, ve la de todos.
//
// El "que hizo" historico NO vive aqui: eso ya lo cubre auditoria_log y se lee
// con GET /api/auditoria/log. Esta tabla solo responde "donde esta ahora".
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  MINUTOS_PRESENCIA_ACTIVA,
  esquemaLatidoPresencia,
  type PresenciaUsuario,
  type RespuestaPresencia
} from '@sedea/shared';
import { consultar, pool } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';

/**
 * Guarda de rol ESTRICTA: solo `admin`. Mismo criterio que el resto de
 * /api/admin: saber quien esta conectado y en que pantalla es supervision, no
 * captura ni edicion de datos, asi que `editor_datos` tampoco alcanza.
 */
async function soloAdmin(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (!usuario.rol.split('+').includes('admin')) {
    throw new ErrorApi(
      403,
      'rol_no_autorizado',
      'Solo un administrador puede ver el monitor de actividad.'
    );
  }
}

/** Traduce un fallo de Zod al formato de error del contrato (422). */
function traducirFalloZod(error: ZodError): ErrorApi {
  const primero = error.issues[0];
  if (!primero) return new ErrorApi(422, 'payload_invalido', 'Datos inválidos.');
  const campo = primero.path.join('.');
  const mensaje =
    primero.code === 'invalid_type' && primero.received === 'undefined' && campo
      ? `Falta el campo ${campo}.`
      : primero.message;
  return new ErrorApi(422, 'payload_invalido', mensaje);
}

const SELECT_PRESENCIA = `
  SELECT p.usuario_id,
         u.usuario,
         u.nombre_completo,
         u.rol,
         u.regional_id,
         r.nombre                                          AS regional,
         p.ruta,
         p.etiqueta_pantalla,
         p.ip,
         p.visto_en,
         EXTRACT(EPOCH FROM (now() - p.visto_en))::int     AS segundos_desde_visto,
         (p.visto_en > now() - ($1 || ' minutes')::interval) AS activo
    FROM presencia_usuarios p
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN direcciones_regionales r ON r.id = u.regional_id
   ORDER BY p.visto_en DESC
   LIMIT 300`;

export default async function rutasPresencia(app: FastifyInstance): Promise<void> {
  /**
   * Latido de la PWA. Lo llama TODO usuario autenticado (sin exigir rol): cada
   * quien reporta unicamente su propia presencia, porque el usuario_id sale
   * del token y nunca del body.
   *
   * Tiene que ser barato: es un solo upsert por clave primaria y responde
   * `{ok:true}` sin leer nada de vuelta.
   */
  app.post('/api/presencia', { preHandler: [app.autenticar] }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();

    let cuerpo;
    try {
      cuerpo = esquemaLatidoPresencia.parse(peticion.body ?? {});
    } catch (error) {
      if (error instanceof ZodError) throw traducirFalloZod(error);
      throw error;
    }

    const userAgent =
      (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;

    await pool.query(
      `INSERT INTO presencia_usuarios (usuario_id, ruta, etiqueta_pantalla, ip, user_agent, visto_en)
            VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (usuario_id) DO UPDATE
              SET ruta = EXCLUDED.ruta,
                  etiqueta_pantalla = EXCLUDED.etiqueta_pantalla,
                  ip = EXCLUDED.ip,
                  user_agent = EXCLUDED.user_agent,
                  visto_en = now()`,
      [
        usuario.id,
        cuerpo.ruta.slice(0, 300),
        cuerpo.etiqueta_pantalla?.slice(0, 120) ?? null,
        peticion.ip ?? null,
        userAgent
      ]
    );

    return respuesta.status(200).send({ ok: true });
  });

  /**
   * Foto completa para el monitor del admin. Separa en dos listas usando un
   * unico criterio (MINUTOS_PRESENCIA_ACTIVA, definido en @sedea/shared):
   *   activos   -> ultimo latido dentro del umbral, estan en la app ahora.
   *   inactivos -> se conectaron alguna vez pero su ultimo latido ya expiro.
   */
  app.get(
    '/api/admin/presencia',
    { preHandler: [app.autenticar, soloAdmin] },
    async (_peticion, respuesta) => {
      const filas = await consultar<PresenciaUsuario>(SELECT_PRESENCIA, [
        String(MINUTOS_PRESENCIA_ACTIVA)
      ]);

      const cuerpo: RespuestaPresencia = {
        generado_en: new Date().toISOString(),
        umbral_minutos: MINUTOS_PRESENCIA_ACTIVA,
        activos: filas.filter((f) => f.activo),
        inactivos: filas.filter((f) => !f.activo)
      };
      return respuesta.status(200).send(cuerpo);
    }
  );
}
