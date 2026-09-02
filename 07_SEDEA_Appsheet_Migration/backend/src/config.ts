// Lectura y validacion de variables de entorno. El arranque falla temprano
// si falta algo critico (por ejemplo un JWT_SECRET corto o ausente).
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Carga el .env de la raiz del monorepo si existe (en Docker las vars ya vienen del compose).
for (const candidato of ['.env', '../.env', '../../.env']) {
  const ruta = path.resolve(process.cwd(), candidato);
  if (fs.existsSync(ruta)) {
    dotenv.config({ path: ruta });
    break;
  }
}

/**
 * Resuelve un directorio del repositorio probando varias rutas candidatas,
 * de modo que funcione igual ejecutando desde la raiz, desde backend/ o dentro
 * del contenedor (WORKDIR /app).
 */
export function resolverDirectorio(relativo: string): string {
  const candidatos = [
    path.resolve(process.cwd(), relativo),
    path.resolve(process.cwd(), '..', relativo),
    path.resolve('/app', relativo)
  ];
  for (const c of candidatos) {
    if (fs.existsSync(c)) return c;
  }
  return candidatos[0];
}

const esquemaEnv = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGIN: z.string().default('*'),
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  MEDIA_DIR: z.string().default('./media'),
  MEDIA_PUBLIC_PATH: z.string().default('/media'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(8),
  // Un PDF de un ADF puede contener decenas o cientos de recibos; necesita un
  // limite distinto al de las fotografias individuales.
  MAX_CONCILIACION_PDF_MB: z.coerce.number().int().positive().default(40),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Candado de defensa en profundidad para la unica operacion destructiva
  // global. Se habilita UNICAMENTE escribiendo literalmente "true".
  ALLOW_DESTRUCTIVE_RESET: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  // Build 13: pre-dictaminacion con IA. Todas con default: ninguna rompe el
  // arranque si falta (A19-11). El default es `simulado` para poder instalar,
  // probar y evaluar sin ANTHROPIC_API_KEY y sin gastar.
  PREDICTAMEN_DRIVER: z.enum(['anthropic', 'openai_compatible', 'simulado']).default('simulado'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  // Driver `openai_compatible`: cualquier endpoint que hable Chat Completions
  // estilo OpenAI (Qwen via DashScope compatible-mode, OpenRouter, OpenAI...).
  PREDICTAMEN_API_BASE_URL: z.string().default(''),
  PREDICTAMEN_API_KEY: z.string().default(''),
  PREDICTAMEN_MODEL: z.string().default('')
});

const parseado = esquemaEnv.safeParse(process.env);

if (!parseado.success) {
  const detalle = parseado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`\nConfiguracion invalida. Revisa tu archivo .env:\n${detalle}\n`);
  process.exit(1);
}

const env = parseado.data;

export const config = {
  entorno: env.NODE_ENV,
  puerto: env.PORT,
  urlBaseDatos: env.DATABASE_URL,
  jwtSecreto: env.JWT_SECRET,
  jwtExpiracion: env.JWT_EXPIRES_IN,
  corsOrigen: env.CORS_ORIGIN,
  driverAlmacenamiento: env.STORAGE_DRIVER,
  directorioMedia: path.isAbsolute(env.MEDIA_DIR)
    ? env.MEDIA_DIR
    : path.resolve(process.cwd(), env.MEDIA_DIR),
  rutaPublicaMedia: env.MEDIA_PUBLIC_PATH,
  maxSubidaBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  maxSubidaMb: env.MAX_UPLOAD_MB,
  maxPdfConciliacionBytes: env.MAX_CONCILIACION_PDF_MB * 1024 * 1024,
  maxPdfConciliacionMb: env.MAX_CONCILIACION_PDF_MB,
  limitePeticiones: env.RATE_LIMIT_MAX,
  permitirReinicioDestructivo: env.ALLOW_DESTRUCTIVE_RESET,
  predictamenDriver: env.PREDICTAMEN_DRIVER,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  anthropicModelo: env.ANTHROPIC_MODEL,
  predictamenApiBaseUrl: env.PREDICTAMEN_API_BASE_URL,
  predictamenApiKey: env.PREDICTAMEN_API_KEY,
  predictamenModelo: env.PREDICTAMEN_MODEL,
  directorioMigraciones: resolverDirectorio('db/migrations'),
  directorioSeeds: resolverDirectorio('db/seeds')
};

export type Config = typeof config;
