// Control de acceso por rol y utilidades de aislamiento por Direccion Regional.
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PerfilUsuario } from '@sedea/shared';
import { errorNoAutorizado, errorProhibido } from './errores.js';

/**
 * Regional a la que el backend fuerza las consultas del usuario.
 * - capturista: siempre la suya.
 * - auditor con regional asignada: la suya.
 * - auditor sin regional y admin: null (pueden ver todas y filtrar libremente).
 * Nunca depende de lo que mande el frontend.
 */
export function regionalForzada(usuario: PerfilUsuario): number | null {
  if (usuario.rol === 'admin') return null;
  if (usuario.regional_id === null || usuario.regional_id === undefined) return null;
  return usuario.regional_id;
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.decorate('requiereRol', function (...roles: string[]) {
    return async function (peticion: FastifyRequest, _respuesta: FastifyReply) {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();
      if (!roles.includes(usuario.rol)) {
        throw errorProhibido('No tienes permiso para ver esta seccion.');
      }
    };
  });
}

export default fp(plugin, { name: 'rbac' });
