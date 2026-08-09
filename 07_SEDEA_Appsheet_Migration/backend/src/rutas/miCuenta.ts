// Cambio de la propia contrasena (E39). Disponible para los 4 roles, tanto en
// el cambio obligatorio de la primera entrada como en el cambio voluntario.
// Es ruta de lista blanca: funciona aunque debe_cambiar_password sea true.
// Build 5 (11.4): la contrasena actual solo se exige en el cambio VOLUNTARIO.
// En el obligatorio se omite (D25) porque el usuario ya demostro conocerla al
// iniciar sesion y obtener el token con el que llama a este endpoint.
import type { FastifyInstance } from 'fastify';
import { esquemaCambioPassword, validarFuerzaPassword } from '@sedea/shared';
import { ErrorApi } from '../plugins/errores.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import { hashearPassword, verificarPassword } from '../servicios/passwords.js';
import { actualizarPasswordPropia, obtenerHash, perfilVigente } from '../db/queries/usuarios.js';

/**
 * Todos los fallos de politica responden 422 y no 401, para no disparar el
 * cierre de sesion automatico del cliente.
 */
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

export default async function rutasMiCuenta(app: FastifyInstance): Promise<void> {
  app.patch(
    '/api/mi-cuenta/password',
    { preHandler: [app.autenticar] },
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const parseado = esquemaCambioPassword.safeParse(peticion.body);
      if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');
      const { password_actual, password_nueva } = parseado.data;

      const hashActual = await obtenerHash(actor.id);
      if (!hashActual) throw error422('payload_invalido', 'Datos inválidos.');

      // El modo se decide SIEMPRE con el flag leido de BD, nunca con un campo
      // del body ni con un claim del token (11.4).
      const perfil = await perfilVigente(actor.id);
      const eraObligatorio = perfil?.debe_cambiar_password === true;

      if (eraObligatorio) {
        // D25: el usuario acaba de autenticarse con la contrasena temporal para
        // obtener este token, asi que no se le vuelve a pedir. Si el cliente
        // envia `password_actual` de todas formas, se ignora en silencio.
      } else {
        // D26: el cambio voluntario no se relaja en absoluto.
        if (password_actual === undefined) {
          throw error422('password_actual_requerida', 'Debes escribir tu contraseña actual.');
        }
        if (!verificarPassword(password_actual, hashActual)) {
          throw error422('password_actual_incorrecta', 'La contraseña actual no es correcta.');
        }
      }

      const debil = validarFuerzaPassword(password_nueva);
      if (debil) throw error422(debil.codigo, debil.mensaje);

      if (verificarPassword(password_nueva, hashActual)) {
        throw error422('password_repetida', 'La nueva contraseña debe ser distinta de la actual.');
      }

      const hashNuevo = hashearPassword(password_nueva);

      await enTransaccion(async (cliente) => {
        await actualizarPasswordPropia(cliente, actor.id, hashNuevo);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'password_cambiado',
          entidad: 'usuario',
          entidadId: actor.id,
          // Sin rastro de la contrasena, ni de la anterior ni de la nueva.
          // `sin_password_actual` deja constancia de que se acepto por token.
          detalle: { obligatorio: eraObligatorio, sin_password_actual: eraObligatorio },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      // El token vigente sigue sirviendo: el flag se lee de BD en cada peticion.
      return respuesta.status(200).send({ ok: true, debe_cambiar_password: false });
    }
  );
}
