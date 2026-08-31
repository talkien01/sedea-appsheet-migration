// Lectura y correccion controlada de datos en produccion (E27-E29 + solicitudes).
// Vive en su propio espacio /api/correcciones para no debilitar los endpoints
// operativos de captura. Solo editor_datos y admin pueden entrar aqui.
import type { FastifyInstance } from 'fastify';
import { PATRON_CURP, ROLES_CORRECCION } from '@sedea/shared';
import { consultar, consultarUna, pool } from '../db/pool.js';
import { ErrorApi, errorNoEncontrado, errorProhibido } from '../plugins/errores.js';
import {
  historialCorrecciones,
  obtenerBeneficiarioParaCorreccion
} from '../servicios/correcciones.js';
import { bitacoraEnTransaccion, enTransaccion } from '../servicios/promocion.js';

/** Regional a la que se restringe el editor (admin y editor central: ninguna). */
function regionalDelEditor(usuario: { rol: string; regional_id: number | null }): number | null {
  if (usuario.rol.split('+').includes('admin')) return null;
  return usuario.regional_id ?? null;
}

function error422(codigo: string, mensaje: string): ErrorApi {
  return new ErrorApi(422, codigo, mensaje);
}

function normalizarNombre(valor: unknown): string | null {
  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ');
  return limpio ? limpio.toUpperCase() : null;
}

