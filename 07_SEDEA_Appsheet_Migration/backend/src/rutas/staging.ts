// Endpoints de depuracion / staging (E16-E25).
// Solo los roles editor_datos y admin entran aqui; cualquier otro rol
// autenticado recibe 403 y sin token 401.
import type { FastifyInstance } from 'fastify';
import {
  ROLES_STAGING,
  esquemaConsultaStagingBeneficiarios,
  esquemaConsultaStagingCatalogos,
  esquemaFusion,
  esquemaMotivoRevision
} from '@sedea/shared';
import { regionalForzada } from '../plugins/rbac.js';
import { errorNoEncontrado, errorProhibido, errorValidacion } from '../plugins/errores.js';
import {
  listarStagingBeneficiarios,
  listarStagingCatalogos,
  obtenerStagingBeneficiario,
  obtenerStagingCatalogo,
  relacionadasDeBeneficiario,
  relacionadasDeCatalogo,
  resumenTabla
} from '../db/queries/staging.js';
import {
  bitacoraEnTransaccion,
  enTransaccion,
  errorConflicto,
  promoverBeneficiario,
  promoverCatalogo,
  recalcularFlags
} from '../servicios/promocion.js';

/** Comprueba que el editor pueda tocar una fila de la Regional indicada. */
function verificarRegional(regionalForzadaDelUsuario: number | null, regionalFila: number | null) {
  if (regionalForzadaDelUsuario === null) return;
  if (regionalFila !== null && regionalFila !== regionalForzadaDelUsuario) {
    throw errorProhibido('La fila pertenece a otra Dirección Regional.');
  }
}

