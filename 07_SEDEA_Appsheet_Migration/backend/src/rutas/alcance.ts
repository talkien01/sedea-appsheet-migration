// Alcance de municipios y componentes de un usuario de ventanilla (E47/E48).
// Solo `admin`. Estas rutas NO relajan ninguna regla de 10.7: sigue sin existir
// DELETE /api/usuarios/:id, el nombre de acceso sigue siendo inmutable y la
// tabla `usuarios` no gana columnas.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { esquemaAlcanceUsuario } from '@sedea/shared';
import { consultar, consultarUna } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import { leerAlcancePorId, reemplazarAlcance } from '../servicios/alcance.js';

const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error404 = (mensaje: string) => new ErrorApi(404, 'no_encontrado', mensaje);
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

/** El alcance solo lo administra el `admin` (12.6.8). */
async function soloAdmin(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (usuario.rol !== 'admin') {
    throw error403('rol_no_autorizado', 'No tienes permiso para ver esta sección.');
  }
}

/** Expande el alcance a objetos legibles para la UI. */
async function alcanceLegible(usuarioId: number) {
  const crudo = await leerAlcancePorId(usuarioId);
  const municipios =
    crudo.municipios === 'todos'
      ? ('todos' as const)
      : await consultar<{ id: number; nombre: string }>(
          'SELECT id, nombre FROM municipios WHERE id = ANY($1::bigint[]) ORDER BY nombre',
          [crudo.municipios]
        );
  const componentes =
    crudo.componentes === 'todos'
      ? ('todos' as const)
      : await consultar<{ id: number; clave: string; nombre: string }>(
          'SELECT id, clave, nombre FROM componentes WHERE id = ANY($1::bigint[]) ORDER BY clave',
          [crudo.componentes]
        );
  return { crudo, municipios, componentes };
}

export default async function rutasAlcance(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, soloAdmin] };

  // E47 - Lectura del alcance.
  app.get<{ Params: { id: string } }>(
    '/api/usuarios/:id/alcance',
    protegida,
    async (peticion, respuesta) => {
      const id = Number(peticion.params.id);
      const usuario = await consultarUna<{ id: number; rol: string }>(
        'SELECT id, rol FROM usuarios WHERE id = $1',
        [id]
      );
      if (!usuario) throw error404('El usuario no existe.');

      const { municipios, componentes } = await alcanceLegible(id);
      return respuesta
        .status(200)
        .send({ usuario_id: id, rol: usuario.rol, municipios, componentes });
    }
  );

  // E48 - Reemplazo completo del alcance ("todos" = cero filas).
  app.put<{ Params: { id: string } }>(
    '/api/usuarios/:id/alcance',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);

      const parseado = esquemaAlcanceUsuario.safeParse(peticion.body ?? {});
      if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');
      const datos = parseado.data;

      const usuario = await consultarUna<{ id: number; usuario: string; rol: string }>(
        'SELECT id, usuario, rol FROM usuarios WHERE id = $1',
        [id]
      );
      if (!usuario) throw error404('El usuario no existe.');
      if (usuario.rol !== 'ventanilla') {
        throw error422('rol_sin_alcance', 'El alcance solo aplica a usuarios de ventanilla.');
      }

      // Los ids enviados deben existir y estar activos.
      if (datos.municipios !== 'todos' && datos.municipios.length > 0) {
        const validos = await consultar<{ id: number }>(
          'SELECT id FROM municipios WHERE id = ANY($1::bigint[]) AND activo',
          [datos.municipios]
        );
        if (validos.length !== new Set(datos.municipios).size) {
          throw error422('payload_invalido', 'Alguno de los municipios no existe o está inactivo.');
        }
      }
      if (datos.componentes !== 'todos' && datos.componentes.length > 0) {
        const validos = await consultar<{ id: number }>(
          'SELECT id FROM componentes WHERE id = ANY($1::bigint[]) AND activo',
          [datos.componentes]
        );
        if (validos.length !== new Set(datos.componentes).size) {
          throw error422('payload_invalido', 'Alguno de los componentes no existe o está inactivo.');
        }
      }

      const anterior = await leerAlcancePorId(id);

      await enTransaccion(async (cliente) => {
        await reemplazarAlcance(cliente, id, datos.municipios, datos.componentes);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'alcance_usuario_actualizado',
          entidad: 'usuario',
          entidadId: id,
          detalle: {
            usuario: usuario.usuario,
            municipios_anterior: anterior.municipios,
            municipios_nuevo: datos.municipios,
            componentes_anterior: anterior.componentes,
            componentes_nuevo: datos.componentes
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      const { municipios, componentes } = await alcanceLegible(id);
      return respuesta.status(200).send({ ok: true, municipios, componentes });
    }
  );
}
