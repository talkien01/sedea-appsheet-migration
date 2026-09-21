// Reclasificar el concepto de una solicitud (solo admin), ej. 9 solicitudes
// capturadas como avena (CFA) que en realidad eran garbanzo (CFG).
//
// Cambiar de concepto no es una edicion: el concepto pertenece a un PROYECTO
// (CFA/CFG), y de ahi salen el prefijo del folio, el consecutivo y el checklist.
// Por eso la "edicion administrativa" no lo permite. Esto hace lo que se hacia a
// mano por SQL: crea una solicitud NUEVA con los mismos datos ya capturados
// (solicitante, domicilio, ubicacion, superficie, documentos, capturas de foto)
// pero con el concepto/proyecto/folio correctos, y ANULA la vieja dejando la
// trazabilidad cruzada (quien, cuando, por que, y a que folio se paso).
//
// Alcance deliberado: solo solicitudes con UN concepto, sin entrega fisica ni
// conciliacion (mismo candado que anular: no se reescribe un hecho ya ocurrido).
import { ErrorApi } from '../plugins/errores.js';
import { consultar } from '../db/pool.js';
import { conceptosDuplicadosPorCurp } from '../db/queries/solicitudes.js';
import { cantidadPorEscalon, escalonesCantidadMaxima, superficieAcreditada } from './cantidadMaxima.js';
import { armarFolio, reservarConsecutivo } from './folios.js';
import { bitacoraEnTransaccion, enTransaccion } from './promocion.js';

type Ejecutar = (sql: string, parametros?: unknown[]) => Promise<any[]>;

export interface PlanReclasificacion {
  solicitud_id: number;
  folio_actual: string;
  nombre_solicitante: string;
  concepto_actual: { solicitud_concepto_id: number; tipo_apoyo_id: number; nombre: string };
  concepto_destino: {
    tipo_apoyo_id: number;
    nombre: string;
    unidad_medida: string | null;
    descripcion: string | null;
    proyecto_id: number;
    proyecto_clave: string;
    proyecto_prefijo: string;
    componente_id: number | null;
    modalidad_id: number | null;
  };
  cantidad_actual: number;
  cantidad_nueva: number;
  /** true si la cantidad se bajo al maximo del concepto destino para esa superficie. */
  ajustada_por_maximo: boolean;
  superficie_ha: number | null;
  beneficiario_id: number | null;
  capturas_a_mover: number;
}

const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);
const error409 = (codigo: string, mensaje: string) => new ErrorApi(409, codigo, mensaje);

