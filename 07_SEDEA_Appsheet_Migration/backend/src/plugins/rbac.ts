// Control de acceso por rol y utilidades de aislamiento por Direccion Regional.
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PerfilUsuario } from '@sedea/shared';
import { errorNoAutorizado, errorProhibido } from './errores.js';

/** Verifica si un usuario tiene un rol dentro de su lista multi-rol (ej. "capturista+ventanilla"). */
function tieneRol(usuario: { rol: string }, rolBuscado: string): boolean {
  return usuario.rol.split('+').includes(rolBuscado);
}

/**
 * Regional a la que el backend fuerza las consultas del usuario.
 * - capturista: siempre la suya.
 * - auditor con regional asignada: la suya.
 * - auditor sin regional y admin: null (pueden ver todas y filtrar libremente).
 * Nunca depende de lo que mande el frontend.
 */
export function regionalForzada(usuario: PerfilUsuario): number | null {
  // Multi-rol: si es admin (aunque tenga otros roles), no se fuerza regional
  if (tieneRol(usuario, 'admin')) return null;
  if (usuario.regional_id === null || usuario.regional_id === undefined) return null;
  return usuario.regional_id;
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.decorate('requiereRol', function (...roles: string[]) {
    return async function (peticion: FastifyRequest, _respuesta: FastifyReply) {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();
      // Multi-rol: se permite si tiene AL MENOS uno de los roles requeridos
      const tieneAlguno = roles.some(rol => tieneRol(usuario, rol));
      if (!tieneAlguno) {
        throw errorProhibido('No tienes permiso para ver esta seccion.');
      }
    };
  });
}

export default fp(plugin, { name: 'rbac' });
