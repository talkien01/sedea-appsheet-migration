// Calculo dinamico del checklist de documentos requeridos (E41, 12.6.2).
//
// El algoritmo es determinista y se evalua sobre `documentos_requeridos` con
// activo = true. Se usa igual desde E41 (consulta previa) y desde E42 (cuando
// el alta no manda la lista de documentos y hay que materializarla).
import { normalizarEtiqueta, type DocumentoRequeridoCalculado, type TipoPersona } from '@sedea/shared';
import { consultar } from '../db/pool.js';

interface ReglaDocumento {
  id: number;
  requisito: string;
  componentes: string[] | null;
  tipos_persona: string[] | null;
  proyecto_id: number | null;
  apoyo_id: number | null;
  apoyo_etiquetas: string[] | null;
  apoyo_excluir_id: number | null;
  apoyo_excluir_etiquetas: string[] | null;
  orden: number;
}

interface ConceptoElegido {
  id: number;
  nombre: string;
}

/** Un arreglo NULL o vacio significa "aplica a todos" en esa dimension. */
function aplicaATodos(lista: string[] | null): boolean {
  return lista === null || lista === undefined || lista.length === 0;
}

/**
 * Singular aproximado de una palabra en espanol. Las etiquetas del Excel real
 * vienen en plural (FERTILIZANTES, TRACTORES, PROYECTOS PECUARIOS) mientras que
 * los conceptos del catalogo de 152 filas estan en singular
 * ("FERTILIZANTE FORMULAS ESPECIFICAS"), asi que la contencion literal no
 * bastaria para reconocerlos.
 */
function singular(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith('ES')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('S')) return palabra.slice(0, -1);
  return palabra;
}

/** ¿El nombre del concepto contiene la etiqueta (o su forma singular)? */
function nombreContieneEtiqueta(nombre: string, etiqueta: string): boolean {
  const buscada = normalizarEtiqueta(etiqueta);
  if (buscada === '') return false;
  // 1) Contencion literal, tal como la describe 12.6.2.
  if (nombre.includes(buscada)) return true;
  // 2) Contencion palabra por palabra en singular, para los plurales del Excel.
  const palabras = buscada.split(' ').filter((p) => p.length > 0);
  return palabras.every((p) => nombre.includes(singular(p)));
}

/**
 * ¿El concepto coincide con la regla, por id exacto o porque su nombre
 * normalizado contiene alguna de las etiquetas? (Assumption 51).
 */
function conceptoCoincide(
  concepto: ConceptoElegido,
  apoyoId: number | null,
  etiquetas: string[] | null
): boolean {
  if (apoyoId !== null && concepto.id === apoyoId) return true;
  if (etiquetas && etiquetas.length > 0) {
    const nombre = normalizarEtiqueta(concepto.nombre);
    return etiquetas.some((e) => nombreContieneEtiqueta(nombre, e));
  }
  return false;
}

/** Evalua una regla contra la seleccion actual del formulario. */
export function reglaAplica(
  regla: ReglaDocumento,
  claveComponente: string,
  tipoPersona: TipoPersona,
  proyectoId: number | null,
  conceptos: ConceptoElegido[]
): boolean {
  // 1) Componente.
  if (!aplicaATodos(regla.componentes) && !regla.componentes!.includes(claveComponente)) {
    return false;
  }
  // 2) Tipo de persona.
  if (!aplicaATodos(regla.tipos_persona) && !regla.tipos_persona!.includes(tipoPersona)) {
    return false;
  }
  // 3) Proyecto: una regla ligada a proyecto NO aplica si no se envio ese proyecto.
  if (regla.proyecto_id !== null && regla.proyecto_id !== proyectoId) {
    return false;
  }
  // 4) Concepto: sin apoyo_id ni etiquetas es una regla general.
  const esGeneral = regla.apoyo_id === null && aplicaATodos(regla.apoyo_etiquetas);
  if (!esGeneral) {
    const alguno = conceptos.some((c) =>
      conceptoCoincide(c, regla.apoyo_id, regla.apoyo_etiquetas)
    );
    if (!alguno) return false;
  }
  // 5) Exclusiones: la regla se descarta solo si TODOS los conceptos enviados
  //    coinciden con alguna exclusion (ej. "Cotizaciones" no se pide si el
  //    unico concepto es Fertilizantes, pero si hay otro concepto si se pide).
  const hayExclusion =
    regla.apoyo_excluir_id !== null || !aplicaATodos(regla.apoyo_excluir_etiquetas);
  if (hayExclusion && conceptos.length > 0) {
    const todosExcluidos = conceptos.every((c) =>
      conceptoCoincide(c, regla.apoyo_excluir_id, regla.apoyo_excluir_etiquetas)
    );
    if (todosExcluidos) return false;
  }

  return true;
}

/**
 * Devuelve el checklist calculado: ordenado por `orden` y luego por texto,
 * sin requisitos repetidos (si dos reglas producen el mismo texto se conserva
 * la de menor id, 12.6.2).
 */
export async function calcularDocumentosRequeridos(params: {
  claveComponente: string;
  tipoPersona: TipoPersona;
  proyectoId: number | null;
  tiposApoyoIds: number[];
}): Promise<DocumentoRequeridoCalculado[]> {
  const reglas = await consultar<ReglaDocumento>(
    `SELECT id, requisito, componentes, tipos_persona, proyecto_id, apoyo_id,
            apoyo_etiquetas, apoyo_excluir_id, apoyo_excluir_etiquetas, orden
       FROM documentos_requeridos
      WHERE activo
      ORDER BY orden, requisito, id`
  );

  const conceptos = params.tiposApoyoIds.length
    ? await consultar<ConceptoElegido>(
        'SELECT id, nombre FROM tipos_apoyo WHERE id = ANY($1::bigint[])',
        [params.tiposApoyoIds]
      )
    : [];

  const seleccionadas = reglas.filter((r) =>
    reglaAplica(r, params.claveComponente, params.tipoPersona, params.proyectoId, conceptos)
  );

  // Deduplicacion por texto de requisito conservando el id menor.
  const porTexto = new Map<string, ReglaDocumento>();
  for (const regla of seleccionadas) {
    const previa = porTexto.get(regla.requisito);
    if (!previa || Number(regla.id) < Number(previa.id)) {
      porTexto.set(regla.requisito, regla);
    }
  }

  return [...porTexto.values()]
    .sort((a, b) => a.orden - b.orden || a.requisito.localeCompare(b.requisito, 'es'))
    .map((r) => ({
      documento_requerido_id: Number(r.id),
      requisito: r.requisito,
      origen: 'regla' as const
    }));
}
