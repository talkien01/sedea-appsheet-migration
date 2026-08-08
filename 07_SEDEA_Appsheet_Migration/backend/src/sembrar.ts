// Seeder de datos demo. Ejecuta los .sql de db/seeds en el orden correcto de
// dependencias (catalogos -> usuarios -> beneficiarios) y sustituye los
// marcadores de contrasena por hashes bcrypt generados desde el entorno.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool, esperarBaseDatos } from './db/pool.js';

// Los usuarios dependen de las Regionales; por eso catalogos va primero.
const ORDEN_SEEDS = [
  '002_catalogos_demo.sql',
  '001_usuarios_demo.sql',
  '003_beneficiarios_demo.sql'
];

const SOLO_SI_VACIO = process.argv.includes('--si-vacio');

function leerContrasenaDemo(): string {
  const valor = process.env.SEED_ADMIN_PASSWORD;
  if (!valor || valor.length < 6) {
    console.error(
      'Falta la variable SEED_ADMIN_PASSWORD (minimo 6 caracteres). ' +
        'Copia .env.example a .env y define un valor antes de sembrar.'
    );
    process.exit(1);
  }
  return valor;
}

async function sembrar(): Promise<void> {
  await esperarBaseDatos();

  if (SOLO_SI_VACIO) {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM usuarios'
    );
    if (rows[0].n > 0) {
      console.log('La base ya tiene usuarios: se omite el seed (--si-vacio).');
      return;
    }
  }

  const contrasena = leerContrasenaDemo();
  const usuarioAdmin = process.env.SEED_ADMIN_USER || 'admin';
  const hash = bcrypt.hashSync(contrasena, 10);

  for (const archivo of ORDEN_SEEDS) {
    const ruta = path.join(config.directorioSeeds, archivo);
    if (!fs.existsSync(ruta)) {
      console.warn(`  ? ${archivo} no existe, se omite.`);
      continue;
    }
    let sql = fs.readFileSync(ruta, 'utf8');
    // Los tres usuarios demo comparten la misma contrasena de desarrollo.
    sql = sql
      .replace(/__USUARIO_ADMIN__/g, usuarioAdmin.replace(/'/g, "''"))
      .replace(/__HASH_ADMIN__/g, hash)
      .replace(/__HASH_CAPTURISTA__/g, hash)
      .replace(/__HASH_AUDITOR__/g, hash);

    await pool.query(sql);
    console.log(`  + ${archivo} sembrado`);
  }

  const resumen = await pool.query<{ tabla: string; n: number }>(`
    SELECT 'usuarios' AS tabla, count(*)::int AS n FROM usuarios
    UNION ALL SELECT 'direcciones_regionales', count(*)::int FROM direcciones_regionales
    UNION ALL SELECT 'municipios', count(*)::int FROM municipios
    UNION ALL SELECT 'tipos_apoyo', count(*)::int FROM tipos_apoyo
    UNION ALL SELECT 'catalogos', count(*)::int FROM catalogos
    UNION ALL SELECT 'beneficiarios', count(*)::int FROM beneficiarios
  `);
  for (const fila of resumen.rows) {
    console.log(`  ${fila.tabla}: ${fila.n}`);
  }
  console.log('Seed completado.');
}

sembrar()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Fallo el seed:', error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
