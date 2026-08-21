// Modulo de pre-dictaminacion y dictamen (E55-E59, Build 13).
//
// Reglas transversales:
//  - Todos los endpoints exigen rol `dictaminador` o `admin` (multi-rol ya
//    soportado por requiereRol).
//  - El dictaminador ve TODAS las regionales: aqui no se aplica
//    regionalForzada ni leerAlcance (A19-6).
//  - La IA NUNCA aprueba sola (D19-8): el unico camino que escribe en
//    `dictamenes` es E58, con `resultado` explicito de un humano autenticado.
//  - No existe ningun endpoint de expediente: los archivos se suben con E46 y
//    se leen desde /media/** (servido con token por server.ts).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { ErrorApi } from '../plugins/errores.js';
import { pool } from '../db/pool.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import { predictaminarLote } from '../servicios/predictamen.js';
import { driverIa } from '../servicios/ia/cliente.js';
import {
  bandejaDictamen,
  detalleDictamen,
  documentosRequeridosDeSolicitud,
  metricasDictamen,
  ultimoPredictamen,
  type FiltroEstadoBandeja
} from '../db/queries/dictamen.js';

const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);
const error404 = (mensaje: string) => new ErrorApi(404, 'no_encontrado', mensaje);

/** Techo duro del lote (D19-9). */
const MAX_LOTE = 20;

const esquemaPredictaminar = z
  .object({
    solicitud_ids: z.array(z.number().int().positive()).min(1).max(MAX_LOTE)
  })
  .strict();

const ESTADOS_BANDEJA: FiltroEstadoBandeja[] = [
  'negativo',
  'positivo',
  'error',
  'sin_predictamen',
  'dictaminadas',
  'todas'
];

const esquemaConfirmar = z
  .object({
    resultado: z.enum(['positivo', 'negativo']),
    nota: z.string().max(2000).nullable().optional(),
    detalle: z
      .array(
        z.object({
          documento_requerido_id: z.number().int().positive(),
          veredicto: z.enum(['ok', 'falta', 'ilegible'])
        })
      )
      .optional()
      .default([])
  })
  // El cliente NO decide predictamen_id ni coincide_con_ia: si los manda, se
  // ignoran en silencio (por eso no es .strict()).
  .passthrough();

