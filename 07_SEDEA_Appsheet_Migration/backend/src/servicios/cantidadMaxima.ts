// Cantidad maxima por superficie (tabla `reglas_cantidad_maxima_escalon`).
//
// Un concepto de apoyo puede tener un tope que depende de la superficie que el
// solicitante acredita. NO es una formula: son escalones fijos. Dentro de cada
// rango de superficie se entrega siempre la misma cantidad, sin interpolar; por
// debajo del primer escalon el concepto NO es elegible, y por encima del ultimo
// la cantidad se topa en ese ultimo escalon. Los conceptos SIN escalones no se
// validan (comportamiento historico).
//
// Este modulo es la UNICA implementacion del calculo en el backend: lo usan
// tanto el alta de la solicitud (E42) como la confirmacion del dictamen (E58).
import { cantidadPorEscalon, type EscalonCantidadMaxima } from '@sedea/shared';
import { consultar } from '../db/pool.js';

export { cantidadPorEscalon };
export type { EscalonCantidadMaxima };

/** Todos los escalones vigentes, agrupados por `tipo_apoyo_id`. */
export async function escalonesCantidadMaxima(): Promise<Map<number, EscalonCantidadMaxima[]>> {
  const filas = await consultar<{
    tipo_apoyo_id: string | number;
    superficie_desde: string | number;
    superficie_hasta: string | number;
    cantidad: string | number;
  }>(
    `SELECT tipo_apoyo_id, superficie_desde, superficie_hasta, cantidad
       FROM reglas_cantidad_maxima_escalon
      ORDER BY tipo_apoyo_id, superficie_hasta`
  );

  const mapa = new Map<number, EscalonCantidadMaxima[]>();
  for (const f of filas) {
    const id = Number(f.tipo_apoyo_id);
    const lista = mapa.get(id) ?? [];
    lista.push({
      superficie_desde: Number(f.superficie_desde),
      superficie_hasta: Number(f.superficie_hasta),
      cantidad: Number(f.cantidad)
    });
    mapa.set(id, lista);
  }
  return mapa;
}

/**
 * Superficie que acredita el solicitante, tomada de la seccion de Actividad
 * economica. Se usa `agr_superficie_total_ha` porque el documento oficial habla
 * de la "superficie acreditada por el solicitante", que es la del predio que
 * respalda el documento de propiedad o posesion, no la que planea sembrar.
 * Si la ventanilla solo capturo la superficie de siembra, se usa esa como
 * respaldo para no bloquear la captura.
 */
export function superficieAcreditada(actividad: {
  agr_superficie_total_ha?: number | string | null;
  agr_superficie_siembra_ha?: number | string | null;
}): number | null {
  const aNumero = (valor: number | string | null | undefined): number | null => {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return aNumero(actividad.agr_superficie_total_ha) ?? aNumero(actividad.agr_superficie_siembra_ha);
}

export interface ConceptoAValidar {
  tipo_apoyo_id: number;
  cantidad: number;
  nombre?: string | null;
  unidad_medida?: string | null;
}

export interface ProblemaCantidad {
  /** Codigo HTTP 422 que debe usar quien llama. */
  codigo: 'superficie_insuficiente' | 'cantidad_excede_maximo';
  tipo_apoyo_id: number;
  cantidad: number;
  /** Cantidad fija del escalon; null cuando el problema es la superficie. */
  maximo: number | null;
  mensaje: string;
}

/**
 * Primer concepto que rompe su regla de escalones, o `null` si todos caben.
 * No lanza: quien llama decide el codigo HTTP (E42 y E58 usan 422 con el
 * `codigo` que trae el resultado).
 */
export function primerProblemaDeCantidad(
  conceptos: ConceptoAValidar[],
  escalonesPorTipo: Map<number, EscalonCantidadMaxima[]>,
  superficieHa: number | null
): ProblemaCantidad | null {
  for (const concepto of conceptos) {
    const tipoId = Number(concepto.tipo_apoyo_id);
    const resultado = cantidadPorEscalon(escalonesPorTipo.get(tipoId), superficieHa);
    if (resultado.tipo === 'sin_regla' || resultado.tipo === 'sin_superficie') continue;

    const cantidad = Number(concepto.cantidad);
    const unidad = concepto.unidad_medida ? ` ${concepto.unidad_medida}` : '';
    const etiqueta = concepto.nombre ? `«${concepto.nombre}»` : 'el concepto seleccionado';

    if (resultado.tipo === 'no_elegible') {
      return {
        codigo: 'superficie_insuficiente',
        tipo_apoyo_id: tipoId,
        cantidad,
        maximo: null,
        mensaje:
          `${etiqueta} requiere una superficie mínima de ${resultado.minimo} ha. ` +
          `Se capturó una superficie de ${superficieHa} ha, por lo que el concepto no es elegible.`
      };
    }

    if (Number.isFinite(cantidad) && cantidad > resultado.cantidad) {
      return {
        codigo: 'cantidad_excede_maximo',
        tipo_apoyo_id: tipoId,
        cantidad,
        maximo: resultado.cantidad,
        mensaje:
          `Con una superficie de ${superficieHa} ha, ${etiqueta} admite como máximo ` +
          `${resultado.cantidad}${unidad}. Se capturó ${cantidad}${unidad}.`
      };
    }
  }
  return null;
}
