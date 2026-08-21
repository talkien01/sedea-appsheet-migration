// Router de administracion de catalogos (Build 10).
// Prefijo: /api/admin/catalogos
// Endpoints: E49-E54
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  REGISTRO_ENTIDADES,
  normalizarClave,
  esquemaProgramaAlta,
  esquemaProgramaEdicion,
  esquemaSubprogramaAlta,
  esquemaSubprogramaEdicion,
  esquemaComponenteAlta,
  esquemaComponenteEdicion,
  esquemaModalidadAlta,
  esquemaModalidadEdicion,
  esquemaProyectoAlta,
  esquemaProyectoEdicion,
  esquemaTipoApoyoAlta,
  esquemaTipoApoyoEdicion,
  esquemaDocumentoRequeridoAlta,
  esquemaDocumentoRequeridoEdicion,
  type NombreEntidad
} from '@sedea/shared';
import {
  validarEntidad,
  listarEntidad,
  obtenerEntidad,
  crearEntidad,
  editarEntidad,
  cambiarEstadoEntidad,
  obtenerReferencias,
  obtenerArbol
} from '../servicios/catalogosAdmin.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';

// =============================================================================
// GUARDIAS Y UTILIDADES
// =============================================================================

const error401 = () => errorNoAutorizado();
const error403 = (mensaje: string) => new ErrorApi(403, 'rol_no_autorizado', mensaje);
const error404 = (codigo: string, mensaje: string) => new ErrorApi(404, codigo, mensaje);
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

/** Guarda de rol: solo admin y editor_datos pueden acceder (D49, D51). */
async function soloAdminOEditorDatos(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw error401();
  if (usuario.rol !== 'admin' && usuario.rol !== 'editor_datos') {
    throw error403('Tu rol no puede administrar catálogos.');
  }
}

/** Traduce error de Zod al formato del contrato. */
function traducirFalloZod(error: ZodError): ErrorApi {
  const desconocida = error.issues.find((i) => i.code === 'unrecognized_keys');
  if (desconocida) {
    const claves = (desconocida as unknown as { keys: string[] }).keys ?? [];
    return error422('payload_invalido', `Campo no reconocido: ${claves[0]}`);
  }
  const primerError = error.issues[0];
  if (primerError) {
    return error422('payload_invalido', primerError.message);
  }
  return error422('payload_invalido', 'Datos inválidos.');
}

/** Valida el body segun la entidad y operacion. */
function validarBody(entidad: NombreEntidad, body: unknown, esEdicion: boolean) {
  let esquema: any;

  switch (entidad) {
    case 'programas':
      esquema = esEdicion ? esquemaProgramaEdicion : esquemaProgramaAlta;
      break;
    case 'subprogramas':
      esquema = esEdicion ? esquemaSubprogramaEdicion : esquemaSubprogramaAlta;
      break;
    case 'componentes':
      esquema = esEdicion ? esquemaComponenteEdicion : esquemaComponenteAlta;
      break;
    case 'modalidades':
      esquema = esEdicion ? esquemaModalidadEdicion : esquemaModalidadAlta;
      break;
    case 'proyectos':
      esquema = esEdicion ? esquemaProyectoEdicion : esquemaProyectoAlta;
      break;
    case 'tipos_apoyo':
      esquema = esEdicion ? esquemaTipoApoyoEdicion : esquemaTipoApoyoAlta;
      break;
    case 'documentos_requeridos':
      esquema = esEdicion ? esquemaDocumentoRequeridoEdicion : esquemaDocumentoRequeridoAlta;
      break;
    default:
      throw error404('entidad_desconocida', 'No existe el catalogo solicitado.');
  }

  const parseado = esquema.safeParse(body);
  if (!parseado.success) throw traducirFalloZod(parseado.error);
  return parseado.data;
}

// =============================================================================
// RUTAS
// =============================================================================