export default async function rutasDictamen(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, app.requiereRol('dictaminador', 'admin')] };

  const usuarioDe = (peticion: FastifyRequest) => peticion.usuario!;
  const ipDe = (peticion: FastifyRequest) => peticion.ip;
  const agenteDe = (peticion: FastifyRequest) =>
    (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;

  // -------------------------------------------------------------------------
  // E55 - Pre-dictaminar un lote de solicitudes (disparo MANUAL, D19-4).
  // -------------------------------------------------------------------------
  app.post(
    '/api/dictamen/predictaminar',
    // El lote es sincrono (A19-10): 20 solicitudes con concurrencia 3x3 pueden
    // tardar ~2 min. No hace falta subir ningun timeout: Fastify v4 arranca con
    // `requestTimeout: 0` (sin limite), muy por encima de los 300 s del SPEC.
    protegida,
    async (peticion: FastifyRequest, respuesta: FastifyReply) => {
      const usuario = usuarioDe(peticion);

      const parseado = esquemaPredictaminar.safeParse(peticion.body);
      if (!parseado.success) {
        throw error422(
          'payload_invalido',
          `Envía entre 1 y ${MAX_LOTE} identificadores de solicitud.`
        );
      }
      const ids = [...new Set(parseado.data.solicitud_ids)];
      if (ids.length !== parseado.data.solicitud_ids.length) {
        throw error422('payload_invalido', 'La lista de solicitudes tiene identificadores repetidos.');
      }

      // Un driver real sin credenciales no puede operar: 503 explicito, no un
      // pre-dictamen falso. `anthropic` -> sin ANTHROPIC_API_KEY;
      // `openai_compatible` -> sin PREDICTAMEN_API_KEY o sin
      // PREDICTAMEN_API_BASE_URL. El driver `simulado` siempre esta disponible.
      if (!driverIa().disponible()) {
        throw new ErrorApi(
          503,
          'ia_no_configurada',
          'La pre-dictaminación con IA no está configurada en este servidor.'
        );
      }

      const resultados = await predictaminarLote(ids, usuario.id);

      await enTransaccion(async (cliente) => {
        for (const resultado of resultados) {
          await bitacoraEnTransaccion(cliente, {
            usuarioId: usuario.id,
            accion: 'predictamen_generado',
            entidad: 'solicitud',
            entidadId: resultado.solicitud_id,
            detalle: {
              predictamen_id: resultado.predictamen_id,
              estado: resultado.estado,
              documentos_evaluados: resultado.documentos_evaluados,
              documentos_con_archivo: resultado.documentos_con_archivo
            },
            ip: ipDe(peticion),
            userAgent: agenteDe(peticion)
          });
        }
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'predictamen_lote',
          entidad: 'dictamen',
          entidadId: 0,
          detalle: { total: resultados.length, solicitud_ids: ids },
          ip: ipDe(peticion),
          userAgent: agenteDe(peticion)
        });
      });

      return respuesta.status(200).send({ ok: true, resultados });
    }
  );

  // -------------------------------------------------------------------------
  // E56 - Bandeja priorizada (orden fijo D19-7).
  // -------------------------------------------------------------------------
  app.get<{
    Querystring: { pagina?: string; por_pagina?: string; estado?: string; q?: string };
  }>('/api/dictamen/bandeja', protegida, async (peticion, respuesta) => {
    const consulta = peticion.query;
    const estado = ESTADOS_BANDEJA.includes(consulta.estado as FiltroEstadoBandeja)
      ? (consulta.estado as FiltroEstadoBandeja)
      : 'todas';

    const resultado = await bandejaDictamen({
      pagina: Number(consulta.pagina) > 0 ? Number(consulta.pagina) : 1,
      porPagina: Number(consulta.por_pagina) > 0 ? Number(consulta.por_pagina) : 25,
      estado,
      q: consulta.q ?? null
    });

    return respuesta.send(resultado);
  });

  // -------------------------------------------------------------------------
  // E59 - Metricas de la cabecera. Va ANTES de /:solicitudId para que
  // "metricas" no se interprete como un id.
  // -------------------------------------------------------------------------
  app.get('/api/dictamen/metricas', protegida, async (_peticion, respuesta) => {
    return respuesta.send(await metricasDictamen());
  });

  // -------------------------------------------------------------------------
  // E57 - Detalle de una solicitud para dictaminar.
  // -------------------------------------------------------------------------
  app.get<{ Params: { solicitudId: string } }>(
    '/api/dictamen/:solicitudId',
    protegida,
    async (peticion, respuesta) => {
      const solicitudId = Number(peticion.params.solicitudId);
      if (!Number.isInteger(solicitudId) || solicitudId <= 0) {
        throw error404('La solicitud no existe.');
      }
      const detalle = await detalleDictamen(solicitudId);
      if (!detalle) throw error404('La solicitud no existe.');
      return respuesta.send(detalle);
    }
  );

  // -------------------------------------------------------------------------
  // E58 - Confirmacion HUMANA del dictamen. Unico camino que escribe en
  // `dictamenes`: `resultado` es obligatorio y explicito (D19-8).
  // -------------------------------------------------------------------------
  app.post<{ Params: { solicitudId: string } }>(
    '/api/dictamen/:solicitudId/confirmar',
    protegida,
    async (peticion, respuesta) => {
      const usuario = usuarioDe(peticion);
      const solicitudId = Number(peticion.params.solicitudId);
      if (!Number.isInteger(solicitudId) || solicitudId <= 0) {
        throw error404('La solicitud no existe.');
      }

      const { rows: existe } = await pool.query<{ id: number }>(
        'SELECT id FROM solicitudes WHERE id = $1',
        [solicitudId]
      );
      if (existe.length === 0) throw error404('La solicitud no existe.');

      const parseado = esquemaConfirmar.safeParse(peticion.body);
      if (!parseado.success) {
        throw error422('payload_invalido', 'Elige un resultado: positivo o negativo.');
      }
      const cuerpo = parseado.data;

      const nota = typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : null;
      if (cuerpo.resultado === 'negativo' && (nota === null || nota.length < 10)) {
        throw error422(
          'nota_requerida',
          'Un dictamen negativo necesita una nota de al menos 10 caracteres.'
        );
      }

      const permitidos = await documentosRequeridosDeSolicitud(solicitudId);
      for (const item of cuerpo.detalle) {
        if (!permitidos.has(item.documento_requerido_id)) {
          throw error422(
            'documento_no_pertenece',
            'Uno de los documentos no pertenece al checklist de esta solicitud.'
          );
        }
      }

      // Se liga SIEMPRE al ultimo pre-dictamen y `coincide_con_ia` se calcula
      // en el servidor; lo que mande el cliente se ignora.
      const predictamen = await ultimoPredictamen(solicitudId);
      const predictamenId = predictamen ? Number(predictamen.id) : null;
      const coincideConIa = predictamen ? cuerpo.resultado === predictamen.estado : null;

      const dictamen = await enTransaccion(async (cliente) => {
        const { rows } = await cliente.query<{
          id: number;
          solicitud_id: number;
          resultado: string;
          nota: string | null;
          coincide_con_ia: boolean | null;
          dictaminado_en: string;
          dictaminado_por: number;
        }>(
          `INSERT INTO dictamenes
             (solicitud_id, resultado, nota, detalle, predictamen_id, coincide_con_ia, dictaminado_por)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
           RETURNING id, solicitud_id, resultado, nota, coincide_con_ia, dictaminado_en, dictaminado_por`,
          [
            solicitudId,
            cuerpo.resultado,
            nota,
            JSON.stringify(cuerpo.detalle),
            predictamenId,
            coincideConIa,
            usuario.id
          ]
        );

        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'dictamen_confirmado',
          entidad: 'solicitud',
          entidadId: solicitudId,
          detalle: {
            dictamen_id: rows[0].id,
            resultado: cuerpo.resultado,
            predictamen_id: predictamenId,
            coincide_con_ia: coincideConIa
          },
          ip: ipDe(peticion),
          userAgent: agenteDe(peticion)
        });

        return rows[0];
      });

      return respuesta.status(201).send({ ok: true, dictamen });
    }
  );
}
