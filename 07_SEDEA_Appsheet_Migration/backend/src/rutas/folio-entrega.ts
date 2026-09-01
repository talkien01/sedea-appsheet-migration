// Endpoints para generar Folio de Entrega con QR.
// GET  /api/solicitudes/:id/folio-entrega.pdf
// POST /api/solicitudes/lote/folio-entrega.pdf
import type { FastifyInstance } from 'fastify';
import { esquemaConsultaBeneficiarios } from '@sedea/shared';
import { generarFolioEntregaPdf, generarFolioEntregaLotePdf } from '../servicios/folio-entrega.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { obtenerSolicitud } from '../db/queries/solicitudes.js';
import { consultar } from '../db/pool.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { conceptosAutorizadosDeFacto } from '../servicios/autorizacion-operativa.js';
import { exigirAutorizacionSecretario } from './solicitudes.js';
import { construirFiltrosBeneficiarios } from './beneficiarios.js';

/**
 * Protección contra peticiones enormes de clientes viejos que no mandan
 * page/page_size. La PWA nueva trabaja normalmente en lotes de 50 o 100.
 */
export const MAX_FOLIOS_LOTE = 300;

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

      const solicitud = await obtenerSolicitud(id);
      if (!solicitud) throw new ErrorApi(404, 'no_encontrado', 'Solicitud no encontrada.');

      // Avena (160) y Garbanzo (161) están autorizados de facto por regla
      // operativa. No se altera el campo autorizada_secretario ni se atribuye
      // esa decisión al Secretario; simplemente no aplica el candado.
      if (solicitud.autorizada_secretario !== true) {
        const conceptos = await consultar<{ tipo_apoyo_id: string | number }>(
          'SELECT tipo_apoyo_id FROM solicitud_conceptos WHERE solicitud_id = $1 ORDER BY orden',
          [id]
        );
        if (!conceptosAutorizadosDeFacto(conceptos)) {
          exigirAutorizacionSecretario(solicitud);
        }
      }

      try {
        const pdf = await generarFolioEntregaPdf(id);
        return respuesta
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename=\"folio_${id}.pdf\"`)
          .send(pdf);
      } catch (error) {
        if ((error as Error).message.includes('no encontrada')) {
          throw new ErrorApi(404, 'no_encontrado', 'Solicitud no encontrada.');
        }
        throw error;
      }
    }
  );

  app.post(
    '/api/solicitudes/lote/folio-entrega.pdf',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_LOTE)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const cuerpo = (peticion.body as Record<string, unknown> | undefined) ?? {};
      const paginacionSolicitada =
        Object.prototype.hasOwnProperty.call(cuerpo, 'page') ||
        Object.prototype.hasOwnProperty.call(cuerpo, 'page_size');

      const q = esquemaConsultaBeneficiarios.parse(cuerpo);
      const { where, parametros, regional } = construirFiltrosBeneficiarios(usuario, q);

      const filas = await consultar<{
        solicitud_id: string;
        autorizada: boolean;
        tipos_apoyo_ids: Array<string | number>;
      }>(
        `SELECT DISTINCT s.id AS solicitud_id,
                s.autorizada_secretario AS autorizada,
                ARRAY(
                  SELECT sc.tipo_apoyo_id
                    FROM solicitud_conceptos sc
                   WHERE sc.solicitud_id = s.id
                   ORDER BY sc.orden
                ) AS tipos_apoyo_ids
           FROM beneficiarios b
           JOIN solicitudes s ON s.id = b.solicitud_id
           ${where}
          ORDER BY s.id`,
        parametros
      );

      if (!paginacionSolicitada && filas.length > MAX_FOLIOS_LOTE) {
        throw new ErrorApi(
          413,
          'lote_demasiado_grande',
          `El filtro actual abarca ${filas.length} beneficiarios y el máximo por impresión es ${MAX_FOLIOS_LOTE}. ` +
            'Usa la impresión por lotes de 50 o 100 folios.'
        );
      }

      // Compatibilidad: clientes anteriores siguen imprimiendo todo el filtro
      // (hasta MAX_FOLIOS_LOTE). La PWA nueva manda page/page_size y recibe
      // solamente el bloque pedido.
      const tamanoLote = paginacionSolicitada
        ? Math.min(MAX_FOLIOS_LOTE, Math.max(1, Number(q.page_size)))
        : filas.length;
      const paginaLote = paginacionSolicitada ? Math.max(1, Number(q.page)) : 1;
      const inicio = paginacionSolicitada ? (paginaLote - 1) * tamanoLote : 0;
      const filasLote = paginacionSolicitada ? filas.slice(inicio, inicio + tamanoLote) : filas;

      if (filasLote.length === 0) {
        throw new ErrorApi(
          409,
          'lote_fuera_de_rango',
          `El lote ${paginaLote} no contiene beneficiarios con el filtro actual.`
        );
      }

      const esAutorizadaOperativamente = (fila: typeof filasLote[number]) =>
        fila.autorizada === true ||
        conceptosAutorizadosDeFacto(
          (fila.tipos_apoyo_ids ?? []).map((tipo_apoyo_id) => ({ tipo_apoyo_id }))
        );

      const autorizadas = filasLote
        .filter(esAutorizadaOperativamente)
        .map((f) => Number(f.solicitud_id));
      const autorizadasDeFacto = filasLote.filter(
        (f) => f.autorizada !== true && esAutorizadaOperativamente(f)
      ).length;
      const omitidas = filasLote.length - autorizadas.length;

      if (autorizadas.length === 0) {
        throw new ErrorApi(
          409,
          'sin_folios_autorizados',
          omitidas > 0
            ? `Ninguno de los ${omitidas} beneficiarios de este lote tiene autorización aplicable para entrega.`
            : 'Este lote no arroja beneficiarios con folio de entrega.'
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
          autorizados_de_facto: autorizadasDeFacto,
          omitidos: omitidas,
          total_filtrado: filas.length,
          lote: paginaLote,
          tamano_lote: tamanoLote,
          regional_id: regional,
          filtros: q
        }
      });

      const fecha = new Date().toISOString().slice(0, 10);
      const nombre = paginacionSolicitada
        ? `folios_entrega_lote_${String(paginaLote).padStart(2, '0')}_${fecha}.pdf`
        : `folios_entrega_${fecha}.pdf`;

      return respuesta
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename=\"${nombre}\"`)
        .header('x-folios-incluidos', String(folios.length))
        .header('x-folios-omitidos', String(omitidas))
        .header('x-folios-autorizados-de-facto', String(autorizadasDeFacto))
        .header('x-folios-total-filtrado', String(filas.length))
        .header('x-lote-pagina', String(paginaLote))
        .header('x-lote-tamano', String(tamanoLote))
        .header(
          'access-control-expose-headers',
          'x-folios-incluidos, x-folios-omitidos, x-folios-autorizados-de-facto, x-folios-total-filtrado, x-lote-pagina, x-lote-tamano'
        )
        .send(pdf);
    }
  );
}