export default async function rutasCatalogosAdmin(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, soloAdminOEditorDatos] };

  // -------------------------------------------------------------------------
  // E49 - GET /arbol: arbol jerarquico completo
  // -------------------------------------------------------------------------
  app.get('/arbol', protegida, async (peticion, respuesta) => {
    const query = peticion.query as Record<string, string>;
    const incluirInactivos = query.incluir_inactivos === 'true';

    const arbol = await obtenerArbol(incluirInactivos);
    return respuesta.status(200).send(arbol);
  });

  // -------------------------------------------------------------------------
  // E50 - GET /:entidad: listado paginado con filtros
  // -------------------------------------------------------------------------
  app.get<{ Params: { entidad: string } }>('/:entidad', protegida, async (peticion, respuesta) => {
    const entidad = validarEntidad(peticion.params.entidad);
    const query = peticion.query as Record<string, string>;

    const incluirInactivos = query.incluir_inactivos === 'true';
    const padreId = query.padre_id ? Number(query.padre_id) : null;
    const q = query.q || null;
    const pagina = query.pagina ? Number(query.pagina) : 1;
    const porPagina = query.por_pagina ? Math.min(Number(query.por_pagina), 200) : 50;

    const resultado = await listarEntidad({
      entidad,
      incluirInactivos,
      padreId,
      q,
      pagina,
      porPagina
    });

    return respuesta.status(200).send(resultado);
  });

  // -------------------------------------------------------------------------
  // E51 - POST /:entidad: alta
  // -------------------------------------------------------------------------
  app.post<{ Params: { entidad: string } }>('/:entidad', protegida, async (peticion, respuesta) => {
    const entidad = validarEntidad(peticion.params.entidad);
    const datos = validarBody(entidad, peticion.body, false);

    // Rechazar activo en el alta (D50)
    if ((datos as any).activo !== undefined) {
      throw error422('campo_no_editable', 'El campo activo no se acepta en el alta.');
    }

    const usuario = peticion.usuario!;
    const registro = await crearEntidad(entidad, datos, usuario.id);

    return respuesta.status(201).send({
      entidad,
      registro
    });
  });

  // -------------------------------------------------------------------------
  // E52 - PATCH /:entidad/:id: edicion
  // -------------------------------------------------------------------------
  app.patch<{ Params: { entidad: string; id: string } }>('/:entidad/:id', protegida, async (peticion, respuesta) => {
    const entidad = validarEntidad(peticion.params.entidad);
    const id = Number(peticion.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw error404('registro_no_encontrado', 'ID invalido.');
    }

    // F-22 (criterio 487): la existencia se verifica ANTES de validar el payload,
    // para que un id inexistente responda 404 y no 422 por un nombre corto.
    await obtenerEntidad(entidad, id);

    const datos = validarBody(entidad, peticion.body, true);
    const usuario = peticion.usuario!;

    const registro = await editarEntidad(entidad, id, datos, usuario.id);

    return respuesta.status(200).send({
      entidad,
      registro
    });
  });

  // -------------------------------------------------------------------------
  // E53 - POST /:entidad/:id/estado: activar/desactivar
  // -------------------------------------------------------------------------
  app.post<{ Params: { entidad: string; id: string } }>('/:entidad/:id/estado', protegida, async (peticion, respuesta) => {
    const entidad = validarEntidad(peticion.params.entidad);
    const id = Number(peticion.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw error404('registro_no_encontrado', 'ID invalido.');
    }

    const body = peticion.body as Record<string, unknown>;
    if (typeof body.activo !== 'boolean') {
      throw error422('payload_invalido', 'El campo activo es requerido y debe ser booleano.');
    }

    const usuario = peticion.usuario!;
    const resultado = await cambiarEstadoEntidad(entidad, id, body.activo, usuario.id);

    let aviso = '';
    if (!body.activo && Object.keys(resultado.hijos_activos).length > 0) {
      const partes: string[] = [];
      for (const [ent, count] of Object.entries(resultado.hijos_activos)) {
        const etiqueta = REGISTRO_ENTIDADES[ent as NombreEntidad]?.etiqueta ?? ent;
        partes.push(`${count} ${etiqueta.toLowerCase()}`);
      }
      aviso = `Se desactivó el registro. Sus ${partes.join(' y ')} siguen activos pero ya no serán seleccionables en ventanilla.`;
    }

    return respuesta.status(200).send({
      entidad,
      registro: resultado.registro,
      hijos_activos: resultado.hijos_activos,
      aviso
    });
  });

  // -------------------------------------------------------------------------
  // E54 - GET /referencias: opciones para selects
  // -------------------------------------------------------------------------
  app.get('/referencias', protegida, async (peticion, respuesta) => {
    const referencias = await obtenerReferencias();
    return respuesta.status(200).send(referencias);
  });
}
