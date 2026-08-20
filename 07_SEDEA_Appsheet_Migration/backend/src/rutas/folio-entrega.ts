// Endpoint para generar Folio de Entrega con QR (Build 12).
// GET /api/solicitudes/:id/folio-entrega.pdf
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generarFolioEntregaPdf } from '../servicios/folio-entrega.js';
import { ErrorApi } from '../plugins/errores.js';

export default async function rutasFolioEntrega(app: FastifyInstance): Promise<void> {
  app.get(
    '/solicitudes/:id/folio-entrega.pdf',
    { preHandler: [app.autenticar] },
    async (peticion: FastifyRequest, respuesta: FastifyReply) => {
      const id = Number(peticion.params.id);
      if (!id || isNaN(id)) {
        throw new ErrorApi(400, 'id_invalido', 'ID de solicitud inválido.');
      }

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
