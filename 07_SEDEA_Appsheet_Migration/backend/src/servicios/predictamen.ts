// Orquestador del pre-dictamen de IA (SPEC 19.5).
//
// La entrada son los adjuntos que E46 ya guardo por documento
// (`solicitud_documentos.archivo_url`). NO existe expediente unico: cada
// archivo ya sabe a que documento requerido corresponde, asi que se hace UNA
// llamada al modelo por documento con archivo (D19-11) y cero llamadas por los
// documentos sin archivo.
import fs from 'node:fs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { rutaAbsolutaDesdeUrl } from './almacenamiento.js';
import { mediaTypeDeUrl } from './predictamen.prompt.js';
import { driverIa, type VeredictoIa } from './ia/cliente.js';

export type EstadoPredictamen = 'positivo' | 'negativo' | 'error';

export interface DetalleDocumento {
  solicitud_documento_id: number;
  documento_requerido_id: number | null;
  requisito: string;
  archivo_url: string | null;
  presente: boolean;
  legible: boolean;
  curp_coincide: boolean | null;
  curp_leida: string | null;
  observacion: string;
}

export interface ResultadoPredictamen {
  solicitud_id: number;
  predictamen_id: number;
  estado: EstadoPredictamen;
  resumen: string | null;
  documentos_evaluados: number;
  documentos_con_archivo: number;
}

/** Esquema de la respuesta cruda del modelo (SPEC 19.5.4). */
const esquemaVeredicto = z.object({
  presente: z.boolean(),
  legible: z.boolean(),
  curp_coincide: z.boolean().nullable().optional().default(null),
  curp_leida: z.string().nullable().optional().default(null),
  observacion: z.string().optional().default('')
});

const SIN_ARCHIVO = 'No se adjuntó ningún archivo para este documento.';
const ARCHIVO_PERDIDO = 'El archivo adjunto no se encontró en el almacenamiento.';
const FALLO_IA = 'No se pudo evaluar este documento (error de la IA).';

interface FilaDocumento {
  id: number;
  documento_requerido_id: number | null;
  requisito: string;
  archivo_url: string | null;
  archivo_hash: string | null;
  archivo_nombre: string | null;
}

interface FilaSolicitud {
  id: number;
  folio: string;
  curp: string | null;
  tipo_persona: string;
}

