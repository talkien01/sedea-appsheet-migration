// Edicion correctiva de beneficiarios ya promovidos a produccion.
// Aqui viven la lista blanca, la normalizacion, el diff y la bitacora; la ruta
// solo orquesta. Toda la operacion es transaccional.
import {
  CAMPOS_EDITABLES,
  LONGITUDES_MAXIMAS,
  esquemaEdicionBeneficiario,
  normalizarTelefono,
  type CambioCampo
} from '@sedea/shared';
import { ErrorApi, errorNoEncontrado } from '../plugins/errores.js';
import { consultar, consultarUna } from '../db/pool.js';
import { bitacoraEnTransaccion, enTransaccion } from './promocion.js';

/** Error 422 con codigo propio (el contrato del SPEC define uno por caso). */
function error422(codigo: string, mensaje: string): ErrorApi {
  return new ErrorApi(422, codigo, mensaje);
}

/**
 * Valida el payload contra la lista blanca. El rechazo es ATOMICO: si aparece
 * una sola clave no editable (curp, folio, nombre_completo, regional_id, ...)
 * se rechaza el payload completo y no se escribe nada.
 */
export function validarPayload(cuerpo: unknown): Record<string, unknown> {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw error422('payload_invalido', 'Datos inválidos.');
  }

  const permitidas = new Set<string>([...CAMPOS_EDITABLES, 'motivo']);
  const noEditables = Object.keys(cuerpo as Record<string, unknown>).filter(
    (clave) => !permitidas.has(clave)
  );
  if (noEditables.length > 0) {
    throw error422(
      'campo_no_editable',
      `Los campos ${noEditables.join(', ')} no son editables. CURP y Folio son la identidad ` +
        'legal del expediente; corrígelos en el padrón de origen y reimporta vía staging.'
    );
  }

  const parseado = esquemaEdicionBeneficiario.safeParse(cuerpo);
  if (!parseado.success) {
    // El unico caso que queda aqui es un tipo incorrecto (p. ej. municipio_id texto).
    throw error422('payload_invalido', 'Datos inválidos.');
  }
  return parseado.data as Record<string, unknown>;
}

/**
 * Normaliza los valores enviados: trim en textos, cadena vacia -> NULL
 * (permite limpiar un dato) y telefono reducido a sus 10 digitos.
 */
export function normalizarValores(datos: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};

  for (const campo of CAMPOS_EDITABLES) {
    if (!(campo in datos)) continue;
    const bruto = datos[campo];

    if (campo === 'municipio_id') {
      salida[campo] = bruto === null ? null : Number(bruto);
      continue;
    }

    if (bruto === null) {
      salida[campo] = null;
      continue;
    }

    const texto = String(bruto).trim();
    if (texto === '') {
      salida[campo] = null;
      continue;
    }

    if (campo === 'telefono') {
      const normalizado = normalizarTelefono(texto);
      if (!normalizado) throw error422('telefono_invalido', 'El teléfono debe tener 10 dígitos.');
      salida[campo] = normalizado;
      continue;
    }

    const maximo = LONGITUDES_MAXIMAS[campo];
    if (maximo && texto.length > maximo) {
      throw error422('longitud_excedida', `El campo ${campo} excede la longitud máxima.`);
    }
    salida[campo] = texto;
  }

  return salida;
}

interface UsuarioEditor {
  id: number;
  rol: string;
  regional_id: number | null;
}

const SELECT_BENEFICIARIO = `
  SELECT b.id, b.folio, b.curp, b.nombre_completo, b.regional_id, r.nombre AS regional,
         b.municipio_id, m.nombre AS municipio, b.colonia, b.seccion, b.localidad,
         b.domicilio, b.telefono, b.tipo_apoyo_id, t.nombre AS tipo_apoyo_nombre,
         b.cantidad_asignada, b.actualizado_en
    FROM beneficiarios b
    LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
    LEFT JOIN municipios m ON m.id = b.municipio_id
    LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
`;

export async function obtenerBeneficiarioParaCorreccion(id: number) {
  return consultarUna<any>(`${SELECT_BENEFICIARIO} WHERE b.id = $1`, [id]);
}

/**
 * Aplica la correccion. Devuelve el beneficiario actualizado y el diff de
 * cambios. Si nada cambia, `cambios` viene vacio y no se toca la base.
 */
