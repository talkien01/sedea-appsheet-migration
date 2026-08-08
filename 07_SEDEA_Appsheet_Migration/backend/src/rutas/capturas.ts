// Alta de capturas de evidencia (multipart) con idempotencia por uuid.
import type { FastifyInstance } from 'fastify';
import { esquemaCaptura, ROLES_CAPTURA } from '@sedea/shared';
import { config } from '../config.js';
import { consultar, consultarUna } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import {
  errorNoAutorizado,
  errorNoEncontrado,
  errorProhibido,
  errorValidacion
} from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { guardarFoto } from '../servicios/almacenamiento.js';

export default async function rutasCapturas(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/capturas',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_CAPTURA)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      if (!peticion.isMultipart()) {
        throw errorValidacion('La captura debe enviarse como multipart/form-data.');
      }

      const campos: Record<string, string> = {};
      let foto: Buffer | null = null;
      let mimetypeFoto = '';

      for await (const parte of peticion.parts()) {
        if (parte.type === 'file') {
          if (parte.fieldname !== 'foto') {
            // Se descarta cualquier archivo que no sea la foto esperada.
            await parte.toBuffer();
            continue;
          }
          mimetypeFoto = parte.mimetype || '';
          foto = await parte.toBuffer();
        } else {
          campos[parte.fieldname] = String(parte.value ?? '');
        }
      }

      // 1) Validacion de los campos de negocio (uuid, coordenadas, fecha...).
      const parseado = esquemaCaptura.safeParse({
        uuid: campos.uuid,
        beneficiario_id: campos.beneficiario_id,
        lat: campos.lat,
        lng: campos.lng,
        precision_m: campos.precision_m,
        capturado_en: campos.capturado_en,
        tipo_apoyo_id: campos.tipo_apoyo_id ? campos.tipo_apoyo_id : null,
        cantidad_entregada:
          campos.cantidad_entregada !== undefined && campos.cantidad_entregada !== ''
            ? campos.cantidad_entregada
            : null,
        observaciones: campos.observaciones ? campos.observaciones : null
      });

      if (!parseado.success) {
        throw errorValidacion(
          'Los datos de la captura son invalidos.',
          parseado.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }))
        );
      }
      const datos = parseado.data;

      // 2) Validacion de la fotografia.
      if (!foto || foto.length === 0) {
        throw errorValidacion('La fotografia de evidencia es obligatoria.');
      }
      if (!mimetypeFoto.startsWith('image/')) {
        throw errorValidacion('El archivo adjunto debe ser una imagen.');
      }
      if (foto.length > config.maxSubidaBytes) {
        throw errorValidacion(`La fotografia excede ${config.maxSubidaMb} MB.`);
      }

      // 3) Beneficiario existente y dentro del alcance del usuario.
      const beneficiario = await consultarUna<{ id: number; regional_id: number }>(
        'SELECT id, regional_id FROM beneficiarios WHERE id = $1',
        [datos.beneficiario_id]
      );
      if (!beneficiario) throw errorNoEncontrado('El beneficiario no existe.');

      const forzada = regionalForzada(usuario);
      if (forzada !== null && beneficiario.regional_id !== forzada) {
        throw errorProhibido('El beneficiario pertenece a otra Direccion Regional.');
      }

      // 4) Idempotencia: si el uuid ya existe se responde 200 sin duplicar.
      const existente = await consultarUna<{ uuid: string; foto_url: string }>(
        'SELECT uuid, foto_url FROM capturas WHERE uuid = $1',
        [datos.uuid]
      );
      if (existente) {
        await registrarAuditoria(peticion, {
          usuarioId: usuario.id,
          accion: 'captura_duplicada',
          entidad: 'captura',
          entidadId: datos.uuid,
          detalle: { beneficiario_id: datos.beneficiario_id }
        });
        return respuesta
          .status(200)
          .send({ uuid: existente.uuid, foto_url: existente.foto_url, duplicado: true });
      }

      const guardada = await guardarFoto(foto, datos.uuid);
      const dispositivo = (peticion.headers['user-agent'] as string | undefined)?.slice(0, 200) ?? null;

      const insertadas = await consultar<{ uuid: string; foto_url: string }>(
        `INSERT INTO capturas (
            uuid, beneficiario_id, usuario_id, foto_url, foto_hash, geom, lat, lng,
            precision_m, tipo_apoyo_id, cantidad_entregada, observaciones, capturado_en, dispositivo)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $7, $6,
                 $8, $9, $10, $11, $12::timestamptz, $13)
         ON CONFLICT (uuid) DO NOTHING
         RETURNING uuid, foto_url`,
        [
          datos.uuid,
          datos.beneficiario_id,
          usuario.id,
          guardada.url,
          guardada.hash,
          datos.lng,
          datos.lat,
          datos.precision_m,
          datos.tipo_apoyo_id ?? null,
          datos.cantidad_entregada ?? null,
          datos.observaciones ?? null,
          new Date(datos.capturado_en).toISOString(),
          dispositivo
        ]
      );

      // Carrera: otro proceso inserto el mismo uuid entre la lectura y el INSERT.
      if (insertadas.length === 0) {
        const relectura = await consultarUna<{ uuid: string; foto_url: string }>(
          'SELECT uuid, foto_url FROM capturas WHERE uuid = $1',
          [datos.uuid]
        );
        await registrarAuditoria(peticion, {
          usuarioId: usuario.id,
          accion: 'captura_duplicada',
          entidad: 'captura',
          entidadId: datos.uuid,
          detalle: { beneficiario_id: datos.beneficiario_id }
        });
        return respuesta
          .status(200)
          .send({ uuid: datos.uuid, foto_url: relectura?.foto_url ?? guardada.url, duplicado: true });
      }

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'captura_creada',
        entidad: 'captura',
        entidadId: datos.uuid,
        detalle: {
          beneficiario_id: datos.beneficiario_id,
          lat: datos.lat,
          lng: datos.lng,
          precision_m: datos.precision_m
        }
      });

      return respuesta
        .status(201)
        .send({ uuid: datos.uuid, foto_url: guardada.url, duplicado: false });
    }
  );

  app.get('/api/capturas', { preHandler: [app.autenticar] }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();

    const q = peticion.query as Record<string, string>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(q.page_size ?? 100) || 100));

    const condiciones: string[] = [];
    const parametros: unknown[] = [];

    const forzada = regionalForzada(usuario);
    if (forzada !== null) {
      parametros.push(forzada);
      condiciones.push(`b.regional_id = $${parametros.length}`);
    }
    if (q.beneficiario_id) {
      parametros.push(Number(q.beneficiario_id));
      condiciones.push(`c.beneficiario_id = $${parametros.length}`);
    }
    if (q.desde) {
      parametros.push(q.desde);
      condiciones.push(`c.capturado_en >= $${parametros.length}::timestamptz`);
    }
    if (q.hasta) {
      parametros.push(q.hasta);
      condiciones.push(`c.capturado_en <= $${parametros.length}::timestamptz`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const totalFila = await consultarUna<{ total: number }>(
      `SELECT count(*)::int AS total FROM capturas c
         JOIN beneficiarios b ON b.id = c.beneficiario_id ${where}`,
      parametros
    );

    const filas = await consultar(
      `SELECT c.uuid, c.beneficiario_id, c.usuario_id, c.foto_url, c.lat, c.lng, c.precision_m,
              c.tipo_apoyo_id, c.cantidad_entregada, c.observaciones, c.capturado_en,
              c.sincronizado_en, c.estado_sync, u.nombre_completo AS capturista,
              b.nombre_completo AS beneficiario_nombre
         FROM capturas c
         JOIN beneficiarios b ON b.id = c.beneficiario_id
         LEFT JOIN usuarios u ON u.id = c.usuario_id
         ${where}
        ORDER BY c.capturado_en DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      parametros
    );

    return respuesta.status(200).send({
      data: filas,
      page,
      page_size: pageSize,
      total: totalFila?.total ?? 0,
      has_more: (page - 1) * pageSize + filas.length < (totalFila?.total ?? 0)
    });
  });
}
