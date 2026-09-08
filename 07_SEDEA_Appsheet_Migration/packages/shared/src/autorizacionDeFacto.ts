// Exenciones operativas al candado de autorización del Secretario.
//
// Que tipos_apoyo estan exentos vive en la columna tipos_apoyo.autorizado_de_facto
// (migracion 033), editable desde Catalogos -> Conceptos de apoyo — ya NO es
// una lista de IDs fija en codigo. Quien llama a estas funciones es responsable
// de traer ese campo con su propia consulta (join a tipos_apoyo) y pasarlo aqui;
// esta capa solo interpreta el valor, no vuelve a consultar la base.
//
// Vive en @sedea/shared (no solo en el backend) porque el FRONTEND tambien
// necesita el mismo criterio: el boton "Imprimir Folio de Entrega" en
// DetalleSolicitud.tsx debe habilitarse con la MISMA regla que aplica el
// backend en GET /:id/folio, o el boton se queda deshabilitado aunque el
// backend si dejaria pasar (bug real encontrado en produccion: CFA-AVENA
// tiene autorizado_de_facto=true pero el boton seguia bloqueado porque
// DetalleSolicitud.tsx solo miraba autorizada_secretario).
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
