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
import { prepararAlmacenamiento } from './servicios/almacenamiento.js';
import rutasSalud from './rutas/salud.js';
import rutasAuth from './rutas/auth.js';
import rutasCatalogos from './rutas/catalogos.js';
import rutasBeneficiarios from './rutas/beneficiarios.js';
import rutasCapturas from './rutas/capturas.js';
import rutasAuditoria from './rutas/auditoria.js';

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
