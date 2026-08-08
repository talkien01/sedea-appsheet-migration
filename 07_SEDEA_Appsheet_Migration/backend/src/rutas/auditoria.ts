// Panel de auditoria: consulta de capturas, GeoJSON para el mapa y
// exportaciones (CSV y expediente PDF/CSV).
import type { FastifyInstance } from 'fastify';
import { esquemaConsultaAuditoria, ROLES_AUDITORIA } from '@sedea/shared';
import { consultar, consultarUna } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import { errorNoAutorizado, errorNoEncontrado, errorProhibido } from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { generarCsv, formatearFecha } from '../servicios/csv.js';
import { generarExpedientePdf } from '../servicios/pdf.js';

/** Construye el WHERE comun de las consultas de auditoria. */
function construirFiltros(
  usuario: { rol: string; regional_id: number | null },
  q: ReturnType<typeof esquemaConsultaAuditoria.parse>
): { where: string; parametros: unknown[] } {
  const condiciones: string[] = [];
  const parametros: unknown[] = [];

  const forzada = regionalForzada(usuario as any);
  const regional = forzada ?? q.regional_id ?? null;

  if (regional) {
    parametros.push(regional);
    condiciones.push(`b.regional_id = $${parametros.length}`);
  }
  if (q.municipio_id) {
    parametros.push(q.municipio_id);
    condiciones.push(`b.municipio_id = $${parametros.length}`);
  }
  if (q.desde) {
    parametros.push(q.desde);
    condiciones.push(`c.capturado_en >= $${parametros.length}::timestamptz`);
  }
  if (q.hasta) {
    parametros.push(q.hasta);
    condiciones.push(`c.capturado_en <= $${parametros.length}::timestamptz`);
  }
  if (q.q && q.q.trim()) {
    parametros.push(`%${q.q.trim()}%`);
    const i = parametros.length;
    condiciones.push(
      `(unaccent(lower(b.nombre_completo)) LIKE unaccent(lower($${i}))
        OR unaccent(lower(coalesce(b.curp, ''))) LIKE unaccent(lower($${i})))`
    );
  }

  return {
    where: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
    parametros
  };
}

const SELECT_CAPTURAS = `
  SELECT c.uuid, c.foto_url, c.lat, c.lng, c.precision_m, c.capturado_en, c.sincronizado_en,
         c.observaciones, c.cantidad_entregada, c.estado_sync,
         u.nombre_completo AS capturista,
         b.id AS beneficiario_id, b.folio, b.nombre_completo AS beneficiario_nombre, b.curp,
         b.colonia, b.seccion, r.nombre AS regional_nombre, m.nombre AS municipio_nombre,
         b.municipio_id, b.regional_id
    FROM capturas c
    JOIN beneficiarios b ON b.id = c.beneficiario_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
    LEFT JOIN municipios m ON m.id = b.municipio_id
`;

