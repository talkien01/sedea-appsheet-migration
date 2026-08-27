// Regla de cantidad maxima por superficie (tabla `reglas_cantidad_maxima`).
//
// Un concepto de apoyo puede tener un tope que depende de la superficie que el
// solicitante acredita: cantidad_maxima = superficie_ha * kg_por_hectarea, con
// la superficie truncada al `tope_hectareas` de la regla. Los conceptos SIN
// fila en `reglas_cantidad_maxima` no se validan (comportamiento historico).
//
// Este modulo es la UNICA implementacion del calculo: lo usan tanto el alta de
// la solicitud (E42) como la confirmacion del dictamen (E58).
import { maximoPorSuperficie } from '@sedea/shared';
import { consultar } from '../db/pool.js';

export { maximoPorSuperficie };

export interface ReglaCantidadMaxima {
  tipo_apoyo_id: number;
  kg_por_hectarea: number;
  tope_hectareas: number;
}

/** Todas las reglas vigentes, indexadas por `tipo_apoyo_id`. */
export async function reglasCantidadMaxima(): Promise<Map<number, ReglaCantidadMaxima>> {
  const filas = await consultar<{
    tipo_apoyo_id: string | number;
    kg_por_hectarea: string | number;
    tope_hectareas: string | number;
  }>('SELECT tipo_apoyo_id, kg_por_hectarea, tope_hectareas FROM reglas_cantidad_maxima');

  return new Map(
    filas.map((f) => [
      Number(f.tipo_apoyo_id),
      {
        tipo_apoyo_id: Number(f.tipo_apoyo_id),
        kg_por_hectarea: Number(f.kg_por_hectarea),
        tope_hectareas: Number(f.tope_hectareas)
      }
    ])
  );
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

export interface ExcesoCantidad {
  tipo_apoyo_id: number;
  cantidad: number;
  maximo: number;
  mensaje: string;
}

/**
 * Primer concepto que rompe su regla, o `null` si todos caben. No lanza: quien
 * llama decide el codigo HTTP (E42 y E58 usan 422 `cantidad_excede_maximo`).
 */
export function primerExcesoDeCantidad(
  conceptos: ConceptoAValidar[],
  reglas: Map<number, ReglaCantidadMaxima>,
  superficieHa: number | null
): ExcesoCantidad | null {
  for (const concepto of conceptos) {
    const regla = reglas.get(Number(concepto.tipo_apoyo_id));
    const maximo = maximoPorSuperficie(regla, superficieHa);
    if (maximo === null) continue;
    const cantidad = Number(concepto.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= maximo) continue;

    const unidad = concepto.unidad_medida ? ` ${concepto.unidad_medida}` : '';
    const etiqueta = concepto.nombre ? `«${concepto.nombre}»` : 'el concepto seleccionado';
    return {
      tipo_apoyo_id: Number(concepto.tipo_apoyo_id),
      cantidad,
      maximo,
      mensaje:
        `Con una superficie de ${superficieHa} ha, ${etiqueta} admite como máximo ` +
        `${maximo}${unidad}. Se capturó ${cantidad}${unidad}.`
    };
  }
  return null;
}
