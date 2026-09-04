// Registro de entrega del apoyo (Parte 1).
//
// Dos endpoints:
//   POST /api/entregas                    -> registra la entrega de UN concepto
//   GET  /api/entregas/preparar-evento    -> paquete para trabajar sin senal
//
// El POST es calcado de POST /api/capturas: mismo multipart, mismo uuid de
// cliente como clave de idempotencia, mismo `guardarFoto`. La cola offline de
// la Parte 2 podra reintentar sin duplicar.
import type { FastifyInstance } from 'fastify';
import {
  esquemaEntregaApoyo,
  ROLES_ENTREGA,
  puedeGestionarEntregas,
  type ConceptoPorEntregar,
  type PaqueteEventoEntrega
} from '@sedea/shared';
import { config } from '../config.js';
import { consultar, consultarUna } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import {
  ErrorApi,
  errorNoAutorizado,
  errorNoEncontrado,
  errorProhibido,
  errorValidacion
} from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { guardarFoto } from '../servicios/almacenamiento.js';
import { esAutorizadoDeFacto } from '../servicios/autorizacion-operativa.js';
import { exigirAutorizacionSecretario } from './solicitudes.js';

interface ConceptoConSolicitud {
  id: number;
  solicitud_id: number;
  tipo_apoyo_id: number;
  folio: string;
  regional_id: number;
  autorizada_secretario: boolean;
  autorizado_de_facto: boolean;
}

