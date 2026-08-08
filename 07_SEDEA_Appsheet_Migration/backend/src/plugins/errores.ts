// Manejo uniforme de errores: siempre {"error":{"codigo","mensaje"}}.
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** Error de negocio con codigo HTTP y codigo de aplicacion. */
export class ErrorApi extends Error {
  estado: number;
  codigo: string;
  detalles?: unknown;

  constructor(estado: number, codigo: string, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const errorNoAutorizado = (mensaje = 'No autorizado.') =>
  new ErrorApi(401, 'no_autorizado', mensaje);
export const errorProhibido = (mensaje = 'No tienes permiso para esta operacion.') =>
  new ErrorApi(403, 'prohibido', mensaje);
export const errorNoEncontrado = (mensaje = 'Recurso no encontrado.') =>
  new ErrorApi(404, 'no_encontrado', mensaje);
export const errorValidacion = (mensaje = 'Datos invalidos.', detalles?: unknown) =>
  new ErrorApi(422, 'validacion', mensaje, detalles);

async function plugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, peticion, respuesta) => {
    if (error instanceof ErrorApi) {
      return respuesta.status(error.estado).send({
        error: { codigo: error.codigo, mensaje: error.message, detalles: error.detalles }
      });
    }

    if (error instanceof ZodError) {
      return respuesta.status(422).send({
        error: {
          codigo: 'validacion',
          mensaje: 'Datos invalidos.',
          detalles: error.issues.map((i) => ({
            campo: i.path.join('.'),
            mensaje: i.message
          }))
        }
      });
    }

    const cualquiera = error as any;

    // Errores de @fastify/jwt
    if (typeof cualquiera.code === 'string' && cualquiera.code.startsWith('FST_JWT')) {
      return respuesta.status(401).send({
        error: { codigo: 'no_autorizado', mensaje: 'Token invalido o expirado.' }
      });
    }

    // Limite de tamano de archivo de @fastify/multipart
    if (cualquiera.code === 'FST_REQ_FILE_TOO_LARGE') {
      return respuesta.status(422).send({
        error: { codigo: 'validacion', mensaje: 'La foto excede el tamano maximo permitido.' }
      });
    }

    if (cualquiera.statusCode === 429) {
      return respuesta.status(429).send({
        error: { codigo: 'limite_peticiones', mensaje: 'Demasiadas peticiones. Intenta mas tarde.' }
      });
    }

    if (cualquiera.statusCode && cualquiera.statusCode < 500) {
      return respuesta.status(cualquiera.statusCode).send({
        error: { codigo: 'peticion_invalida', mensaje: error.message }
      });
    }

    peticion.log.error({ err: error }, 'Error no controlado');
    return respuesta.status(500).send({
      error: { codigo: 'error_interno', mensaje: 'Error interno del servidor.' }
    });
  });

  app.setNotFoundHandler((_peticion, respuesta) => {
    respuesta.status(404).send({
      error: { codigo: 'no_encontrado', mensaje: 'Ruta no encontrada.' }
    });
  });
}

export default fp(plugin, { name: 'errores' });
