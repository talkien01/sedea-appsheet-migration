// Ajuste masivo de kilogramos asignados (avena/garbanzo, sin monto -- por
// indicacion de la Direccion estos 2 conceptos solo manejan kg). Reemplaza
// el ajuste "a ojo" que hacian varios companeros con Excel para que la suma
// de kg comprometidos cuadrara contra el tope real disponible por Regional/
// Municipio: el sistema no valida ese tope en automatico hoy -- los
// escalones de `cantidadMaxima.ts` topan la cantidad por PERSONA segun su
// superficie, nunca la SUMA de varias solicitudes contra un tope de
// Regional o Municipio, que es justo lo que se desajusto.
//
// El archivo que mandan (Excel o CSV) es tipicamente el mismo export del
// padron de Beneficiarios (`beneficiarios.ts` -> export.xlsx) con
// `cantidad_asignada` ya editada a mano al valor FINAL deseado -- se acepta
// tal cual, ignorando las columnas que no hacen falta. Solo importan:
//   - folio (identifica la solicitud)
//   - cantidad_asignada / cantidad_nueva / cantidad (el valor final en kg)
//   - concepto_apoyo (opcional: solo se usa si esa solicitud tiene MAS DE UN
//     concepto -- ej. avena Y garbanzo en la misma solicitud -- para saber
//     cual de los dos ajustar; con un solo concepto se ignora).
// Cualquier fila sin folio se descarta en silencio (ej. la fila de "suma
// total" que varios companeros dejan al final para verificar su cuenta).
import ExcelJS from 'exceljs';
import { ErrorApi } from '../plugins/errores.js';
import { parsearCsv } from './csv.js';
import { consultar, consultarUna } from '../db/pool.js';
import { enTransaccion, bitacoraEnTransaccion } from './promocion.js';

export interface FilaArchivoAjuste {
  /** Numero de renglon en el archivo (1-based, contando el encabezado), para mensajes. */
  fila: number;
  folio: string;
  cantidad_nueva: number;
  concepto_texto: string | null;
}

export interface ErrorParseoAjuste {
  fila: number;
  mensaje: string;
}

const ENCABEZADOS_FOLIO = ['folio'];
const ENCABEZADOS_CANTIDAD = ['cantidad_asignada', 'cantidad_nueva', 'cantidad'];
const ENCABEZADOS_CONCEPTO = ['concepto_apoyo', 'concepto', 'tipo_apoyo'];

function normalizarEncabezado(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function ubicarColumna(encabezados: string[], candidatos: string[]): number {
  for (const candidato of candidatos) {
    const i = encabezados.indexOf(candidato);
    if (i !== -1) return i;
  }
  return -1;
}

/** ExcelJS entrega celdas de formula como {formula, result}; texto enriquecido como {richText:[...]}. */
function valorCelda(crudo: unknown): unknown {
  if (crudo && typeof crudo === 'object') {
    if ('result' in (crudo as Record<string, unknown>)) return (crudo as { result: unknown }).result;
    if ('richText' in (crudo as Record<string, unknown>)) {
      return (crudo as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    }
    if ('text' in (crudo as Record<string, unknown>)) return (crudo as { text: unknown }).text;
  }
  return crudo;
}

async function matrizDesdeXlsx(buffer: Buffer): Promise<unknown[][]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const filas: unknown[][] = [];
  hoja.eachRow((fila) => {
    // ExcelJS indexa `values` desde 1 (values[0] siempre vacio).
    const valores = (fila.values as unknown[]).slice(1).map(valorCelda);
    filas.push(valores);
  });
  return filas;
}

function matrizDesdeCsv(texto: string): unknown[][] {
  return parsearCsv(texto);
}

/**
 * Parsea el archivo (xlsx o csv) a filas {folio, cantidad_nueva, concepto_texto}.
 */
export async function parsearArchivoAjuste(
  buffer: Buffer,
  nombreArchivo: string
): Promise<{ filas: FilaArchivoAjuste[]; errores: ErrorParseoAjuste[] }> {
  const esXlsx = /\.xlsx$/i.test(nombreArchivo);
  const matriz = esXlsx ? await matrizDesdeXlsx(buffer) : matrizDesdeCsv(buffer.toString('utf8'));

  if (matriz.length === 0) {
    return { filas: [], errores: [{ fila: 0, mensaje: 'El archivo esta vacio.' }] };
  }

  const encabezados = (matriz[0] as unknown[]).map(normalizarEncabezado);
  const iFolio = ubicarColumna(encabezados, ENCABEZADOS_FOLIO);
  const iCantidad = ubicarColumna(encabezados, ENCABEZADOS_CANTIDAD);
  const iConcepto = ubicarColumna(encabezados, ENCABEZADOS_CONCEPTO);

  if (iFolio === -1 || iCantidad === -1) {
    return {
      filas: [],
      errores: [
        {
          fila: 1,
          mensaje:
            'No se encontraron las columnas "folio" y "cantidad_asignada" (o "cantidad_nueva"/"cantidad") en el encabezado del archivo.'
        }
      ]
    };
  }

  const filas: FilaArchivoAjuste[] = [];
  const errores: ErrorParseoAjuste[] = [];

  for (let i = 1; i < matriz.length; i++) {
    const renglon = matriz[i] as unknown[];
    const folio = String(renglon[iFolio] ?? '').trim();
    if (!folio) continue; // fila sin folio: se descarta en silencio (ej. total de verificacion)

    const crudo = renglon[iCantidad];
    const cantidad = typeof crudo === 'number' ? crudo : Number(String(crudo ?? '').trim());
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      errores.push({ fila: i + 1, mensaje: `Folio ${folio}: cantidad invalida ("${String(crudo)}").` });
      continue;
    }

    filas.push({
      fila: i + 1,
      folio,
      cantidad_nueva: cantidad,
      concepto_texto: iConcepto !== -1 ? String(renglon[iConcepto] ?? '').trim() || null : null
    });
  }

  return { filas, errores };
}