async function construirPlan(
  q: Ejecutar,
  solicitudId: number,
  tipoApoyoDestinoId: number
): Promise<PlanReclasificacion> {
  const [sol] = await q(
    `SELECT id, folio, anulada_en, curp, nombre_solicitante,
            agr_superficie_total_ha, agr_superficie_siembra_ha
       FROM solicitudes WHERE id = $1`,
    [solicitudId]
  );
  if (!sol) throw new ErrorApi(404, 'no_encontrado', 'La solicitud no existe.');
  if (sol.anulada_en) throw error409('solicitud_anulada', 'Esta solicitud ya está anulada.');

  const conceptos = await q(
    `SELECT sc.id, sc.tipo_apoyo_id, sc.cantidad::float8 AS cantidad, sc.beneficiario_id,
            t.nombre
       FROM solicitud_conceptos sc JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
      WHERE sc.solicitud_id = $1`,
    [solicitudId]
  );
  if (conceptos.length !== 1) {
    throw error422(
      'reclasificar_un_concepto',
      'Solo se puede reclasificar una solicitud con un único concepto. Esta tiene ' +
        `${conceptos.length}: anúlala y captúrala de nuevo.`
    );
  }
  const actual = conceptos[0];

  const [yaEntregado] = await q(
    `SELECT 1 FROM entregas_apoyo ea
       JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
      WHERE sc.solicitud_id = $1 LIMIT 1`,
    [solicitudId]
  );
  const [yaConciliado] = await q(
    `SELECT 1 FROM conciliacion_recibos WHERE solicitud_id = $1 LIMIT 1`,
    [solicitudId]
  );
  if (yaEntregado || yaConciliado) {
    throw error409(
      'folio_con_entrega',
      'Esta solicitud ya tiene una entrega física registrada con este folio: no se puede reclasificar.'
    );
  }

  const [destino] = await q(
    `SELECT t.id, t.nombre, t.unidad_medida, t.descripcion, t.activo,
            p.id AS proyecto_id, p.clave AS proyecto_clave, p.prefijo_folio,
            p.componente_id, p.modalidad_id, p.activo AS proyecto_activo
       FROM tipos_apoyo t LEFT JOIN proyectos p ON p.id = t.proyecto_id
      WHERE t.id = $1`,
    [tipoApoyoDestinoId]
  );
  if (!destino || !destino.activo) {
    throw error422('concepto_destino_invalido', 'El concepto destino no existe o está inactivo.');
  }
  if (Number(destino.id) === Number(actual.tipo_apoyo_id)) {
    throw error422('mismo_concepto', 'La solicitud ya es de ese concepto.');
  }
  if (destino.proyecto_id === null || destino.proyecto_id === undefined || !destino.proyecto_activo) {
    throw error422(
      'concepto_sin_proyecto',
      'Ese concepto no pertenece a un proyecto activo: no se puede reclasificar hacia él.'
    );
  }

  if (sol.curp) {
    const duplicados = (await conceptosDuplicadosPorCurp(sol.curp, [Number(destino.id)])).filter(
      (d) => Number(d.solicitud_id) !== solicitudId
    );
    if (duplicados.length > 0) {
      throw error422(
        'curp_concepto_duplicado',
        `Esa CURP ya tiene «${destino.nombre}» en la solicitud ${duplicados[0].folio}.`
      );
    }
  }

  // La cantidad NO se inventa: se conserva la capturada, salvo que rebase el
  // maximo del concepto destino para la superficie (garbanzo topa a la mitad de
  // avena), en cuyo caso se baja a ese maximo -- la misma regla que el alta.
  const superficie = superficieAcreditada({
    agr_superficie_total_ha: sol.agr_superficie_total_ha,
    agr_superficie_siembra_ha: sol.agr_superficie_siembra_ha
  });
  const escalones = await escalonesCantidadMaxima();
  const regla = cantidadPorEscalon(escalones.get(Number(destino.id)), superficie);
  let cantidadNueva = Number(actual.cantidad);
  let ajustada = false;
  if (regla.tipo === 'no_elegible') {
    throw error422(
      'superficie_insuficiente',
      `«${destino.nombre}» requiere una superficie mínima de ${regla.minimo} ha y esta solicitud tiene ${superficie} ha.`
    );
  }
  if (regla.tipo === 'fijo' && cantidadNueva > regla.cantidad) {
    cantidadNueva = regla.cantidad;
    ajustada = true;
  }

  let capturas = 0;
  if (actual.beneficiario_id) {
    const [fila] = await q(`SELECT count(*)::int AS n FROM capturas WHERE beneficiario_id = $1`, [
      actual.beneficiario_id
    ]);
    capturas = fila?.n ?? 0;
  }

  return {
    solicitud_id: solicitudId,
    folio_actual: sol.folio,
    nombre_solicitante: sol.nombre_solicitante,
    concepto_actual: {
      solicitud_concepto_id: Number(actual.id),
      tipo_apoyo_id: Number(actual.tipo_apoyo_id),
      nombre: actual.nombre
    },
    concepto_destino: {
      tipo_apoyo_id: Number(destino.id),
      nombre: destino.nombre,
      unidad_medida: destino.unidad_medida ?? null,
      descripcion: destino.descripcion ?? null,
      proyecto_id: Number(destino.proyecto_id),
      proyecto_clave: destino.proyecto_clave,
      proyecto_prefijo: String(destino.prefijo_folio).toUpperCase(),
      componente_id: destino.componente_id === null ? null : Number(destino.componente_id),
      modalidad_id: destino.modalidad_id === null ? null : Number(destino.modalidad_id)
    },
    cantidad_actual: Number(actual.cantidad),
    cantidad_nueva: cantidadNueva,
    ajustada_por_maximo: ajustada,
    superficie_ha: superficie,
    beneficiario_id: actual.beneficiario_id === null ? null : Number(actual.beneficiario_id),
    capturas_a_mover: capturas
  };
}

/** Solo lectura: que pasaria, sin tocar nada (ni consumir un consecutivo de folio). */
export async function previsualizarReclasificacion(
  solicitudId: number,
  tipoApoyoDestinoId: number
): Promise<PlanReclasificacion> {
  return construirPlan(
    (sql, p) => consultar<any>(sql, p) as Promise<any[]>,
    solicitudId,
    tipoApoyoDestinoId
  );
}

