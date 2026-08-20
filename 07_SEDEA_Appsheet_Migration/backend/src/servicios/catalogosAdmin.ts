// Servicio de administracion de catalogos (Build 10).
// Patron generico sobre las 7 entidades: programas, subprogramas, componentes,
// modalidades, proyectos, tipos_apoyo, documentos_requeridos.
import type { PoolClient } from 'pg';
import {
  REGISTRO_ENTIDADES,
  normalizarClave,
  type NombreEntidad,
  type DefinicionCatalogo
} from '@sedea/shared';
import { pool, consultar, consultarUna } from '../db/pool.js';
import { ErrorApi } from '../plugins/errores.js';

// =============================================================================
// ERRORES TIPIFICADOS
// =============================================================================

const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error404 = (codigo: string, mensaje: string) => new ErrorApi(404, codigo, mensaje);
const error409 = (codigo: string, mensaje: string) => new ErrorApi(409, codigo, mensaje);
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

/** Tipos de persona aceptados en documentos_requeridos (F-13, criterio 479). */
const TIPOS_PERSONA_VALIDOS = ['fisica', 'moral', 'grupo'];

// =============================================================================
// REGISTRO DE ENTIDADES (unica fuente de verdad)
// =============================================================================

/** Valida que el nombre de entidad sea conocido. */
export function validarEntidad(nombre: string): NombreEntidad {
  const valido = Object.keys(REGISTRO_ENTIDADES).includes(nombre);
  if (!valido) {
    throw error404('entidad_desconocida', 'No existe el catalogo solicitado.');
  }
  return nombre as NombreEntidad;
}

/** Obtiene la definicion de una entidad. */
export function obtenerDefinicion(entidad: NombreEntidad): DefinicionCatalogo {
  return REGISTRO_ENTIDADES[entidad];
}

// =============================================================================
// CONSULTAS GENERICAS
// =============================================================================

/**
 * Lista filas de una entidad con paginacion y filtros.
 * - `incluirInactivos`: si false, solo rows con activo=true
 * - `padreId`: filtra por la FK padre (si la entidad tiene padre)
 * - `q`: busqueda textual en clave/nombre/requisito
 */
export async function listarEntidad(opts: {
  entidad: NombreEntidad;
  incluirInactivos?: boolean;
  padreId?: number | null;
  q?: string | null;
  pagina?: number;
  porPagina?: number;
}) {
  const def = obtenerDefinicion(opts.entidad);
  const tabla = def.tabla;
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  // Filtro activo
  if (!opts.incluirInactivos) {
    condiciones.push('activo = TRUE');
  }

  // Filtro por padre
  if (opts.padreId !== undefined && opts.padreId !== null) {
    const padre = def.padres.find((p) => p.obligatorio);
    if (padre) {
      condiciones.push(`${padre.campo} = $${i}`);
      valores.push(opts.padreId);
      i++;
    }
  }

  // Filtro de busqueda textual
  if (opts.q && opts.q.trim().length >= 2) {
    const q = `%${opts.q.trim()}%`;
    if (opts.entidad === 'documentos_requeridos') {
      condiciones.push(`requisito ILIKE $${i}`);
    } else {
      condiciones.push(`(clave ILIKE $${i} OR nombre ILIKE $${i})`);
    }
    valores.push(q);
    i++;
  }

  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  // Orden
  let ordenSql = 'orden ASC, requisito ASC';
  if (opts.entidad !== 'documentos_requeridos') {
    ordenSql = 'clave ASC';
  }

  // Total
  const totalRow = await consultarUna<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${tabla} ${donde}`,
    valores
  );
  const total = Number(totalRow?.n ?? 0);

  // Paginacion
  const pagina = Math.max(1, opts.pagina ?? 1);
  const porPagina = Math.min(200, Math.max(1, opts.porPagina ?? 50));
  const offset = (pagina - 1) * porPagina;

  valores.push(porPagina, offset);

  // F-20 (criterio 468): documentos_requeridos entrega ademas las claves
  // resueltas de sus FKs (apoyo_clave, apoyo_excluir_clave, proyecto_clave),
  // porque en la UI y en el rubric se leen por clave, no por id.
  const seleccion =
    opts.entidad === 'documentos_requeridos'
      ? `t.*,
         ap.clave  AS apoyo_clave,
         apx.clave AS apoyo_excluir_clave,
         pr.clave  AS proyecto_clave`
      : 't.*';
  const joins =
    opts.entidad === 'documentos_requeridos'
      ? `LEFT JOIN tipos_apoyo ap  ON ap.id  = t.apoyo_id
         LEFT JOIN tipos_apoyo apx ON apx.id = t.apoyo_excluir_id
         LEFT JOIN proyectos   pr  ON pr.id  = t.proyecto_id`
      : '';
  const dondeAlias = donde.replace(/\b(activo|requisito|clave|nombre)\b/g, 't.$1');
  const ordenAlias = ordenSql.replace(/\b(orden|requisito|clave)\b/g, 't.$1');

  const data = await consultar<any>(
    `SELECT ${seleccion} FROM ${tabla} t ${joins} ${dondeAlias}
     ORDER BY ${ordenAlias} LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  return { datos: data, total, pagina, porPagina };
}