export interface ItemPlanAjuste {
  fila: number;
  folio: string;
  aplicable: boolean;
  motivo_omision: string | null;
  solicitud_concepto_id: number | null;
  beneficiario_id: number | null;
  beneficiario_nombre: string | null;
  concepto_nombre: string | null;
  cantidad_actual: number | null;
  cantidad_nueva: number;
  delta: number | null;
}

export interface ResumenPlanAjuste {
  total_filas: number;
  aplicables: number;
  omitidas: number;
  kg_actuales: number;
  kg_nuevos: number;
}

function omitido(fila: FilaArchivoAjuste, motivo: string): ItemPlanAjuste {
  return {
    fila: fila.fila,
    folio: fila.folio,
    aplicable: false,
    motivo_omision: motivo,
    solicitud_concepto_id: null,
    beneficiario_id: null,
    beneficiario_nombre: null,
    concepto_nombre: null,
    cantidad_actual: null,
    cantidad_nueva: fila.cantidad_nueva,
    delta: null
  };
}

/**
 * Resuelve cada fila del archivo contra la base real: localiza el concepto a
 * ajustar (desambiguando por `concepto_texto` si la solicitud tiene mas de
 * uno), y OMITE automaticamente lo que no se puede tocar sin riesgo: folio
 * inexistente, solicitud anulada, concepto ambiguo, o concepto que YA tiene
 * una entrega fisica registrada (no se puede recortar lo que ya se entrego).
 */
export async function construirPlanAjuste(
  filas: FilaArchivoAjuste[]
): Promise<{ items: ItemPlanAjuste[]; resumen: ResumenPlanAjuste }> {
  const items: ItemPlanAjuste[] = [];
  const vistos = new Set<string>();

  for (const fila of filas) {
    const claveDup = `${fila.folio.toUpperCase()}::${(fila.concepto_texto ?? '').toUpperCase()}`;
    if (vistos.has(claveDup)) {
      items.push(omitido(fila, 'Este folio (y concepto) ya aparece antes en el archivo.'));
      continue;
    }
    vistos.add(claveDup);

    const solicitud = await consultarUna<{ id: number; anulada_en: string | null }>(
      `SELECT id, anulada_en FROM solicitudes WHERE folio = $1`,
      [fila.folio]
    );
    if (!solicitud) {
      items.push(omitido(fila, 'No existe una solicitud con este folio.'));
      continue;
    }
    if (solicitud.anulada_en) {
      items.push(omitido(fila, 'Esta solicitud esta anulada.'));
      continue;
    }

    const conceptos = await consultar<{
      id: number;
      cantidad: string;
      tipo_apoyo_nombre: string;
      beneficiario_id: number | null;
      beneficiario_nombre: string | null;
    }>(
      `SELECT sc.id, sc.cantidad, t.nombre AS tipo_apoyo_nombre,
              sc.beneficiario_id, b.nombre_completo AS beneficiario_nombre
         FROM solicitud_conceptos sc
         JOIN tipos_apoyo t ON t.id = sc.tipo_apoyo_id
         LEFT JOIN beneficiarios b ON b.id = sc.beneficiario_id
        WHERE sc.solicitud_id = $1`,
      [solicitud.id]
    );

    if (conceptos.length === 0) {
      items.push(omitido(fila, 'Esta solicitud no tiene conceptos registrados.'));
      continue;
    }

    let concepto = conceptos[0]!;
    if (conceptos.length > 1) {
      const buscado = (fila.concepto_texto ?? '').toUpperCase();
      const coincidencias = conceptos.filter((c) => c.tipo_apoyo_nombre.toUpperCase() === buscado);
      if (coincidencias.length !== 1) {
        items.push(
          omitido(
            fila,
            `Esta solicitud tiene ${conceptos.length} conceptos: indica la columna "concepto_apoyo" con el nombre exacto para saber cual ajustar.`
          )
        );
        continue;
      }
      concepto = coincidencias[0]!;
    }

    const entrega = await consultarUna<{ uuid: string }>(
      `SELECT uuid FROM entregas_apoyo WHERE solicitud_concepto_id = $1 LIMIT 1`,
      [concepto.id]
    );
    if (entrega) {
      items.push(omitido(fila, 'Este concepto ya tiene una entrega fisica registrada: no se puede ajustar.'));
      continue;
    }

    items.push({
      fila: fila.fila,
      folio: fila.folio,
      aplicable: true,
      motivo_omision: null,
      solicitud_concepto_id: concepto.id,
      beneficiario_id: concepto.beneficiario_id,
      beneficiario_nombre: concepto.beneficiario_nombre,
      concepto_nombre: concepto.tipo_apoyo_nombre,
      cantidad_actual: Number(concepto.cantidad),
      cantidad_nueva: fila.cantidad_nueva,
      delta: fila.cantidad_nueva - Number(concepto.cantidad)
    });
  }

  const aplicables = items.filter((i) => i.aplicable);
  const resumen: ResumenPlanAjuste = {
    total_filas: items.length,
    aplicables: aplicables.length,
    omitidas: items.length - aplicables.length,
    kg_actuales: aplicables.reduce((s, i) => s + (i.cantidad_actual ?? 0), 0),
    kg_nuevos: aplicables.reduce((s, i) => s + i.cantidad_nueva, 0)
  };

  return { items, resumen };
}

