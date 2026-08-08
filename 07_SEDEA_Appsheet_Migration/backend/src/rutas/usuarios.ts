// Administracion de usuarios reales (E34-E38).
// Solo admin y editor_datos (D15). NO existe DELETE: las bajas se hacen
// desactivando la cuenta para no romper la trazabilidad de capturas,
// staging y auditoria (D16).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AVISO_PASSWORD_TEMPORAL,
  CLAVES_EDICION_USUARIO,
  ROLES_ADMIN_USUARIOS,
  esquemaActivoUsuario,
  esquemaResetPassword
} from '@sedea/shared';
import { errorNoAutorizado } from '../plugins/errores.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import { generarPasswordTemporal, hashearPassword } from '../servicios/passwords.js';
import {
  actualizarActivo,
  actualizarDatosUsuario,
  actualizarPasswordTemporal,
  existeNombreUsuario,
  insertarUsuario,
  listarUsuarios,
  obtenerFilaUsuario,
  obtenerUsuarioAdmin
} from '../db/queries/usuarios.js';
import {
  calcularCambios,
  error403,
  error404,
  error409,
  error422,
  exigirQuedaOtroAdmin,
  exigirRolAdministrable,
  resolverRegional,
  validarAlta,
  validarEdicion
} from '../servicios/usuarios.js';

/** Guarda de rol propia para devolver el codigo `rol_no_autorizado` del contrato. */
async function soloAdministradores(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (!ROLES_ADMIN_USUARIOS.includes(usuario.rol as 'admin' | 'editor_datos')) {
    throw error403('rol_no_autorizado', 'No tienes permiso para ver esta sección.');
  }
}