export interface ResultadoReclasificacion {
  plan: PlanReclasificacion;
  solicitud_nueva: { id: number; folio: string };
  capturas_movidas: number;
}

export async function reclasificarSolicitud(
  solicitudId: number,
  tipoApoyoDestinoId: number,
  contexto: {
    usuarioId: number;
    motivo: string;
    ip: string | null;
    userAgent: string | null;
  }
): Promise<ResultadoReclasificacion> {
  return enTransaccion(async (cliente) => {
    const q: Ejecutar = async (sql, p) => (await cliente.query(sql, p as unknown[])).rows;

    // Bloquea la vieja y RE-VALIDA todo dentro de la transaccion: nunca se
    // confia en lo que se vio en la previsualizacion.
    await cliente.query('SELECT id FROM solicitudes WHERE id = $1 FOR UPDATE', [solicitudId]);
    const plan = await construirPlan(q, solicitudId, tipoApoyoDestinoId);
    const destino = plan.concepto_destino;

    // Folio nuevo: mismos codigos de ventanilla/municipio/anio que el folio
    // viejo (esos no cambian al cambiar de concepto), otro prefijo y consecutivo.
    const partes = plan.folio_actual.split('-');
    if (partes.length !== 5 || !/^\d+$/.test(partes[4])) {
      throw error422(
        'folio_no_reclasificable',
        `El folio ${plan.folio_actual} no tiene el formato esperado para derivar el nuevo.`
      );
    }
    const partesFolio = {
      prefijo: destino.proyecto_prefijo,
      claveRegional: partes[1],
      siglasMunicipio: partes[2],
      anio: Number(partes[4])
    };
    let folioNuevo = '';
    for (let intento = 0; intento < 4; intento++) {
      folioNuevo = armarFolio(partesFolio, await reservarConsecutivo(cliente, partesFolio));
      const [existe] = await q('SELECT 1 FROM solicitudes WHERE folio = $1', [folioNuevo]);
      if (!existe) break;
      if (intento === 3) {
        throw new ErrorApi(500, 'folio_no_generado', 'No fue posible generar un folio único.');
      }
    }

    // Componente/modalidad: los del proyecto destino si los define; si no, los
    // de la solicitud original (CFA y CFG comparten componente y no tienen modalidad).
    const [orig] = await q(
      'SELECT componente_id, modalidad_id FROM solicitudes WHERE id = $1',
      [solicitudId]
    );
    const componenteNuevo = destino.componente_id ?? Number(orig.componente_id);
    let modalidadNueva: number | null = destino.modalidad_id;
    if (modalidadNueva === null && orig.modalidad_id !== null) {
      const [m] = await q('SELECT componente_id FROM modalidades WHERE id = $1', [orig.modalidad_id]);
      if (m && Number(m.componente_id) === componenteNuevo) modalidadNueva = Number(orig.modalidad_id);
    }

    const rastro = {
      reclasificada_de: {
        solicitud_id: solicitudId,
        folio: plan.folio_actual,
        concepto: plan.concepto_actual.nombre
      }
    };

    // Clones con tabla temporal: copia TODAS las columnas (incluidas las que se
    // agreguen en el futuro) y solo se pisa lo que cambia.
    await cliente.query(`CREATE TEMP TABLE _rc_sol ON COMMIT DROP AS SELECT * FROM solicitudes WHERE id = $1`, [solicitudId]);
    await cliente.query(
      `UPDATE _rc_sol
          SET id = nextval(pg_get_serial_sequence('solicitudes', 'id')),
              folio = $1, proyecto_id = $2, componente_id = $3, modalidad_id = $4,
              anulada_en = NULL, anulada_por = NULL, motivo_anulacion = NULL,
              actualizado_en = now(),
              datos_extra = COALESCE(datos_extra, '{}'::jsonb) || $5::jsonb`,
      [folioNuevo, destino.proyecto_id, componenteNuevo, modalidadNueva, JSON.stringify(rastro)]
    );
    await cliente.query('INSERT INTO solicitudes SELECT * FROM _rc_sol');
    const [{ id: idNuevo }] = await q('SELECT id FROM _rc_sol');
    const solicitudNuevaId = Number(idNuevo);

    // Concepto nuevo (descripcion/unidad del concepto destino, cantidad ya resuelta).
    const [concOrig] = await q(
      `SELECT orden, unidad_medida, monto_estatal, monto_productor, monto_total
         FROM solicitud_conceptos WHERE id = $1`,
      [plan.concepto_actual.solicitud_concepto_id]
    );
    const [conceptoNuevo] = await q(
      `INSERT INTO solicitud_conceptos
         (solicitud_id, orden, tipo_apoyo_id, descripcion, cantidad, unidad_medida,
          monto_estatal, monto_productor, monto_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        solicitudNuevaId,
        concOrig.orden,
        destino.tipo_apoyo_id,
        destino.descripcion,
        plan.cantidad_nueva,
        destino.unidad_medida ?? concOrig.unidad_medida,
        concOrig.monto_estatal,
        concOrig.monto_productor,
        concOrig.monto_total
      ]
    );

    // Beneficiario derivado: mismo registro de la persona, con el folio/concepto nuevos.
    let capturasMovidas = 0;
    if (plan.beneficiario_id) {
      await cliente.query(`CREATE TEMP TABLE _rc_ben ON COMMIT DROP AS SELECT * FROM beneficiarios WHERE id = $1`, [plan.beneficiario_id]);
      await cliente.query(
        `UPDATE _rc_ben
            SET id = nextval(pg_get_serial_sequence('beneficiarios', 'id')),
                folio = $1, solicitud_id = $2, tipo_apoyo_id = $3, cantidad_asignada = $4,
                actualizado_en = now(),
                datos_extra = COALESCE(datos_extra, '{}'::jsonb)
                              || jsonb_build_object('solicitud_folio', $1::text) || $5::jsonb`,
        [folioNuevo, solicitudNuevaId, destino.tipo_apoyo_id, plan.cantidad_nueva, JSON.stringify(rastro)]
      );
      await cliente.query('INSERT INTO beneficiarios SELECT * FROM _rc_ben');
      const [{ id: benNuevo }] = await q('SELECT id FROM _rc_ben');
      await cliente.query('UPDATE solicitud_conceptos SET beneficiario_id = $1 WHERE id = $2', [
        benNuevo,
        conceptoNuevo.id
      ]);
      // Las fotos/GPS ya capturadas son del predio de la persona, no del concepto:
      // se pasan al beneficiario nuevo para no obligar a recapturarlas.
      const movidas = await q(
        'UPDATE capturas SET beneficiario_id = $1 WHERE beneficiario_id = $2 RETURNING 1',
        [benNuevo, plan.beneficiario_id]
      );
      capturasMovidas = movidas.length;
      await cliente.query('UPDATE beneficiarios SET actualizado_en = now() WHERE id = $1', [
        plan.beneficiario_id
      ]);
    }

    // Checklist de documentos tal cual esta (lo recibido y sus archivos).
    await cliente.query(`CREATE TEMP TABLE _rc_doc ON COMMIT DROP AS SELECT * FROM solicitud_documentos WHERE solicitud_id = $1`, [solicitudId]);
    await cliente.query(
      `UPDATE _rc_doc SET id = nextval(pg_get_serial_sequence('solicitud_documentos', 'id')), solicitud_id = $1`,
      [solicitudNuevaId]
    );
    await cliente.query('INSERT INTO solicitud_documentos SELECT * FROM _rc_doc');

    // La vieja se ANULA (queda de historial) apuntando a la nueva.
    await cliente.query(
      `UPDATE solicitudes
          SET anulada_en = now(), anulada_por = $1, motivo_anulacion = $2
        WHERE id = $3`,
      [
        contexto.usuarioId,
        `Reclasificada a ${folioNuevo} (${destino.nombre}): ${contexto.motivo}`.slice(0, 500),
        solicitudId
      ]
    );

    await bitacoraEnTransaccion(cliente, {
      usuarioId: contexto.usuarioId,
      accion: 'solicitud_reclasificada',
      entidad: 'solicitud',
      entidadId: solicitudId,
      detalle: {
        folio_anterior: plan.folio_actual,
        folio_nuevo: folioNuevo,
        solicitud_nueva_id: solicitudNuevaId,
        concepto_anterior: plan.concepto_actual.nombre,
        concepto_nuevo: destino.nombre,
        cantidad_anterior: plan.cantidad_actual,
        cantidad_nueva: plan.cantidad_nueva,
        capturas_movidas: capturasMovidas,
        motivo: contexto.motivo
      },
      ip: contexto.ip,
      userAgent: contexto.userAgent
    });

    return {
      plan,
      solicitud_nueva: { id: solicitudNuevaId, folio: folioNuevo },
      capturas_movidas: capturasMovidas
    };
  });
}
