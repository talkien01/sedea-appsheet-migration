// Autenticacion JWT. Acepta el token en el header Authorization: Bearer <jwt>
// o en el query ?token= (necesario para <img src="/media/...">).
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PerfilUsuario } from '@sedea/shared';
import { config } from '../config.js';
import { ErrorApi, errorNoAutorizado } from './errores.js';
import { perfilVigente } from '../db/queries/usuarios.js';
import { exigirPasswordCambiada } from './cambioPassword.js';

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

    let identificador: number;
    try {
      const perfil = app.jwt.verify(token) as any;
      identificador = Number(perfil.id);
    } catch {
      throw errorNoAutorizado('Token invalido o expirado.');
    }

    // Build 4: el perfil se lee de BD en cada peticion (10.6.1). Cuesta una
    // consulta por clave primaria y a cambio desactivar una cuenta invalida su
    // token al instante, y cambiar la contrasena desbloquea el token vigente
    // sin necesidad de volver a iniciar sesion.
    const fila = await perfilVigente(identificador);
    if (!fila) {
      throw new ErrorApi(401, 'token_invalido', 'Token invalido o expirado.');
    }
    if (!fila.activo) {
      throw new ErrorApi(
        401,
        'cuenta_desactivada',
        'Tu cuenta está desactivada. Contacta al administrador.'
      );
    }

    peticion.usuario = {
      id: fila.id,
      usuario: fila.usuario,
      nombre_completo: fila.nombre_completo,
      rol: fila.rol as PerfilUsuario['rol'],
      regional_id: fila.regional_id,
      regional_nombre: fila.regional_nombre,
      activo: fila.activo,
      debe_cambiar_password: fila.debe_cambiar_password
    };

    // El guardado global corre antes que este preHandler de ruta; aqui se
    // aplica de nuevo ahora que ya se conoce el estado real del usuario.
    exigirPasswordCambiada(peticion);
  });
}

export default fp(plugin, { name: 'auth' });
