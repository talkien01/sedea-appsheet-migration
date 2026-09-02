// Conciliacion posterior de recibos fisicos regresados por los camiones.
//
// Flujo:
//   1) crear lote por municipio/camion (y opcionalmente tipo de apoyo),
//   2) subir el PDF multipagina generado por el ADF,
//   3) rasterizar cada pagina y leer su QR sin OCR,
//   4) resolver el folio contra solicitudes y congelar kg/costales,
//   5) corregir manualmente las paginas cuyo QR no se pudo leer,
//   6) cerrar el lote cuando no queden pendientes.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { consultar, consultarUna, pool } from '../db/pool.js';
import {
  ErrorApi,
  errorNoAutorizado,
  errorNoEncontrado,
  errorProhibido,
  errorValidacion
} from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { regionalForzada } from '../plugins/rbac.js';
import { guardarPdfConciliacion } from '../servicios/almacenamiento.js';
import { leerQrDePdf } from '../servicios/qr-recibos.js';

const ROLES_CONCILIACION = ['capturista', 'admin'] as const;
const KG_POR_COSTAL = 25;
const MAX_PAGINAS_PDF = 300;

type EstadoPagina =
  | 'conciliada'
  | 'sin_qr'
  | 'varios_qr'
  | 'folio_no_encontrado'
  | 'municipio_distinto'
  | 'sin_concepto_lote'
  | 'duplicada'
  | 'pendiente_manual'
  | 'error';

interface LoteDb {
  id: number;
  municipio_id: number;
  regional_id: number;
  camion: string;
  tipo_apoyo_id: number | null;
  estado: 'abierto' | 'cerrado';
  pdf_url: string | null;
  pdf_hash: string | null;
  pdf_bytes: number | null;
  paginas_pdf: number | null;
  creado_por: number;
  cerrado_por: number | null;
  creado_en: string;
  actualizado_en: string;
  cerrado_en: string | null;
  municipio_nombre: string;
  regional_nombre: string;
  tipo_apoyo_nombre: string | null;
}

interface ConceptoDb {
  id: number;
  tipo_apoyo_id: number;
  tipo_apoyo_nombre: string;
  cantidad: number;
  unidad_medida: string | null;
}

interface ResultadoPagina {
  pagina: number;
  estado: EstadoPagina;
  folio: string | null;
  mensaje: string | null;
}

const esquemaNuevoLote = z.object({
  municipio_id: z.coerce.number().int().positive(),
  camion: z.string().trim().min(1).max(100),
  tipo_apoyo_id: z
    .union([z.coerce.number().int().positive(), z.null()])
    .optional()
    .transform((v) => v ?? null)
});

const esquemaManual = z.object({
  folio: z.string().trim().min(1).max(100)
});

function normalizarFolio(valor: string): string {
  return valor.trim().toUpperCase();
}