export default async function rutasStaging(app: FastifyInstance): Promise<void> {
  const soloEditores = {
    preHandler: [app.autenticar, app.requiereRol(...ROLES_STAGING)]
  };

  // E16 - Resumen de conteos para las tarjetas de la pantalla de depuracion.
  app.get('/api/staging/resumen', soloEditores, async (peticion, respuesta) => {
    const regional = regionalForzada(peticion.usuario!);
    return respuesta.status(200).send({
      beneficiarios: await resumenTabla('staging_beneficiarios', regional),
      catalogos: await resumenTabla('staging_catalogos', regional)
    });
  });

  // E17 - Listado filtrable del staging de padron.
  app.get('/api/staging/beneficiarios', soloEditores, async (peticion, respuesta) => {
    const filtros = esquemaConsultaStagingBeneficiarios.parse(peticion.query ?? {});
    const regional = regionalForzada(peticion.usuario!);
    return respuesta.status(200).send(await listarStagingBeneficiarios(filtros, regional));
  });

  // E18 - Detalle con candidatos relacionados para la comparacion lado a lado.
  app.get<{ Params: { id: string } }>(
    '/api/staging/beneficiarios/:id',
    soloEditores,
    async (peticion, respuesta) => {
      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('Fila de staging no encontrada.');
      const fila = await obtenerStagingBeneficiario(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      verificarRegional(regionalForzada(peticion.usuario!), fila.regional_id);
      return respuesta.status(200).send({
        fila,
        relacionadas: await relacionadasDeBeneficiario(fila)
      });
    }
  );

  // E19 - Aprobar y promover a produccion.
  app.post<{ Params: { id: string } }>(
    '/api/staging/beneficiarios/:id/aprobar',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const { motivo } = esquemaMotivoRevision.parse(peticion.body ?? {});

      const fila = await obtenerStagingBeneficiario(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      verificarRegional(regionalForzada(usuario), fila.regional_id);
      if (fila.estado_revision !== 'pendiente') throw errorConflicto();

      const beneficiarioId = await enTransaccion(async (cliente) => {
        // Se vuelve a leer con FOR UPDATE para evitar doble promocion simultanea.
        const bloqueada = await cliente.query(
          `SELECT estado_revision FROM staging_beneficiarios WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (bloqueada.rows[0]?.estado_revision !== 'pendiente') throw errorConflicto();

        const nuevoId = await promoverBeneficiario(cliente, fila, fila.importacion_id);
        await cliente.query(
          `UPDATE staging_beneficiarios
              SET estado_revision = 'aprobado', revisado_por = $2, revisado_en = now(),
                  motivo_revision = $3, promovido_beneficiario_id = $4, actualizado_en = now()
            WHERE id = $1`,
          [id, usuario.id, motivo ?? null, nuevoId]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'staging_aprobado',
          entidad: 'staging_beneficiario',
          entidadId: id,
          detalle: {
            estado_anterior: 'pendiente',
            estado_nuevo: 'aprobado',
            beneficiario_id: nuevoId,
            folio: fila.folio,
            motivo: motivo ?? null,
            flags: flagsDeFila(fila)
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        });
        return nuevoId;
      });

      return respuesta.status(200).send({ ok: true, beneficiario_id: beneficiarioId });
    }
  );

  // E20 - Descartar (nunca escribe en produccion).
  app.post<{ Params: { id: string } }>(
    '/api/staging/beneficiarios/:id/descartar',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const { motivo } = esquemaMotivoRevision.parse(peticion.body ?? {});

      const fila = await obtenerStagingBeneficiario(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      verificarRegional(regionalForzada(usuario), fila.regional_id);
      if (fila.estado_revision !== 'pendiente') throw errorConflicto();

      await enTransaccion(async (cliente) => {
        const bloqueada = await cliente.query(
          `SELECT estado_revision FROM staging_beneficiarios WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (bloqueada.rows[0]?.estado_revision !== 'pendiente') throw errorConflicto();

        await cliente.query(
          `UPDATE staging_beneficiarios
              SET estado_revision = 'descartado', revisado_por = $2, revisado_en = now(),
                  motivo_revision = $3, actualizado_en = now()
            WHERE id = $1`,
          [id, usuario.id, motivo ?? null]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'staging_descartado',
          entidad: 'staging_beneficiario',
          entidadId: id,
          detalle: {
            estado_anterior: 'pendiente',
            estado_nuevo: 'descartado',
            folio: fila.folio,
            motivo: motivo ?? null,
            flags: flagsDeFila(fila)
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        });
      });

      return respuesta.status(200).send({ ok: true });
    }
  );

  // E21 - Fusionar duplicados en una fila principal.
  app.post('/api/staging/beneficiarios/fusionar', soloEditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const cuerpo = esquemaFusion.parse(peticion.body ?? {});
    const secundarios = [...new Set(cuerpo.secundarios_ids)];

    if (secundarios.includes(cuerpo.principal_id)) {
      throw errorValidacion('La fila principal no puede estar también entre las secundarias.');
    }

    const principal = await obtenerStagingBeneficiario(cuerpo.principal_id);
    if (!principal) throw errorValidacion('La fila principal no existe.');
    verificarRegional(regionalForzada(usuario), principal.regional_id);
    if (principal.estado_revision !== 'pendiente') {
      throw errorValidacion('La fila principal ya fue revisada.');
    }

    for (const idSecundario of secundarios) {
      const fila = await obtenerStagingBeneficiario(idSecundario);
      if (!fila) throw errorValidacion(`La fila ${idSecundario} no existe.`);
      verificarRegional(regionalForzada(usuario), fila.regional_id);
      if (fila.estado_revision !== 'pendiente') {
        throw errorValidacion(`La fila ${idSecundario} ya fue revisada.`);
      }
    }

    const resultado = await enTransaccion(async (cliente) => {
      // Campos de datos que el revisor decidio conservar en la principal.
      const campos = cuerpo.campos ?? {};
      const asignaciones: string[] = [];
      const parametros: unknown[] = [cuerpo.principal_id];
      for (const [columna, valor] of Object.entries(campos)) {
        parametros.push(valor === '' ? null : valor);
        asignaciones.push(`${columna} = $${parametros.length}`);
      }
      if (asignaciones.length) {
        await cliente.query(
          `UPDATE staging_beneficiarios SET ${asignaciones.join(', ')}, actualizado_en = now()
            WHERE id = $1`,
          parametros
        );
      }

      await cliente.query(
        `UPDATE staging_beneficiarios
            SET estado_revision = 'fusionado', fusionado_en_id = $2, revisado_por = $3,
                revisado_en = now(), motivo_revision = $4, actualizado_en = now()
          WHERE id = ANY($1::bigint[])`,
        [secundarios, cuerpo.principal_id, usuario.id, cuerpo.motivo ?? null]
      );

      // Los flags de la principal pueden haber dejado de aplicar tras la fusion.
      await recalcularFlags(cliente, cuerpo.principal_id);

      let beneficiarioId: number | null = null;
      if (cuerpo.promover) {
        const { rows } = await cliente.query(
          `SELECT * FROM staging_beneficiarios WHERE id = $1`,
          [cuerpo.principal_id]
        );
        beneficiarioId = await promoverBeneficiario(cliente, rows[0], rows[0].importacion_id);
        await cliente.query(
          `UPDATE staging_beneficiarios
              SET estado_revision = 'aprobado', revisado_por = $2, revisado_en = now(),
                  promovido_beneficiario_id = $3, actualizado_en = now()
            WHERE id = $1`,
          [cuerpo.principal_id, usuario.id, beneficiarioId]
        );
      }

      await bitacoraEnTransaccion(cliente, {
        usuarioId: usuario.id,
        accion: 'staging_fusionado',
        entidad: 'staging_beneficiario',
        entidadId: cuerpo.principal_id,
        detalle: {
          estado_anterior: 'pendiente',
          estado_nuevo: cuerpo.promover ? 'aprobado' : 'pendiente',
          principal_id: cuerpo.principal_id,
          secundarios_ids: secundarios,
          campos_aplicados: Object.keys(campos),
          promovido: !!cuerpo.promover,
          beneficiario_id: beneficiarioId,
          motivo: cuerpo.motivo ?? null
        },
        ip: peticion.ip,
        userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
      });

      return beneficiarioId;
    });

    return respuesta.status(200).send({
      ok: true,
      principal_id: cuerpo.principal_id,
      fusionados: secundarios,
      beneficiario_id: resultado
    });
  });

  // E22 - Listado del staging de catalogos.
  app.get('/api/staging/catalogos', soloEditores, async (peticion, respuesta) => {
    const filtros = esquemaConsultaStagingCatalogos.parse(peticion.query ?? {});
    return respuesta.status(200).send(await listarStagingCatalogos(filtros));
  });

  // E23 - Detalle de una fila de catalogo con sus homonimas.
  app.get<{ Params: { id: string } }>(
    '/api/staging/catalogos/:id',
    soloEditores,
    async (peticion, respuesta) => {
      const id = Number(peticion.params.id);
      const fila = await obtenerStagingCatalogo(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      return respuesta.status(200).send({ fila, relacionadas: await relacionadasDeCatalogo(fila) });
    }
  );

  // E24 - Aprobar una entrada de catalogo.
  app.post<{ Params: { id: string } }>(
    '/api/staging/catalogos/:id/aprobar',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const { motivo } = esquemaMotivoRevision.parse(peticion.body ?? {});

      const fila = await obtenerStagingCatalogo(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      if (fila.estado_revision !== 'pendiente') throw errorConflicto();

      const catalogoId = await enTransaccion(async (cliente) => {
        const bloqueada = await cliente.query(
          `SELECT estado_revision FROM staging_catalogos WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (bloqueada.rows[0]?.estado_revision !== 'pendiente') throw errorConflicto();

        const nuevoId = await promoverCatalogo(cliente, fila);
        await cliente.query(
          `UPDATE staging_catalogos
              SET estado_revision = 'aprobado', revisado_por = $2, revisado_en = now(),
                  motivo_revision = $3, promovido_catalogo_id = $4, actualizado_en = now()
            WHERE id = $1`,
          [id, usuario.id, motivo ?? null, nuevoId]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'staging_aprobado',
          entidad: 'staging_catalogo',
          entidadId: id,
          detalle: {
            estado_anterior: 'pendiente',
            estado_nuevo: 'aprobado',
            catalogo_id: nuevoId,
            grupo: fila.grupo,
            clave: fila.clave,
            motivo: motivo ?? null
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        });
        return nuevoId;
      });

      return respuesta.status(200).send({ ok: true, catalogo_id: catalogoId });
    }
  );

  // E25 - Descartar una entrada de catalogo.
  app.post<{ Params: { id: string } }>(
    '/api/staging/catalogos/:id/descartar',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const { motivo } = esquemaMotivoRevision.parse(peticion.body ?? {});

      const fila = await obtenerStagingCatalogo(id);
      if (!fila) throw errorNoEncontrado('Fila de staging no encontrada.');
      if (fila.estado_revision !== 'pendiente') throw errorConflicto();

      await enTransaccion(async (cliente) => {
        const bloqueada = await cliente.query(
          `SELECT estado_revision FROM staging_catalogos WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (bloqueada.rows[0]?.estado_revision !== 'pendiente') throw errorConflicto();

        await cliente.query(
          `UPDATE staging_catalogos
              SET estado_revision = 'descartado', revisado_por = $2, revisado_en = now(),
                  motivo_revision = $3, actualizado_en = now()
            WHERE id = $1`,
          [id, usuario.id, motivo ?? null]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'staging_descartado',
          entidad: 'staging_catalogo',
          entidadId: id,
          detalle: {
            estado_anterior: 'pendiente',
            estado_nuevo: 'descartado',
            grupo: fila.grupo,
            clave: fila.clave,
            motivo: motivo ?? null
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        });
      });

      return respuesta.status(200).send({ ok: true });
    }
  );
}

/** Extrae los 6 flags de una fila para dejarlos en la bitacora. */
function flagsDeFila(fila: any): Record<string, boolean> {
  return {
    folio_duplicado: !!fila.folio_duplicado,
    curp_duplicada_mismo_concepto: !!fila.curp_duplicada_mismo_concepto,
    curp_duplicada_concepto_distinto: !!fila.curp_duplicada_concepto_distinto,
    sin_coordenadas: !!fila.sin_coordenadas,
    sin_colonia: !!fila.sin_colonia,
    concepto_no_reconocido: !!fila.concepto_no_reconocido
  };
}

