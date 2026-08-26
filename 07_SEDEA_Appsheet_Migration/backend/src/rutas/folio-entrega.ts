// Endpoint para generar Folio de Entrega con QR (Build 12).
// GET /api/solicitudes/:id/folio-entrega.pdf
// El prefijo /api es obligatorio: nginx solo proxea /api/ y /media/.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generarFolioEntregaPdf } from '../servicios/folio-entrega.js';
import { ErrorApi } from '../plugins/errores.js';
import { obtenerSolicitud } from '../db/queries/solicitudes.js';
import { exigirAutorizacionSecretario } from './solicitudes.js';

export default async function rutasFolioEntrega(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/solicitudes/:id/folio-entrega.pdf',
    { preHandler: [app.autenticar] },
    async (peticion, respuesta) => {
      const id = Number((peticion.params as { id: string }).id);
      if (!id || isNaN(id)) {
        throw new ErrorApi(400, 'id_invalido', 'ID de solicitud inválido.');
      }

      // Mismo candado que la pantalla del folio: sin autorizacion capturada, el
      // PDF tampoco se emite (si no, bastaria pedir el .pdf para saltarselo).
      const solicitud = await obtenerSolicitud(id);
      if (!solicitud) throw new ErrorApi(404, 'no_encontrado', 'Solicitud no encontrada.');
      exigirAutorizacionSecretario(solicitud);

      try {
        const pdf = await generarFolioEntregaPdf(id);
        return respuesta
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="folio_${id}.pdf"`)
          .send(pdf);
      } catch (error) {
        if ((error as Error).message.includes('no encontrada')) {
          throw new ErrorApi(404, 'no_encontrado', 'Solicitud no encontrada.');
        }
        throw error;
      }
    }
  );
}