function esUnidadKg(unidad: string | null | undefined): boolean {
  const limpia = (unidad ?? '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '');
  return ['KG', 'KGS', 'KILOGRAMO', 'KILOGRAMOS'].includes(limpia);
}

function snapshotCantidad(cantidad: number, unidad: string | null): {
  cantidadKg: number | null;
  costales: number | null;
} {
  if (!esUnidadKg(unidad) || !Number.isFinite(cantidad) || cantidad <= 0) {
    return { cantidadKg: null, costales: null };
  }
  const calculados = cantidad / KG_POR_COSTAL;
  const entero = Math.round(calculados);
  return {
    cantidadKg: cantidad,
    costales: Math.abs(calculados - entero) < 1e-9 ? entero : null
  };
}

async function cargarLote(id: number, usuario: any): Promise<LoteDb> {
  const lote = await consultarUna<LoteDb>(
    `SELECT l.*, m.nombre AS municipio_nombre, dr.nombre AS regional_nombre,
            ta.nombre AS tipo_apoyo_nombre
       FROM conciliacion_lotes l
       JOIN municipios m ON m.id = l.municipio_id
       JOIN direcciones_regionales dr ON dr.id = l.regional_id
       LEFT JOIN tipos_apoyo ta ON ta.id = l.tipo_apoyo_id
      WHERE l.id = $1`,
    [id]
  );
  if (!lote) throw errorNoEncontrado('El lote de conciliacion no existe.');

  const forzada = regionalForzada(usuario);
  if (forzada !== null && Number(lote.regional_id) !== forzada) {
    throw errorProhibido('El lote pertenece a otra Direccion Regional.');
  }
  return lote;
}

async function guardarEstadoPagina(
  loteId: number,
  pagina: number,
  estado: EstadoPagina,
  qrText: string | null,
  folio: string | null,
  mensaje: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO conciliacion_paginas
       (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lote_id, pagina) DO UPDATE
       SET estado = EXCLUDED.estado,
           qr_text = EXCLUDED.qr_text,
           folio_detectado = EXCLUDED.folio_detectado,
           mensaje = EXCLUDED.mensaje,
           actualizado_en = now()`,
    [loteId, pagina, estado, qrText, folio, mensaje]
  );
}

/**
 * Decide que texto QR usar. El recibo tiene el mismo QR arriba y abajo, por lo
 * que duplicados del mismo texto ya llegan eliminados. Si una pagina contiene
 * varios QR diferentes, solo se acepta automaticamente cuando exactamente uno
 * corresponde a un folio real de SISPACQ.
 */
async function elegirFolioDeQrs(qrsOriginales: string[]): Promise<{
  folio: string | null;
  estado?: EstadoPagina;
  mensaje?: string;
}> {
  const qrs = Array.from(new Set(qrsOriginales.map(normalizarFolio).filter(Boolean)));
  if (qrs.length === 0) return { folio: null, estado: 'sin_qr', mensaje: 'No se detecto QR.' };
  if (qrs.length === 1) return { folio: qrs[0] };

  const conocidos = await consultar<{ folio: string }>(
    'SELECT folio FROM solicitudes WHERE folio = ANY($1::text[]) ORDER BY folio',
    [qrs]
  );
  if (conocidos.length === 1) return { folio: conocidos[0].folio };
  return {
    folio: null,
    estado: 'varios_qr',
    mensaje: `Se detectaron ${qrs.length} QR distintos en la misma pagina.`
  };
}

async function conciliarFolio(
  lote: LoteDb,
  pagina: number,
  folioOriginal: string,
  origen: 'qr' | 'manual',
  qrText: string | null,
  usuarioId: number
): Promise<ResultadoPagina> {
  const folio = normalizarFolio(folioOriginal);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const solicitudResultado = await cliente.query<{
      id: number;
      folio: string;
      ubi_municipio_id: number;
    }>(
      `SELECT id, folio, ubi_municipio_id
         FROM solicitudes
        WHERE folio = $1
        FOR SHARE`,
      [folio]
    );
    const solicitud = solicitudResultado.rows[0];

    if (!solicitud) {
      await cliente.query(
        `INSERT INTO conciliacion_paginas
           (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
         VALUES ($1, $2, 'folio_no_encontrado', $3, $4, $5)
         ON CONFLICT (lote_id, pagina) DO UPDATE
           SET estado = 'folio_no_encontrado', qr_text = EXCLUDED.qr_text,
               folio_detectado = EXCLUDED.folio_detectado,
               mensaje = EXCLUDED.mensaje, actualizado_en = now()`,
        [lote.id, pagina, qrText, folio, 'El folio no existe en SISPACQ.']
      );
      await cliente.query('COMMIT');
      return { pagina, estado: 'folio_no_encontrado', folio, mensaje: 'El folio no existe en SISPACQ.' };
    }

    if (Number(solicitud.ubi_municipio_id) !== Number(lote.municipio_id)) {
      const mensaje = `El folio pertenece a otro municipio; este lote es ${lote.municipio_nombre}.`;
      await cliente.query(
        `INSERT INTO conciliacion_paginas
           (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
         VALUES ($1, $2, 'municipio_distinto', $3, $4, $5)
         ON CONFLICT (lote_id, pagina) DO UPDATE
           SET estado = 'municipio_distinto', qr_text = EXCLUDED.qr_text,
               folio_detectado = EXCLUDED.folio_detectado,
               mensaje = EXCLUDED.mensaje, actualizado_en = now()`,
        [lote.id, pagina, qrText, solicitud.folio, mensaje]
      );
      await cliente.query('COMMIT');
      return { pagina, estado: 'municipio_distinto', folio: solicitud.folio, mensaje };
    }

    const parametrosConcepto: unknown[] = [solicitud.id];
    let filtroTipo = '';
    if (lote.tipo_apoyo_id !== null) {
      parametrosConcepto.push(lote.tipo_apoyo_id);
      filtroTipo = `AND sc.tipo_apoyo_id = $${parametrosConcepto.length}`;
    }
    const conceptosResultado = await cliente.query<ConceptoDb>(
      `SELECT sc.id, sc.tipo_apoyo_id, ta.nombre AS tipo_apoyo_nombre,
              sc.cantidad::float8 AS cantidad,
              COALESCE(sc.unidad_medida, ta.unidad_medida) AS unidad_medida
         FROM solicitud_conceptos sc
         JOIN tipos_apoyo ta ON ta.id = sc.tipo_apoyo_id
        WHERE sc.solicitud_id = $1
          ${filtroTipo}
        ORDER BY sc.orden`,
      parametrosConcepto as any[]
    );
    const conceptos = conceptosResultado.rows;

    if (conceptos.length === 0) {
      const mensaje = lote.tipo_apoyo_nombre
        ? `El folio no tiene el apoyo ${lote.tipo_apoyo_nombre}.`
        : 'El folio no tiene conceptos de apoyo registrados.';
      await cliente.query(
        `INSERT INTO conciliacion_paginas
           (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
         VALUES ($1, $2, 'sin_concepto_lote', $3, $4, $5)
         ON CONFLICT (lote_id, pagina) DO UPDATE
           SET estado = 'sin_concepto_lote', qr_text = EXCLUDED.qr_text,
               folio_detectado = EXCLUDED.folio_detectado,
               mensaje = EXCLUDED.mensaje, actualizado_en = now()`,
        [lote.id, pagina, qrText, solicitud.folio, mensaje]
      );
      await cliente.query('COMMIT');
      return { pagina, estado: 'sin_concepto_lote', folio: solicitud.folio, mensaje };
    }

    const idsConceptos = conceptos.map((c) => Number(c.id));
    const duplicados = await cliente.query<{
      solicitud_concepto_id: number;
      lote_id: number;
      camion: string;
    }>(
      `SELECT crc.solicitud_concepto_id, l.id AS lote_id, l.camion
         FROM conciliacion_recibo_conceptos crc
         JOIN conciliacion_recibos r ON r.id = crc.recibo_id
         JOIN conciliacion_lotes l ON l.id = r.lote_id
        WHERE crc.solicitud_concepto_id = ANY($1::bigint[])`,
      [idsConceptos]
    );
    if (duplicados.rows.length > 0) {
      const primero = duplicados.rows[0];
      const mensaje = `El apoyo de este folio ya fue conciliado en el lote ${primero.lote_id} (${primero.camion}).`;
      await cliente.query(
        `INSERT INTO conciliacion_paginas
           (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
         VALUES ($1, $2, 'duplicada', $3, $4, $5)
         ON CONFLICT (lote_id, pagina) DO UPDATE
           SET estado = 'duplicada', qr_text = EXCLUDED.qr_text,
               folio_detectado = EXCLUDED.folio_detectado,
               mensaje = EXCLUDED.mensaje, actualizado_en = now()`,
        [lote.id, pagina, qrText, solicitud.folio, mensaje]
      );
      await cliente.query('COMMIT');
      return { pagina, estado: 'duplicada', folio: solicitud.folio, mensaje };
    }

    const paginaResultado = await cliente.query<{ id: number }>(
      `INSERT INTO conciliacion_paginas
         (lote_id, pagina, estado, qr_text, folio_detectado, mensaje)
       VALUES ($1, $2, 'conciliada', $3, $4, NULL)
       ON CONFLICT (lote_id, pagina) DO UPDATE
         SET estado = 'conciliada', qr_text = EXCLUDED.qr_text,
             folio_detectado = EXCLUDED.folio_detectado,
             mensaje = NULL, actualizado_en = now()
       RETURNING id`,
      [lote.id, pagina, qrText, solicitud.folio]
    );
    const paginaId = Number(paginaResultado.rows[0].id);

    const reciboResultado = await cliente.query<{ id: number }>(
      `INSERT INTO conciliacion_recibos
         (lote_id, pagina_id, solicitud_id, folio, origen, conciliado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [lote.id, paginaId, solicitud.id, solicitud.folio, origen, usuarioId]
    );
    const reciboId = Number(reciboResultado.rows[0].id);

    for (const concepto of conceptos) {
      const cantidad = Number(concepto.cantidad);
      const snapshot = snapshotCantidad(cantidad, concepto.unidad_medida);
      await cliente.query(
        `INSERT INTO conciliacion_recibo_conceptos
           (recibo_id, solicitud_concepto_id, tipo_apoyo_id, cantidad,
            unidad_medida, cantidad_kg, costales)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reciboId,
          concepto.id,
          concepto.tipo_apoyo_id,
          cantidad,
          concepto.unidad_medida,
          snapshot.cantidadKg,
          snapshot.costales
        ]
      );
    }

    await cliente.query('COMMIT');
    return { pagina, estado: 'conciliada', folio: solicitud.folio, mensaje: null };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    const pg = error as { code?: string };
    if (pg.code === '23505') {
      const mensaje = 'El recibo o alguno de sus conceptos ya fue conciliado.';
      await guardarEstadoPagina(lote.id, pagina, 'duplicada', qrText, folio, mensaje);
      return { pagina, estado: 'duplicada', folio, mensaje };
    }
    throw error;
  } finally {
    cliente.release();
  }
}

async function procesarPaginaQr(
  lote: LoteDb,
  pagina: number,
  qrs: string[],
  usuarioId: number
): Promise<ResultadoPagina> {
  const eleccion = await elegirFolioDeQrs(qrs);
  if (!eleccion.folio) {
    const estado = eleccion.estado ?? 'sin_qr';
    const qrText = qrs.length > 0 ? qrs.join(' | ').slice(0, 1000) : null;
    await guardarEstadoPagina(
      lote.id,
      pagina,
      estado,
      qrText,
      null,
      eleccion.mensaje ?? 'No fue posible identificar el folio.'
    );
    return {
      pagina,
      estado,
      folio: null,
      mensaje: eleccion.mensaje ?? 'No fue posible identificar el folio.'
    };
  }
  return conciliarFolio(
    lote,
    pagina,
    eleccion.folio,
    'qr',
    qrs.join(' | ').slice(0, 1000) || eleccion.folio,
    usuarioId
  );
}

async function resumenLote(id: number): Promise<Record<string, unknown>> {
  const fila = await consultarUna<Record<string, unknown>>(
    `SELECT l.id, l.municipio_id, m.nombre AS municipio_nombre,
            l.regional_id, dr.nombre AS regional_nombre,
            l.camion, l.tipo_apoyo_id, ta.nombre AS tipo_apoyo_nombre,
            l.estado, l.pdf_url, l.pdf_hash, l.pdf_bytes, l.paginas_pdf,
            l.creado_por, u.nombre_completo AS creado_por_nombre,
            l.creado_en, l.actualizado_en, l.cerrado_en,
            (SELECT COUNT(*)::int
               FROM conciliacion_paginas p WHERE p.lote_id = l.id) AS paginas_procesadas,
            (SELECT COUNT(*)::int
               FROM conciliacion_paginas p
              WHERE p.lote_id = l.id AND p.estado <> 'conciliada') AS pendientes,
            (SELECT COUNT(*)::int
               FROM conciliacion_paginas p
              WHERE p.lote_id = l.id AND p.estado = 'duplicada') AS duplicados,
            (SELECT COUNT(*)::int
               FROM conciliacion_recibos r WHERE r.lote_id = l.id) AS recibos,
            COALESCE((SELECT SUM(crc.cantidad_kg)::float8
                        FROM conciliacion_recibo_conceptos crc
                        JOIN conciliacion_recibos r ON r.id = crc.recibo_id
                       WHERE r.lote_id = l.id), 0) AS kg_total,
            COALESCE((SELECT SUM(crc.costales)::int
                        FROM conciliacion_recibo_conceptos crc
                        JOIN conciliacion_recibos r ON r.id = crc.recibo_id
                       WHERE r.lote_id = l.id), 0) AS costales_total
       FROM conciliacion_lotes l
       JOIN municipios m ON m.id = l.municipio_id
       JOIN direcciones_regionales dr ON dr.id = l.regional_id
       LEFT JOIN tipos_apoyo ta ON ta.id = l.tipo_apoyo_id
       LEFT JOIN usuarios u ON u.id = l.creado_por
      WHERE l.id = $1`,
    [id]
  );
  if (!fila) throw errorNoEncontrado('El lote de conciliacion no existe.');
  return fila;
}

async function detalleLote(id: number): Promise<Record<string, unknown>> {
  const lote = await resumenLote(id);
  const recibos = await consultar<Record<string, unknown>>(
    `SELECT r.id, p.pagina, r.folio, r.solicitud_id, r.origen, r.creado_en,
            COALESCE(NULLIF(s.razon_social, ''), s.nombre_solicitante) AS beneficiario,
            STRING_AGG(ta.nombre, ' / ' ORDER BY ta.nombre) AS apoyos,
            COALESCE(SUM(crc.cantidad_kg)::float8, 0) AS kg,
            COALESCE(SUM(crc.costales)::int, 0) AS costales
       FROM conciliacion_recibos r
       JOIN conciliacion_paginas p ON p.id = r.pagina_id
       JOIN solicitudes s ON s.id = r.solicitud_id
       JOIN conciliacion_recibo_conceptos crc ON crc.recibo_id = r.id
       JOIN tipos_apoyo ta ON ta.id = crc.tipo_apoyo_id
      WHERE r.lote_id = $1
      GROUP BY r.id, p.pagina, r.folio, r.solicitud_id, r.origen, r.creado_en,
               s.razon_social, s.nombre_solicitante
      ORDER BY p.pagina`,
    [id]
  );
  const pendientes = await consultar<Record<string, unknown>>(
    `SELECT id, pagina, estado, qr_text, folio_detectado, mensaje, actualizado_en
       FROM conciliacion_paginas
      WHERE lote_id = $1 AND estado <> 'conciliada'
      ORDER BY pagina`,
    [id]
  );
  return { lote, recibos, pendientes };
}

export default async function rutasConciliacion(app: FastifyInstance): Promise<void> {
  const preHandler = [app.autenticar, app.requiereRol(...ROLES_CONCILIACION)];

  app.get('/api/conciliacion/catalogos', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const forzada = regionalForzada(usuario);

    const parametros: unknown[] = [];
    let filtro = '';
    if (forzada !== null) {
      parametros.push(forzada);
      filtro = `AND m.regional_id = $${parametros.length}`;
    }
    const municipios = await consultar<{ id: number; nombre: string; regional_id: number }>(
      `SELECT m.id, m.nombre, m.regional_id
         FROM municipios m
        WHERE m.activo = TRUE ${filtro}
        ORDER BY m.nombre`,
      parametros
    );
    const tiposApoyo = await consultar<{ id: number; nombre: string; clave: string }>(
      `SELECT id, nombre, clave FROM tipos_apoyo
        WHERE activo = TRUE
        ORDER BY nombre`
    );
    return respuesta.status(200).send({ municipios, tipos_apoyo: tiposApoyo });
  });

  app.post('/api/conciliacion/lotes', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const parseado = esquemaNuevoLote.safeParse(peticion.body);
    if (!parseado.success) throw errorValidacion('Datos invalidos para crear el lote.');
    const datos = parseado.data;

    const municipio = await consultarUna<{ id: number; nombre: string; regional_id: number }>(
      'SELECT id, nombre, regional_id FROM municipios WHERE id = $1 AND activo = TRUE',
      [datos.municipio_id]
    );
    if (!municipio) throw errorNoEncontrado('El municipio no existe o esta inactivo.');
    const forzada = regionalForzada(usuario);
    if (forzada !== null && Number(municipio.regional_id) !== forzada) {
      throw errorProhibido('El municipio pertenece a otra Direccion Regional.');
    }

    if (datos.tipo_apoyo_id !== null) {
      const tipo = await consultarUna<{ id: number }>(
        'SELECT id FROM tipos_apoyo WHERE id = $1 AND activo = TRUE',
        [datos.tipo_apoyo_id]
      );
      if (!tipo) throw errorNoEncontrado('El tipo de apoyo no existe o esta inactivo.');
    }

    const creado = await consultarUna<{ id: number }>(
      `INSERT INTO conciliacion_lotes
         (municipio_id, regional_id, camion, tipo_apoyo_id, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        datos.municipio_id,
        municipio.regional_id,
        datos.camion.trim(),
        datos.tipo_apoyo_id,
        usuario.id
      ]
    );
    if (!creado) throw new Error('No fue posible crear el lote.');

    await registrarAuditoria(peticion, {
      usuarioId: usuario.id,
      accion: 'conciliacion_lote_creado',
      entidad: 'conciliacion_lote',
      entidadId: creado.id,
      detalle: {
        municipio_id: datos.municipio_id,
        camion: datos.camion,
        tipo_apoyo_id: datos.tipo_apoyo_id
      }
    });
    return respuesta.status(201).send(await detalleLote(creado.id));
  });

  app.get('/api/conciliacion/lotes', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const forzada = regionalForzada(usuario);
    const parametros: unknown[] = [];
    let filtro = '';
    if (forzada !== null) {
      parametros.push(forzada);
      filtro = `WHERE l.regional_id = $${parametros.length}`;
    }
    const ids = await consultar<{ id: number }>(
      `SELECT l.id FROM conciliacion_lotes l ${filtro}
        ORDER BY l.creado_en DESC LIMIT 200`,
      parametros
    );
    const data = [];
    for (const fila of ids) data.push(await resumenLote(Number(fila.id)));
    return respuesta.status(200).send({ data });
  });

  app.get('/api/conciliacion/lotes/:id', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const id = Number((peticion.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) throw errorValidacion('Id de lote invalido.');
    await cargarLote(id, usuario);
    return respuesta.status(200).send(await detalleLote(id));
  });

  app.post('/api/conciliacion/lotes/:id/pdf', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const id = Number((peticion.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) throw errorValidacion('Id de lote invalido.');
    const lote = await cargarLote(id, usuario);
    if (lote.estado !== 'abierto') throw new ErrorApi(409, 'lote_cerrado', 'El lote ya esta cerrado.');
    if (lote.pdf_url || lote.paginas_pdf) {
      throw new ErrorApi(409, 'pdf_ya_cargado', 'Este lote ya tiene un PDF procesado.');
    }
    if (!peticion.isMultipart()) {
      throw errorValidacion('El PDF debe enviarse como multipart/form-data.');
    }

    let pdf: Buffer | null = null;
    let mimetype = '';
    for await (const parte of peticion.parts()) {
      if (parte.type === 'file' && parte.fieldname === 'pdf') {
        mimetype = parte.mimetype || '';
        pdf = await parte.toBuffer();
      } else if (parte.type === 'file') {
        await parte.toBuffer();
      }
    }
    if (!pdf || pdf.length === 0) throw errorValidacion('Selecciona el PDF de recibos.');
    if (mimetype !== 'application/pdf' && !pdf.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw errorValidacion('El archivo debe ser un PDF.');
    }
    if (pdf.length > config.maxPdfConciliacionBytes) {
      throw errorValidacion(`El PDF excede ${config.maxPdfConciliacionMb} MB.`);
    }

    const guardado = guardarPdfConciliacion(pdf, randomUUID());
    let lectura;
    try {
      lectura = await leerQrDePdf(guardado.rutaAbsoluta, MAX_PAGINAS_PDF);
    } catch (error) {
      throw new ErrorApi(
        500,
        'lector_pdf_no_disponible',
        `No fue posible procesar el PDF de recibos: ${(error as Error).message}`
      );
    }

    await pool.query(
      `UPDATE conciliacion_lotes
          SET pdf_url = $2, pdf_hash = $3, pdf_bytes = $4,
              paginas_pdf = $5, actualizado_en = now()
        WHERE id = $1`,
      [id, guardado.url, guardado.hash, guardado.bytes, lectura.paginas]
    );

    const resultados: ResultadoPagina[] = [];
    for (const pagina of lectura.resultados) {
      try {
        resultados.push(await procesarPaginaQr(lote, pagina.pagina, pagina.qrs, usuario.id));
      } catch (error) {
        const mensaje = (error as Error).message.slice(0, 500);
        await guardarEstadoPagina(id, pagina.pagina, 'error', pagina.qrs.join(' | ') || null, null, mensaje);
        resultados.push({ pagina: pagina.pagina, estado: 'error', folio: null, mensaje });
      }
    }

    const conciliadas = resultados.filter((r) => r.estado === 'conciliada').length;
    await registrarAuditoria(peticion, {
      usuarioId: usuario.id,
      accion: 'conciliacion_pdf_procesado',
      entidad: 'conciliacion_lote',
      entidadId: id,
      detalle: {
        paginas: lectura.paginas,
        conciliadas,
        pendientes: lectura.paginas - conciliadas,
        bytes: guardado.bytes,
        hash: guardado.hash
      }
    });
    return respuesta.status(200).send({
      ...(await detalleLote(id)),
      procesamiento: {
        paginas: lectura.paginas,
        conciliadas,
        pendientes: lectura.paginas - conciliadas
      }
    });
  });

  app.post(
    '/api/conciliacion/lotes/:id/paginas/:pagina/manual',
    { preHandler },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();
      const params = peticion.params as Record<string, string>;
      const id = Number(params.id);
      const pagina = Number(params.pagina);
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(pagina) || pagina <= 0) {
        throw errorValidacion('Lote o pagina invalidos.');
      }
      const lote = await cargarLote(id, usuario);
      if (lote.estado !== 'abierto') throw new ErrorApi(409, 'lote_cerrado', 'El lote ya esta cerrado.');
      if (!lote.paginas_pdf || pagina > lote.paginas_pdf) {
        throw errorValidacion('La pagina no pertenece al PDF de este lote.');
      }
      const parseado = esquemaManual.safeParse(peticion.body);
      if (!parseado.success) throw errorValidacion('Escribe un folio valido.');

      const yaConciliada = await consultarUna<{ id: number }>(
        `SELECT r.id
           FROM conciliacion_recibos r
           JOIN conciliacion_paginas p ON p.id = r.pagina_id
          WHERE r.lote_id = $1 AND p.pagina = $2`,
        [id, pagina]
      );
      if (yaConciliada) {
        throw new ErrorApi(409, 'pagina_ya_conciliada', 'La pagina ya esta conciliada.');
      }

      const resultado = await conciliarFolio(
        lote,
        pagina,
        parseado.data.folio,
        'manual',
        null,
        usuario.id
      );
      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'conciliacion_recibo_manual',
        entidad: 'conciliacion_lote',
        entidadId: id,
        detalle: { pagina, folio: normalizarFolio(parseado.data.folio), estado: resultado.estado }
      });
      return respuesta.status(200).send(await detalleLote(id));
    }
  );

  app.delete(
    '/api/conciliacion/lotes/:id/recibos/:reciboId',
    { preHandler },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();
      const params = peticion.params as Record<string, string>;
      const id = Number(params.id);
      const reciboId = Number(params.reciboId);
      if (!Number.isInteger(id) || !Number.isInteger(reciboId) || id <= 0 || reciboId <= 0) {
        throw errorValidacion('Lote o recibo invalidos.');
      }
      const lote = await cargarLote(id, usuario);
      if (lote.estado !== 'abierto') throw new ErrorApi(409, 'lote_cerrado', 'El lote ya esta cerrado.');

      const recibo = await consultarUna<{ pagina_id: number; pagina: number; folio: string }>(
        `SELECT r.pagina_id, p.pagina, r.folio
           FROM conciliacion_recibos r
           JOIN conciliacion_paginas p ON p.id = r.pagina_id
          WHERE r.id = $1 AND r.lote_id = $2`,
        [reciboId, id]
      );
      if (!recibo) throw errorNoEncontrado('El recibo no existe en este lote.');

      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query('DELETE FROM conciliacion_recibos WHERE id = $1', [reciboId]);
        await cliente.query(
          `UPDATE conciliacion_paginas
              SET estado = 'pendiente_manual', mensaje = 'Conciliacion retirada; captura el folio correcto.',
                  actualizado_en = now()
            WHERE id = $1`,
          [recibo.pagina_id]
        );
        await cliente.query('COMMIT');
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
      } finally {
        cliente.release();
      }

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'conciliacion_recibo_eliminado',
        entidad: 'conciliacion_lote',
        entidadId: id,
        detalle: { recibo_id: reciboId, pagina: recibo.pagina, folio: recibo.folio }
      });
      return respuesta.status(200).send(await detalleLote(id));
    }
  );

  app.post('/api/conciliacion/lotes/:id/cerrar', { preHandler }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const id = Number((peticion.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) throw errorValidacion('Id de lote invalido.');
    const lote = await cargarLote(id, usuario);
    if (lote.estado === 'cerrado') return respuesta.status(200).send(await detalleLote(id));
    if (!lote.paginas_pdf) {
      throw new ErrorApi(409, 'lote_sin_pdf', 'Carga y procesa el PDF antes de cerrar el lote.');
    }

    const pendientes = await consultarUna<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM conciliacion_paginas
        WHERE lote_id = $1 AND estado <> 'conciliada'`,
      [id]
    );
    if (Number(pendientes?.total ?? 0) > 0) {
      throw new ErrorApi(
        409,
        'lote_con_pendientes',
        `El lote tiene ${Number(pendientes?.total ?? 0)} pagina(s) pendiente(s) de conciliar.`
      );
    }
    const recibos = await consultarUna<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM conciliacion_recibos WHERE lote_id = $1',
      [id]
    );
    if (Number(recibos?.total ?? 0) === 0) {
      throw new ErrorApi(409, 'lote_sin_recibos', 'El lote no tiene recibos conciliados.');
    }

    await pool.query(
      `UPDATE conciliacion_lotes
          SET estado = 'cerrado', cerrado_por = $2, cerrado_en = now(), actualizado_en = now()
        WHERE id = $1`,
      [id, usuario.id]
    );
    await registrarAuditoria(peticion, {
      usuarioId: usuario.id,
      accion: 'conciliacion_lote_cerrado',
      entidad: 'conciliacion_lote',
      entidadId: id,
      detalle: { recibos: Number(recibos?.total ?? 0) }
    });
    return respuesta.status(200).send(await detalleLote(id));
  });
}
