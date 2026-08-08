// Autenticacion: login con usuario/contrasena y perfil del token.
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { esquemaLogin } from '@sedea/shared';
import type { PerfilUsuario } from '@sedea/shared';
import { consultarUna } from '../db/pool.js';
import { ErrorApi, errorValidacion } from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';

/**
 * Limitador de fuerza bruta: maximo 10 intentos FALLIDOS por IP por minuto.
 * Los inicios de sesion correctos no consumen cupo, para no bloquear el uso
 * legitimo de un mismo punto de acceso compartido en oficinas regionales.
 */
const intentosFallidos = new Map<string, { conteo: number; desde: number }>();
const VENTANA_MS = 60_000;
const MAX_FALLIDOS = 10;

function bloqueadoPorIntentos(ip: string): boolean {
  const registro = intentosFallidos.get(ip);
  if (!registro) return false;
  if (Date.now() - registro.desde > VENTANA_MS) {
    intentosFallidos.delete(ip);
    return false;
  }
  return registro.conteo >= MAX_FALLIDOS;
}

function anotarFallo(ip: string): void {
  const registro = intentosFallidos.get(ip);
  if (!registro || Date.now() - registro.desde > VENTANA_MS) {
    intentosFallidos.set(ip, { conteo: 1, desde: Date.now() });
  } else {
    registro.conteo += 1;
  }
}

interface FilaUsuario {
  id: number;
  usuario: string;
  nombre_completo: string;
  password_hash: string;
  rol: PerfilUsuario['rol'];
  regional_id: number | null;
  regional_nombre: string | null;
  activo: boolean;
  debe_cambiar_password: boolean;
}

export default async function rutasAuth(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (peticion, respuesta) => {
    const parseado = esquemaLogin.safeParse(peticion.body);
    if (!parseado.success) {
      throw errorValidacion('Usuario y contrasena son obligatorios.');
    }

    if (bloqueadoPorIntentos(peticion.ip)) {
      return respuesta.status(429).send({
        error: {
          codigo: 'limite_peticiones',
          mensaje: 'Demasiados intentos fallidos. Espera un minuto e intenta de nuevo.'
        }
      });
    }

    const { usuario, password } = parseado.data;

    const fila = await consultarUna<FilaUsuario>(
      `SELECT u.id, u.usuario, u.nombre_completo, u.password_hash, u.rol,
              u.regional_id, u.activo, u.debe_cambiar_password, r.nombre AS regional_nombre
         FROM usuarios u
         LEFT JOIN direcciones_regionales r ON r.id = u.regional_id
        WHERE lower(u.usuario) = lower($1)`,
      [usuario]
    );

    const passwordOk = !!fila && bcrypt.compareSync(password, fila.password_hash);
    const credencialesOk = !!fila && fila.activo && passwordOk;

    if (!credencialesOk) {
      anotarFallo(peticion.ip);
      // Una cuenta desactivada recibe el mismo mensaje generico que una
      // credencial invalida: no se filtra el estado de la cuenta (Assumption 55).
      const motivo = !fila
        ? 'usuario_inexistente'
        : !fila.activo
          ? 'cuenta_desactivada'
          : 'contrasena_incorrecta';
      await registrarAuditoria(peticion, {
        usuarioId: fila?.id ?? null,
        accion: 'login_fallido',
        entidad: 'usuario',
        entidadId: usuario,
        detalle: { motivo }
      });
      throw new ErrorApi(401, 'credenciales_invalidas', 'Usuario o contraseña incorrectos.');
    }

    const perfil: PerfilUsuario = {
      id: fila.id,
      usuario: fila.usuario,
      nombre_completo: fila.nombre_completo,
      rol: fila.rol,
      regional_id: fila.regional_id,
      regional_nombre: fila.regional_nombre,
      // Build 4: el cliente necesita saber si debe forzar el cambio.
      debe_cambiar_password: fila.debe_cambiar_password === true,
      activo: true
    };

    const token = app.jwt.sign(perfil as any);

    await registrarAuditoria(peticion, {
      usuarioId: fila.id,
      accion: 'login',
      entidad: 'usuario',
      entidadId: fila.id,
      detalle: { rol: fila.rol, regional_id: fila.regional_id }
    });

    return respuesta.status(200).send({ token, usuario: perfil });
  });

  app.get(
    '/api/auth/me',
    { preHandler: [app.autenticar] },
    async (peticion, respuesta) => respuesta.status(200).send({ usuario: peticion.usuario })
  );
}
