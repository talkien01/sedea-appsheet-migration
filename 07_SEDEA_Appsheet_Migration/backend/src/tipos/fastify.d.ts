// Extensiones de tipos de Fastify usadas por los plugins propios.
import type { PerfilUsuario } from '@sedea/shared';

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler que exige un JWT valido y llena request.usuario. */
    autenticar: (peticion: FastifyRequest, respuesta: FastifyReply) => Promise<void>;
    /** Fabrica de preHandler que exige uno de los roles indicados. */
    requiereRol: (
      ...roles: string[]
    ) => (peticion: FastifyRequest, respuesta: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    usuario?: PerfilUsuario;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: PerfilUsuario;
    user: PerfilUsuario;
  }
}
