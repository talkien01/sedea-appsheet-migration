// Exenciones operativas al candado de autorización del Secretario.
//
// Por instrucción operativa, los apoyos de semilla de AVENA y GARBANZO se
// consideran autorizados de facto para impresión y entrega. La excepción se
// aplica por ID de tipo_apoyo para no depender del texto visible del catálogo.
//
// Importante: esta regla NO modifica solicitudes.autorizada_secretario ni
// atribuye la autorización al Secretario. Solo resuelve el candado operativo.
export const IDS_TIPOS_APOYO_AUTORIZADOS_DE_FACTO = [160, 161] as const;
export const TIPOS_APOYO_AUTORIZADOS_DE_FACTO = new Set<number>(
  IDS_TIPOS_APOYO_AUTORIZADOS_DE_FACTO
);

export function esTipoApoyoAutorizadoDeFacto(tipoApoyoId: unknown): boolean {
  const id = Number(tipoApoyoId);
  return Number.isInteger(id) && TIPOS_APOYO_AUTORIZADOS_DE_FACTO.has(id);
}

export function conceptosAutorizadosDeFacto(
  conceptos: Array<{ tipo_apoyo_id?: unknown }> | null | undefined
): boolean {
  return Array.isArray(conceptos) &&
    conceptos.length > 0 &&
    conceptos.every((concepto) => esTipoApoyoAutorizadoDeFacto(concepto.tipo_apoyo_id));
}
