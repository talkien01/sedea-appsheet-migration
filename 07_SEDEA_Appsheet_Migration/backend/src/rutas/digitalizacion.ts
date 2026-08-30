// Digitalizacion V1 / Fase 1.
// Base operativa para construir lotes de preparacion antes de generar caratulas QR.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';

const error400 = (codigo: string, mensaje: string) => new ErrorApi(400, codigo, mensaje);
const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error404 = (mensaje: string) => new ErrorApi(404, 'no_encontrado', mensaje);

function enteroPositivo(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function idOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = enteroPositivo(valor);
  if (id === null) throw error400('filtro_invalido', `${campo} debe ser un identificador válido.`);
  return id;
}

function texto(valor: unknown): string {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function usuarioActual(peticion: FastifyRequest) {
  if (!peticion.usuario) throw errorNoAutorizado();
  return peticion.usuario;
}

/**
 * La autoridad territorial es el municipio del predio (solicitudes.ubi_municipio_id).
 * Una Regional enviada por el frontend nunca amplía el alcance del usuario.
 */
function regionalPermitida(peticion: FastifyRequest, regionalSolicitada: number | null): number | null {
  const forzada = regionalForzada(usuarioActual(peticion));
  if (forzada !== null && regionalSolicitada !== null && regionalSolicitada !== forzada) {
    throw error403('fuera_de_alcance', 'La Regional solicitada está fuera de tu alcance.');
  }
  return forzada ?? regionalSolicitada;
}

async function validarMunicipio(municipioId: number | null, regionalId: number | null): Promise<void> {
  if (municipioId === null) return;
  const valores: unknown[] = [municipioId];
  let condicionRegional = '';
  if (regionalId !== null) {
    valores.push(regionalId);
    condicionRegional = ' AND regional_id = $2';
  }
  const { rows } = await pool.query<{ uno: number }>(
    `SELECT 1 AS uno FROM municipios WHERE id = $1${condicionRegional}`,
    valores
  );
  if (rows.length === 0) {
    throw error403('fuera_de_alcance', 'El municipio no existe o está fuera de la Regional permitida.');
  }
}

export default async function rutasDigitalizacion(app: FastifyInstance): Promise<void> {
  const protegida = {
    preHandler: [
      app.autenticar,
      app.requiereRol('ventanilla', 'capturista', 'editor_datos', 'admin')
    ]
  };

  // Solicitudes candidatas para formar lotes. La paginacion solo afecta la vista;
  // el lote se crea siempre con ids explicitos enviados por el operador.
  app.get('/api/digitalizacion/solicitudes', protegida, async (peticion, respuesta) => {
    const query = (peticion.query ?? {}) as Record<string, unknown>;
    const regionalSolicitada = idOpcional(query.regional_id, 'regional_id');
    const municipioId = idOpcional(query.municipio_id, 'municipio_id');
    const regionalId = regionalPermitida(peticion, regionalSolicitada);
    await validarMunicipio(municipioId, regionalId);

    const pagina = Math.max(1, enteroPositivo(query.pagina) ?? 1);
    const limite = Math.min(200, Math.max(1, enteroPositivo(query.limite) ?? 50));
    const offset = (pagina - 1) * limite;
    const busqueda = texto(query.q);
    const estado = texto(query.estado) || 'pendiente';
    const estadosValidos = new Set([
      'todos',
      'pendiente',
      'en_lote',
      'caratula_generada',
      'digitalizado',
      'incidencia'
    ]);
    if (!estadosValidos.has(estado)) {
      throw error400('estado_invalido', 'El estado de digitalización no es válido.');
    }

    const condiciones: string[] = ['TRUE'];
    const valores: unknown[] = [];
    const agregar = (valor: unknown) => {
      valores.push(valor);
      return `$${valores.length}`;
    };

    if (regionalId !== null) condiciones.push(`m.regional_id = ${agregar(regionalId)}`);
    if (municipioId !== null) condiciones.push(`s.ubi_municipio_id = ${agregar(municipioId)}`);
    if (busqueda) {
      const p = agregar(`%${busqueda}%`);
      condiciones.push(`(
        unaccent(s.folio) ILIKE unaccent(${p}) OR
        unaccent(s.nombre_solicitante) ILIKE unaccent(${p}) OR
        unaccent(COALESCE(s.curp, '')) ILIKE unaccent(${p})
      )`);
    }

    const existe = (valorEstado: string) =>
      `EXISTS (
        SELECT 1
          FROM digitalizacion_lote_solicitudes dls_e
         WHERE dls_e.solicitud_id = s.id
           AND dls_e.estado = '${valorEstado}'
      )`;

    // Pendiente = aun no digitalizado. Puede estar ya incluido en un lote o
    // tener caratula generada sin dejar de ser pendiente de digitalizacion.
    if (estado === 'pendiente') {
      condiciones.push(`NOT ${existe('digitalizado')}`);
    } else if (estado === 'en_lote') {
      condiciones.push(`EXISTS (
        SELECT 1 FROM digitalizacion_lote_solicitudes dls_e
         WHERE dls_e.solicitud_id = s.id
      )`);
    } else if (estado !== 'todos') {
      condiciones.push(existe(estado));
    }

    const where = condiciones.join(' AND ');
    const limiteParam = `$${valores.length + 1}`;
    const offsetParam = `$${valores.length + 2}`;

    const [{ rows }, conteo] = await Promise.all([
      pool.query(
        `SELECT
           s.id,
           s.folio,
           s.nombre_solicitante,
           s.ubi_municipio_id,
           m.nombre AS municipio,
           m.regional_id,
           dr.nombre AS regional,
           s.componente_id,
           c.nombre AS componente,
           COALESCE(dig.en_lote, FALSE) AS en_lote,
           COALESCE(dig.caratula_generada, FALSE) AS caratula_generada,
           COALESCE(dig.digitalizado, FALSE) AS digitalizado,
           COALESCE(dig.incidencia, FALSE) AS incidencia
         FROM solicitudes s
         JOIN municipios m ON m.id = s.ubi_municipio_id
         LEFT JOIN direcciones_regionales dr ON dr.id = m.regional_id
         LEFT JOIN componentes c ON c.id = s.componente_id
         LEFT JOIN LATERAL (
           SELECT
             (COUNT(*) > 0) AS en_lote,
             BOOL_OR(dls.estado = 'caratula_generada') AS caratula_generada,
             BOOL_OR(dls.estado = 'digitalizado') AS digitalizado,
             BOOL_OR(dls.estado = 'incidencia') AS incidencia
           FROM digitalizacion_lote_solicitudes dls
           WHERE dls.solicitud_id = s.id
         ) dig ON TRUE
         WHERE ${where}
         ORDER BY s.recibida_en DESC, s.id DESC
         LIMIT ${limiteParam} OFFSET ${offsetParam}`,
        [...valores, limite, offset]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
           FROM solicitudes s
           JOIN municipios m ON m.id = s.ubi_municipio_id
          WHERE ${where}`,
        valores
      )
    ]);

    const total = Number(conteo.rows[0]?.total ?? 0);
    return respuesta.status(200).send({
      items: rows,
      pagina,
      limite,
      total,
      paginas: Math.max(1, Math.ceil(total / limite)),
      filtros: {
        regional_id: regionalId,
        municipio_id: municipioId,
        estado,
        q: busqueda || null
      }
    });
  });

  // Crea un lote definido por el usuario a partir de una seleccion explicita.
  app.post('/api/digitalizacion/lotes', protegida, async (peticion, respuesta) => {
    const usuario = usuarioActual(peticion);
    const body = (peticion.body ?? {}) as Record<string, unknown>;
    const nombre = texto(body.nombre);
    if (nombre.length < 3 || nombre.length > 120) {
      throw error400('nombre_invalido', 'El nombre del lote debe tener entre 3 y 120 caracteres.');
    }
    if (!Array.isArray(body.solicitud_ids)) {
      throw error400('solicitudes_requeridas', 'Selecciona al menos una solicitud para el lote.');
    }

    const ids = [
      ...new Set(
        body.solicitud_ids
          .map((valor) => enteroPositivo(valor))
          .filter((id): id is number => id !== null)
      )
    ];
    if (ids.length === 0) {
      throw error400('solicitudes_requeridas', 'Selecciona al menos una solicitud para el lote.');
    }
    if (ids.length > 2000) {
      throw error400('lote_demasiado_grande', 'Un lote de preparación no puede exceder 2000 solicitudes.');
    }

    const filtroRegionalSolicitado = idOpcional(body.filtro_regional_id, 'filtro_regional_id');
    const filtroMunicipioId = idOpcional(body.filtro_municipio_id, 'filtro_municipio_id');
    const regionalId = regionalPermitida(peticion, filtroRegionalSolicitado);
    await validarMunicipio(filtroMunicipioId, regionalId);

    const condiciones = ['s.id = ANY($1::bigint[])'];
    const valores: unknown[] = [ids];
    if (regionalId !== null) {
      valores.push(regionalId);
      condiciones.push(`m.regional_id = $${valores.length}`);
    }
    if (filtroMunicipioId !== null) {
      valores.push(filtroMunicipioId);
      condiciones.push(`s.ubi_municipio_id = $${valores.length}`);
    }

    const { rows: accesibles } = await pool.query<{ id: string }>(
      `SELECT s.id::text AS id
         FROM solicitudes s
         JOIN municipios m ON m.id = s.ubi_municipio_id
        WHERE ${condiciones.join(' AND ')}`,
      valores
    );
    if (accesibles.length !== ids.length) {
      throw error403(
        'fuera_de_alcance',
        'Una o más solicitudes seleccionadas no existen o están fuera de tu alcance territorial.'
      );
    }

    const criterios =
      typeof body.criterios === 'object' && body.criterios !== null && !Array.isArray(body.criterios)
        ? body.criterios
        : {};

    const lote = await enTransaccion(async (cliente) => {
      const secuencia = await cliente.query<{ numero: string }>(
        "SELECT nextval('digitalizacion_lote_codigo_seq')::text AS numero"
      );
      const numero = Number(secuencia.rows[0].numero);
      const codigo = `DIG-${new Date().getFullYear()}-${String(numero).padStart(6, '0')}`;

      const creado = await cliente.query<{
        id: string;
        codigo: string;
        nombre: string;
        estado: string;
        creado_en: string;
      }>(
        `INSERT INTO digitalizacion_lotes (
           codigo, nombre, filtro_regional_id, filtro_municipio_id,
           criterios, creado_por
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         RETURNING id::text, codigo, nombre, estado, creado_en::text`,
        [codigo, nombre, regionalId, filtroMunicipioId, JSON.stringify(criterios), usuario.id]
      );
      const fila = creado.rows[0];

      await cliente.query(
        `INSERT INTO digitalizacion_lote_solicitudes (
           lote_id, solicitud_id, orden, agregado_por
         )
         SELECT $1, x.solicitud_id, x.orden, $2
           FROM unnest($3::bigint[]) WITH ORDINALITY AS x(solicitud_id, orden)`,
        [fila.id, usuario.id, ids]
      );

      await bitacoraEnTransaccion(cliente, {
        usuarioId: usuario.id,
        accion: 'digitalizacion_lote_creado',
        entidad: 'digitalizacion_lotes',
        entidadId: fila.id,
        detalle: {
          codigo,
          nombre,
          solicitudes: ids.length,
          filtro_regional_id: regionalId,
          filtro_municipio_id: filtroMunicipioId
        },
        ip: peticion.ip,
        userAgent: peticion.headers['user-agent'] ?? null
      });

      return { ...fila, solicitudes: ids.length };
    });

    return respuesta.status(201).send(lote);
  });

  // Lista de lotes. Para usuarios regionales, los conteos y la visibilidad se
  // recortan a solicitudes cuyo predio pertenece a su propia Regional.
  app.get('/api/digitalizacion/lotes', protegida, async (peticion, respuesta) => {
    const query = (peticion.query ?? {}) as Record<string, unknown>;
    const regionalSolicitada = idOpcional(query.regional_id, 'regional_id');
    const regionalId = regionalPermitida(peticion, regionalSolicitada);

    const valores: unknown[] = [];
    const condiciones: string[] = ["dl.estado <> 'cancelado'"];
    if (regionalId !== null) {
      valores.push(regionalId);
      condiciones.push(`m.regional_id = $${valores.length}`);
    }

    const { rows } = await pool.query(
      `SELECT
         dl.id,
         dl.codigo,
         dl.nombre,
         dl.filtro_regional_id,
         dl.filtro_municipio_id,
         dl.estado,
         dl.creado_en,
         dl.creado_por,
         u.nombre_completo AS creado_por_nombre,
         COUNT(dls.solicitud_id)::int AS solicitudes,
         COUNT(*) FILTER (WHERE dls.estado = 'caratula_generada')::int AS caratulas_generadas,
         COUNT(*) FILTER (WHERE dls.estado = 'digitalizado')::int AS digitalizados,
         COUNT(*) FILTER (WHERE dls.estado = 'incidencia')::int AS incidencias
       FROM digitalizacion_lotes dl
       JOIN usuarios u ON u.id = dl.creado_por
       JOIN digitalizacion_lote_solicitudes dls ON dls.lote_id = dl.id
       JOIN solicitudes s ON s.id = dls.solicitud_id
       JOIN municipios m ON m.id = s.ubi_municipio_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY dl.id, u.nombre_completo
       ORDER BY dl.creado_en DESC
       LIMIT 200`,
      valores
    );

    return respuesta.status(200).send({ items: rows });
  });

  app.get('/api/digitalizacion/lotes/:id', protegida, async (peticion, respuesta) => {
    const usuario = usuarioActual(peticion);
    const loteId = enteroPositivo((peticion.params as { id?: string }).id);
    if (loteId === null) throw error404('Lote no encontrado.');
    const regionalId = regionalForzada(usuario);

    const valores: unknown[] = [loteId];
    const territorial = regionalId !== null ? 'AND m.regional_id = $2' : '';
    if (regionalId !== null) valores.push(regionalId);

    const { rows } = await pool.query(
      `SELECT
         dl.id AS lote_id,
         dl.codigo,
         dl.nombre AS lote_nombre,
         dl.estado AS lote_estado,
         dls.orden,
         dls.estado,
         s.id AS solicitud_id,
         s.folio,
         s.nombre_solicitante,
         m.id AS municipio_id,
         m.nombre AS municipio,
         m.regional_id,
         dr.nombre AS regional,
         s.componente_id,
         c.nombre AS componente
       FROM digitalizacion_lotes dl
       JOIN digitalizacion_lote_solicitudes dls ON dls.lote_id = dl.id
       JOIN solicitudes s ON s.id = dls.solicitud_id
       JOIN municipios m ON m.id = s.ubi_municipio_id
       LEFT JOIN direcciones_regionales dr ON dr.id = m.regional_id
       LEFT JOIN componentes c ON c.id = s.componente_id
       WHERE dl.id = $1 ${territorial}
       ORDER BY dls.orden`,
      valores
    );
    if (rows.length === 0) throw error404('Lote no encontrado o fuera de tu alcance.');

    return respuesta.status(200).send({
      lote: {
        id: (rows[0] as any).lote_id,
        codigo: (rows[0] as any).codigo,
        nombre: (rows[0] as any).lote_nombre,
        estado: (rows[0] as any).lote_estado
      },
      solicitudes: rows.map((fila: any) => ({
        orden: fila.orden,
        estado: fila.estado,
        solicitud_id: fila.solicitud_id,
        folio: fila.folio,
        nombre_solicitante: fila.nombre_solicitante,
        municipio_id: fila.municipio_id,
        municipio: fila.municipio,
        regional_id: fila.regional_id,
        regional: fila.regional,
        componente_id: fila.componente_id,
        componente: fila.componente
      }))
    });
  });
}