/** Obtiene una fila por ID. */
export async function obtenerEntidad(entidad: NombreEntidad, id: number) {
  const def = obtenerDefinicion(entidad);
  const fila = await consultarUna<any>(`SELECT * FROM ${def.tabla} WHERE id = $1`, [id]);
  if (!fila) {
    throw error404('registro_no_encontrado', 'No se encontro el registro.');
  }
  return fila;
}

/**
 * Crea una nueva fila. Valida unicidad de clave, padre existente/activo,
 * y coherencia componente-modalidad en proyectos.
 */
export async function crearEntidad(
  entidad: NombreEntidad,
  datos: Record<string, unknown>,
  usuarioId: number
) {
  const def = obtenerDefinicion(entidad);
  const tabla = def.tabla;

  // Normalizar clave si existe
  if (def.campoClave && datos.clave) {
    datos.clave = normalizarClave(String(datos.clave));
  }

  // Validar padre si es obligatorio y existe
  for (const padre of def.padres) {
    const valor = (datos as any)[padre.campo];
    if (padre.obligatorio && (valor === null || valor === undefined)) {
      throw error422('padre_invalido', `El campo ${padre.campo} es requerido.`);
    }
    if (valor !== null && valor !== undefined) {
      const padreRow = await consultarUna<any>(`SELECT id, activo FROM ${padre.tabla} WHERE id = $1`, [valor]);
      if (!padreRow) {
        throw error422('padre_invalido', `El ${padre.tabla.slice(0, -1)} seleccionado no existe.`);
      }
      if (!padreRow.activo) {
        throw error422('padre_inactivo', `No se puede crear bajo un ${padre.tabla.slice(0, -1)} desactivado.`);
      }
    }
  }

  // Coherencia componente-modalidad en proyectos (F-16)
  if (entidad === 'proyectos') {
    const { componente_id, modalidad_id } = datos as { componente_id?: number | null; modalidad_id?: number | null };
    // Si ambos se proporcionan, validar que correspondan
    if (componente_id != null && modalidad_id != null) {
      const modalidad = await consultarUna<{ componente_id: number }>(
        'SELECT componente_id FROM modalidades WHERE id = $1',
        [modalidad_id]
      );
      if (!modalidad) {
        throw error422('modalidad_invalida', 'La modalidad seleccionada no existe.');
      }
      if (modalidad.componente_id !== componente_id) {
        throw error422('modalidad_no_corresponde_componente', 'La modalidad no corresponde al componente seleccionado.');
      }
    }
    // Derivar componente_id desde modalidad_id si no viene explícito
    if ((componente_id == null || componente_id === 0) && modalidad_id != null && modalidad_id !== 0) {
      const modalidad = await consultarUna<{ componente_id: number }>(
        'SELECT componente_id FROM modalidades WHERE id = $1',
        [modalidad_id]
      );
      if (modalidad) {
        datos.componente_id = modalidad.componente_id;
      }
    }
  }

  // Validar unicidad de clave
  if (def.campoClave && datos.clave) {
    let dondeClave = `clave = $1`;
    const valoresClave: any[] = [datos.clave];

    // Subprogramas: unicidad por (programa_id, clave), no solo clave (F-11)
    if (entidad === 'subprogramas') {
      const programaId = (datos as any).programa_id;
      if (programaId) {
        dondeClave = `programa_id = $2 AND clave = $1`;
        valoresClave.push(programaId);
      }
    }

    const existe = await consultarUna<any>(
      `SELECT id FROM ${tabla} WHERE ${dondeClave}`,
      valoresClave
    );
    if (existe) {
      throw error409('clave_duplicada', `Ya existe un registro con la clave ${datos.clave}.`);
    }
  }

  // Validar unicidad de requisito en documentos_requeridos
  if (entidad === 'documentos_requeridos') {
    const requisito = String(datos.requisito).trim();
    // F-13: los arreglos van como arreglos JS; node-pg los serializa a literal
    // de Postgres ({A,B}). JSON.stringify producia "malformed array literal".
    const componentes = (datos.componentes as string[] | undefined) ?? null;
    const tiposPersona = (datos.tipos_persona as string[] | undefined) ?? null;
    const apoyoId = datos.apoyo_id ?? null;
    const proyectoId = datos.proyecto_id ?? null;

    // F-13: Validar los tipos de persona antes que cualquier otra regla
    if (tiposPersona && tiposPersona.length > 0) {
      for (const tp of tiposPersona) {
        if (!TIPOS_PERSONA_VALIDOS.includes(tp)) {
          throw error422('tipo_persona_invalido', `El tipo de persona "${tp}" no es valido.`);
        }
      }
    }

    // F-13: Validar que los componentes existen si se proporcionan
    if (datos.componentes && Array.isArray(datos.componentes) && datos.componentes.length > 0) {
      for (const claveComp of datos.componentes) {
        const compExiste = await consultarUna<any>(
          'SELECT id FROM componentes WHERE clave = $1',
          [claveComp]
        );
        if (!compExiste) {
          throw error422('componente_invalido', `El componente con clave "${claveComp}" no existe.`);
        }
      }
    }

    const existe = await consultarUna<any>(
      `SELECT id FROM documentos_requeridos
       WHERE activo = TRUE
         AND LOWER(TRIM(requisito)) = LOWER(TRIM($1))
         AND (componentes IS NULL OR componentes = $2)
         AND (tipos_persona IS NULL OR tipos_persona = $3)
         AND (COALESCE(proyecto_id, -1) = COALESCE($4, -1))
         AND (COALESCE(apoyo_id, -1) = COALESCE($5, -1))`,
      [requisito, componentes, tiposPersona, proyectoId, apoyoId]
    );
    if (existe) {
      throw error409('requisito_duplicado', 'Ya existe una regla activa con este requisito y combinacion de filtros.');
    }
  }

  // Construir INSERT
  // F-12: activo va al final para que el orden de columnas coincida con valores
  const columnas: string[] = [];
  const valores: unknown[] = [];
  const marcadores: string[] = [];
  let idx = 1;

  if (def.campoClave) {
    columnas.push('clave');
    valores.push(datos.clave);
    marcadores.push(`$${idx++}`);
  }
  if (def.camposTexto.includes('nombre')) {
    columnas.push('nombre');
    valores.push(datos.nombre);
    marcadores.push(`$${idx++}`);
  }

  // Campos enteros (padres)
  for (const campo of def.camposEnteros) {
    const valor = (datos as any)[campo];
    if (valor !== undefined && valor !== null) {
      columnas.push(campo);
      valores.push(valor);
      marcadores.push(`$${idx++}`);
    }
  }

  // Campos de arreglo (documentos_requeridos)
  for (const campo of def.camposArreglo) {
    const valor = (datos as any)[campo];
    if (valor !== undefined && valor !== null) {
      columnas.push(campo);
      // F-13: node-pg convierte el arreglo JS al literal de Postgres.
      valores.push(valor);
      marcadores.push(`$${idx++}`);
    }
  }

  // Campos especificos de proyectos
  if (entidad === 'proyectos' && datos.prefijo_folio) {
    columnas.push('prefijo_folio');
    valores.push(String(datos.prefijo_folio).toUpperCase());
    marcadores.push(`$${idx++}`);
  }

  // Campos especificos de tipos_apoyo
  if (entidad === 'tipos_apoyo') {
    if (datos.categoria !== undefined) {
      columnas.push('categoria');
      valores.push(datos.categoria ?? null);
      marcadores.push(`$${idx++}`);
    }
    if (datos.unidad_medida !== undefined) {
      columnas.push('unidad_medida');
      valores.push(datos.unidad_medida ?? null);
      marcadores.push(`$${idx++}`);
    }
  }

  // Campos especificos de documentos_requeridos.
  // F-13: orden/proyecto_id/apoyo_id/apoyo_excluir_id ya los agrega el bucle de
  // camposEnteros y los arreglos el de camposArreglo; repetirlos aqui producia
  // 'column "orden" specified more than once'. Solo falta `requisito`.
  if (entidad === 'documentos_requeridos' && datos.requisito !== undefined) {
    columnas.push('requisito');
    valores.push(String(datos.requisito).trim());
    marcadores.push(`$${idx++}`);
  }

  // activo siempre es TRUE al alta - va al final para coincidir con el orden de valores
  columnas.push('activo');
  valores.push(true);
  marcadores.push(`$${idx++}`);

  const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcadores.join(', ')}) RETURNING id, *`;

  try {
    const { rows } = await pool.query(sql, valores);
    const registro = rows[0];

    // Auditoria
    await pool.query(
      `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [
        usuarioId,
        entidad === 'documentos_requeridos' ? 'regla_documento_creada' : 'catalogo_creado',
        tabla,
        registro.id,
        JSON.stringify({ entidad, clave: registro.clave, campos: datos })
      ]
    );

    return registro;
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === '23505') {
      throw error409('clave_duplicada', 'Ya existe un registro con esta clave.');
    }
    throw error;
  }
}

