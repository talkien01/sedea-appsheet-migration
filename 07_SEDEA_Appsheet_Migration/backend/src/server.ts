// Bootstrap de la API Fastify.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import estaticos from '@fastify/static';
import { config } from './config.js';
import { pool, esperarBaseDatos } from './db/pool.js';
import pluginErrores from './plugins/errores.js';
import pluginAuth from './plugins/auth.js';
import pluginRbac from './plugins/rbac.js';
import pluginCambioPassword from './plugins/cambioPassword.js';
import { prepararAlmacenamiento } from './servicios/almacenamiento.js';
import rutasSalud from './rutas/salud.js';
import rutasAuth from './rutas/auth.js';
import rutasCatalogos from './rutas/catalogos.js';
import rutasBeneficiarios from './rutas/beneficiarios.js';
import rutasCapturas from './rutas/capturas.js';
import rutasAuditoria from './rutas/auditoria.js';
import rutasStaging from './rutas/staging.js';
import rutasCorrecciones from './rutas/correcciones.js';
import rutasEstadisticas from './rutas/estadisticas.js';
import rutasUsuarios from './rutas/usuarios.js';
import rutasMiCuenta from './rutas/miCuenta.js';
// Build 6: modulo de captura de Solicitud de Apoyo en ventanilla.
import rutasSolicitudes from './rutas/solicitudes.js';
import rutasAlcance from './rutas/alcance.js';
// Digitalizacion V1: lotes de preparacion, caratulas y expediente electronico por fases.
import rutasDigitalizacion from './rutas/digitalizacion.js';
// Build 10: administracion de catalogos jerarquicos.
import rutasCatalogosAdmin from './rutas/catalogosAdmin.js';
import rutasConfiguracion from './rutas/configuracion.js';
import rutasFolioEntrega from './rutas/folio-entrega.js';
// Build 13: pre-dictaminacion con IA y dictamen humano.
import rutasDictamen from './rutas/dictamen.js';
// E60: traspaso celular -> PC para el escaneo de la Constancia CURP.
import rutasEscaneoCurp from './rutas/escaneoCurp.js';
// Administracion del sistema: reinicio de datos de prueba (solo admin).
import rutasAdmin from './rutas/admin.js';
// Registro de entrega del apoyo por concepto (evidencia en campo).
import rutasEntregas from './rutas/entregas.js';
// Monitor de presencia en vivo: latido de la PWA + consulta solo para admin.
import rutasPresencia from './rutas/presencia.js';

async function construirApp() {
  const app = Fastify({
    logger: {
      level: config.entorno === 'production' ? 'info' : 'debug',
      transport: undefined
    },
    bodyLimit: config.maxSubidaBytes + 1024 * 1024,
    trustProxy: true
  });

  await app.register(pluginErrores);

  await app.register(helmet, {
    // La PWA se sirve desde Nginx; aqui solo hace falta endurecer la API.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
  });

  await app.register(cors, {
    origin: config.corsOrigen === '*' ? true : config.corsOrigen.split(',').map((o) => o.trim()),
    credentials: true
  });

  await app.register(rateLimit, {
    max: config.limitePeticiones,
    timeWindow: '1 minute',
    // El health check no debe consumir cupo (lo usa el healthcheck de Docker).
    allowList: () => false,
    keyGenerator: (peticion) => peticion.ip
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxSubidaBytes,
      files: 2,
      fields: 20
    }
  });

  await app.register(pluginAuth);
  await app.register(pluginRbac);
  // Build 4: guarda global del cambio de contrasena obligatorio.
  await app.register(pluginCambioPassword);

  // Fotos de evidencia: requieren token (header o ?token=).
  prepararAlmacenamiento();
  app.addHook('onRequest', async (peticion, respuesta) => {
    if (peticion.raw.url?.startsWith(`${config.rutaPublicaMedia}/`)) {
      await app.autenticar(peticion, respuesta);
    }
  });
  await app.register(estaticos, {
    root: config.directorioMedia,
    prefix: `${config.rutaPublicaMedia}/`,
    decorateReply: false,
    index: false,
    list: false
  });

  await app.register(rutasSalud);
  await app.register(rutasAuth);
  await app.register(rutasCatalogos);
  await app.register(rutasBeneficiarios);
  await app.register(rutasCapturas);
  await app.register(rutasAuditoria);
  // Extensiones: depuracion de staging, correccion en produccion y dashboard.
  await app.register(rutasStaging);
  await app.register(rutasCorrecciones);
  await app.register(rutasEstadisticas);
  // Build 4: administracion de usuarios y cambio de la propia contrasena.
  await app.register(rutasUsuarios);
  await app.register(rutasMiCuenta);
  // Build 6: ventanilla (E40-E46) y alcance de usuarios (E47/E48).
  await app.register(rutasSolicitudes);
  await app.register(rutasAlcance);
  // Digitalizacion V1 / Fase 1: formacion y consulta de lotes de preparacion.
  await app.register(rutasDigitalizacion);
  // Build 10: administracion de catalogos (E49-E54).
  await app.register(rutasCatalogosAdmin, { prefix: '/api/admin/catalogos' });
  // Build 12: configuracion de plazos.
  await app.register(rutasConfiguracion);
  // Build 12: folio de entrega con QR.
  await app.register(rutasFolioEntrega);
  // Build 13: dictamen (E55-E59).
  await app.register(rutasDictamen);
  // E60: sesiones de escaneo con celular vinculado.
  await app.register(rutasEscaneoCurp);
  // Reinicio de datos de prueba (solo admin estricto).
  await app.register(rutasAdmin);
  // Entrega del apoyo: registro por concepto + paquete offline del evento.
  await app.register(rutasEntregas);
  // Monitor de presencia en vivo (quien esta conectado y en que pantalla).
  await app.register(rutasPresencia);

  return app;
}

async function main(): Promise<void> {
  await esperarBaseDatos();
  const app = await construirApp();

  const cerrar = async (senal: string) => {
    app.log.info(`Senal ${senal} recibida, cerrando...`);
    await app.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void cerrar('SIGINT'));
  process.on('SIGTERM', () => void cerrar('SIGTERM'));

  await app.listen({ port: config.puerto, host: '0.0.0.0' });
  app.log.info(`API SEDEA escuchando en el puerto ${config.puerto}`);
}

main().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exit(1);
});
