// Digitalizacion V1 / Fase 2: generacion y reimpresion masiva de caratulas QR.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import {
  generarCaratulasDigitalizacionPdf,
  type DatosCaratulaDigitalizacion
} from '../servicios/caratulas-digitalizacion.js';

const error400 = (codigo: string, mensaje: string) => new ErrorApi(400, codigo, mensaje);
const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error404 = (mensaje: string) => new ErrorApi(404, 'no_encontrado', mensaje);

function enteroPositivo(valor: unknown): number | null {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function usuarioActual(peticion: FastifyRequest) {
  if (!peticion.usuario) throw errorNoAutorizado();
  return peticion.usuario;
}

interface FilaCaratula {
  solicitud_id: string;
  orden: number;
  folio: string;
  beneficiario: string;
  municipio: string;
  regional: string;
  lote_codigo: string;
  lote_nombre: string;
}

async function solicitudesAccesiblesDelLote(
  loteId: number,
  peticion: FastifyRequest
): Promise<FilaCaratula[]> {
  const regionalId = regionalForzada(usuarioActual(peticion));
  const valores: unknown[] = [loteId];
  const territorial = regionalId === null ? '' : 'AND m.regional_id = $2';
  if (regionalId !== null) valores.push(regionalId);

  const { rows } = await pool.query<FilaCaratula>(
    `SELECT
       s.id::text AS solicitud_id,
       dls.orden,
       s.folio,
       CASE
         WHEN s.tipo_persona IN ('moral','grupo')
          AND COALESCE(BTRIM(s.razon_social), '') <> ''
         THEN s.razon_social
         ELSE s.nombre_solicitante
       END AS beneficiario,
       m.nombre AS municipio,
       COALESCE(dr.nombre, '—') AS regional,
       dl.codigo AS lote_codigo,
       dl.nombre AS lote_nombre
     FROM digitalizacion_lotes dl
     JOIN digitalizacion_lote_solicitudes dls ON dls.lote_id = dl.id
     JOIN solicitudes s ON s.id = dls.solicitud_id
     JOIN municipios m ON m.id = s.ubi_municipio_id
     LEFT JOIN direcciones_regionales dr ON dr.id = m.regional_id
     WHERE dl.id = $1
       AND dl.estado <> 'cancelado'
       ${territorial}
     ORDER BY dls.orden`,
    valores
  );
  return rows;
}

async function asegurarQrPrincipales(
  solicitudIds: number[],
  usuarioId: number
): Promise<Map<number, string>> {
  return enTransaccion(async (cliente) => {
    const actuales = await cliente.query<{ solicitud_id: string; token: string }>(
      `SELECT solicitud_id::text, token::text
         FROM expediente_qr
        WHERE solicitud_id = ANY($1::bigint[])
          AND tipo = 'expediente'
          AND activo = TRUE`,
      [solicitudIds]
    );
    const existentes = new Set(actuales.rows.map((fila) => Number(fila.solicitud_id)));

    for (const solicitudId of solicitudIds) {
      if (existentes.has(solicitudId)) continue;
      await cliente.query(
        `INSERT INTO expediente_qr (
           solicitud_id, tipo, token, version, activo, creado_por
         ) VALUES ($1, 'expediente', $2::uuid, 1, TRUE, $3)
         ON CONFLICT (solicitud_id)
           WHERE tipo = 'expediente' AND activo = TRUE
         DO NOTHING`,
        [solicitudId, crypto.randomUUID(), usuarioId]
      );
    }

    const finales = await cliente.query<{ solicitud_id: string; token: string }>(
      `SELECT solicitud_id::text, token::text
         FROM expediente_qr
        WHERE solicitud_id = ANY($1::bigint[])
          AND tipo = 'expediente'
          AND activo = TRUE`,
      [solicitudIds]
    );
    if (finales.rows.length !== solicitudIds.length) {
      throw new Error('No fue posible resolver todos los QR principales del lote.');
    }

    return new Map(
      finales.rows.map((fila) => [Number(fila.solicitud_id), fila.token] as const)
    );
  });
}

function idsSolicitados(body: unknown): number[] | null {
  if (!body || typeof body !== 'object') return null;
  const valor = (body as Record<string, unknown>).solicitud_ids;
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) {
    throw error400('solicitudes_invalidas', 'solicitud_ids debe ser una lista de identificadores.');
  }
  const ids = [
    ...new Set(
      valor
        .map((item) => enteroPositivo(item))
        .filter((id): id is number => id !== null)
    )
  ];
  if (ids.length === 0) {
    throw error400('solicitudes_invalidas', 'Selecciona al menos una solicitud válida.');
  }
  return ids;
}

