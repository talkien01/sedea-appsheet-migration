// Modulo de captura de Solicitud de Apoyo en ventanilla (E40-E46, build 6).
//
// Reglas transversales:
//  - Solo los roles `ventanilla` y `admin` entran aqui (D34).
//  - El alcance por municipios/componentes se aplica en el BACKEND (D36).
//  - La solicitud entra DIRECTO a produccion, sin pasar por staging (D33).
//  - No existe edicion ni borrado de solicitudes (D44): no hay PATCH ni DELETE
//    sobre /api/solicitudes/:id, solo sobre su checklist de documentos.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  DECLARACIONES_VERSION,
  ETIQUETAS_TIPO_PERSONA,
  PATRON_CORREO,
  PATRON_CURP,
  TIPOS_PERSONA,
  esquemaActualizarDocumento,
  esquemaCrearSolicitud,
  esquemaDocumentosRequeridos,
  normalizarTelefono,
  type EntradaCrearSolicitud,
  type TipoPersona
} from '@sedea/shared';
import { config } from '../config.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { enTransaccion, bitacoraEnTransaccion } from '../servicios/promocion.js';
import {
  dentroDeAlcance,
  leerAlcance,
  ventanillasPermitidas,
  type AlcanceResuelto
} from '../servicios/alcance.js';
import { calcularDocumentosRequeridos } from '../servicios/documentos.js';
import { anioFolio, armarFolio, reservarConsecutivo, siglasMunicipio } from '../servicios/folios.js';
import {
  TIPOS_ADJUNTO_SOLICITUD,
  guardarAdjuntoSolicitud
} from '../servicios/almacenamiento.js';
import { pool } from '../db/pool.js';
import {
  beneficiariosDeSolicitud,
  catalogosDelAlta,
  catalogosVentanilla,
  componenteActivo,
  conceptosDeSolicitud,
  documentoDeSolicitud,
  documentosDeSolicitud,
  insertarBeneficiarioDeSolicitud,
  listarSolicitudes,
  municipioActivo,
  obtenerSolicitud,
  tiposApoyoActivos
} from '../db/queries/solicitudes.js';

const consultarUna = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
  const { rows } = await pool.query<T>(sql, values);
  return rows[0] ?? null;
};
const consultar = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
  const { rows } = await pool.query<T>(sql, values);
  return rows;
};

const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error404 = (mensaje: string) => new ErrorApi(404, 'no_encontrado', mensaje);
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

/** Guarda de rol con el codigo del contrato (12.6). */
async function soloVentanilla(peticion: FastifyRequest, _respuesta: FastifyReply) {
  const usuario = peticion.usuario;
  if (!usuario) throw errorNoAutorizado();
  if (usuario.rol !== 'ventanilla' && usuario.rol !== 'capturista' && usuario.rol !== 'admin') {
    throw error403('rol_no_autorizado', 'Tu rol no puede capturar solicitudes de apoyo.');
  }
}

// ---------------------------------------------------------------------------
// Normalizacion de textos antes de guardar (12.6.3)
// ---------------------------------------------------------------------------

/** trim; la cadena vacia se guarda como NULL. */
function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === '' ? null : limpio;
}

/** trim + MAYUSCULAS (nombre, razon social y CURP). */
function textoMayus(valor: unknown): string | null {
  const limpio = texto(valor);
  return limpio === null ? null : limpio.toUpperCase();
}

function numeroONulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Traduce el fallo de Zod: una clave fuera del esquema es `campo_no_editable`
 * (el folio, el id o la Regional los pone el sistema), cualquier otro fallo es
 * `payload_invalido`.
 */
function traducirFalloZod(error: ZodError): ErrorApi {
  const desconocida = error.issues.find((i) => i.code === 'unrecognized_keys');
  if (desconocida) {
    const claves = (desconocida as unknown as { keys: string[] }).keys ?? [];
    const campo = claves[0] ?? 'desconocido';
    return error422(
      'campo_no_editable',
      `El campo ${campo} no se captura: lo genera el sistema.`
    );
  }
  return error422('payload_invalido', 'Datos inválidos.');
}

