// Configuración de plazos para ingreso de solicitudes (Build 12).
// Endpoint para consultar el plazo vigente de captura de solicitudes.
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export default async function rutasConfiguracion(app: FastifyInstance): Promise<void> {
  app.get('/api/configuracion/plazo-solicitudes', async (_peticion, respuesta) => {
    const { rows } = await pool.query<{
      fecha_inicio: string;
      fecha_fin: string;
      activo: boolean;
    }>(
      `SELECT fecha_inicio, fecha_fin, activo
       FROM configuracion_plazos
       WHERE activo = true
       ORDER BY id DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      return respuesta.send({ activo: false });
    }

    const plazo = rows[0];
    const hoy = new Date();
    const fin = new Date(plazo.fecha_fin);
    const diasRestantes = Math.max(0, Math.ceil((fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)));

    respuesta.send({
      activo: true,
      fecha_inicio: plazo.fecha_inicio,
      fecha_fin: plazo.fecha_fin,
      dias_restantes: diasRestantes,
      vencido: diasRestantes === 0
    });
  });
}
