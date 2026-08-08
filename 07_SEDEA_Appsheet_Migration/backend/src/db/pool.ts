// Pool unico de conexiones a PostgreSQL.
import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// NUMERIC llega como string por defecto; lo convertimos a number para los DTOs.
types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
// BIGINT (int8) tambien: los ids del proyecto caben de sobra en un number.
types.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString: config.urlBaseDatos,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/** Atajo tipado para consultas. */
export async function consultar<T = any>(
  sql: string,
  parametros: unknown[] = []
): Promise<T[]> {
  const resultado = await pool.query(sql, parametros as any[]);
  return resultado.rows as T[];
}

/** Devuelve la primera fila o null. */
export async function consultarUna<T = any>(
  sql: string,
  parametros: unknown[] = []
): Promise<T | null> {
  const filas = await consultar<T>(sql, parametros);
  return filas.length > 0 ? filas[0] : null;
}

/** Espera a que la base de datos acepte conexiones (arranque en Docker). */
export async function esperarBaseDatos(intentos = 30, esperaMs = 2000): Promise<void> {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (i === intentos) throw error;
      console.log(`Base de datos no disponible, reintento ${i}/${intentos}...`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}