export default async function rutasUsuarios(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, soloAdministradores] };

  // E34 - Listado filtrado y paginado.
  app.get('/api/usuarios', protegida, async (peticion, respuesta) => {
    const q = peticion.query as Record<string, string>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));

    const { data, total } = await listarUsuarios({
      rol: q.rol || null,
      regional_id: q.regional_id ? Number(q.regional_id) : null,
      activo: q.activo === 'true' ? true : q.activo === 'false' ? false : null,
      q: q.q || null,
      page,
      page_size: pageSize
    });

    return respuesta.status(200).send({
      data,
      page,
      page_size: pageSize,
      total,
      has_more: (page - 1) * pageSize + data.length < total
    });
  });

  // E35 - Alta con contrasena temporal de un solo uso.
  app.post('/api/usuarios', protegida, async (peticion, respuesta) => {
    const actor = peticion.usuario!;
    const datos = validarAlta(peticion.body);

    exigirRolAdministrable(actor.rol, datos.rol);

    if (await existeNombreUsuario(datos.usuario)) {
      throw error409('usuario_duplicado', 'Ya existe un usuario con ese nombre de acceso.');
    }

    const regionalId = await resolverRegional(datos.rol, datos.regional_id);

    // La cadena en claro solo vive en memoria y en la respuesta HTTP.
    const passwordTemporal = generarPasswordTemporal();
    const hash = hashearPassword(passwordTemporal);

    const id = await enTransaccion(async (cliente) => {
      if (await existeNombreUsuario(datos.usuario, cliente)) {
        throw error409('usuario_duplicado', 'Ya existe un usuario con ese nombre de acceso.');
      }
      const nuevoId = await insertarUsuario(cliente, {
        usuario: datos.usuario,
        nombre_completo: datos.nombre_completo,
        rol: datos.rol,
        regional_id: regionalId,
        password_hash: hash
      });
      await bitacoraEnTransaccion(cliente, {
        usuarioId: actor.id,
        accion: 'usuario_creado',
        entidad: 'usuario',
        entidadId: nuevoId,
        // NUNCA se registra la contrasena temporal.
        detalle: {
          usuario: datos.usuario,
          rol: datos.rol,
          regional_id: regionalId,
          creado_por_rol: actor.rol
        },
        ip: peticion.ip,
        userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
      });
      return nuevoId;
    });

    const creado = await obtenerUsuarioAdmin(id);
    return respuesta.status(201).send({
      ok: true,
      usuario: creado,
      password_temporal: passwordTemporal,
      aviso: AVISO_PASSWORD_TEMPORAL
    });
  });

  // E36 - Edicion de nombre, rol y Regional. El nombre de acceso es inmutable.
  app.patch<{ Params: { id: string } }>(
    '/api/usuarios/:id',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);
      const datos = validarEdicion(peticion.body);

      const actual = await obtenerFilaUsuario(id);
      if (!actual) throw error404('no_encontrado', 'El usuario no existe.');

      exigirRolAdministrable(actor.rol, actual.rol);
      if (datos.rol) exigirRolAdministrable(actor.rol, datos.rol);

      const rolFinal = datos.rol ?? actual.rol;

      // Coherencia rol <-> Regional: si el rol deja de ser capturista, la
      // Regional se limpia sola; enviarla explicitamente sigue siendo un error.
      let regionalFinal: number | null;
      if (rolFinal === 'capturista') {
        const propuesta =
          'regional_id' in datos ? (datos.regional_id ?? null) : actual.regional_id;
        regionalFinal = await resolverRegional('capturista', propuesta);
      } else {
        if ('regional_id' in datos && (datos.regional_id ?? null) !== null) {
          throw error422('regional_no_aplica', 'Solo los capturistas llevan Dirección Regional.');
        }
        regionalFinal = null;
      }

      const propuesto: Record<string, unknown> = {};
      if (datos.nombre_completo !== undefined) propuesto.nombre_completo = datos.nombre_completo;
      if (datos.rol !== undefined) propuesto.rol = rolFinal;
      if (regionalFinal !== actual.regional_id) propuesto.regional_id = regionalFinal;

      const cambios = calcularCambios(
        {
          nombre_completo: actual.nombre_completo,
          rol: actual.rol,
          regional_id: actual.regional_id
        },
        propuesto,
        CLAVES_EDICION_USUARIO
      );

      if (cambios.length === 0) {
        // Sin cambios reales no se toca actualizado_en ni la bitacora.
        return respuesta
          .status(200)
          .send({ ok: true, usuario: await obtenerUsuarioAdmin(id), cambios: [] });
      }

      await enTransaccion(async (cliente) => {
        // Degradar de rol al ultimo admin activo dejaria el sistema sin dueno.
        if (datos.rol && datos.rol !== 'admin' && actual.rol === 'admin' && actual.activo) {
          await exigirQuedaOtroAdmin(cliente, id, actual.rol);
        }
        const aEscribir: Record<string, unknown> = {};
        for (const cambio of cambios) aEscribir[cambio.campo] = cambio.nuevo;
        await actualizarDatosUsuario(cliente, id, aEscribir);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'usuario_editado',
          entidad: 'usuario',
          entidadId: id,
          detalle: { cambios, editado_por_rol: actor.rol, motivo: datos.motivo ?? null },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta
        .status(200)
        .send({ ok: true, usuario: await obtenerUsuarioAdmin(id), cambios });
    }
  );

  // E37 - Reseteo de contrasena: nueva temporal y cambio obligatorio.
  app.post<{ Params: { id: string } }>(
    '/api/usuarios/:id/reset-password',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);
      const parseado = esquemaResetPassword.safeParse(peticion.body ?? {});
      if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');

      const actual = await obtenerFilaUsuario(id);
      if (!actual) throw error404('no_encontrado', 'El usuario no existe.');
      exigirRolAdministrable(actor.rol, actual.rol);

      const passwordTemporal = generarPasswordTemporal();
      const hash = hashearPassword(passwordTemporal);

      await enTransaccion(async (cliente) => {
        await actualizarPasswordTemporal(cliente, id, hash);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'usuario_password_reset',
          entidad: 'usuario',
          entidadId: id,
          // Sin rastro de la contrasena, ni en claro ni hasheada.
          detalle: {
            usuario: actual.usuario,
            motivo: parseado.data.motivo ?? null,
            reseteado_por_rol: actor.rol
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta.status(200).send({
        ok: true,
        usuario_id: id,
        usuario: actual.usuario,
        password_temporal: passwordTemporal,
        aviso: AVISO_PASSWORD_TEMPORAL
      });
    }
  );

  // E38 - Activacion / desactivacion (la unica forma de "dar de baja").
  app.patch<{ Params: { id: string } }>(
    '/api/usuarios/:id/activo',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);
      const parseado = esquemaActivoUsuario.safeParse(peticion.body);
      if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');
      const { activo, motivo } = parseado.data;

      const actual = await obtenerFilaUsuario(id);
      if (!actual) throw error404('no_encontrado', 'El usuario no existe.');
      exigirRolAdministrable(actor.rol, actual.rol);

      if (!activo && id === actor.id) {
        throw error409('auto_desactivacion', 'No puedes desactivar tu propia cuenta.');
      }

      if (actual.activo === activo) {
        // Idempotente: sin cambio no hay bitacora.
        return respuesta
          .status(200)
          .send({ ok: true, usuario: { id, usuario: actual.usuario, activo } });
      }

      await enTransaccion(async (cliente) => {
        if (!activo) await exigirQuedaOtroAdmin(cliente, id, actual.rol);
        await actualizarActivo(cliente, id, activo);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: activo ? 'usuario_activado' : 'usuario_desactivado',
          entidad: 'usuario',
          entidadId: id,
          detalle: {
            usuario: actual.usuario,
            anterior: actual.activo,
            nuevo: activo,
            motivo: motivo ?? null
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta
        .status(200)
        .send({ ok: true, usuario: { id, usuario: actual.usuario, activo } });
    }
  );

  // Nota: no se registra ninguna ruta DELETE /api/usuarios/:id (D16).
  // Fastify responde 404 a esa peticion con el manejador global.
}