/**
 * Edita una fila existente. Rechaza campos inmutables (clave, prefijo_folio).
 */
export async function editarEntidad(
  entidad: NombreEntidad,
  id: number,
  datos: Record<string, unknown>,
  usuarioId: number
) {
  const def = obtenerDefinicion(entidad);
  const tabla = def.tabla;

  // Verificar existencia
  const actual = await obtenerEntidad(entidad, id);

  // Rechazar campos inmutables si cambian
  for (const inmutable of def.inmutables) {
    if (datos[inmutable] !== undefined) {
      const valorNuevo = inmutable === 'clave' ? normalizarClave(String(datos[inmutable])) : String(datos[inmutable]);
      const valorActual = actual[inmutable];
      // F-14: Solo rechazar si el valor es distinto (valores iguales son no-op)
      if (valorNuevo !== valorActual) {
        if (inmutable === 'prefijo_folio') {
          throw error422('campo_inmutable', 'El prefijo de folio no se puede modificar. Desactiva el proyecto y da de alta uno nuevo.');
        }
        throw error422('campo_inmutable', `El campo ${inmutable} no se puede modificar.`);
      }
      // F-14: Si el valor es igual, removerlo de datos para que no cuente como cambio
      delete datos[inmutable];
    }
  }

  // Normalizar clave si viene
  if (def.campoClave && datos.clave) {
    datos.clave = normalizarClave(String(datos.clave));
  }

  // Construir UPDATE dinamico
  const actualizaciones: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;
  const cambios: Record<string, { anterior: unknown; nuevo: unknown }> = {};

  for (const campo of def.camposTexto) {
    if (datos[campo] !== undefined) {
      actualizaciones.push(`${campo} = $${idx}`);
      valores.push(datos[campo]);
      if (actual[campo] !== datos[campo]) {
        cambios[campo] = { anterior: actual[campo], nuevo: datos[campo] };
      }
      idx++;
    }
  }

  for (const campo of def.camposEnteros) {
    if (datos[campo] !== undefined) {
      actualizaciones.push(`${campo} = $${idx}`);
      valores.push(datos[campo] ?? null);
      if (actual[campo] !== (datos[campo] ?? null)) {
        cambios[campo] = { anterior: actual[campo], nuevo: datos[campo] ?? null };
      }
      idx++;
    }
  }

  for (const campo of def.camposArreglo) {
    if (datos[campo] !== undefined) {
      actualizaciones.push(`${campo} = $${idx}`);
      // F-13: arreglo JS directo; node-pg lo serializa a literal de Postgres.
      valores.push(datos[campo] ?? null);
      const anteriorStr = actual[campo] ? JSON.stringify(actual[campo]) : null;
      const nuevoStr = datos[campo] != null ? JSON.stringify(datos[campo]) : null;
      if (anteriorStr !== nuevoStr) {
        cambios[campo] = { anterior: actual[campo], nuevo: datos[campo] };
      }
      idx++;
    }
  }

  // Campos especificos
  if (entidad === 'proyectos' && datos.prefijo_folio !== undefined) {
    actualizaciones.push('prefijo_folio = $' + idx);
    valores.push(String(datos.prefijo_folio).toUpperCase());
    if (actual.prefijo_folio !== datos.prefijo_folio) {
      cambios.prefijo_folio = { anterior: actual.prefijo_folio, nuevo: datos.prefijo_folio };
    }
    idx++;
  }

  if (entidad === 'tipos_apoyo') {
    for (const campo of ['categoria', 'unidad_medida']) {
      if (datos[campo] !== undefined) {
        actualizaciones.push(`${campo} = $${idx}`);
        valores.push(datos[campo] ?? null);
        if (actual[campo] !== (datos[campo] ?? null)) {
          cambios[campo] = { anterior: actual[campo], nuevo: datos[campo] ?? null };
        }
        idx++;
      }
    }
  }

  // F-13: documentos_requeridos no necesita bloque propio: `requisito` ya lo
  // cubre camposTexto, los enteros camposEnteros y los arreglos camposArreglo.
  // El bloque anterior repetia esas columnas y rompia el UPDATE.

  if (actualizaciones.length === 0) {
    throw error422('payload_invalido', 'No se envio ningun campo editable.');
  }

  const sql = `UPDATE ${tabla} SET ${actualizaciones.join(', ')} WHERE id = $${idx} RETURNING id, *`;
  valores.push(id);

  const { rows } = await pool.query(sql, valores);
  const registro = rows[0];

  // Auditoria solo si hubo cambios reales
  if (Object.keys(cambios).length > 0) {
    await pool.query(
      `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [
        usuarioId,
        'catalogo_actualizado',
        tabla,
        id,
        JSON.stringify({ entidad, clave: actual.clave, cambios })
      ]
    );
  }

  return registro;
}

/**
 * Activa o desactiva una fila. Desactivar no es en cascada (D46).
 * Reactivar requiere que el padre este activo.
 */
export async function cambiarEstadoEntidad(
  entidad: NombreEntidad,
  id: number,
  activo: boolean,
  usuarioId: number
) {
  const def = obtenerDefinicion(entidad);
  const tabla = def.tabla;

  const actual = await obtenerEntidad(entidad, id);

  // Idempotencia
  if (actual.activo === activo) {
    return { registro: actual, hijos_activos: {} };
  }

  // Reactivar: verificar padre (F-15: validar padre_inactivo en modalidades)
  if (activo) {
    for (const padre of def.padres) {
      const padreId = (actual as any)[padre.campo];
      if (padreId !== null && padreId !== undefined) {
        const padreRow = await consultarUna<any>(
          `SELECT activo FROM ${padre.tabla} WHERE id = $1`,
          [padreId]
        );
        if (padreRow && !padreRow.activo) {
          throw error409('padre_inactivo', `Reactiva primero el ${padre.tabla.slice(0, -1)} al que pertenece.`);
        }
      }
    }
  }

  // Desactivar: contar hijos activos
  const hijosActivos: Record<string, number> = {};
  if (!activo) {
    for (const hijo of def.hijos) {
      const hijoDef = REGISTRO_ENTIDADES[hijo.entidad];
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${hijoDef.tabla} WHERE ${hijo.campo} = $1 AND activo`,
        [id]
      );
      if (rows[0] && Number(rows[0].n) > 0) {
        hijosActivos[hijo.entidad] = Number(rows[0].n);
      }
    }
  }

  // Actualizar
  const { rows } = await pool.query(
    `UPDATE ${tabla} SET activo = $1 WHERE id = $2 RETURNING id, *`,
    [activo, id]
  );
  const registro = rows[0];

  // Auditoria
  await pool.query(
    `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
     VALUES ($1, $2, $3, $4, $5, NULL)`,
    [
      usuarioId,
      'catalogo_estado_cambiado',
      tabla,
      id,
      JSON.stringify({
        entidad,
        clave: actual.clave,
        activo_anterior: actual.activo,
        activo_nuevo: activo,
        hijos_activos: hijosActivos
      })
    ]
  );

  return { registro, hijos_activos: hijosActivos };
}

