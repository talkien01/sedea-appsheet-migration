// Guarda global del cambio de contrasena obligatorio (10.6.2).
// Si el usuario tiene debe_cambiar_password = true solo puede consultar su
// perfil y cambiar su contrasena; cualquier otra ruta responde 403
// cambio_password_requerido.
//
// La comprobacion se aplica en dos puntos para cubrir el orden de hooks de
// Fastify: dentro de `autenticar` (que es un preHandler de ruta y por tanto
// corre despues de los hooks globales) y como preHandler global, que atrapa a
// quien se autentica en el hook onRequest de /media.
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ErrorApi } from './errores.js';

/** Unicas rutas utilizables con el flag activo. */
const LISTA_BLANCA: Array<{ metodo: string; ruta: string }> = [
  { metodo: 'GET', ruta: '/api/health' },
  { metodo: 'POST', ruta: '/api/auth/login' },
  { metodo: 'GET', ruta: '/api/auth/me' },
  { metodo: 'PATCH', ruta: '/api/mi-cuenta/password' }
];

function enListaBlanca(metodo: string, url: string): boolean {
  const ruta = url.split('?')[0].replace(/\/+$/, '') || '/';
  return LISTA_BLANCA.some(
    (entrada) => entrada.metodo === metodo.toUpperCase() && entrada.ruta === ruta
  );
}

/** Lanza 403 si el usuario autenticado debe cambiar su contrasena. */
export function exigirPasswordCambiada(peticion: FastifyRequest): void {
  const usuario = peticion.usuario;
  if (!usuario || usuario.debe_cambiar_password !== true) return;
  if (enListaBlanca(peticion.method, peticion.raw.url ?? '')) return;

  throw new ErrorApi(
    403,
    'cambio_password_requerido',
    'Debes cambiar tu contraseña antes de continuar.'
  );
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (peticion) => {
    exigirPasswordCambiada(peticion);
  });
}

export default fp(plugin, { name: 'cambioPassword' });
