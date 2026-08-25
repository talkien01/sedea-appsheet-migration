// Operaciones de administracion del sistema. Solo rol `admin` ESTRICTO.
//
// Contiene la unica operacion destructiva de la API: el reinicio de datos de
// prueba. No se expone a `editor_datos` ni a ningun otro rol.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorNoAutorizado } from '../plugins/errores.js';
import { ErrorApi } from '../plugins/errores.js';
import { exigirFraseConfirmacion, reiniciarDatosPrueba } from '../servicios/reinicioDatos.js';

/**
 * Guarda de rol ESTRICTA: solo `admin`. A diferencia de la de /api/usuarios,
 * aqui `editor_datos` NO alcanza: borrar el padron completo no es una tarea de
 * captura de datos.
 */
async function soloAdmin(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (!usuario.rol.split('+').includes('admin')) {
    throw new ErrorApi(
      403,
      'rol_no_autorizado',
      'Solo un administrador puede ejecutar esta operacion.'
    );
  }
}

export default async function rutasAdmin(app: FastifyInstance): Promise<void> {
  const soloAdministrador = { preHandler: [app.autenticar, soloAdmin] };

  /**
   * Vacia TODO lo capturado (padron, capturas, solicitudes, dictamen, folios).
   * IRREVERSIBLE. Exige repetir la frase de confirmacion en el body: el
   * frontend ya la pide, pero un POST directo con curl tambien tiene que
   * pasar por el mismo candado (defensa en profundidad).
   *
   * NO borra archivos de /media: esa limpieza es manual y esta documentada en
   * el README.
   */
  app.post('/api/admin/reiniciar-datos-prueba', soloAdministrador, async (peticion, respuesta) => {
    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    exigirFraseConfirmacion(cuerpo.confirmacion);

    const usuario = peticion.usuario!;
    const resultado = await reiniciarDatosPrueba({
      usuarioId: usuario.id,
      usuarioNombre: usuario.usuario,
      ip: peticion.ip ?? null,
      userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
    });

    peticion.log.warn(
      { usuario: usuario.usuario, filas: resultado.total_filas_borradas },
      'REINICIO DE DATOS DE PRUEBA ejecutado'
    );

    return respuesta.status(200).send(resultado);
  });
}