export async function aplicarCorreccion(
  usuario: UsuarioEditor,
  id: number,
  cuerpo: unknown,
  contexto: { ip?: string | null; userAgent?: string | null }
): Promise<{ beneficiario: any; cambios: CambioCampo[] }> {
  const datos = validarPayload(cuerpo);
  const motivo = typeof datos.motivo === 'string' ? datos.motivo.trim() || null : null;

  const actual = await obtenerBeneficiarioParaCorreccion(id);
  if (!actual) throw errorNoEncontrado('El beneficiario no existe.');

  const clavesDeDatos = CAMPOS_EDITABLES.filter((campo) => campo in datos);
  if (clavesDeDatos.length === 0) {
    throw error422('sin_cambios', 'No se envió ningún campo editable.');
  }

  // Aislamiento por Regional: un editor con Regional asignada no sale de ella.
  const regionalDelUsuario =
    usuario.rol === 'admin' ? null : (usuario.regional_id ?? null);
  if (regionalDelUsuario !== null && actual.regional_id !== regionalDelUsuario) {
    throw new ErrorApi(
      403,
      'regional_no_permitida',
      'El beneficiario pertenece a otra Dirección Regional.'
    );
  }

  const valores = normalizarValores(datos);

  // Cambiar de municipio arrastra la Regional: es un dato derivado, nunca
  // aceptado en el payload (Assumption 33).
  let regionalDerivada: number | null = null;
  if ('municipio_id' in valores && valores.municipio_id !== null) {
    const municipio = await consultarUna<{ id: number; regional_id: number; activo: boolean }>(
      'SELECT id, regional_id, activo FROM municipios WHERE id = $1',
      [valores.municipio_id]
    );
    if (!municipio || !municipio.activo) {
      throw error422('municipio_invalido', 'El municipio seleccionado no existe o está inactivo.');
    }
    if (regionalDelUsuario !== null && municipio.regional_id !== regionalDelUsuario) {
      throw new ErrorApi(
        403,
        'regional_no_permitida',
        'No puedes mover un beneficiario a un municipio de otra Dirección Regional.'
      );
    }
    if (municipio.regional_id !== actual.regional_id) regionalDerivada = municipio.regional_id;
  }

  // Diff contra los valores actuales.
  const cambios: CambioCampo[] = [];
  for (const campo of Object.keys(valores)) {
    const anterior = actual[campo] ?? null;
    const nuevo = valores[campo] ?? null;
    if (String(anterior ?? '') !== String(nuevo ?? '')) {
      cambios.push({ campo, anterior, nuevo });
    }
  }
  if (regionalDerivada !== null) {
    cambios.push({ campo: 'regional_id', anterior: actual.regional_id, nuevo: regionalDerivada });
  }

  // No-op: se responde 200 sin tocar actualizado_en ni la bitacora.
  if (cambios.length === 0) {
    return { beneficiario: actual, cambios: [] };
  }

  const beneficiario = await enTransaccion(async (cliente) => {
    const asignaciones: string[] = [];
    const parametros: unknown[] = [id];
    for (const cambio of cambios) {
      parametros.push(cambio.nuevo);
      asignaciones.push(`${cambio.campo} = $${parametros.length}`);
    }

    await cliente.query(
      `UPDATE beneficiarios SET ${asignaciones.join(', ')}, actualizado_en = now() WHERE id = $1`,
      parametros
    );

    await bitacoraEnTransaccion(cliente, {
      usuarioId: usuario.id,
      accion: 'beneficiario_editado',
      entidad: 'beneficiario',
      entidadId: id,
      detalle: { cambios, motivo, rol: usuario.rol },
      ip: contexto.ip,
      userAgent: contexto.userAgent
    });

    const { rows } = await cliente.query(`${SELECT_BENEFICIARIO} WHERE b.id = $1`, [id]);
    return rows[0];
  });

  return { beneficiario, cambios };
}

/** Historial de correcciones de un beneficiario (E29). */
export async function historialCorrecciones(id: number) {
  const filas = await consultar<any>(
    `SELECT a.creado_en AS fecha, u.nombre_completo AS usuario, a.detalle
       FROM auditoria_log a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.accion = 'beneficiario_editado'
        AND a.entidad = 'beneficiario'
        AND a.entidad_id = $1
      ORDER BY a.id DESC
      LIMIT 50`,
    [String(id)]
  );

  return filas.map((fila) => ({
    fecha: fila.fecha,
    usuario: fila.usuario ?? null,
    rol: fila.detalle?.rol ?? null,
    motivo: fila.detalle?.motivo ?? null,
    cambios: Array.isArray(fila.detalle?.cambios) ? fila.detalle.cambios : []
  }));
}