export default async function rutasAuditoria(app: FastifyInstance): Promise<void> {
  const soloAuditores = { preHandler: [app.autenticar, app.requiereRol(...ROLES_AUDITORIA)] };

  // E9 - Listado paginado de capturas.
  app.get('/api/auditoria/capturas', soloAuditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const q = esquemaConsultaAuditoria.parse(peticion.query ?? {});
    const { where, parametros } = construirFiltros(usuario, q);

    const totalFila = await consultarUna<{ total: number }>(
      `SELECT count(*)::int AS total FROM capturas c JOIN beneficiarios b ON b.id = c.beneficiario_id ${where}`,
      parametros
    );

    const filas = await consultar(
      `${SELECT_CAPTURAS} ${where} ORDER BY c.capturado_en DESC
       LIMIT ${q.page_size} OFFSET ${(q.page - 1) * q.page_size}`,
      parametros
    );

    const data = filas.map((f: any) => ({
      uuid: f.uuid,
      foto_url: f.foto_url,
      lat: f.lat,
      lng: f.lng,
      precision_m: f.precision_m,
      capturado_en: f.capturado_en,
      capturista: f.capturista,
      observaciones: f.observaciones,
      beneficiario: {
        id: f.beneficiario_id,
        folio: f.folio,
        nombre_completo: f.beneficiario_nombre,
        curp: f.curp,
        regional_nombre: f.regional_nombre,
        municipio_nombre: f.municipio_nombre,
        municipio_id: f.municipio_id,
        regional_id: f.regional_id,
        colonia: f.colonia,
        seccion: f.seccion
      }
    }));

    return respuesta.status(200).send({
      data,
      page: q.page,
      page_size: q.page_size,
      total: totalFila?.total ?? 0
    });
  });

  // E10 - GeoJSON para pintar los marcadores en Leaflet.
  app.get('/api/auditoria/geojson', soloAuditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const q = esquemaConsultaAuditoria.parse(peticion.query ?? {});
    const { where, parametros } = construirFiltros(usuario, q);

    const filas = await consultar<any>(
      `SELECT c.uuid, ST_AsGeoJSON(c.geom) AS geometria, c.foto_url, c.precision_m,
              c.capturado_en, u.nombre_completo AS capturista,
              b.id AS beneficiario_id, b.nombre_completo AS beneficiario_nombre, b.curp
         FROM capturas c
         JOIN beneficiarios b ON b.id = c.beneficiario_id
         LEFT JOIN usuarios u ON u.id = c.usuario_id
         ${where}
        ORDER BY c.capturado_en DESC
        LIMIT 2000`,
      parametros
    );

    return respuesta.status(200).send({
      type: 'FeatureCollection',
      features: filas.map((f) => ({
        type: 'Feature',
        geometry: JSON.parse(f.geometria),
        properties: {
          uuid: f.uuid,
          foto_url: f.foto_url,
          precision_m: f.precision_m,
          capturado_en: f.capturado_en,
          capturista: f.capturista,
          beneficiario_id: f.beneficiario_id,
          beneficiario_nombre: f.beneficiario_nombre,
          curp: f.curp
        }
      }))
    });
  });

  const COLUMNAS_EXPORT = [
    'uuid',
    'folio',
    'beneficiario',
    'curp',
    'regional',
    'municipio',
    'colonia',
    'seccion',
    'lat',
    'lng',
    'precision_m',
    'capturado_en',
    'capturista',
    'observaciones'
  ];

  // E11 - Exportacion CSV de todas las filas del filtro actual.
  app.get('/api/auditoria/export.csv', soloAuditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const q = esquemaConsultaAuditoria.parse(peticion.query ?? {});
    const { where, parametros } = construirFiltros(usuario, q);

    const filas = await consultar<any>(
      `${SELECT_CAPTURAS} ${where} ORDER BY c.capturado_en DESC LIMIT 50000`,
      parametros
    );

    const csv = generarCsv(
      COLUMNAS_EXPORT,
      filas.map((f) => [
        f.uuid,
        f.folio,
        f.beneficiario_nombre,
        f.curp ?? '',
        f.regional_nombre ?? '',
        f.municipio_nombre ?? '',
        f.colonia ?? '',
        f.seccion ?? '',
        f.lat,
        f.lng,
        f.precision_m,
        formatearFecha(f.capturado_en),
        f.capturista ?? '',
        f.observaciones ?? ''
      ])
    );

    await registrarAuditoria(peticion, {
      usuarioId: usuario.id,
      accion: 'export_csv',
      entidad: 'captura',
      detalle: { filas: filas.length, filtros: q }
    });

    const nombre = `capturas_sedea_${new Date().toISOString().slice(0, 10)}.csv`;
    return respuesta
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nombre}"`)
      .status(200)
      .send(csv);
  });

  /** Carga el beneficiario y sus capturas verificando el alcance por Regional. */
  async function cargarExpediente(usuario: any, id: number) {
    const beneficiario = await consultarUna<any>(
      `SELECT b.id, b.folio, b.nombre_completo, b.curp, b.colonia, b.seccion, b.localidad,
              b.domicilio, b.regional_id, r.nombre AS regional_nombre,
              m.nombre AS municipio_nombre, t.nombre AS tipo_apoyo_nombre
         FROM beneficiarios b
         LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
         LEFT JOIN municipios m ON m.id = b.municipio_id
         LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
        WHERE b.id = $1`,
      [id]
    );
    if (!beneficiario) throw errorNoEncontrado('Beneficiario no encontrado.');

    const forzada = regionalForzada(usuario);
    if (forzada !== null && beneficiario.regional_id !== forzada) {
      throw errorProhibido('El beneficiario pertenece a otra Direccion Regional.');
    }

    const capturas = await consultar<any>(
      `SELECT c.uuid, c.foto_url, c.lat, c.lng, c.precision_m, c.capturado_en,
              c.observaciones, c.cantidad_entregada, u.nombre_completo AS capturista
         FROM capturas c
         LEFT JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.beneficiario_id = $1
        ORDER BY c.capturado_en DESC`,
      [id]
    );

    return { beneficiario, capturas };
  }

  // E12/E13 - Expediente por beneficiario. El sufijo del archivo (.pdf o .csv)
  // decide el formato; se resuelve en el handler para no depender de rutas
  // parametricas con extension.
  app.get<{ Params: { archivo: string } }>(
    '/api/auditoria/expediente/:archivo',
    soloAuditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const archivo = peticion.params.archivo;
      const formato = archivo.endsWith('.pdf') ? 'pdf' : archivo.endsWith('.csv') ? 'csv' : null;
      if (!formato) throw errorNoEncontrado('Formato de expediente no soportado (usa .pdf o .csv).');

      const id = Number(archivo.replace(/\.(pdf|csv)$/i, ''));
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('Beneficiario no encontrado.');

      const { beneficiario, capturas } = await cargarExpediente(usuario, id);

      if (formato === 'csv') {
        const csv = generarCsv(
          COLUMNAS_EXPORT,
          capturas.map((c) => [
            c.uuid,
            beneficiario.folio,
            beneficiario.nombre_completo,
            beneficiario.curp ?? '',
            beneficiario.regional_nombre ?? '',
            beneficiario.municipio_nombre ?? '',
            beneficiario.colonia ?? '',
            beneficiario.seccion ?? '',
            c.lat,
            c.lng,
            c.precision_m,
            formatearFecha(c.capturado_en),
            c.capturista ?? '',
            c.observaciones ?? ''
          ])
        );

        await registrarAuditoria(peticion, {
          usuarioId: usuario.id,
          accion: 'export_csv',
          entidad: 'beneficiario',
          entidadId: id,
          detalle: { capturas: capturas.length }
        });

        return respuesta
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="expediente_${beneficiario.folio}.csv"`
          )
          .status(200)
          .send(csv);
      }

      const pdf = await generarExpedientePdf({
        beneficiario,
        capturas,
        generadoPor: `${usuario.nombre_completo} (${usuario.usuario})`
      });

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'export_pdf',
        entidad: 'beneficiario',
        entidadId: id,
        detalle: { capturas: capturas.length }
      });

      return respuesta
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="expediente_${beneficiario.folio}.pdf"`
        )
        .status(200)
        .send(pdf);
    }
  );

  // E14 - Bitacora (solo admin).
  app.get(
    '/api/auditoria/log',
    { preHandler: [app.autenticar, app.requiereRol('admin')] },
    async (peticion, respuesta) => {
      if (!peticion.usuario) throw errorNoAutorizado();
      const q = peticion.query as Record<string, string>;
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const pageSize = Math.min(500, Math.max(1, Number(q.page_size ?? 100) || 100));

      const condiciones: string[] = [];
      const parametros: unknown[] = [];
      if (q.accion) {
        parametros.push(q.accion);
        condiciones.push(`a.accion = $${parametros.length}`);
      }
      const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

      const totalFila = await consultarUna<{ total: number }>(
        `SELECT count(*)::int AS total FROM auditoria_log a ${where}`,
        parametros
      );

      const filas = await consultar(
        `SELECT a.id, a.usuario_id, u.usuario AS usuario, a.accion, a.entidad, a.entidad_id,
                a.detalle, a.ip::text AS ip, a.user_agent, a.creado_en
           FROM auditoria_log a
           LEFT JOIN usuarios u ON u.id = a.usuario_id
           ${where}
          ORDER BY a.id DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        parametros
      );

      return respuesta.status(200).send({
        data: filas,
        page,
        page_size: pageSize,
        total: totalFila?.total ?? 0
      });
    }
  );
}