/**
 * Obtiene referencias para los selects del formulario.
 * Devuelve todas las filas (activas e inactivas) con el campo `activo`.
 */
export async function obtenerReferencias() {
  const [programas, componentes, modalidades, proyectos, tiposApoyo] = await Promise.all([
    consultar<any>('SELECT id, clave, nombre, activo FROM programas ORDER BY nombre'),
    consultar<any>('SELECT id, clave, nombre, activo FROM componentes ORDER BY nombre'),
    consultar<any>('SELECT id, clave, nombre, componente_id, activo FROM modalidades ORDER BY nombre'),
    consultar<any>('SELECT id, clave, nombre, prefijo_folio, componente_id, modalidad_id, activo FROM proyectos ORDER BY nombre'),
    consultar<any>('SELECT id, clave, nombre, unidad_medida, activo FROM tipos_apoyo ORDER BY nombre')
  ]);

  return {
    programas,
    componentes,
    modalidades,
    proyectos,
    tipos_apoyo: tiposApoyo,
    tipos_persona: [
      { clave: 'fisica', nombre: 'Persona física' },
      { clave: 'moral', nombre: 'Persona moral sin fines de lucro' },
      { clave: 'grupo', nombre: 'Grupo de productores' }
    ]
  };
}

/**
 * Obtiene el arbol jerarquico completo.
 * Separa ramas programas/subprogramas y componentes/modalidades/proyectos.
 */
