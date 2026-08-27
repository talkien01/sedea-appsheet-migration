// Endpoints para generar Folio de Entrega con QR (Build 12).
// GET  /api/solicitudes/:id/folio-entrega.pdf        (uno)
// POST /api/solicitudes/lote/folio-entrega.pdf       (lote del filtro actual)
// El prefijo /api es obligatorio: nginx solo proxea /api/ y /media/.
import type { FastifyInstance } from 'fastify';
import { esquemaConsultaBeneficiarios } from '@sedea/shared';
import { generarFolioEntregaPdf, generarFolioEntregaLotePdf } from '../servicios/folio-entrega.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { obtenerSolicitud } from '../db/queries/solicitudes.js';
import { consultar } from '../db/pool.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { exigirAutorizacionSecretario } from './solicitudes.js';
import { construirFiltrosBeneficiarios } from './beneficiarios.js';

/**
 * Tope de folios por peticion. Cada folio son dos hojas mas un QR renderizado,
 * asi que un filtro sin acotar (un padron entero) mantendria al proceso
 * dibujando miles de paginas en memoria y tumbaria la API para todos. 300 es
 * ~600 hojas: mas de lo que cabe en una charola de impresora, asi que el tope
 * tambien es razonable en la operacion real de la mesa de entrega.
 */
export const MAX_FOLIOS_LOTE = 300;

/** Mismos roles que el padron: la pantalla que dispara el lote es Beneficiarios. */
const ROLES_LOTE = ['capturista', 'auditor', 'ventanilla', 'admin'];

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

  // -------------------------------------------------------------------------
  // Impresion en lote de los folios del filtro ACTUAL del padron.
  //
  // Recibe el mismo filtro que el listado de beneficiarios (no una lista de
  // ids del cliente) y lo resuelve con `construirFiltrosBeneficiarios`, la
  // misma funcion que alimenta el listado y el CSV: asi el lote no puede
  // abarcar filas que el usuario no tiene en pantalla, y la Regional forzada
  // del actor se aplica en SQL — un ventanilla de la Regional 4 no imprime
  // folios de la 2 aunque mande `regional_id=2`.
  //
  // Los beneficiarios filtrados SIN autorizacion del Secretario se OMITEN del
  // documento en vez de abortarlo: en la mesa de entrega el operador filtra
  // por municipio, no por estado de autorizacion, y romper el lote entero por
  // un expediente pendiente obligaria a adivinar cual es. La respuesta declara
  // en cabeceras cuantos entraron y cuantos se omitieron.
  // -------------------------------------------------------------------------
  app.post(
    '/api/solicitudes/lote/folio-entrega.pdf',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_LOTE)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const q = esquemaConsultaBeneficiarios.parse(
        (peticion.body as Record<string, unknown> | undefined) ?? {}
      );
      const { where, parametros, regional } = construirFiltrosBeneficiarios(usuario, q);

      // Un beneficiario sin `solicitud_id` (padron importado que nunca paso por
      // ventanilla) no tiene folio de entrega que imprimir: no cuenta ni como
      // incluido ni como omitido por falta de firma.
      const filas = await consultar<{ solicitud_id: string; autorizada: boolean }>(
        `SELECT DISTINCT s.id AS solicitud_id, s.autorizada_secretario AS autorizada
           FROM beneficiarios b
           JOIN solicitudes s ON s.id = b.solicitud_id
           ${where}
          ORDER BY s.id`,
        parametros
      );

      const autorizadas = filas.filter((f) => f.autorizada === true).map((f) => Number(f.solicitud_id));
      const omitidas = filas.length - autorizadas.length;

      if (filas.length > MAX_FOLIOS_LOTE) {
        throw new ErrorApi(
          413,
          'lote_demasiado_grande',
          `El filtro actual abarca ${filas.length} beneficiarios y el máximo por impresión es ${MAX_FOLIOS_LOTE}. ` +
            'Acota el filtro (por municipio, colonia o sección) y vuelve a intentar.'
        );
      }

      if (autorizadas.length === 0) {
        throw new ErrorApi(
          409,
          'sin_folios_autorizados',
          omitidas > 0
            ? `Ninguno de los ${omitidas} beneficiarios del filtro tiene capturada la autorización del Secretario.`
            : 'El filtro actual no arroja beneficiarios con folio de entrega.'
        );
      }

      const { pdf, folios } = await generarFolioEntregaLotePdf(autorizadas);

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'export_pdf',
        entidad: 'solicitud',
        detalle: {
          tipo: 'lote_folio_entrega',
          incluidos: folios.length,
          omitidos: omitidas,
          regional_id: regional,
          filtros: q
        }
      });

      const nombre = `folios_entrega_${new Date().toISOString().slice(0, 10)}.pdf`;
      return respuesta
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${nombre}"`)
        // El navegador no puede leer el cuerpo del PDF para saber a quien se
        // omitio: el conteo viaja en cabeceras expuestas por CORS.
        .header('x-folios-incluidos', String(folios.length))
        .header('x-folios-omitidos', String(omitidas))
        .header('access-control-expose-headers', 'x-folios-incluidos, x-folios-omitidos')
        .send(pdf);
    }
  );
}
