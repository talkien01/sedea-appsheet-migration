// Exenciones operativas al candado de autorización del Secretario.
//
// Que tipos_apoyo estan exentos vive en la columna tipos_apoyo.autorizado_de_facto
// (migracion 033), editable desde Catalogos -> Conceptos de apoyo — ya NO es
// una lista de IDs fija en codigo. Quien llama a estas funciones es responsable
// de traer ese campo con su propia consulta (join a tipos_apoyo) y pasarlo aqui;
// esta capa solo interpreta el valor, no vuelve a consultar la base.
//
// Importante: esta regla NO modifica solicitudes.autorizada_secretario ni
// atribuye la autorización al Secretario. Solo resuelve el candado operativo.
export function esAutorizadoDeFacto(concepto: { autorizado_de_facto?: unknown } | null | undefined): boolean {
  return concepto?.autorizado_de_facto === true;
}

export function conceptosAutorizadosDeFacto(
  conceptos: Array<{ autorizado_de_facto?: unknown }> | null | undefined
): boolean {
  return Array.isArray(conceptos) &&
    conceptos.length > 0 &&
    conceptos.every((concepto) => esAutorizadoDeFacto(concepto));
}