export interface ItemAAplicar {
  folio: string;
  solicitud_concepto_id: number;
  beneficiario_id: number | null;
  cantidad_actual: number;
  cantidad_nueva: number;
}

/**
 * Aplica el ajuste en UNA sola transaccion, todo-o-nada: si cualquier fila
 * ya no coincide con lo que se vio en la previsualizacion (otra edicion
 * concurrente, una entrega registrada mientras tanto, una anulacion), se
 * aborta TODO el lote con un error que identifica el folio problematico --
 * nunca se deja un ajuste a medias. El usuario vuelve a previsualizar y
 * reintenta.
 */
export async function aplicarAjuste(
  items: ItemAAplicar[],
  contexto: {
    usuarioId: number;
    motivo: string;
    nombreArchivo: string;
    ip: string | null;
    userAgent: string | null;
  }
): Promise<{ aplicados: number }> {
  await enTransaccion(async (cliente) => {
    for (const item of items) {
      await cliente.query('SELECT id FROM solicitud_conceptos WHERE id = $1 FOR UPDATE', [
        item.solicitud_concepto_id
      ]);

      const actual = await cliente.query<{ cantidad: string; anulada_en: string | null }>(
        `SELECT sc.cantidad, s.anulada_en
           FROM solicitud_conceptos sc
           JOIN solicitudes s ON s.id = sc.solicitud_id
          WHERE sc.id = $1`,
        [item.solicitud_concepto_id]
      );
      const fila = actual.rows[0];
      if (!fila) {
        throw new ErrorApi(409, 'concepto_no_encontrado', `Folio ${item.folio}: el concepto ya no existe.`);
      }
      if (fila.anulada_en) {
        throw new ErrorApi(
          409,
          'solicitud_anulada',
          `Folio ${item.folio}: la solicitud se anulo despues de la previsualizacion.`
        );
      }
      if (Number(fila.cantidad) !== item.cantidad_actual) {
        throw new ErrorApi(
          409,
          'cambio_concurrente',
          `Folio ${item.folio}: la cantidad cambio despues de la previsualizacion (otra edicion concurrente). Vuelve a previsualizar.`
        );
      }

      const entrega = await cliente.query(
        `SELECT 1 FROM entregas_apoyo WHERE solicitud_concepto_id = $1 LIMIT 1`,
        [item.solicitud_concepto_id]
      );
      if (entrega.rows.length > 0) {
        throw new ErrorApi(
          409,
          'entrega_registrada',
          `Folio ${item.folio}: se registro una entrega fisica despues de la previsualizacion.`
        );
      }

      await cliente.query(`UPDATE solicitud_conceptos SET cantidad = $1 WHERE id = $2`, [
        item.cantidad_nueva,
        item.solicitud_concepto_id
      ]);
      if (item.beneficiario_id) {
        await cliente.query(
          `UPDATE beneficiarios SET cantidad_asignada = $1, actualizado_en = now() WHERE id = $2`,
          [item.cantidad_nueva, item.beneficiario_id]
        );
      }

      await bitacoraEnTransaccion(cliente, {
        usuarioId: contexto.usuarioId,
        accion: 'ajuste_masivo_kg',
        entidad: 'solicitud_concepto',
        entidadId: item.solicitud_concepto_id,
        detalle: {
          folio: item.folio,
          cantidad_anterior: item.cantidad_actual,
          cantidad_nueva: item.cantidad_nueva,
          motivo: contexto.motivo,
          archivo: contexto.nombreArchivo
        },
        ip: contexto.ip,
        userAgent: contexto.userAgent
      });
    }
  });

  return { aplicados: items.length };
}
