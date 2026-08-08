// Lectura para correccion de datos en produccion (E27-E29).
// Vive en su propio espacio /api/correcciones para no debilitar la regla del
// build 2: la coleccion /api/beneficiarios sigue devolviendo 403 al editor.
import type { FastifyInstance } from 'fastify';
import { ROLES_CORRECCION } from '@sedea/shared';
import { consultar, consultarUna } from '../db/pool.js';
import { errorNoEncontrado, errorProhibido } from '../plugins/errores.js';
import {
  historialCorrecciones,
  obtenerBeneficiarioParaCorreccion
} from '../servicios/correcciones.js';

/** Regional a la que se restringe el editor (admin y editor central: ninguna). */
function regionalDelEditor(usuario: { rol: string; regional_id: number | null }): number | null {
  if (usuario.rol === 'admin') return null;
  return usuario.regional_id ?? null;
}

export default async function rutasCorrecciones(app: FastifyInstance): Promise<void> {
  const soloEditores = {
    preHandler: [app.autenticar, app.requiereRol(...ROLES_CORRECCION)]
  };

  // E27 - Buscador de beneficiarios a corregir.
  app.get('/api/correcciones/beneficiarios', soloEditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const q = peticion.query as Record<string, string>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));

    const condiciones: string[] = [];
    const parametros: unknown[] = [];

    const forzada = regionalDelEditor(usuario);
    const regional = forzada ?? (q.regional_id ? Number(q.regional_id) : null);
    if (regional) {
      parametros.push(regional);
      condiciones.push(`b.regional_id = $${parametros.length}`);
    }
    if (q.municipio_id) {
      parametros.push(Number(q.municipio_id));
      condiciones.push(`b.municipio_id = $${parametros.length}`);
    }
    if (q.q && q.q.trim().length >= 2) {
      parametros.push(`%${q.q.trim()}%`);
      const i = parametros.length;
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
    const desplazamiento = (page - 1) * pageSize;

    const data = await consultar(
      `SELECT b.id, b.folio, b.curp, b.nombre_completo, r.nombre AS regional,
              b.municipio_id, m.nombre AS municipio, b.colonia, b.seccion,
              b.domicilio, b.telefono,
              (SELECT count(*)::int FROM capturas c WHERE c.beneficiario_id = b.id) AS capturas
         FROM beneficiarios b
         LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
         LEFT JOIN municipios m ON m.id = b.municipio_id
         ${where}
        ORDER BY b.nombre_completo
        LIMIT ${pageSize} OFFSET ${desplazamiento}`,
      parametros
    );

    return respuesta.status(200).send({
      data,
      page,
      page_size: pageSize,
      total,
      has_more: desplazamiento + data.length < total
    });
  });

  // E28 - Ficha completa + municipios disponibles para el select.
  app.get<{ Params: { id: string } }>(
    '/api/correcciones/beneficiarios/:id',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('El beneficiario no existe.');

      const beneficiario = await obtenerBeneficiarioParaCorreccion(id);
      if (!beneficiario) throw errorNoEncontrado('El beneficiario no existe.');

      const forzada = regionalDelEditor(usuario);
      if (forzada !== null && beneficiario.regional_id !== forzada) {
        throw errorProhibido('El beneficiario pertenece a otra Dirección Regional.');
      }

      const municipios_disponibles = await consultar(
        forzada
          ? `SELECT m.id, m.nombre, m.regional_id, r.nombre AS regional
               FROM municipios m LEFT JOIN direcciones_regionales r ON r.id = m.regional_id
              WHERE m.activo AND m.regional_id = $1 ORDER BY m.nombre`
          : `SELECT m.id, m.nombre, m.regional_id, r.nombre AS regional
               FROM municipios m LEFT JOIN direcciones_regionales r ON r.id = m.regional_id
              WHERE m.activo ORDER BY r.nombre, m.nombre`,
        forzada ? [forzada] : []
      );

      return respuesta.status(200).send({ ...beneficiario, municipios_disponibles });
    }
  );

  // E29 - Historial de correcciones leido de la bitacora.
  app.get<{ Params: { id: string } }>(
    '/api/correcciones/beneficiarios/:id/historial',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const beneficiario = await obtenerBeneficiarioParaCorreccion(id);
      if (!beneficiario) throw errorNoEncontrado('El beneficiario no existe.');

      const forzada = regionalDelEditor(usuario);
      if (forzada !== null && beneficiario.regional_id !== forzada) {
        throw errorProhibido('El beneficiario pertenece a otra Dirección Regional.');
      }

      return respuesta.status(200).send({ data: await historialCorrecciones(id) });
    }
  );
}
