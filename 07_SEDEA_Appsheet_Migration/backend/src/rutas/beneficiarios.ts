// Padron de beneficiarios (solo lectura). El aislamiento por Direccion
// Regional se aplica SIEMPRE en la capa SQL, nunca en el frontend.
import type { FastifyInstance } from 'fastify';
import { esquemaConsultaBeneficiarios, ROLES_CORRECCION } from '@sedea/shared';
import { consultar, consultarUna } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import { errorNoAutorizado, errorNoEncontrado, errorProhibido } from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { aplicarCorreccion } from '../servicios/correcciones.js';
import { ErrorApi } from '../plugins/errores.js';

/**
 * El padron de campo es exclusivo de capturista y admin. El rol editor_datos
 * trabaja en /api/staging y /api/correcciones, nunca aqui (regla del build 2,
 * que el build 3 NO debilita: la excepcion es solo el PATCH de mas abajo).
 */
const ROLES_PADRON = ['capturista', 'auditor', 'admin'];

const SELECT_BASE = `
  SELECT b.id, b.folio, b.curp, b.nombre_completo, b.regional_id, r.nombre AS regional_nombre,
         b.municipio_id, m.nombre AS municipio_nombre, b.colonia, b.seccion, b.localidad,
         b.domicilio, b.telefono, b.tipo_apoyo_id, t.nombre AS tipo_apoyo_nombre,
         b.cantidad_asignada, b.datos_extra, b.actualizado_en,
         (SELECT count(*)::int FROM capturas c WHERE c.beneficiario_id = b.id) AS total_capturas
    FROM beneficiarios b
    LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
    LEFT JOIN municipios m ON m.id = b.municipio_id
    LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
`;

export default async function rutasBeneficiarios(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/beneficiarios',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_PADRON)] },
    async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();

    const q = esquemaConsultaBeneficiarios.parse(peticion.query ?? {});
    const forzada = regionalForzada(usuario);
    // Si el usuario tiene Regional forzada se ignora cualquier regional_id del cliente.
    const regional = forzada ?? q.regional_id ?? null;

    const condiciones: string[] = [];
    const parametros: unknown[] = [];

    if (regional) {
      parametros.push(regional);
      condiciones.push(`b.regional_id = $${parametros.length}`);
    }
    if (q.municipio_id) {
      parametros.push(q.municipio_id);
      condiciones.push(`b.municipio_id = $${parametros.length}`);
    }
    if (q.colonia) {
      parametros.push(q.colonia);
      condiciones.push(`b.colonia = $${parametros.length}`);
    }
    if (q.seccion) {
      parametros.push(q.seccion);
      condiciones.push(`b.seccion = $${parametros.length}`);
    }
    if (q.since) {
      parametros.push(q.since);
      condiciones.push(`b.actualizado_en > $${parametros.length}::timestamptz`);
    }
    if (q.q && q.q.trim()) {
      parametros.push(`%${q.q.trim()}%`);
      const i = parametros.length;
      // Busqueda insensible a mayusculas y acentos.
      condiciones.push(
        `(unaccent(lower(b.nombre_completo)) LIKE unaccent(lower($${i}))
          OR unaccent(lower(coalesce(b.curp, ''))) LIKE unaccent(lower($${i}))
          OR unaccent(lower(b.folio)) LIKE unaccent(lower($${i})))`
      );
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const totalFila = await consultarUna<{ total: number }>(
      `SELECT count(*)::int AS total FROM beneficiarios b ${where}`,
      parametros
    );
    const total = totalFila?.total ?? 0;

    const desplazamiento = (q.page - 1) * q.page_size;
    const filas = await consultar(
      `${SELECT_BASE} ${where} ORDER BY b.id LIMIT ${q.page_size} OFFSET ${desplazamiento}`,
      parametros
    );

    // La primera pagina de una descarga se considera inicio de sincronizacion.
    if (q.page === 1) {
      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'sync_padron',
        entidad: 'beneficiario',
        detalle: { total, regional_id: regional, since: q.since ?? null }
      });
    }

    return respuesta.status(200).send({
      data: filas,
      page: q.page,
      page_size: q.page_size,
      total,
      has_more: desplazamiento + filas.length < total
    });
  }
  );

  app.get<{ Params: { id: string } }>(
    '/api/beneficiarios/:id',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_PADRON)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('Beneficiario no encontrado.');

      const fila = await consultarUna<any>(`${SELECT_BASE} WHERE b.id = $1`, [id]);
      if (!fila) throw errorNoEncontrado('Beneficiario no encontrado.');

      const forzada = regionalForzada(usuario);
      if (forzada !== null && fila.regional_id !== forzada) {
        throw errorProhibido('El beneficiario pertenece a otra Direccion Regional.');
      }

      return respuesta.status(200).send(fila);
    }
  );

  /**
   * E26 - Edicion correctiva de datos de contacto y ubicacion.
   *
   * Unica excepcion a la regla anterior: aqui SI entran editor_datos y admin,
   * y quedan fuera capturista y auditor. La lista blanca (colonia, domicilio,
   * telefono, seccion, municipio_id) es estricta: CURP y folio nunca se
   * editan porque son la identidad legal del expediente.
   *
   * No existe POST ni DELETE de beneficiarios: todo beneficiario nace de una
   * importacion de padron oficial revisada en staging (decision D11).
   */
  app.patch<{ Params: { id: string } }>(
    '/api/beneficiarios/:id',
    { preHandler: [app.autenticar] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      if (!(ROLES_CORRECCION as readonly string[]).includes(usuario.rol)) {
        throw new ErrorApi(
          403,
          'rol_no_autorizado',
          'Tu rol no puede editar datos de beneficiarios.'
        );
      }

      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('El beneficiario no existe.');

      const { beneficiario, cambios } = await aplicarCorreccion(
        { id: usuario.id, rol: usuario.rol, regional_id: usuario.regional_id ?? null },
        id,
        peticion.body ?? {},
        {
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        }
      );

      return respuesta.status(200).send({ ok: true, beneficiario, cambios });
    }
  );
}
