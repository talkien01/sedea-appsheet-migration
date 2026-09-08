// Exenciones operativas al candado de autorización del Secretario.
//
// La implementacion real vive en packages/shared/src/autorizacionDeFacto.ts
// (el frontend tambien la necesita, para habilitar el boton de Folio de
// Entrega con el mismo criterio que este backend). Este archivo solo
// re-exporta para no tener que tocar los imports existentes en entregas.ts,
// folio-entrega.ts y solicitudes.ts.
export { esAutorizadoDeFacto, conceptosAutorizadosDeFacto } from '@sedea/shared';
