// Autenticacion JWT. Acepta el token en el header Authorization: Bearer <jwt>
// o en el query ?token= (necesario para <img src="/media/...">).
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { errorNoAutorizado } from './errores.js';

async function plugin(app: FastifyInstance): Promise<void> {
  await app.register(jwt, {
    secret: config.jwtSecreto,
    sign: { algorithm: 'HS256', expiresIn: config.jwtExpiracion }
  });

  app.decorate('autenticar', async function (peticion: FastifyRequest, _respuesta: FastifyReply) {
    const cabecera = peticion.headers.authorization;
    const tokenQuery = (peticion.query as Record<string, string> | undefined)?.token;

    let token: string | undefined;
    if (cabecera && cabecera.toLowerCase().startsWith('bearer ')) {
      token = cabecera.slice(7).trim();
    } else if (tokenQuery) {
      token = tokenQuery;
    }

    if (!token) {
      throw errorNoAutorizado('Falta el token de autenticacion.');
    }

    try {
      const perfil = app.jwt.verify(token) as any;
      peticion.usuario = {
        id: perfil.id,
        usuario: perfil.usuario,
        nombre_completo: perfil.nombre_completo,
        rol: perfil.rol,
        regional_id: perfil.regional_id ?? null,
        regional_nombre: perfil.regional_nombre ?? null
      };
    } catch {
      throw errorNoAutorizado('Token invalido o expirado.');
    }
  });
}

export default fp(plugin, { name: 'auth' });