/** Corre `tareas` con como maximo `limite` en vuelo, conservando el orden. */
async function conConcurrencia<T, R>(
  elementos: T[],
  limite: number,
  tarea: (elemento: T, indice: number) => Promise<R>
): Promise<R[]> {
  const salida = new Array<R>(elementos.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (siguiente < elementos.length) {
      const indice = siguiente++;
      salida[indice] = await tarea(elementos[indice], indice);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

/** Normaliza la salida del modelo a la forma exacta de §19.4.1. */
function normalizarDetalle(
  fila: FilaDocumento,
  veredicto: VeredictoIa | null,
  observacionPorDefecto: string
): DetalleDocumento {
  const presente = veredicto ? veredicto.presente === true : false;
  // Si no hay archivo o no esta presente, legible se fuerza a false.
  const legible = presente && veredicto ? veredicto.legible === true : false;
  const curpLeida =
    veredicto && typeof veredicto.curp_leida === 'string' && veredicto.curp_leida.trim().length > 0
      ? veredicto.curp_leida.trim().toUpperCase().slice(0, 18)
      : null;

  return {
    solicitud_documento_id: fila.id,
    documento_requerido_id: fila.documento_requerido_id,
    requisito: fila.requisito,
    archivo_url: fila.archivo_url,
    presente,
    legible,
    curp_coincide: veredicto ? (veredicto.curp_coincide ?? null) : null,
    curp_leida: curpLeida,
    observacion: (veredicto?.observacion || observacionPorDefecto).slice(0, 300)
  };
}

/** Estado global segun D19-5. `curp_coincide === null` NO vuelve negativo (A19-7). */
export function estadoGlobal(detalle: DetalleDocumento[]): 'positivo' | 'negativo' {
  const hayProblema = detalle.some(
    (d) => d.presente === false || d.legible === false || d.curp_coincide === false
  );
  return hayProblema ? 'negativo' : 'positivo';
}

/** Resumen determinista compuesto por el backend, nunca por la IA (SPEC 19.5.4). */
export function componerResumen(
  estado: EstadoPredictamen,
  detalle: DetalleDocumento[],
  errorMensaje: string | null
): string {
  if (estado === 'error') return (errorMensaje ?? 'Error al generar el pre-dictamen.').slice(0, 300);
  if (estado === 'positivo') return 'Todos los documentos están presentes y legibles.';

  const conProblema = detalle.filter(
    (d) => d.presente === false || d.legible === false || d.curp_coincide === false
  );
  const nombres = conProblema.slice(0, 3).map((d) => d.requisito);
  const restantes = conProblema.length - nombres.length;
  const lista = restantes > 0 ? `${nombres.join(', ')} y ${restantes} más` : nombres.join(', ');
  return `${conProblema.length} documento(s) con problema: ${lista}.`.slice(0, 300);
}

/** Cuenta los documentos con problema del detalle (lo usa la bandeja). */
export function documentosConProblema(detalle: DetalleDocumento[]): number {
  return detalle.filter(
    (d) => d.presente === false || d.legible === false || d.curp_coincide === false
  ).length;
}

/**
 * Evalua UNA solicitud completa y guarda la fila de `predictamenes_ia`.
 * Regenerar SIEMPRE inserta una fila nueva (D19-6, historial append-only).
 */
export async function predictaminarSolicitud(
  solicitudId: number,
  usuarioId: number
): Promise<ResultadoPredictamen> {
  const inicio = Date.now();
  const driver = driverIa();

  const { rows: solicitudes } = await pool.query<FilaSolicitud>(
    'SELECT id, folio, curp, tipo_persona FROM solicitudes WHERE id = $1',
    [solicitudId]
  );
  const solicitud = solicitudes[0] ?? null;

  const { rows: documentos } = await pool.query<FilaDocumento>(
    `SELECT id, documento_requerido_id, requisito, archivo_url, archivo_hash, archivo_nombre
       FROM solicitud_documentos
      WHERE solicitud_id = $1
      ORDER BY id`,
    [solicitudId]
  );

  const conArchivo = documentos.filter((d) => d.archivo_url !== null).length;

  // Sin solicitud no hay fila que insertar (la FK lo impediria): se reporta el
  // error sin tocar la base.
  if (!solicitud) {
    return {
      solicitud_id: solicitudId,
      predictamen_id: 0,
      estado: 'error',
      resumen: 'La solicitud no existe.',
      documentos_evaluados: 0,
      documentos_con_archivo: 0
    };
  }

  // §19.5.1 punto 2: sin checklist no hay nada que evaluar. No es negativo:
  // no dice nada del ciudadano (A19-5).
  if (documentos.length === 0) {
    return guardar({
      solicitudId,
      usuarioId,
      estado: 'error',
      detalle: [],
      errorMensaje: 'La solicitud no tiene checklist de documentos.',
      modelo: driver.modelo,
      documentosEvaluados: documentos.length,
      documentosConArchivo: conArchivo,
      latenciaMs: Date.now() - inicio
    });
  }

  let primerFalloTecnico: string | null = null;
  let fallosTecnicos = 0;

  // Concurrencia 3 entre los documentos de la solicitud (§19.5.5).
  const detalle = await conConcurrencia(documentos, 3, async (fila) => {
    // §19.5.1 punto 3: sin archivo no se llama al modelo.
    if (!fila.archivo_url) return normalizarDetalle(fila, null, SIN_ARCHIVO);

    const rutaAbsoluta = rutaAbsolutaDesdeUrl(fila.archivo_url);
    if (!rutaAbsoluta) return normalizarDetalle(fila, null, ARCHIVO_PERDIDO);

    const mediaType = mediaTypeDeUrl(fila.archivo_url);
    if (!mediaType) return normalizarDetalle(fila, null, ARCHIVO_PERDIDO);

    const entrada = {
      contenido: fs.readFileSync(rutaAbsoluta),
      mediaType,
      archivoNombre: fila.archivo_nombre,
      archivoHash: fila.archivo_hash,
      contexto: {
        requisito: fila.requisito,
        curpCapturada: solicitud.curp,
        tipoPersona: solicitud.tipo_persona,
        folio: solicitud.folio
      }
    };

    // Un reintento ante excepcion o JSON invalido (§19.5.4). El fallo de un
    // documento no aborta los demas.
    for (let intento = 0; intento < 2; intento++) {
      try {
        const crudo = await driver.evaluarDocumento(entrada);
        const veredicto = esquemaVeredicto.parse(crudo);
        return normalizarDetalle(fila, veredicto as VeredictoIa, '');
      } catch (error) {
        if (intento === 1) {
          fallosTecnicos++;
          if (!primerFalloTecnico) primerFalloTecnico = (error as Error).message;
          return normalizarDetalle(fila, null, FALLO_IA);
        }
      }
    }
    return normalizarDetalle(fila, null, FALLO_IA);
  });

  // §19.5.1 punto 5: si TODAS las filas con archivo fallaron tecnicamente, es error.
  const todoFallo = conArchivo > 0 && fallosTecnicos === conArchivo;
  const estado: EstadoPredictamen = todoFallo ? 'error' : estadoGlobal(detalle);

  return guardar({
    solicitudId,
    usuarioId,
    estado,
    detalle,
    errorMensaje: todoFallo ? primerFalloTecnico : null,
    modelo: driver.modelo,
    documentosEvaluados: documentos.length,
    documentosConArchivo: conArchivo,
    latenciaMs: Date.now() - inicio
  });
}

async function guardar(datos: {
  solicitudId: number;
  usuarioId: number;
  estado: EstadoPredictamen;
  detalle: DetalleDocumento[];
  errorMensaje: string | null;
  modelo: string;
  documentosEvaluados: number;
  documentosConArchivo: number;
  latenciaMs: number;
}): Promise<ResultadoPredictamen> {
  const resumen = componerResumen(datos.estado, datos.detalle, datos.errorMensaje);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO predictamenes_ia
       (solicitud_id, documentos_evaluados, documentos_con_archivo, estado, detalle,
        resumen, error_mensaje, modelo_usado, latencia_ms, generado_por)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      datos.solicitudId,
      datos.documentosEvaluados,
      datos.documentosConArchivo,
      datos.estado,
      JSON.stringify(datos.detalle),
      resumen,
      datos.errorMensaje,
      datos.modelo,
      datos.latenciaMs,
      datos.usuarioId
    ]
  );

  return {
    solicitud_id: datos.solicitudId,
    predictamen_id: rows[0].id,
    estado: datos.estado,
    resumen,
    documentos_evaluados: datos.documentosEvaluados,
    documentos_con_archivo: datos.documentosConArchivo
  };
}

/**
 * Lote de solicitudes con concurrencia 3 a nivel de solicitud (§19.5.5).
 * El fallo de una solicitud no aborta las demas: se guarda como estado 'error'.
 */
export async function predictaminarLote(
  solicitudIds: number[],
  usuarioId: number
): Promise<ResultadoPredictamen[]> {
  return conConcurrencia(solicitudIds, 3, async (solicitudId) => {
    try {
      return await predictaminarSolicitud(solicitudId, usuarioId);
    } catch (error) {
      // Un fallo inesperado en una solicitud no aborta el resto del lote.
      return {
        solicitud_id: solicitudId,
        predictamen_id: 0,
        estado: 'error' as const,
        resumen: (error as Error).message.slice(0, 300),
        documentos_evaluados: 0,
        documentos_con_archivo: 0
      };
    }
  });
}