/** Comprueba el alcance del usuario sobre una solicitud ya guardada. */
function exigirAlcanceSobre(
  alcance: AlcanceResuelto,
  solicitud: { ubi_municipio_id: number | string; componente_id: number | string }
): void {
  const municipio = Number(solicitud.ubi_municipio_id);
  const componente = Number(solicitud.componente_id);
  if (!dentroDeAlcance(alcance.municipios, municipio) ||
      !dentroDeAlcance(alcance.componentes, componente)) {
    throw error403('fuera_de_alcance', 'Esta solicitud está fuera de tu alcance asignado.');
  }
}

export default async function rutasSolicitudes(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, soloVentanilla] };

  // -------------------------------------------------------------------------
  // E40 - Catalogos del formulario, ya filtrados al alcance del usuario.
  // -------------------------------------------------------------------------
  app.get('/api/solicitudes/catalogos', protegida, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const alcance = await leerAlcance(usuario);
    const catalogos = await catalogosVentanilla();

    const permitidas = ventanillasPermitidas(
      usuario,
      alcance,
      catalogos.ventanillas.map((v) => ({
        id: Number(v.id),
        regional_id: Number(v.regional_id),
        es_central: v.es_central
      }))
    );

    // El filtrado de la UI es cosmetico; el control real vive en E42 (D36).
    const componentes = catalogos.componentes.filter((c: any) =>
      dentroDeAlcance(alcance.componentes, Number(c.id))
    );
    const municipios = catalogos.municipios.filter((m: any) =>
      dentroDeAlcance(alcance.municipios, Number(m.id))
    );
    const ventanillas = catalogos.ventanillas.filter((v) => permitidas.includes(Number(v.id)));

    // Filtra modalidades: solo las de componentes dentro del alcance. Usa el
    // mismo helper que componentes/municipios, que ya trata 'todos' como
    // "sin restriccion" (un alcance 'todos' ve TODAS las modalidades).
    const modalidades = catalogos.modalidades.filter((m: any) =>
      dentroDeAlcance(alcance.componentes, Number(m.componente_id))
    );

    return respuesta.status(200).send({
      programas: catalogos.programas,
      subprogramas: catalogos.subprogramas,
      componentes,
      modalidades,
      proyectos: catalogos.proyectos,
      ventanillas,
      municipios,
      tipos_apoyo: catalogos.tiposApoyo,
      tipos_persona: TIPOS_PERSONA.map((clave) => ({
        clave,
        nombre: ETIQUETAS_TIPO_PERSONA[clave]
      })),
      alcance: {
        municipios: alcance.municipios,
        componentes: alcance.componentes,
        ventanillas_permitidas: permitidas
      }
    });
  });

  // -------------------------------------------------------------------------
  // E41 - Calculo dinamico del checklist de documentos. Es consulta de
  // catalogo: NO aplica restriccion de alcance.
  // -------------------------------------------------------------------------
  app.post('/api/solicitudes/documentos-requeridos', protegida, async (peticion, respuesta) => {
    const parseado = esquemaDocumentosRequeridos.safeParse(peticion.body ?? {});
    if (!parseado.success) throw traducirFalloZod(parseado.error);
    const datos = parseado.data;

    const componente = await componenteActivo(datos.componente_id);
    if (!componente) {
      throw error422('componente_invalido', 'El componente seleccionado no existe o está inactivo.');
    }

    const documentos = await calcularDocumentosRequeridos({
      claveComponente: componente.clave,
      tipoPersona: datos.tipo_persona,
      proyectoId: datos.proyecto_id ?? null,
      tiposApoyoIds: datos.tipos_apoyo_ids ?? []
    });

    return respuesta.status(200).send({ documentos, total: documentos.length });
  });

  // -------------------------------------------------------------------------
  // E42 - Alta de la solicitud. Una sola transaccion: folio, solicitud,
  // conceptos, documentos, beneficiarios derivados y bitacora.
  // -------------------------------------------------------------------------
  app.post('/api/solicitudes', protegida, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const parseado = esquemaCrearSolicitud.safeParse(peticion.body ?? {});
    if (!parseado.success) throw traducirFalloZod(parseado.error);
    const datos: EntradaCrearSolicitud = parseado.data;

    // --- Validaciones de negocio (ninguna escribe nada) --------------------
    const nombre = textoMayus(datos.nombre_solicitante);
    if (!nombre) throw error422('payload_invalido', 'Escribe el nombre del solicitante.');

    const tipoPersona = datos.tipo_persona as TipoPersona;
    const razonSocial = textoMayus(datos.razon_social);
    if (tipoPersona === 'moral' || tipoPersona === 'grupo') {
      const integrantes = numeroONulo(datos.num_integrantes);
      if (!razonSocial || integrantes === null || integrantes < 1) {
        throw error422(
          'datos_persona_moral_requeridos',
          'Para persona moral o grupo debes capturar la razón social y el número de integrantes.'
        );
      }
    }

    if (!Array.isArray(datos.conceptos) || datos.conceptos.length === 0) {
      throw error422('conceptos_requeridos', 'Agrega al menos un concepto de apoyo.');
    }

    if (datos.declaracion_aceptada !== true) {
      throw error422('declaracion_requerida', 'Debes aceptar las declaraciones del solicitante.');
    }

    const curp = textoMayus(datos.curp);
    if (curp && !PATRON_CURP.test(curp)) {
      throw error422('curp_invalida', 'La CURP no tiene el formato correcto.');
    }

    const correo = texto(datos.correo);
    if (correo && !PATRON_CORREO.test(correo)) {
      throw error422('correo_invalido', 'El correo electrónico no es válido.');
    }

    let telefono: string | null = null;
    const telefonoCrudo = texto(datos.telefono);
    if (telefonoCrudo) {
      telefono = normalizarTelefono(telefonoCrudo);
      if (!telefono) throw error422('telefono_invalido', 'El teléfono debe tener 10 dígitos.');
    }

    // --- Catalogos ---------------------------------------------------------
    const cat = await catalogosDelAlta({
      programa_id: datos.programa_id,
      subprograma_id: datos.subprograma_id ?? null,
      componente_id: datos.componente_id,
      proyecto_id: datos.proyecto_id,
      ventanilla_id: datos.ventanilla_id
    });
    if (!cat.programa || !cat.subprograma || !cat.componente || !cat.proyecto || !cat.ventanilla) {
      throw error422(
        'catalogo_invalido',
        'Uno de los catálogos seleccionados no existe o está inactivo.'
      );
    }
    // Alias no nulos: dentro de la transaccion TypeScript pierde el estrechado.
    const ventanilla = cat.ventanilla;
    const componente = cat.componente;
    const proyecto = cat.proyecto;

    // --- Validación de modalidad_id (Build 8, E42) -------------------------
    // Si se proporciona modalidad_id, debe ser activa y del mismo componente.
    let modalidadIdFinal: number | null = datos.modalidad_id ?? null;
    if (modalidadIdFinal !== null) {
      const modalidadRow = await consultarUna<{ id: number; componente_id: number }>(
        'SELECT id, componente_id FROM modalidades WHERE id = $1 AND activo',
        [modalidadIdFinal]
      );
      if (!modalidadRow) {
        throw error422('modalidad_invalida', 'La modalidad seleccionada no existe o está inactiva.');
      }
      if (modalidadRow.componente_id !== Number(componente.id)) {
        throw error422('modalidad_invalida', 'La modalidad no corresponde al componente seleccionado.');
      }
      // Si el proyecto tiene modalidad_id asignada y difiere -> 422.
      const proyectoModalidadId = Number(proyecto.modalidad_id);
      if (proyecto.modalidad_id !== null && proyectoModalidadId !== modalidadIdFinal) {
        throw error422('modalidad_no_corresponde_proyecto',
          'La modalidad no corresponde al proyecto seleccionado.');
      }
    } else {
      // Si el componente tiene modalidades (PET) y no se envia modalidad_id -> 422.
      const modalidadesDelComponente = await consultar<{ id: number }>(
        'SELECT id FROM modalidades WHERE componente_id = $1 AND activo',
        [Number(componente.id)]
      );
      if (modalidadesDelComponente.length > 0) {
        // El componente tiene modalidades: se requiere modalidad_id.
        // Excepción: si el proyecto ya tiene modalidad_id, la usamos.
        if (proyecto.modalidad_id !== null) {
          modalidadIdFinal = Number(proyecto.modalidad_id);
        } else {
          throw error422('modalidad_requerida',
            'Este componente requiere seleccionar una modalidad.');
        }
      }
    }

    const municipioUbicacion = await municipioActivo(datos.apoyo.ubicacion.municipio_id);
    if (!municipioUbicacion) {
      throw error422('municipio_invalido', 'El municipio seleccionado no existe o está inactivo.');
    }

    const idsConceptos = datos.conceptos.map((c) => c.tipo_apoyo_id);
    const apoyosValidos = await tiposApoyoActivos(idsConceptos);
    const mapaApoyos = new Map(apoyosValidos.map((a) => [Number(a.id), a]));
    for (const id of idsConceptos) {
      if (!mapaApoyos.has(id)) {
        throw error422('tipo_apoyo_invalido', 'El concepto de apoyo seleccionado no existe.');
      }
    }

    for (const concepto of datos.conceptos) {
      const cantidad = Number(concepto.cantidad);
      const estatal = Number(concepto.monto_estatal ?? 0);
      const productor = Number(concepto.monto_productor ?? 0);
      const total = concepto.monto_total === null || concepto.monto_total === undefined
        ? estatal + productor
        : Number(concepto.monto_total);
      if (!(cantidad > 0) || estatal < 0 || productor < 0 || total < 0) {
        throw error422(
          'montos_invalidos',
          'Las cantidades y montos deben ser mayores o iguales a cero.'
        );
      }
    }

    // --- Alcance (D36). El admin nunca recibe 403 por alcance --------------
    const alcance = await leerAlcance(usuario);
    if (usuario.rol !== 'admin') {
      if (!dentroDeAlcance(alcance.municipios, Number(municipioUbicacion.id))) {
        throw error403('municipio_fuera_de_alcance', 'No tienes asignado este municipio.');
      }
      if (!dentroDeAlcance(alcance.componentes, Number(componente.id))) {
        throw error403('componente_fuera_de_alcance', 'No tienes asignado este componente.');
      }
      const todasVentanillas = (await catalogosVentanilla()).ventanillas.map((v) => ({
        id: Number(v.id),
        regional_id: Number(v.regional_id),
        es_central: v.es_central
      }));
      const permitidas = ventanillasPermitidas(usuario, alcance, todasVentanillas);
      if (!permitidas.includes(Number(ventanilla.id))) {
        throw error403('ventanilla_fuera_de_alcance', 'No puedes registrar en esta ventanilla.');
      }
    }

    // --- Checklist: el enviado, o el calculado con el algoritmo de E41 -----
    let documentos: { documento_requerido_id: number | null; requisito: string; recibido: boolean; observaciones: string | null }[];
    if (datos.documentos && datos.documentos.length > 0) {
      const vistos = new Set<string>();
      documentos = [];
      for (const doc of datos.documentos) {
        const requisito = String(doc.requisito).trim().slice(0, 300);
        if (requisito === '' || vistos.has(requisito)) continue;
        vistos.add(requisito);
        documentos.push({
          documento_requerido_id: doc.documento_requerido_id ?? null,
          requisito,
          recibido: doc.recibido === true,
          observaciones: texto(doc.observaciones)
        });
      }
    } else {
      const calculados = await calcularDocumentosRequeridos({
        claveComponente: componente.clave,
        tipoPersona,
        proyectoId: datos.proyecto_id,
        tiposApoyoIds: idsConceptos
      });
      documentos = calculados.map((d) => ({
        documento_requerido_id: d.documento_requerido_id,
        requisito: d.requisito,
        recibido: false,
        observaciones: null
      }));
    }

    // --- Actividad economica: los subcampos de una actividad no marcada se
    //     guardan como NULL aunque vengan en el body ------------------------
    const act = datos.actividad ?? ({} as NonNullable<EntradaCrearSolicitud['actividad']>);
    const agricola = act.agricola === true;
    const ganadera = act.ganadera === true;
    const acuicola = act.acuicola === true;
    const pesca = act.pesca === true;

    const dom = datos.domicilio ?? {};
    const ubicacion = datos.apoyo.ubicacion;

    const partesFolio = {
      prefijo: String(proyecto.prefijo_folio).toUpperCase(),
      claveRegional: String(ventanilla.clave_folio).toUpperCase(),
      siglasMunicipio: siglasMunicipio(
        municipioUbicacion.siglas_folio,
        municipioUbicacion.nombre
      ),
      anio: anioFolio()
    };

    const resultado = await enTransaccion(async (cliente) => {
      // 1) Folio: consecutivo atomico + hasta 3 reintentos si el unique choca
      //    (caso patologico de datos migrados, 12.5 punto 6).
      let folio = '';
      let solicitudId = 0;
      let insertada = false;

      for (let intento = 1; intento <= 4 && !insertada; intento++) {
        const consecutivo = await reservarConsecutivo(cliente, partesFolio);
        folio = armarFolio(partesFolio, consecutivo);
        await cliente.query('SAVEPOINT sp_folio');
        try {
          const { rows } = await cliente.query<{ id: string }>(
            `INSERT INTO solicitudes (
               folio, capturado_por, programa_id, subprograma_id, componente_id, proyecto_id,
               ventanilla_id, regional_id, modalidad_id,
               tipo_persona, nombre_solicitante, sexo, fecha_nacimiento, correo, telefono, curp,
               razon_social, num_integrantes,
               dom_municipio_id, dom_localidad, dom_delegacion, dom_cp, dom_tipo_asentamiento,
               dom_asentamiento, dom_tipo_vialidad, dom_vialidad,
               act_agricola, agr_superficie_total_ha, agr_superficie_siembra_ha, agr_temporal_ha,
               agr_riego_ha, agr_cultivo_principal,
               act_ganadera, gan_tipo_ganado, gan_num_cabezas, gan_superficie_agostadero_ha,
               gan_produccion,
               act_acuicola, acu_especies, act_pesca, pes_especies,
               descripcion_proyecto, ben_hombres_total, ben_hombres_discapacidad,
               ben_hombres_lengua_indigena, ben_mujeres_total, ben_mujeres_discapacidad,
               ben_mujeres_lengua_indigena,
               ubi_municipio_id, ubi_localidad, ubi_ejido, ubi_coordenadas,
               declaracion_aceptada, declaracion_version, observaciones, origen)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                     $10,$11,$12,$13::date,$14,$15,$16,
                     $17,$18,
                     $19,$20,$21,$22,$23,$24,$25,$26,
                     $27,$28,$29,$30,$31,$32,
                     $33,$34,$35,$36,$37,
                     $38,$39,$40,$41,
                     $42,$43,$44,$45,$46,$47,$48,
                     $49,$50,$51,$52,
                     TRUE,$53,$54,'solicitud_ventanilla')
             RETURNING id`,
            [
              folio,
              usuario.id,
              datos.programa_id,
              datos.subprograma_id ?? null,
              datos.componente_id,
              datos.proyecto_id,
              datos.ventanilla_id,
              Number(ventanilla.regional_id),
              modalidadIdFinal,

              tipoPersona,
              nombre,
              datos.sexo ?? null,
              texto(datos.fecha_nacimiento),
              correo,
              telefono,
              curp,
              razonSocial,
              numeroONulo(datos.num_integrantes),

              (dom as any).municipio_id ?? null,
              texto((dom as any).localidad),
              texto((dom as any).delegacion),
              texto((dom as any).cp),
              (dom as any).tipo_asentamiento ?? null,
              texto((dom as any).asentamiento),
              (dom as any).tipo_vialidad ?? null,
              texto((dom as any).vialidad),

              agricola,
              agricola ? numeroONulo(act.agr_superficie_total_ha) : null,
              agricola ? numeroONulo(act.agr_superficie_siembra_ha) : null,
              agricola ? numeroONulo(act.agr_temporal_ha) : null,
              agricola ? numeroONulo(act.agr_riego_ha) : null,
              agricola ? texto(act.agr_cultivo_principal) : null,

              ganadera,
              ganadera ? texto(act.gan_tipo_ganado) : null,
              ganadera ? numeroONulo(act.gan_num_cabezas) : null,
              ganadera ? numeroONulo(act.gan_superficie_agostadero_ha) : null,
              ganadera ? act.gan_produccion ?? null : null,

              acuicola,
              acuicola ? texto(act.acu_especies) : null,
              pesca,
              pesca ? texto(act.pes_especies) : null,

              texto(datos.apoyo.descripcion_proyecto),
              datos.apoyo.ben_hombres_total ?? 0,
              datos.apoyo.ben_hombres_discapacidad ?? 0,
              datos.apoyo.ben_hombres_lengua_indigena ?? 0,
              datos.apoyo.ben_mujeres_total ?? 0,
              datos.apoyo.ben_mujeres_discapacidad ?? 0,
              datos.apoyo.ben_mujeres_lengua_indigena ?? 0,

              Number(municipioUbicacion.id),
              texto(ubicacion.localidad),
              texto(ubicacion.ejido),
              texto(ubicacion.coordenadas),

              DECLARACIONES_VERSION,
              texto(datos.observaciones)
            ]
          );
          solicitudId = Number(rows[0].id);
          insertada = true;
        } catch (error) {
          const codigo = (error as { code?: string }).code;
          if (codigo === '23505' && intento < 4) {
            await cliente.query('ROLLBACK TO SAVEPOINT sp_folio');
            continue;
          }
          if (codigo === '23505') {
            throw new ErrorApi(
              500,
              'folio_no_generado',
              'No fue posible generar un folio único para la solicitud.'
            );
          }
          throw error;
        }
      }

      // 2) Conceptos + 3) beneficiario por concepto (D39).
      const conceptosGuardados: {
        id: number;
        orden: number;
        tipo_apoyo_id: number;
        beneficiario_id: number;
      }[] = [];
      const beneficiariosCreados: { id: number; folio: string }[] = [];
      const variosConceptos = datos.conceptos.length > 1;
      const nombreBeneficiario =
        tipoPersona === 'moral' || tipoPersona === 'grupo' ? razonSocial! : nombre;

      for (let i = 0; i < datos.conceptos.length; i++) {
        const concepto = datos.conceptos[i];
        const orden = i + 1;
        const estatal = Number(concepto.monto_estatal ?? 0);
        const productor = Number(concepto.monto_productor ?? 0);
        const total =
          concepto.monto_total === null || concepto.monto_total === undefined
            ? estatal + productor
            : Number(concepto.monto_total);

        const { rows: filasConcepto } = await cliente.query<{ id: string }>(
          `INSERT INTO solicitud_conceptos
             (solicitud_id, orden, tipo_apoyo_id, descripcion, cantidad, unidad_medida,
              monto_estatal, monto_productor, monto_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            solicitudId,
            orden,
            concepto.tipo_apoyo_id,
            texto(concepto.descripcion),
            Number(concepto.cantidad),
            texto(concepto.unidad_medida) ??
              mapaApoyos.get(concepto.tipo_apoyo_id)?.unidad_medida ??
              null,
            estatal,
            productor,
            total
          ]
        );
        const conceptoId = Number(filasConcepto[0].id);

        // El beneficiario hereda la UBICACION DEL APOYO, nunca el domicilio
        // particular del solicitante (D40): el capturista de campo va al predio.
        const folioBeneficiario = variosConceptos ? `${folio}-C${orden}` : folio;
        const beneficiarioId = await insertarBeneficiarioDeSolicitud(cliente, {
          folio: folioBeneficiario,
          curp,
          nombre_completo: nombreBeneficiario,
          regional_id: Number(ventanilla.regional_id),
          municipio_id: Number(municipioUbicacion.id),
          colonia: texto(ubicacion.localidad),
          localidad: texto(ubicacion.localidad),
          domicilio: texto(ubicacion.ejido),
          telefono,
          tipo_apoyo_id: concepto.tipo_apoyo_id,
          cantidad_asignada: Number(concepto.cantidad),
          solicitud_id: solicitudId,
          datos_extra: {
            origen: 'solicitud_ventanilla',
            solicitud_folio: folio,
            concepto_orden: orden,
            coordenadas_declaradas: texto(ubicacion.coordenadas)
          }
        });

        await cliente.query(
          'UPDATE solicitud_conceptos SET beneficiario_id = $1 WHERE id = $2',
          [beneficiarioId, conceptoId]
        );

        conceptosGuardados.push({
          id: conceptoId,
          orden,
          tipo_apoyo_id: concepto.tipo_apoyo_id,
          beneficiario_id: beneficiarioId
        });
        beneficiariosCreados.push({ id: beneficiarioId, folio: folioBeneficiario });
      }

      // 4) Checklist materializado (copia del texto, Assumption 53).
      for (const doc of documentos) {
        await cliente.query(
          `INSERT INTO solicitud_documentos
             (solicitud_id, documento_requerido_id, requisito, recibido, observaciones, actualizado_por)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (solicitud_id, requisito) DO NOTHING`,
          [
            solicitudId,
            doc.documento_requerido_id,
            doc.requisito,
            doc.recibido,
            doc.observaciones,
            usuario.id
          ]
        );
      }

      // 5) Bitacora. Nunca lleva CURP completa ni domicilio (12.3.3).
      await bitacoraEnTransaccion(cliente, {
        usuarioId: usuario.id,
        accion: 'solicitud_creada',
        entidad: 'solicitud',
        entidadId: solicitudId,
        detalle: {
          folio,
          origen: 'solicitud_ventanilla',
          componente: componente.clave,
          proyecto: proyecto.clave,
          ventanilla: ventanilla.clave,
          tipo_persona: tipoPersona,
          municipio_id: Number(municipioUbicacion.id),
          conceptos: conceptosGuardados.length,
          beneficiarios_creados: beneficiariosCreados,
          documentos_requeridos: documentos.length
        },
        ip: peticion.ip,
        userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
      });

      return { solicitudId, folio, conceptosGuardados, beneficiariosCreados };
    });

    const fila = await obtenerSolicitud(resultado.solicitudId);
    return respuesta.status(201).send({
      ok: true,
      solicitud: {
        id: resultado.solicitudId,
        folio: resultado.folio,
        recibida_en: fila?.recibida_en ?? null,
        componente: componente.clave,
        proyecto: proyecto.clave,
        ventanilla: ventanilla.clave,
        regional_id: Number(ventanilla.regional_id),
        tipo_persona: tipoPersona,
        nombre_solicitante: nombre,
        modalidad: fila?.modalidad ?? null
      },
      conceptos: resultado.conceptosGuardados,
      beneficiarios_creados: resultado.beneficiariosCreados,
      documentos: await documentosDeSolicitud(resultado.solicitudId)
    });
  });

  // -------------------------------------------------------------------------
  // E43 - Listado paginado con aislamiento por alcance en SQL.
  // -------------------------------------------------------------------------
  app.get('/api/solicitudes', protegida, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const alcance = await leerAlcance(usuario);
    const q = peticion.query as Record<string, string>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.page_size ?? 50) || 50));

    const { data, total } = await listarSolicitudes({
      alcance,
      q: q.q || null,
      componente_id: q.componente_id ? Number(q.componente_id) : null,
      municipio_id: q.municipio_id ? Number(q.municipio_id) : null,
      ventanilla_id: q.ventanilla_id ? Number(q.ventanilla_id) : null,
      desde: q.desde || null,
      hasta: q.hasta || null,
      page,
      page_size: pageSize
    });

    return respuesta.status(200).send({
      data,
      page,
      page_size: pageSize,
      total,
      has_more: (page - 1) * pageSize + data.length < total
    });
  });

  // -------------------------------------------------------------------------
  // E44 - Detalle completo (solo lectura, D44).
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/solicitudes/:id',
    protegida,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw error404('La solicitud no existe.');

      const solicitud = await obtenerSolicitud(id);
      if (!solicitud) throw error404('La solicitud no existe.');

      if (usuario.rol !== 'admin') {
        exigirAlcanceSobre(await leerAlcance(usuario), solicitud);
      }

      return respuesta.status(200).send({
        solicitud,
        conceptos: await conceptosDeSolicitud(id),
        documentos: await documentosDeSolicitud(id),
        beneficiarios: await beneficiariosDeSolicitud(id)
      });
    }
  );

  // -------------------------------------------------------------------------
  // E45 - Checklist: marcar recibido / observaciones. Es lo UNICO mutable
  // despues del alta (D44).
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string; docId: string } }>(
    '/api/solicitudes/:id/documentos/:docId',
    protegida,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const docId = Number(peticion.params.docId);

      const parseado = esquemaActualizarDocumento.safeParse(peticion.body ?? {});
      if (!parseado.success) throw traducirFalloZod(parseado.error);
      const datos = parseado.data;
      if (datos.recibido === undefined && datos.observaciones === undefined) {
        throw error422('sin_cambios', 'No enviaste ningún cambio.');
      }

      const solicitud = await obtenerSolicitud(id);
      if (!solicitud) throw error404('La solicitud no existe.');
      if (usuario.rol !== 'admin') {
        exigirAlcanceSobre(await leerAlcance(usuario), solicitud);
      }

      const documento = await documentoDeSolicitud(id, docId);
      if (!documento) throw error404('El documento no pertenece a esta solicitud.');

      const recibidoNuevo = datos.recibido === undefined ? documento.recibido : datos.recibido;

      await enTransaccion(async (cliente) => {
        await cliente.query(
          `UPDATE solicitud_documentos
              SET recibido = $1,
                  observaciones = COALESCE($2, observaciones),
                  actualizado_por = $3,
                  actualizado_en = now()
            WHERE id = $4`,
          [recibidoNuevo, datos.observaciones ?? null, usuario.id, docId]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'solicitud_documento_actualizado',
          entidad: 'solicitud_documento',
          entidadId: docId,
          detalle: {
            solicitud_id: id,
            requisito: documento.requisito,
            recibido_anterior: documento.recibido,
            recibido_nuevo: recibidoNuevo
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      return respuesta
        .status(200)
        .send({ ok: true, documento: await documentoDeSolicitud(id, docId) });
    }
  );

  // -------------------------------------------------------------------------
  // E46 - Adjunto del documento (multipart). Reutiliza el almacenamiento de
  // fotos: mismo driver, mismo MEDIA_DIR, solo cambia la subcarpeta (D43).
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string; docId: string } }>(
    '/api/solicitudes/:id/documentos/:docId/archivo',
    protegida,
    async (peticion, respuesta) => {
      const usuario = peticion.usuario!;
      const id = Number(peticion.params.id);
      const docId = Number(peticion.params.docId);

      if (!peticion.isMultipart()) {
        throw error422('payload_invalido', 'El archivo debe enviarse como multipart/form-data.');
      }

      const solicitud = await obtenerSolicitud(id);
      if (!solicitud) throw error404('La solicitud no existe.');
      if (usuario.rol !== 'admin') {
        exigirAlcanceSobre(await leerAlcance(usuario), solicitud);
      }
      const documento = await documentoDeSolicitud(id, docId);
      if (!documento) throw error404('El documento no pertenece a esta solicitud.');

      let contenido: Buffer | null = null;
      let mimetype = '';
      let nombreOriginal = '';
      let truncado = false;

      for await (const parte of peticion.parts()) {
        if (parte.type === 'file') {
          if (parte.fieldname !== 'archivo') {
            await parte.toBuffer();
            continue;
          }
          mimetype = (parte.mimetype || '').toLowerCase();
          contenido = await parte.toBuffer();
          truncado = parte.file.truncated === true;
          nombreOriginal = String(parte.filename ?? '').slice(0, 200);
        }
      }

      if (truncado || (contenido && contenido.length > config.maxSubidaBytes)) {
        throw new ErrorApi(
          413,
          'archivo_muy_grande',
          `El archivo excede ${config.maxSubidaMb} MB.`
        );
      }
      if (!contenido || contenido.length === 0) {
        throw error422('payload_invalido', 'Adjunta un archivo.');
      }

      const extension = TIPOS_ADJUNTO_SOLICITUD[mimetype];
      if (!extension) {
        throw error422(
          'tipo_archivo_no_permitido',
          'Solo se aceptan imágenes JPG/PNG/WEBP o PDF.'
        );
      }

      // Subir de nuevo REEMPLAZA la referencia; el archivo anterior se conserva
      // en disco por trazabilidad (12.6.7).
      const guardado = guardarAdjuntoSolicitud(contenido, crypto.randomUUID(), extension);

      await enTransaccion(async (cliente) => {
        await cliente.query(
          `UPDATE solicitud_documentos
              SET archivo_url = $1, archivo_hash = $2, archivo_nombre = $3,
                  recibido = TRUE, actualizado_por = $4, actualizado_en = now()
            WHERE id = $5`,
          [guardado.url, guardado.hash, nombreOriginal || null, usuario.id, docId]
        );
        await bitacoraEnTransaccion(cliente, {
          usuarioId: usuario.id,
          accion: 'solicitud_documento_adjuntado',
          entidad: 'solicitud_documento',
          entidadId: docId,
          detalle: {
            solicitud_id: id,
            requisito: documento.requisito,
            archivo_url: guardado.url,
            bytes: guardado.bytes,
            mimetype
          },
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
        });
      });

      const actualizado = await documentoDeSolicitud(id, docId);
      return respuesta.status(201).send({ ok: true, documento: actualizado });
    }
  );

  // Nota: no se registra PATCH ni DELETE sobre /api/solicitudes/:id (D44).
  // Fastify responde 404 con el manejador global.
}