function normalizarCurp(valor: unknown): string | null {
  const limpio = String(valor ?? '').trim().toUpperCase();
  return limpio || null;
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

  // -----------------------------------------------------------------------
  // Correccion de solicitudes ya registradas.
  // Lista blanca inicial y deliberadamente pequena: nombre y CURP.
  // Folio, programa, concepto, montos y demas datos operativos NO se tocan.
  // -----------------------------------------------------------------------
  app.get('/api/correcciones/solicitudes', soloEditores, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const q = peticion.query as Record<string, string>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));
    const parametros: unknown[] = [];
    const condiciones: string[] = [];

    const forzada = regionalDelEditor(usuario);
    if (forzada !== null) {
      parametros.push(forzada);
      condiciones.push(`mu.regional_id = $${parametros.length}`);
    }
    if (q.q && q.q.trim().length >= 2) {
      parametros.push(`%${q.q.trim()}%`);
      const i = parametros.length;
      condiciones.push(
        `(unaccent(lower(s.nombre_solicitante)) LIKE unaccent(lower($${i}))
          OR unaccent(lower(coalesce(s.curp, ''))) LIKE unaccent(lower($${i}))
          OR unaccent(lower(s.folio)) LIKE unaccent(lower($${i})))`
      );
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const totalFila = await consultarUna<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM solicitudes s
         LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
         ${where}`,
      parametros
    );
    const total = totalFila?.total ?? 0;
    const desplazamiento = (page - 1) * pageSize;
    const data = await consultar(
      `SELECT s.id, s.folio, s.nombre_solicitante, s.curp, s.tipo_persona,
              s.recibida_en, mu.nombre AS municipio, dr.nombre AS regional,
              (SELECT count(*)::int FROM beneficiarios b WHERE b.solicitud_id = s.id) AS beneficiarios
         FROM solicitudes s
         LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
         LEFT JOIN direcciones_regionales dr ON dr.id = mu.regional_id
         ${where}
        ORDER BY s.recibida_en DESC, s.id DESC
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

  app.get<{ Params: { id: string } }>(
    '/api/correcciones/solicitudes/:id',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('La solicitud no existe.');

      const solicitud = await consultarUna<any>(
        `SELECT s.id, s.folio, s.nombre_solicitante, s.curp, s.tipo_persona,
                s.recibida_en, s.ubi_municipio_id, mu.nombre AS municipio,
                mu.regional_id AS regional_id, dr.nombre AS regional,
                (SELECT count(*)::int FROM beneficiarios b WHERE b.solicitud_id = s.id) AS beneficiarios
           FROM solicitudes s
           LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
           LEFT JOIN direcciones_regionales dr ON dr.id = mu.regional_id
          WHERE s.id = $1`,
        [id]
      );
      if (!solicitud) throw errorNoEncontrado('La solicitud no existe.');
      const forzada = regionalDelEditor(usuario);
      if (forzada !== null && Number(solicitud.regional_id) !== forzada) {
        throw errorProhibido('La solicitud pertenece a otra Dirección Regional.');
      }

      const historial = await consultar<any>(
        `SELECT a.creado_en AS fecha, u.nombre_completo AS usuario, a.detalle
           FROM auditoria_log a
           LEFT JOIN usuarios u ON u.id = a.usuario_id
          WHERE a.accion = 'solicitud_editada'
            AND a.entidad = 'solicitud'
            AND a.entidad_id = $1
          ORDER BY a.id DESC LIMIT 50`,
        [String(id)]
      );

      return respuesta.status(200).send({
        ...solicitud,
        historial: historial.map((h) => ({
          fecha: h.fecha,
          usuario: h.usuario ?? null,
          motivo: h.detalle?.motivo ?? null,
          cambios: Array.isArray(h.detalle?.cambios) ? h.detalle.cambios : [],
          beneficiarios_actualizados: h.detalle?.beneficiarios_actualizados ?? 0
        }))
      });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/api/correcciones/solicitudes/:id',
    soloEditores,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('La solicitud no existe.');
      if (!peticion.body || typeof peticion.body !== 'object' || Array.isArray(peticion.body)) {
        throw error422('payload_invalido', 'Datos inválidos.');
      }
      const cuerpo = peticion.body as Record<string, unknown>;
      const permitidas = new Set(['nombre_solicitante', 'curp', 'motivo']);
      const desconocidas = Object.keys(cuerpo).filter((k) => !permitidas.has(k));
      if (desconocidas.length) {
        throw error422('campo_no_editable', `Los campos ${desconocidas.join(', ')} no son editables.`);
      }

      const motivo = String(cuerpo.motivo ?? '').trim();
      if (motivo.length < 5 || motivo.length > 500) {
        throw error422('motivo_requerido', 'Escribe un motivo de corrección de al menos 5 caracteres.');
      }
      const quiereNombre = Object.prototype.hasOwnProperty.call(cuerpo, 'nombre_solicitante');
      const quiereCurp = Object.prototype.hasOwnProperty.call(cuerpo, 'curp');
      if (!quiereNombre && !quiereCurp) {
        throw error422('sin_cambios', 'No se envió ningún campo editable.');
      }

      const resultado = await enTransaccion(async (cliente) => {
        const actualRes = await cliente.query<any>(
          `SELECT s.id, s.folio, s.nombre_solicitante, s.curp, s.tipo_persona,
                  s.ubi_municipio_id, mu.regional_id
             FROM solicitudes s
             LEFT JOIN municipios mu ON mu.id = s.ubi_municipio_id
            WHERE s.id = $1 FOR UPDATE OF s`,
          [id]
        );
        const actual = actualRes.rows[0];
        if (!actual) throw errorNoEncontrado('La solicitud no existe.');
        const forzada = regionalDelEditor(usuario);
        if (forzada !== null && Number(actual.regional_id) !== forzada) {
          throw errorProhibido('La solicitud pertenece a otra Dirección Regional.');
        }

        const nuevoNombre = quiereNombre ? normalizarNombre(cuerpo.nombre_solicitante) : actual.nombre_solicitante;
        if (!nuevoNombre) throw error422('nombre_requerido', 'El nombre del solicitante no puede quedar vacío.');
        if (nuevoNombre.length > 300) throw error422('nombre_invalido', 'El nombre es demasiado largo.');

        const nuevaCurp = quiereCurp ? normalizarCurp(cuerpo.curp) : (actual.curp ?? null);
        if (actual.tipo_persona === 'fisica' && quiereCurp && !nuevaCurp) {
          throw error422('curp_requerida', 'La CURP es obligatoria para persona física.');
        }
        if (nuevaCurp && !PATRON_CURP.test(nuevaCurp)) {
          throw error422('curp_invalida', 'La CURP no tiene el formato correcto.');
        }

        if (quiereCurp && nuevaCurp && nuevaCurp !== String(actual.curp ?? '').trim().toUpperCase()) {
          const conflicto = await cliente.query<any>(
            `SELECT s2.folio, ta.nombre AS concepto
               FROM solicitud_conceptos sc_actual
               JOIN solicitud_conceptos sc2 ON sc2.tipo_apoyo_id = sc_actual.tipo_apoyo_id
               JOIN solicitudes s2 ON s2.id = sc2.solicitud_id
               LEFT JOIN tipos_apoyo ta ON ta.id = sc2.tipo_apoyo_id
              WHERE sc_actual.solicitud_id = $1
                AND s2.id <> $1
                AND upper(btrim(coalesce(s2.curp, ''))) = $2
              ORDER BY s2.recibida_en, s2.id
              LIMIT 1`,
            [id, nuevaCurp]
          );
          if (conflicto.rows[0]) {
            throw error422(
              'curp_concepto_duplicado',
              `La CURP ya tiene el mismo concepto en la solicitud ${conflicto.rows[0].folio}.`
            );
          }
        }

        const cambios: Array<{ campo: string; anterior: unknown; nuevo: unknown }> = [];
        if (quiereNombre && nuevoNombre !== actual.nombre_solicitante) {
          cambios.push({ campo: 'nombre_solicitante', anterior: actual.nombre_solicitante, nuevo: nuevoNombre });
        }
        if (quiereCurp && String(nuevaCurp ?? '') !== String(actual.curp ?? '')) {
          cambios.push({ campo: 'curp', anterior: actual.curp ?? null, nuevo: nuevaCurp });
        }
        if (cambios.length === 0) {
          return { solicitud: actual, cambios, beneficiarios_actualizados: 0 };
        }

        const asignaciones: string[] = [];
        const valores: unknown[] = [id];
        for (const cambio of cambios) {
          valores.push(cambio.nuevo);
          asignaciones.push(`${cambio.campo} = $${valores.length}`);
        }
        await cliente.query(
          `UPDATE solicitudes SET ${asignaciones.join(', ')}, actualizado_en = now() WHERE id = $1`,
          valores
        );

        const bSets: string[] = [];
        const bValores: unknown[] = [id];
        if (cambios.some((c) => c.campo === 'nombre_solicitante')) {
          bValores.push(nuevoNombre);
          bSets.push(`nombre_completo = $${bValores.length}`);
        }
        if (cambios.some((c) => c.campo === 'curp')) {
          bValores.push(nuevaCurp);
          bSets.push(`curp = $${bValores.length}`);
        }
        let beneficiariosActualizados = 0;
        if (bSets.length) {
          const br = await cliente.query(
            `UPDATE beneficiarios
                SET ${bSets.join(', ')}, actualizado_en = now()
              WHERE solicitud_id = $1`,
            bValores
          );
          beneficiariosActualizados = br.rowCount ?? 0;
        }

        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'solicitud_editada',
          entidad: 'solicitud',
          entidadId: id,
          detalle: {
            folio: actual.folio,
            cambios,
            motivo,
            rol: usuario.rol,
            beneficiarios_actualizados: beneficiariosActualizados
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        });

        const finalRes = await cliente.query(
          `SELECT id, folio, nombre_solicitante, curp, tipo_persona, actualizado_en
             FROM solicitudes WHERE id = $1`,
          [id]
        );
        return {
          solicitud: finalRes.rows[0],
          cambios,
          beneficiarios_actualizados: beneficiariosActualizados
        };
      });

      return respuesta.status(200).send({ ok: true, ...resultado });
    }
  );
}