export default async function rutasEntregas(app: FastifyInstance): Promise<void> {
  // Defensa adicional para multi-rol: `auditor+ventanilla` es el perfil del
  // Director Regional que puede apoyar en captura de solicitudes, no en la
  // entrega fisica. Se conserva acceso si ademas es admin o capturista.
  const soloEntregaOperativa = async (peticion: any) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    if (!puedeGestionarEntregas(usuario.rol)) {
      throw errorProhibido('Tu perfil puede capturar solicitudes, pero no preparar ni registrar entregas.');
    }
  };

  // -------------------------------------------------------------------------
  // POST /api/entregas - evidencia de la entrega fisica de un concepto.
  // -------------------------------------------------------------------------
  app.post(
    '/api/entregas',
    {
      preHandler: [
        app.autenticar,
        app.requiereRol(...ROLES_ENTREGA),
        soloEntregaOperativa
      ]
    },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      if (!peticion.isMultipart()) {
        throw errorValidacion('La entrega debe enviarse como multipart/form-data.');
      }

      const campos: Record<string, string> = {};
      let foto: Buffer | null = null;
      let mimetypeFoto = '';

      for await (const parte of peticion.parts()) {
        if (parte.type === 'file') {
          if (parte.fieldname !== 'foto') {
            await parte.toBuffer();
            continue;
          }
          mimetypeFoto = parte.mimetype || '';
          foto = await parte.toBuffer();
        } else {
          campos[parte.fieldname] = String(parte.value ?? '');
        }
      }

      // 1) Campos de negocio.
      const parseado = esquemaEntregaApoyo.safeParse({
        uuid: campos.uuid,
        solicitud_concepto_id: campos.solicitud_concepto_id,
        lat: campos.lat,
        lng: campos.lng,
        precision_m: campos.precision_m,
        entregado_en: campos.entregado_en,
        observaciones: campos.observaciones ? campos.observaciones : null
      });
      if (!parseado.success) {
        throw errorValidacion(
          'Los datos de la entrega son invalidos.',
          parseado.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }))
        );
      }
      const datos = parseado.data;

      // 2) Idempotencia PRIMERO: un reintento de la cola no debe volver a
      //    escribir la foto en disco ni revalidar nada.
      const existente = await consultarUna<{
        uuid: string;
        solicitud_concepto_id: string | number;
        foto_url: string;
      }>(
        'SELECT uuid, solicitud_concepto_id, foto_url FROM entregas_apoyo WHERE uuid = $1',
        [datos.uuid]
      );
      if (existente) {
        return respuesta.status(200).send({
          uuid: existente.uuid,
          solicitud_concepto_id: Number(existente.solicitud_concepto_id),
          foto_url: existente.foto_url,
          duplicado: true
        });
      }

      // 3) Fotografia (mismas reglas que las capturas de campo).
      if (!foto || foto.length === 0) {
        throw errorValidacion('La fotografia de evidencia es obligatoria.');
      }
      if (!mimetypeFoto.startsWith('image/')) {
        throw errorValidacion('El archivo adjunto debe ser una imagen.');
      }
      if (foto.length > config.maxSubidaBytes) {
        throw errorValidacion(`La fotografia excede ${config.maxSubidaMb} MB.`);
      }

      // 4) El concepto existe y su solicitud esta al alcance del usuario.
      const concepto = await consultarUna<ConceptoConSolicitud>(
        `SELECT sc.id, sc.solicitud_id, sc.tipo_apoyo_id,
                s.folio, s.regional_id, s.autorizada_secretario,
                t.autorizado_de_facto
           FROM solicitud_conceptos sc
           JOIN solicitudes s ON s.id = sc.solicitud_id
           JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
          WHERE sc.id = $1`,
        [datos.solicitud_concepto_id]
      );
      if (!concepto) throw errorNoEncontrado('El concepto de la solicitud no existe.');

      const forzada = regionalForzada(usuario);
      if (forzada !== null && Number(concepto.regional_id) !== forzada) {
        throw errorProhibido('La solicitud pertenece a otra Direccion Regional.');
      }

      // 5) Candado de autorización. Los conceptos marcados autorizado_de_facto
      //    en el catalogo (Catalogos -> Conceptos de apoyo) no requieren
      //    autorización del Secretario. Para cualquier otro se conserva el candado.
      if (!esAutorizadoDeFacto(concepto)) {
        exigirAutorizacionSecretario(concepto);
      }

      // 6) Sin parcialidades: si el concepto ya tiene entrega y viene con OTRO
      //    uuid, es un intento de re-entregar, no un reintento de red.
      const yaEntregado = await consultarUna<{ uuid: string; entregado_en: string }>(
        'SELECT uuid, entregado_en FROM entregas_apoyo WHERE solicitud_concepto_id = $1',
        [datos.solicitud_concepto_id]
      );
      if (yaEntregado) {
        throw new ErrorApi(
          409,
          'concepto_ya_entregado',
          'Este concepto ya tiene una entrega registrada. No se permiten entregas parciales ni repetidas.'
        );
      }

      const guardada = await guardarFoto(foto, datos.uuid);
      const dispositivo =
        (peticion.headers['user-agent'] as string | undefined)?.slice(0, 200) ?? null;

      const insertadas = await consultar<{ uuid: string; foto_url: string }>(
        `INSERT INTO entregas_apoyo (
            uuid, solicitud_concepto_id, foto_url, foto_hash, geom, lat, lng,
            precision_m, observaciones, entregado_en, entregado_por, dispositivo)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $6, $5,
                 $7, $8, $9::timestamptz, $10, $11)
         ON CONFLICT (uuid) DO NOTHING
         RETURNING uuid, foto_url`,
        [
          datos.uuid,
          datos.solicitud_concepto_id,
          guardada.url,
          guardada.hash,
          datos.lng,
          datos.lat,
          datos.precision_m,
          datos.observaciones ?? null,
          new Date(datos.entregado_en).toISOString(),
          usuario.id,
          dispositivo
        ]
      );

      // Carrera: otro proceso inserto el mismo uuid entre la lectura y el INSERT.
      if (insertadas.length === 0) {
        const relectura = await consultarUna<{ foto_url: string }>(
          'SELECT foto_url FROM entregas_apoyo WHERE uuid = $1',
          [datos.uuid]
        );
        return respuesta.status(200).send({
          uuid: datos.uuid,
          solicitud_concepto_id: datos.solicitud_concepto_id,
          foto_url: relectura?.foto_url ?? guardada.url,
          duplicado: true
        });
      }

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'entrega_apoyo_registrada',
        entidad: 'entrega_apoyo',
        entidadId: datos.uuid,
        detalle: {
          solicitud_concepto_id: datos.solicitud_concepto_id,
          solicitud_id: Number(concepto.solicitud_id),
          folio: concepto.folio,
          autorizacion_de_facto: esAutorizadoDeFacto(concepto),
          lat: datos.lat,
          lng: datos.lng,
          precision_m: datos.precision_m
        }
      });

      return respuesta.status(201).send({
        uuid: datos.uuid,
        solicitud_concepto_id: datos.solicitud_concepto_id,
        foto_url: guardada.url,
        duplicado: false
      });
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/entregas/preparar-evento?tipo_apoyo_id=&regional_id=
  //
  // Paquete de trabajo del evento de entrega: lo que la Parte 2 guarda en
  // IndexedDB para operar sin senal. Devuelve UN RENGLON POR CONCEPTO
  // pendiente, no por solicitud.
  //
  // Para Avena/Garbanzo no se exige autorización del Secretario. Para el resto
  // sí se conserva. En todos los casos se excluyen conceptos ya entregados.
  // -------------------------------------------------------------------------
  app.get(
    '/api/entregas/preparar-evento',
    {
      preHandler: [
        app.autenticar,
        app.requiereRol(...ROLES_ENTREGA),
        soloEntregaOperativa
      ]
    },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const q = peticion.query as Record<string, string>;
      const tipoApoyoId = Number(q.tipo_apoyo_id);
      if (!tipoApoyoId || Number.isNaN(tipoApoyoId)) {
        throw errorValidacion('tipo_apoyo_id es obligatorio para preparar el evento.');
      }

      const tipoApoyo = await consultarUna<{ id: number; nombre: string; autorizado_de_facto: boolean }>(
        'SELECT id, nombre, autorizado_de_facto FROM tipos_apoyo WHERE id = $1',
        [tipoApoyoId]
      );
      if (!tipoApoyo) throw errorNoEncontrado('El tipo de apoyo no existe.');

      // El alcance regional del usuario manda sobre el filtro pedido.
      const forzada = regionalForzada(usuario);
      let regionalId: number | null = q.regional_id ? Number(q.regional_id) : null;
      if (regionalId !== null && Number.isNaN(regionalId)) regionalId = null;
      if (forzada !== null) regionalId = forzada;

      const parametros: unknown[] = [tipoApoyoId];
      let filtroRegional = '';
      if (regionalId !== null) {
        parametros.push(regionalId);
        filtroRegional = `AND s.regional_id = $${parametros.length}`;
      }

      const filtroAutorizacion = esAutorizadoDeFacto(tipoApoyo)
        ? ''
        : 'AND s.autorizada_secretario = TRUE';

      const filas = await consultar<Record<string, unknown>>(
        `SELECT sc.id                       AS solicitud_concepto_id,
                sc.solicitud_id,
                s.folio,
                sc.beneficiario_id,
                COALESCE(NULLIF(s.razon_social, ''), s.nombre_solicitante) AS beneficiario_nombre,
                s.curp,
                s.regional_id,
                dr.nombre                   AS regional_nombre,
                mun.nombre                  AS municipio_nombre,
                sc.tipo_apoyo_id,
                ta.nombre                   AS tipo_apoyo_nombre,
                sc.descripcion              AS concepto_descripcion,
                sc.cantidad::float8         AS cantidad,
                COALESCE(sc.unidad_medida, ta.unidad_medida) AS unidad_medida
           FROM solicitud_conceptos sc
           JOIN solicitudes s              ON s.id = sc.solicitud_id
           JOIN tipos_apoyo ta             ON ta.id = sc.tipo_apoyo_id
           LEFT JOIN direcciones_regionales dr ON dr.id = s.regional_id
           LEFT JOIN municipios mun        ON mun.id = s.dom_municipio_id
           LEFT JOIN entregas_apoyo ea     ON ea.solicitud_concepto_id = sc.id
          WHERE sc.tipo_apoyo_id = $1
            ${filtroAutorizacion}
            AND ea.uuid IS NULL
            ${filtroRegional}
          ORDER BY s.folio, sc.orden`,
        parametros
      );

      const conceptos: ConceptoPorEntregar[] = filas.map((f) => ({
        solicitud_concepto_id: Number(f.solicitud_concepto_id),
        solicitud_id: Number(f.solicitud_id),
        folio: String(f.folio),
        beneficiario_id: f.beneficiario_id === null ? null : Number(f.beneficiario_id),
        beneficiario_nombre: String(f.beneficiario_nombre ?? ''),
        curp: (f.curp as string | null) ?? null,
        regional_id: f.regional_id === null ? null : Number(f.regional_id),
        regional_nombre: (f.regional_nombre as string | null) ?? null,
        municipio_nombre: (f.municipio_nombre as string | null) ?? null,
        tipo_apoyo_id: Number(f.tipo_apoyo_id),
        tipo_apoyo_nombre: String(f.tipo_apoyo_nombre ?? ''),
        concepto_descripcion: (f.concepto_descripcion as string | null) ?? null,
        cantidad: Number(f.cantidad ?? 0),
        unidad_medida: (f.unidad_medida as string | null) ?? null
      }));

      const paquete: PaqueteEventoEntrega = {
        generado_en: new Date().toISOString(),
        filtro: {
          tipo_apoyo_id: tipoApoyoId,
          tipo_apoyo_nombre: tipoApoyo.nombre,
          regional_id: regionalId,
          regional_nombre:
            regionalId === null
              ? null
              : ((
                  await consultarUna<{ nombre: string }>(
                    'SELECT nombre FROM direcciones_regionales WHERE id = $1',
                    [regionalId]
                  )
                )?.nombre ?? null)
        },
        total: conceptos.length,
        conceptos
      };

      return respuesta.status(200).send(paquete);
    }
  );
}
