// Reseteo de contrasena EN LOTE para usuarios que YA EXISTEN (E37b).
//
// Distinto del alta en lote de `usuariosLote.ts` (que CREA usuarios desde un
// CSV): aqui los usuarios ya existen y solo se les cambia la contrasena.
//
// Principio rector, el mismo de `usuariosLote.ts`: este modulo NO tiene reglas
// de negocio propias. Cada id se resuelve con exactamente las mismas piezas del
// reseteo individual de E37 (`exigirRolAdministrable`, `resolverPasswordInicial`,
// `hashearPassword`, `actualizarPasswordTemporal` y la bitacora
// `usuario_password_reset`), de modo que el lote nunca puede hacer algo que el
// boton individual habria rechazado.
//
// Cada id es INDEPENDIENTE: corre en su propia transaccion y su fallo no
// arrastra a los demas. Lo unico que se decide UNA sola vez, antes de tocar
// nada, es la contrasena en modo manual: si no cumple la politica, el lote
// entero se rechaza y no se resetea a nadie.
import type { ModoPassword, PerfilUsuario, ResultadoResetLoteUsuario } from '@sedea/shared';
import { ErrorApi } from '../plugins/errores.js';
import { generarPasswordTemporal, hashearPassword } from '../servicios/passwords.js';
import { bitacoraEnTransaccion, enTransaccion } from '../servicios/promocion.js';
import { actualizarPasswordTemporal, obtenerFilaUsuario } from '../db/queries/usuarios.js';
import { error404, exigirRolAdministrable, resolverPasswordInicial } from './usuarios.js';

interface OpcionesResetLote {
  ids: number[];
  modoPassword: ModoPassword;
  passwordManual?: string;
  motivo?: string | null;
}

/** Fila de `usuarios` tal como la devuelve `obtenerFilaUsuario`. */
type FilaUsuario = NonNullable<Awaited<ReturnType<typeof obtenerFilaUsuario>>>;

/**
 * Resetea UN usuario ya leido de BD, con las mismas reglas de E37. Lanza
 * `ErrorApi` con el codigo y el mensaje exactos que habria devuelto el reseteo
 * individual; quien llama lo convierte en un resultado `error` sin tocar los
 * demas ids.
 */
async function resetearUno(
  actor: PerfilUsuario,
  actual: FilaUsuario,
  password: string,
  modoPassword: ModoPassword,
  motivo: string | null,
  contexto: { ip: string; userAgent: string | null }
): Promise<void> {
  const id = actual.id;
  exigirRolAdministrable(actor.rol, actual.rol);

  const hash = hashearPassword(password);

  await enTransaccion(async (cliente) => {
    await actualizarPasswordTemporal(cliente, id, hash);
    await bitacoraEnTransaccion(cliente, {
      usuarioId: actor.id,
      accion: 'usuario_password_reset',
      entidad: 'usuario',
      entidadId: id,
      // Mismo detalle que el reseteo individual, sin rastro de la contrasena
      // ni en claro ni hasheada; solo se agrega el origen.
      detalle: {
        usuario: actual.usuario,
        motivo,
        reseteado_por_rol: actor.rol,
        modo_password: modoPassword,
        origen: 'lote'
      },
      ip: contexto.ip,
      userAgent: contexto.userAgent
    });
  });
}

/**
 * Procesa la lista completa. Nunca lanza por un id: devuelve un resultado por
 * cada uno, en el orden recibido. Los ids repetidos se colapsan a uno solo.
 *
 * El unico 4xx posible es el de la contrasena manual debil o ausente, que se
 * valida ANTES de resetear a nadie (misma garantia que el alta en lote).
 */
export async function procesarResetLote(
  actor: PerfilUsuario,
  opciones: OpcionesResetLote,
  contexto: { ip: string; userAgent: string | null }
): Promise<{
  resultados: ResultadoResetLoteUsuario[];
  reseteados: number;
  errores: number;
  modoPassword: ModoPassword;
  passwordComun: string | null;
}> {
  // En modo manual la contrasena se resuelve (y se valida con la politica de
  // D30) UNA sola vez: es la misma para todos. En automatica se deja para
  // adentro del ciclo, porque cada usuario lleva la suya.
  const comun =
    opciones.modoPassword === 'manual'
      ? resolverPasswordInicial('manual', opciones.passwordManual, generarPasswordTemporal).password
      : null;

  const ids = [...new Set(opciones.ids)];
  const motivo = opciones.motivo ?? null;
  const resultados: ResultadoResetLoteUsuario[] = [];

  for (const id of ids) {
    // Se lee primero para poder nombrar al usuario tambien cuando falla: un
    // resultado que solo dijera "id 47 error" seria inutil en pantalla.
    const actual = await obtenerFilaUsuario(id);
    if (!actual) {
      const fallo = error404('no_encontrado', 'El usuario no existe.');
      resultados.push({
        id,
        usuario: '',
        estado: 'error',
        codigo: fallo.codigo,
        motivo: fallo.message
      });
      continue;
    }

    const password =
      comun ?? resolverPasswordInicial('automatica', undefined, generarPasswordTemporal).password;
    try {
      await resetearUno(actor, actual, password, opciones.modoPassword, motivo, contexto);
      resultados.push({
        id,
        usuario: actual.usuario,
        estado: 'reseteado',
        // En modo manual la comun va una sola vez en la respuesta, no repetida
        // por fila; en automatica esta es la unica copia en claro que existira.
        ...(comun === null ? { password_temporal: password } : {})
      });
    } catch (fallo) {
      const api = fallo instanceof ErrorApi ? fallo : null;
      resultados.push({
        id,
        usuario: actual.usuario,
        estado: 'error',
        codigo: api?.codigo ?? 'error',
        motivo: api?.message ?? 'No fue posible resetear la contraseña de este usuario.'
      });
    }
  }

  return {
    resultados,
    reseteados: resultados.filter((r) => r.estado === 'reseteado').length,
    errores: resultados.filter((r) => r.estado === 'error').length,
    modoPassword: opciones.modoPassword,
    passwordComun: comun
  };
}
