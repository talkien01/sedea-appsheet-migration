// Punto de entrada del paquete compartido entre backend y PWA.
export * from './dto.js';
export * from './schemas.js';
export * from './staging.js';
export * from './correcciones.js';
export * from './usuarios.js';
// Build 6: modulo de Solicitud de Apoyo en ventanilla.
export * from './solicitudes.js';
export * from './declaraciones.js';
// Build 10: administracion de catalogos jerarquicos.
export * from './catalogos.js';
// Escaneo del QR de la Constancia CURP y traspaso celular -> PC (E60).
export * from './curpQr.js';
// Reinicio de datos de prueba: fuente unica de verdad de tablas + frase.
export * from './reinicio.js';
// Registro de entrega del apoyo por concepto (evidencia en campo).
export * from './entregas.js';
// Configuracion de plazos de ingreso de solicitudes (administrable desde la app).
export * from './configuracion.js';
// Monitor de presencia: quien esta conectado y en que pantalla (solo admin).
export * from './presencia.js';
