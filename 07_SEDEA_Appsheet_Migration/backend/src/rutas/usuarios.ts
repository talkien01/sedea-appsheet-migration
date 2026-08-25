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
  marcarEliminado,
  obtenerFilaUsuario,
  obtenerMunicipiosDeRegional,
  obtenerUsuarioAdmin,
  regionalValida
} from '../db/queries/usuarios.js';
import {
  calcularCambios,
  error403,
  error404,
  error409,
  error422,
  exigirQuedaOtroAdmin,
  exigirRolAdministrable,
  resolverPasswordInicial,
  resolverRegional,
  validarAlta,
  validarEdicion
} from '../servicios/usuarios.js';
import { generarPlantillaLote, procesarLote } from '../servicios/usuariosLote.js';

/** Guarda de rol propia para devolver el codigo `rol_no_autorizado` del contrato. */
async function soloAdministradores(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  // Multi-rol: se permite si tiene 'admin' O 'editor_datos' en su lista
  const tieneRol = (r: string) => usuario.rol.split('+').includes(r);
  if (!tieneRol('admin') && !tieneRol('editor_datos')) {
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
      eliminado: q.eliminado === 'true' ? true : q.eliminado === 'false' ? false : null,
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

    // La cadena en claro solo vive en memoria y en la respuesta HTTP, sea
    // generada por el backend o escrita por el actor (D27/D29).
    const { password: passwordTemporal, modo: modoPassword } = resolverPasswordInicial(
      datos.modo_password,
      datos.password_manual,
      generarPasswordTemporal
    );
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

      // D35: Insertar automáticamente todos los municipios de la regional
      // para capturista y ventanilla. La semántica es "0 filas = todos",
      // pero queremos que el usuario vea solo los municipios de su regional.
      if (regionalId !== null && (datos.rol.includes('capturista') || datos.rol.includes('ventanilla'))) {
        const municipios = await obtenerMunicipiosDeRegional(regionalId, cliente);
        for (const municipio of municipios) {
          await cliente.query(
            `INSERT INTO usuario_municipios (usuario_id, municipio_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [nuevoId, municipio.id]
          );
        }
      }

      await bitacoraEnTransaccion(cliente, {
        usuarioId: actor.id,
        accion: 'usuario_creado',
        entidad: 'usuario',
        entidadId: nuevoId,
        // NUNCA se registra la contrasena, ni la generada ni la manual:
        // solo el MODO con el que se eligio.
        detalle: {
          usuario: datos.usuario,
          rol: datos.rol,
          regional_id: regionalId,
          creado_por_rol: actor.rol,
          modo_password: modoPassword,
          municipios_asignados: regionalId !== null ? 'todos_los_de_la_regional' : 'ninguno'
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
      modo_password: modoPassword,
      aviso: AVISO_PASSWORD_TEMPORAL
    });
  });

  // E38b-1 - Plantilla CSV del alta en lote.
  // Se sirve desde el backend (y no se arma en el navegador) para que las
  // columnas y el ejemplo salgan de la MISMA fuente que las lee al subirlas.
  app.get('/api/usuarios/plantilla-lote.csv', protegida, async (_peticion, respuesta) => {
    return respuesta
      .status(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="plantilla_usuarios_sedea.csv"')
      .send(generarPlantillaLote());
  });

  // E38b-2 - Alta en lote desde CSV.
  // Cada fila se valida y se crea con las mismas reglas del alta individual y
  // es INDEPENDIENTE de las demas: un error no aborta el resto del archivo.
  // Siempre responde 200 con el detalle fila por fila; los unicos 4xx son los
  // del archivo completo (sin archivo, encabezado invalido, demasiadas filas).
  app.post('/api/usuarios/lote', protegida, async (peticion, respuesta) => {
    const actor = peticion.usuario!;
    let texto: string | null = null;
    // Contrasena comun opcional del lote: si viene, se usa para TODAS las filas
    // en vez de generar una aleatoria por fila. La valida `procesarLote` con la
    // misma politica del alta individual, antes de crear nada.
    let passwordComun: string | null = null;

    if (peticion.isMultipart()) {
      for await (const parte of peticion.parts()) {
        if (parte.type === 'file') {
          const contenido = await parte.toBuffer();
          if (parte.fieldname !== 'archivo') continue;
          if (parte.file.truncated === true) {
            throw error422('archivo_muy_grande', 'El archivo excede el tamaño máximo permitido.');
          }
          texto = contenido.toString('utf8');
        } else if (parte.fieldname === 'password_comun' && typeof parte.value === 'string') {
          passwordComun = parte.value;
        }
      }
    } else {
      // Alternativa para scripts: { "csv": "usuario,nombre_completo,..." }.
      const cuerpo = peticion.body as { csv?: unknown; password_comun?: unknown } | null;
      if (cuerpo && typeof cuerpo.csv === 'string') texto = cuerpo.csv;
      if (cuerpo && typeof cuerpo.password_comun === 'string') passwordComun = cuerpo.password_comun;
    }

    if (texto === null || texto.trim().length === 0) {
      throw error422(
        'archivo_requerido',
        'Sube el archivo CSV en el campo "archivo" (multipart/form-data).'
      );
    }

    const { resultados, creados, errores } = await procesarLote(actor, texto, {
      ip: peticion.ip,
      userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
    }, passwordComun);

    return respuesta.status(200).send({
      ok: true,
      total: resultados.length,
      creados,
      errores,
      resultados,
      // Las temporales de este cuerpo son la unica copia en claro que existira:
      // no se persisten ni se registran en la bitacora.
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
      // Multi-rol: la Regional aplica si la lista contiene 'capturista'
      // (obligatoria) o 'ventanilla' (opcional: null = ventanilla Central).
      const rolesFinales = rolFinal.split('+');
      const regionalAplica =
        rolesFinales.includes('capturista') || rolesFinales.includes('ventanilla');

      // Coherencia rol <-> Regional: si el rol deja de aplicarla, la Regional se
      // limpia sola; enviarla explicitamente sigue siendo un error.
      let regionalFinal: number | null;
      if (regionalAplica) {
        const propuesta =
          'regional_id' in datos ? (datos.regional_id ?? null) : actual.regional_id;
        regionalFinal = await resolverRegional(rolFinal, propuesta);
      } else {
        if ('regional_id' in datos && (datos.regional_id ?? null) !== null) {
          throw error422(
            'regional_no_aplica',
            'Solo los capturistas y las ventanillas llevan Dirección Regional.'
          );
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

      // Igual que en el alta: automatica por defecto, manual si el actor la
      // escribio. En ambos casos el usuario queda obligado a cambiarla (D28).
      const { password: passwordTemporal, modo: modoPassword } = resolverPasswordInicial(
        parseado.data.modo_password,
        parseado.data.password_manual,
        generarPasswordTemporal
      );
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
            reseteado_por_rol: actor.rol,
            modo_password: modoPassword
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
        modo_password: modoPassword,
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

  // E38b - Eliminación lógica (papelera): solo admin.
  // Marca un usuario como eliminado: no puede login, no aparece en listados
  // normales, pero conserva su historial de capturas y auditoría.
  app.post<{ Params: { id: string } }>(
    '/api/usuarios/:id/eliminar',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);

      // Solo admin puede eliminar (D15).
      if (!actor.rol.split('+').includes('admin')) {
        throw error403('rol_no_autorizado', 'Solo los administradores pueden eliminar usuarios.');
      }

      const actual = await obtenerFilaUsuario(id);
      if (!actual) throw error404('no_encontrado', 'El usuario no existe.');
      if (actual.eliminado) {
        throw error409('ya_eliminado', 'Este usuario ya está eliminado.');
      }
      if (id === actor.id) {
        throw error409('auto_eliminacion', 'No puedes eliminarte a ti mismo.');
      }

      await enTransaccion(async (cliente) => {
        // Si es admin, verificar que quede al menos otro admin activo.
        if (actual.rol === 'admin') {
          await exigirQuedaOtroAdmin(cliente, id, actual.rol);
        }
        await marcarEliminado(cliente, id, true);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'usuario_eliminado',
          entidad: 'usuario',
          entidadId: id,
          detalle: {
            usuario: actual.usuario,
            eliminado_por_rol: actor.rol
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta.status(200).send({
        ok: true,
        usuario: { id, usuario: actual.usuario, eliminado: true }
      });
    }
  );

  // E38c - Restaurar desde papelera: solo admin.
  app.post<{ Params: { id: string } }>(
    '/api/usuarios/:id/restaurar',
    protegida,
    async (peticion, respuesta) => {
      const actor = peticion.usuario!;
      const id = Number(peticion.params.id);

      // Solo admin puede restaurar.
      if (!actor.rol.split('+').includes('admin')) {
        throw error403('rol_no_autorizado', 'Solo los administradores pueden restaurar usuarios.');
      }

      const actual = await obtenerFilaUsuario(id);
      if (!actual) throw error404('no_encontrado', 'El usuario no existe.');
      if (!actual.eliminado) {
        throw error409('no_eliminado', 'Este usuario no está eliminado.');
      }

      await enTransaccion(async (cliente) => {
        await marcarEliminado(cliente, id, false);
        await bitacoraEnTransaccion(cliente, {
          usuarioId: actor.id,
          accion: 'usuario_restaurado',
          entidad: 'usuario',
          entidadId: id,
          detalle: {
            usuario: actual.usuario,
            restaurado_por_rol: actor.rol
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta.status(200).send({
        ok: true,
        usuario: { id, usuario: actual.usuario, eliminado: false }
      });
    }
  );

  // Nota: no se registra ninguna ruta DELETE /api/usuarios/:id (D16).
  // La eliminación permanente solo es posible via SQL directo, no desde la API.
}
