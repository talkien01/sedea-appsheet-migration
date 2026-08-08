// Runner de migraciones: aplica en orden los .sql de db/migrations y registra
// cada archivo en la tabla _migraciones para que sea idempotente.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pool, esperarBaseDatos } from './db/pool.js';

async function migrar(): Promise<void> {
  await esperarBaseDatos();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      id        BIGSERIAL PRIMARY KEY,
      archivo   TEXT UNIQUE NOT NULL,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const directorio = config.directorioMigraciones;
  if (!fs.existsSync(directorio)) {
    throw new Error(`No se encontro el directorio de migraciones: ${directorio}`);
  }

  const archivos = fs
    .readdirSync(directorio)
    .filter((a) => a.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ archivo: string }>('SELECT archivo FROM _migraciones');
  const aplicadas = new Set(rows.map((r) => r.archivo));

  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) {
      console.log(`  = ${archivo} (ya aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(directorio, archivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO _migraciones (archivo) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      console.log(`  + ${archivo} aplicada`);
      nuevas++;
    } catch (error) {
      await cliente.query('ROLLBACK');
      console.error(`  ! Error aplicando ${archivo}:`, (error as Error).message);
      throw error;
    } finally {
      cliente.release();
    }
  }

  console.log(`Migraciones completadas. Nuevas: ${nuevas}, total: ${archivos.length}.`);
}

migrar()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Fallo la migracion:', error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
