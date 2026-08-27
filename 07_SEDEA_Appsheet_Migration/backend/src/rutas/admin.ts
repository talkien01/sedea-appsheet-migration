// Operaciones de administracion del sistema. Solo rol `admin` ESTRICTO.
//
// Contiene la unica operacion destructiva de la API: el reinicio de datos de
// prueba. No se expone a `editor_datos` ni a ningun otro rol.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorNoAutorizado } from '../plugins/errores.js';
import { ErrorApi } from '../plugins/errores.js';
import { exigirFraseConfirmacion, reiniciarDatosPrueba } from '../servicios/reinicioDatos.js';
import { consultar } from '../db/pool.js';

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

  /**
   * Solicitudes YA CAPTURADAS que violan la regla de la migracion 026: llevan
   * adentro al menos un concepto cuyo `proyecto_id` no coincide con el
   * `proyecto_id` de la solicitud.
   *
   * Existen porque hasta la 026 `tipos_apoyo` no tenia relacion con
   * `proyectos` y nada impedia mezclarlos. Hacia adelante ya no puede volver a
   * pasar (el alta las rechaza con 422), pero lo ya capturado NO se corrige
   * solo: se lista aqui para revision manual, que es lo que pidio el area.
   *
   * SOLO LECTURA: no corrige, no borra, no marca nada. Es un reporte.
   *
   * Nota de alcance: como hoy unicamente CFA-AVENA y CFG-GARBANZO tienen
   * `proyecto_id` poblado, solo pueden aparecer inconsistencias que involucren
   * a esos dos conceptos. Al poblar la relacion de mas conceptos, este mismo
   * reporte empieza a cubrirlos sin tocar codigo.
   */
  app.get('/api/admin/solicitudes-proyecto-inconsistente', soloAdministrador, async () => {
    const filas = await consultar<{
      solicitud_id: number;
      folio: string | null;
      curp: string | null;
      nombre_solicitante: string | null;
      proyecto_solicitud: string | null;
      concepto: string | null;
      proyecto_del_concepto: string | null;
    }>(
      `SELECT s.id                      AS solicitud_id,
              s.folio,
              s.curp,
              s.nombre_solicitante,
              ps.clave                  AS proyecto_solicitud,
              ta.nombre                 AS concepto,
              pc.clave                  AS proyecto_del_concepto
         FROM solicitud_conceptos sc
         JOIN solicitudes s  ON s.id  = sc.solicitud_id
         JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
         JOIN proyectos pc   ON pc.id = ta.proyecto_id
         LEFT JOIN proyectos ps ON ps.id = s.proyecto_id
        WHERE ta.proyecto_id IS NOT NULL
          AND ta.proyecto_id IS DISTINCT FROM s.proyecto_id
        ORDER BY s.id, sc.orden`
    );
    return { total: filas.length, filas };
  });
}