export default async function rutasDigitalizacionCaratulas(app: FastifyInstance): Promise<void> {
  const protegida = {
    preHandler: [
      app.autenticar,
      app.requiereRol('ventanilla', 'capturista', 'editor_datos', 'admin')
    ]
  };

  // Genera todas las caratulas del lote, o solo el subconjunto indicado.
  // Es POST porque, tras generar el PDF correctamente, se registra la fecha
  // de generacion y cambia el estado operativo de esas filas.
  app.post('/api/digitalizacion/lotes/:id/caratulas', protegida, async (peticion, respuesta) => {
    const usuario = usuarioActual(peticion);
    const loteId = enteroPositivo((peticion.params as { id?: string }).id);
    if (loteId === null) throw error404('Lote no encontrado.');

    const filasAccesibles = await solicitudesAccesiblesDelLote(loteId, peticion);
    if (filasAccesibles.length === 0) {
      throw error404('Lote no encontrado o fuera de tu alcance.');
    }

    const seleccion = idsSolicitados(peticion.body);
    const porId = new Map(filasAccesibles.map((fila) => [Number(fila.solicitud_id), fila]));
    const ids = seleccion ?? filasAccesibles.map((fila) => Number(fila.solicitud_id));

    if (ids.some((id) => !porId.has(id))) {
      throw error403(
        'fuera_de_alcance',
        'Una o más solicitudes no pertenecen al lote o están fuera de tu alcance.'
      );
    }
    // Proteccion del backend en memoria. Para lotes mayores la PWA podra
    // generar varios PDFs consecutivos sin perder la identidad QR.
    if (ids.length > 500) {
      throw error400(
        'demasiadas_caratulas',
        'Genera las carátulas en bloques de hasta 500 hojas por PDF.'
      );
    }

    const tokens = await asegurarQrPrincipales(ids, Number(usuario.id));
    const datos: DatosCaratulaDigitalizacion[] = ids
      .map((id) => porId.get(id)!)
      .sort((a, b) => Number(a.orden) - Number(b.orden))
      .map((fila) => ({
        solicitud_id: Number(fila.solicitud_id),
        folio: fila.folio,
        beneficiario: fila.beneficiario,
        municipio: fila.municipio,
        regional: fila.regional,
        lote_codigo: fila.lote_codigo,
        lote_nombre: fila.lote_nombre,
        token: tokens.get(Number(fila.solicitud_id))!
      }));

    // Solo despues de tener el PDF completo se marca caratula_generada.
    const pdf = await generarCaratulasDigitalizacionPdf(datos);

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE digitalizacion_lote_solicitudes
            SET estado = CASE
                  WHEN estado = 'digitalizado' THEN estado
                  ELSE 'caratula_generada'
                END,
                caratula_generada_en = now()
          WHERE lote_id = $1
            AND solicitud_id = ANY($2::bigint[])`,
        [loteId, ids]
      );

      await bitacoraEnTransaccion(cliente, {
        usuarioId: Number(usuario.id),
        accion: 'digitalizacion_caratulas_generadas',
        entidad: 'digitalizacion_lotes',
        entidadId: loteId,
        detalle: {
          solicitudes: ids.length,
          folios: datos.map((d) => d.folio)
        },
        ip: peticion.ip,
        userAgent: peticion.headers['user-agent'] ?? null
      });
    });

    const codigo = datos[0].lote_codigo.replace(/[^A-Za-z0-9_-]/g, '_');
    return respuesta
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="CARATULAS_${codigo}.pdf"`)
      .header('Cache-Control', 'no-store')
      .status(200)
      .send(pdf);
  });
}