export async function obtenerArbol(incluirInactivos = false) {
  const condicionActivo = incluirInactivos ? '' : 'WHERE activo = TRUE';

  const [programas, subprogramas, componentes, modalidades, proyectos, tiposApoyo, documentos] = await Promise.all([
    consultar<any>(`SELECT id, clave, nombre, activo FROM programas ${condicionActivo} ORDER BY nombre`),
    consultar<any>(`SELECT id, programa_id, clave, nombre, activo FROM subprogramas ${condicionActivo} ORDER BY nombre`),
    consultar<any>(`SELECT id, clave, nombre, activo FROM componentes ${condicionActivo} ORDER BY nombre`),
    consultar<any>(`SELECT id, clave, nombre, componente_id, activo FROM modalidades ${condicionActivo} ORDER BY nombre`),
    consultar<any>(`SELECT id, clave, nombre, prefijo_folio, componente_id, modalidad_id, activo FROM proyectos ${condicionActivo} ORDER BY nombre`),
    consultar<any>(`SELECT count(*)::text AS n FROM tipos_apoyo ${condicionActivo}`),
    consultar<any>(`SELECT count(*)::text AS n FROM documentos_requeridos ${condicionActivo}`)
  ]);

  // Agrupar subprogramas por programa_id
  const subprogramasPorPrograma = new Map<number, any[]>();
  for (const sub of subprogramas) {
    const lista = subprogramasPorPrograma.get(sub.programa_id) || [];
    lista.push(sub);
    subprogramasPorPrograma.set(sub.programa_id, lista);
  }

  // Agrupar modalidades por componente_id
  const modalidadesPorComponente = new Map<number, any[]>();
  for (const mod of modalidades) {
    const lista = modalidadesPorComponente.get(mod.componente_id) || [];
    lista.push(mod);
    modalidadesPorComponente.set(mod.componente_id, lista);
  }

  // Agrupar proyectos por modalidad_id y componente_id
  const proyectosPorModalidad = new Map<number, any[]>();
  const proyectosSinModalidad: any[] = [];
  const proyectosHuerfanos: any[] = [];

  for (const proy of proyectos) {
    if (proy.modalidad_id) {
      const lista = proyectosPorModalidad.get(proy.modalidad_id) || [];
      lista.push(proy);
      proyectosPorModalidad.set(proy.modalidad_id, lista);
    } else if (proy.componente_id) {
      proyectosSinModalidad.push(proy);
    } else {
      proyectosHuerfanos.push(proy);
    }
  }

  // Armar ramas de programas
  const programasConSub = programas.map((prog) => ({
    ...prog,
    subprogramas: subprogramasPorPrograma.get(prog.id) || []
  }));

  // Armar ramas de componentes
  const componentesConModalidades = componentes.map((comp) => {
    const mods = modalidadesPorComponente.get(comp.id) || [];
    const modsConProyectos = mods.map((mod) => ({
      ...mod,
      proyectos: proyectosPorModalidad.get(mod.id) || []
    }));
    return {
      ...comp,
      modalidades: modsConProyectos,
      proyectos_sin_modalidad: proyectosSinModalidad.filter((p) => p.componente_id === comp.id)
    };
  });

  return {
    programas: programasConSub,
    componentes: componentesConModalidades,
    proyectos_huerfanos: proyectosHuerfanos,
    conteos: {
      programas: programas.length,
      subprogramas: subprogramas.length,
      componentes: componentes.length,
      modalidades: modalidades.length,
      proyectos: proyectos.length,
      tipos_apoyo: Number(tiposApoyo[0]?.n ?? 0),
      documentos_requeridos: Number(documentos[0]?.n ?? 0)
    }
  };
}
