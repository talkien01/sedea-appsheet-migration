// Endpoint publico de salud: verifica conexion a la base y version de PostGIS.
import type { FastifyInstance } from 'fastify';
import { consultarUna } from '../db/pool.js';

export default async function rutasSalud(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_peticion, respuesta) => {
    let db = false;
    let postgis = '';
    try {
      const fila = await consultarUna<{ version: string }>(
        'SELECT postgis_lib_version() AS version'
      );
      db = true;
      postgis = fila?.version ?? '';
    } catch (error) {
      app.log.error({ err: error }, 'Health check con base de datos caida');
    }
    return respuesta.status(200).send({ ok: true, db, postgis });
  });
}
