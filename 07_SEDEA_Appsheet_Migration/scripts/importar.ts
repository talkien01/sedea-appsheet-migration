#!/usr/bin/env node
// CLI de importacion de padron y catalogos desde CSV/XLSX.
// El mapeo de columnas se define en un JSON externo: ningun nombre de columna
// del cliente esta escrito en el codigo.
//
// Uso:
//   npm run importar -- --tipo padron --archivo <ruta.csv|xlsx> --mapeo <ruta.json> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------
for (const candidato of ['.env', '../.env']) {
  const ruta = path.resolve(process.cwd(), candidato);
  if (fs.existsSync(ruta)) {
    dotenv.config({ path: ruta });
    break;
  }
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
interface Opciones {
  tipo: 'padron' | 'catalogo' | null;
  archivo: string | null;
  mapeo: string | null;
  dryRun: boolean;
  ayuda: boolean;
}

function leerArgumentos(argv: string[]): Opciones {
  const opciones: Opciones = { tipo: null, archivo: null, mapeo: null, dryRun: false, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const actual = argv[i];
    const siguiente = argv[i + 1];
    switch (actual) {
      case '--tipo':
        opciones.tipo = siguiente as Opciones['tipo'];
        i++;
        break;
      case '--archivo':
        opciones.archivo = siguiente ?? null;
        i++;
        break;
      case '--mapeo':
        opciones.mapeo = siguiente ?? null;
        i++;
        break;
      case '--dry-run':
        opciones.dryRun = true;
        break;
      case '--help':
      case '-h':
        opciones.ayuda = true;
        break;
    }
  }
  return opciones;
}

function mostrarAyuda(): void {
  console.log(`
Importador de padron y catalogos - SEDEA

Uso:
  npm run importar -- --tipo <padron|catalogo> --archivo <ruta> --mapeo <ruta.json> [--dry-run]

Opciones:
  --tipo <padron|catalogo>   Tipo de importacion a ejecutar. Obligatorio.
  --archivo <ruta>           Archivo de origen .csv, .xlsx o .xls. Obligatorio.
  --mapeo <ruta.json>        Archivo JSON con el mapeo de columnas. Obligatorio.
  --dry-run                  Procesa y valida sin escribir en la base de datos.
  --help, -h                 Muestra esta ayuda.

Ejemplos:
  npm run importar -- --tipo padron --archivo scripts/datos-ejemplo/padron.ejemplo.csv --mapeo scripts/mapeos/padron.ejemplo.json
  npm run importar -- --tipo catalogo --archivo scripts/datos-ejemplo/catalogo.ejemplo.csv --mapeo scripts/mapeos/catalogo.ejemplo.json --dry-run
`);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Normaliza un encabezado: sin acentos, mayusculas, espacios colapsados. */
function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Genera una clave tipo slug para catalogos creados al vuelo. */
function aClave(texto: string, prefijo = ''): string {
  const base = normalizar(texto).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return prefijo ? `${prefijo}-${base}` : base;
}

function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const n = Number(String(valor).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

interface Mapeo {
  tipo?: string;
  delimitador?: string;
  hoja?: string;
  columnas: Record<string, string>;
  crear_catalogos_faltantes?: boolean;
  clave_upsert?: string;
  guardar_columnas_no_mapeadas_en?: string;
}

/** Lee el archivo de origen y devuelve filas como objetos {encabezado: valor}. */
function leerFilas(archivo: string, mapeo: Mapeo): Record<string, string>[] {
  const extension = path.extname(archivo).toLowerCase();
  if (extension === '.csv' || extension === '.txt') {
    const contenido = fs.readFileSync(archivo, 'utf8').replace(/^\ufeff/, '');
    return parseCsv(contenido, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: mapeo.delimitador || ','
    }) as Record<string, string>[];
  }
  if (extension === '.xlsx' || extension === '.xls') {
    const libro = XLSX.readFile(archivo);
    const nombreHoja =
      mapeo.hoja && libro.SheetNames.includes(mapeo.hoja) ? mapeo.hoja : libro.SheetNames[0];
    const hoja = libro.Sheets[nombreHoja];
    return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false }) as Record<string, string>[];
  }
  throw new Error(`Extension no soportada: ${extension}. Usa .csv, .xlsx o .xls`);
}

// ---------------------------------------------------------------------------
// Importacion
// ---------------------------------------------------------------------------

const { Pool } = pg;

interface Resultado {
  leidas: number;
  insertadas: number;
  actualizadas: number;
  errores: Array<{ fila: number; motivo: string }>;
}

async function main(): Promise<number> {
  const opciones = leerArgumentos(process.argv.slice(2));

  if (opciones.ayuda || process.argv.slice(2).length === 0) {
    mostrarAyuda();
    return 0;
  }

  if (!opciones.tipo || !['padron', 'catalogo'].includes(opciones.tipo)) {
    console.error('Error: --tipo debe ser "padron" o "catalogo". Usa --help para ver la ayuda.');
    return 1;
  }
  if (!opciones.archivo || !fs.existsSync(opciones.archivo)) {
    console.error(`Error: no se encontro el archivo indicado en --archivo (${opciones.archivo}).`);
    return 1;
  }
  if (!opciones.mapeo || !fs.existsSync(opciones.mapeo)) {
    console.error(`Error: no se encontro el archivo de mapeo indicado en --mapeo (${opciones.mapeo}).`);
    return 1;
  }

  const mapeo: Mapeo = JSON.parse(fs.readFileSync(opciones.mapeo, 'utf8'));
  if (!mapeo.columnas || typeof mapeo.columnas !== 'object') {
    console.error('Error: el archivo de mapeo debe contener un objeto "columnas".');
    return 1;
  }

  const filas = leerFilas(opciones.archivo, mapeo);
  console.log(`Archivo: ${opciones.archivo}`);
  console.log(`Mapeo:   ${opciones.mapeo}`);
  console.log(`Filas leidas: ${filas.length}${opciones.dryRun ? ' (modo --dry-run)' : ''}`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: falta DATABASE_URL. Copia .env.example a .env y configura la conexion.');
    return 1;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const resultado: Resultado = { leidas: filas.length, insertadas: 0, actualizadas: 0, errores: [] };
  let importacionId: number | null = null;

  try {
    if (!opciones.dryRun) {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO importaciones (archivo, tipo, mapeo, ejecutado_por)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [path.basename(opciones.archivo), opciones.tipo, JSON.stringify(mapeo), os.userInfo().username]
      );
      importacionId = rows[0].id;
    }

    if (opciones.tipo === 'padron') {
      await importarPadron(pool, filas, mapeo, resultado, importacionId, opciones.dryRun);
    } else {
      await importarCatalogo(pool, filas, mapeo, resultado, opciones.dryRun);
    }

    if (!opciones.dryRun && importacionId !== null) {
      await pool.query(
        `UPDATE importaciones
            SET filas_leidas = $2, filas_insertadas = $3, filas_actualizadas = $4,
                filas_error = $5, errores = $6::jsonb
          WHERE id = $1`,
        [
          importacionId,
          resultado.leidas,
          resultado.insertadas,
          resultado.actualizadas,
          resultado.errores.length,
          JSON.stringify(resultado.errores.slice(0, 200))
        ]
      );

      // Bitacora de auditoria de la importacion.
      await pool.query(
        `INSERT INTO auditoria_log (accion, entidad, entidad_id, detalle)
         VALUES ('import_padron', 'beneficiario', $1, $2::jsonb)`,
        [
          String(importacionId),
          JSON.stringify({
            archivo: path.basename(opciones.archivo),
            tipo: opciones.tipo,
            leidas: resultado.leidas,
            insertadas: resultado.insertadas,
            actualizadas: resultado.actualizadas,
            errores: resultado.errores.length
          })
        ]
      );
    }

    console.log('');
    console.log('Resumen de la importacion');
    console.log(`  leidas:       ${resultado.leidas}`);
    console.log(`  insertadas:   ${resultado.insertadas}`);
    console.log(`  actualizadas: ${resultado.actualizadas}`);
    console.log(`  errores:      ${resultado.errores.length}`);
    if (importacionId !== null) console.log(`  importacion:  #${importacionId}`);
    for (const error of resultado.errores.slice(0, 10)) {
      console.log(`    - fila ${error.fila}: ${error.motivo}`);
    }
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Importa el padron de beneficiarios con upsert por la clave configurada. */
async function importarPadron(
  pool: pg.Pool,
  filas: Record<string, string>[],
  mapeo: Mapeo,
  resultado: Resultado,
  importacionId: number | null,
  dryRun: boolean
): Promise<void> {
  const columnas = mapeo.columnas;
  const crearFaltantes = mapeo.crear_catalogos_faltantes !== false;
  const campoExtra = mapeo.guardar_columnas_no_mapeadas_en || 'datos_extra';

  // Indice normalizado de columnas mapeadas -> campo destino.
  const mapaNormalizado = new Map<string, string>();
  for (const [destino, origen] of Object.entries(columnas)) {
    mapaNormalizado.set(normalizar(origen), destino);
  }

  // Caches para no golpear la base en cada fila.
  const cacheRegionales = new Map<string, number>();
  const cacheMunicipios = new Map<string, number>();
  const cacheApoyos = new Map<string, number>();

  async function resolverRegional(nombre: string): Promise<number | null> {
    const clave = normalizar(nombre);
    if (!clave) return null;
    if (cacheRegionales.has(clave)) return cacheRegionales.get(clave)!;

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM direcciones_regionales
        WHERE upper(unaccent(nombre)) = $1 OR upper(clave) = $1 LIMIT 1`,
      [clave]
    );
    if (rows.length) {
      cacheRegionales.set(clave, rows[0].id);
      return rows[0].id;
    }
    if (!crearFaltantes || dryRun) return null;

    const insercion = await pool.query<{ id: number }>(
      `INSERT INTO direcciones_regionales (clave, nombre) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [aClave(nombre, 'REG'), nombre.trim()]
    );
    cacheRegionales.set(clave, insercion.rows[0].id);
    return insercion.rows[0].id;
  }

  async function resolverMunicipio(nombre: string, regionalId: number): Promise<number | null> {
    const clave = `${regionalId}|${normalizar(nombre)}`;
    if (!normalizar(nombre)) return null;
    if (cacheMunicipios.has(clave)) return cacheMunicipios.get(clave)!;

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM municipios
        WHERE regional_id = $1 AND (upper(unaccent(nombre)) = $2 OR upper(clave) = $2) LIMIT 1`,
      [regionalId, normalizar(nombre)]
    );
    if (rows.length) {
      cacheMunicipios.set(clave, rows[0].id);
      return rows[0].id;
    }
    if (!crearFaltantes || dryRun) return null;

    // Un mismo municipio en dos Regionales genera dos registros distintos (ver Assumption 7).
    const insercion = await pool.query<{ id: number }>(
      `INSERT INTO municipios (clave, nombre, regional_id) VALUES ($1, $2, $3)
       ON CONFLICT (clave, regional_id) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [aClave(nombre, 'MUN'), nombre.trim(), regionalId]
    );
    cacheMunicipios.set(clave, insercion.rows[0].id);
    return insercion.rows[0].id;
  }

  async function resolverTipoApoyo(nombre: string): Promise<number | null> {
    const clave = normalizar(nombre);
    if (!clave) return null;
    if (cacheApoyos.has(clave)) return cacheApoyos.get(clave)!;

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM tipos_apoyo WHERE upper(unaccent(nombre)) = $1 OR upper(clave) = $1 LIMIT 1`,
      [clave]
    );
    if (rows.length) {
      cacheApoyos.set(clave, rows[0].id);
      return rows[0].id;
    }
    if (!crearFaltantes || dryRun) return null;

    const insercion = await pool.query<{ id: number }>(
      `INSERT INTO tipos_apoyo (clave, nombre, categoria) VALUES ($1, $2, 'otro')
       ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [aClave(nombre, 'TA'), nombre.trim()]
    );
    cacheApoyos.set(clave, insercion.rows[0].id);
    return insercion.rows[0].id;
  }

  let contador = 0;
  for (const [indice, fila] of filas.entries()) {
    const numeroFila = indice + 2; // +1 por encabezado, +1 por base 1
    contador++;

    // Reparte los valores entre campos mapeados y datos_extra.
    const valores: Record<string, string> = {};
    const extra: Record<string, string> = {};
    for (const [encabezado, valor] of Object.entries(fila)) {
      const destino = mapaNormalizado.get(normalizar(encabezado));
      if (destino) valores[destino] = String(valor ?? '').trim();
      else if (String(valor ?? '').trim() !== '') extra[encabezado.trim()] = String(valor).trim();
    }

    const nombreCompleto = valores.nombre_completo;
    if (!nombreCompleto) {
      resultado.errores.push({ fila: numeroFila, motivo: 'Sin nombre del beneficiario' });
      continue;
    }

    const regionalId = valores.regional ? await resolverRegional(valores.regional) : null;
    if (!regionalId) {
      resultado.errores.push({
        fila: numeroFila,
        motivo: `Direccion Regional no resoluble: "${valores.regional ?? ''}"`
      });
      continue;
    }

    const municipioId = valores.municipio ? await resolverMunicipio(valores.municipio, regionalId) : null;
    const tipoApoyoId = valores.tipo_apoyo ? await resolverTipoApoyo(valores.tipo_apoyo) : null;
    const folio = valores.folio && valores.folio !== '' ? valores.folio : `IMP-${contador}`;

    if (dryRun) {
      resultado.insertadas++;
      continue;
    }

    const { rows } = await pool.query<{ inserto: boolean }>(
      `INSERT INTO beneficiarios (
          folio, curp, nombre_completo, regional_id, municipio_id, colonia, seccion,
          localidad, domicilio, telefono, tipo_apoyo_id, cantidad_asignada, ${campoExtra}, origen_import_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       ON CONFLICT (folio) DO UPDATE SET
          curp = EXCLUDED.curp,
          nombre_completo = EXCLUDED.nombre_completo,
          regional_id = EXCLUDED.regional_id,
          municipio_id = EXCLUDED.municipio_id,
          colonia = EXCLUDED.colonia,
          seccion = EXCLUDED.seccion,
          localidad = EXCLUDED.localidad,
          domicilio = EXCLUDED.domicilio,
          telefono = EXCLUDED.telefono,
          tipo_apoyo_id = EXCLUDED.tipo_apoyo_id,
          cantidad_asignada = EXCLUDED.cantidad_asignada,
          ${campoExtra} = EXCLUDED.${campoExtra},
          origen_import_id = EXCLUDED.origen_import_id,
          actualizado_en = now()
       RETURNING (xmax = 0) AS inserto`,
      [
        folio,
        valores.curp || null,
        nombreCompleto,
        regionalId,
        municipioId,
        valores.colonia || null,
        valores.seccion || null,
        valores.localidad || null,
        valores.domicilio || null,
        valores.telefono || null,
        tipoApoyoId,
        aNumero(valores.cantidad_asignada),
        JSON.stringify(extra),
        importacionId
      ]
    );

    if (rows[0]?.inserto) resultado.insertadas++;
    else resultado.actualizadas++;
  }
}

/** Importa entradas del catalogo generico clave/valor. */
async function importarCatalogo(
  pool: pg.Pool,
  filas: Record<string, string>[],
  mapeo: Mapeo,
  resultado: Resultado,
  dryRun: boolean
): Promise<void> {
  const mapaNormalizado = new Map<string, string>();
  for (const [destino, origen] of Object.entries(mapeo.columnas)) {
    mapaNormalizado.set(normalizar(origen), destino);
  }

  for (const [indice, fila] of filas.entries()) {
    const numeroFila = indice + 2;
    const valores: Record<string, string> = {};
    for (const [encabezado, valor] of Object.entries(fila)) {
      const destino = mapaNormalizado.get(normalizar(encabezado));
      if (destino) valores[destino] = String(valor ?? '').trim();
    }

    if (!valores.grupo || !valores.clave || !valores.valor) {
      resultado.errores.push({ fila: numeroFila, motivo: 'Faltan grupo, clave o valor' });
      continue;
    }
    if (dryRun) {
      resultado.insertadas++;
      continue;
    }

    const { rows } = await pool.query<{ inserto: boolean }>(
      `INSERT INTO catalogos (grupo, clave, valor, padre_grupo, padre_clave, orden)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (grupo, clave, COALESCE(padre_clave, '')) DO UPDATE SET
         valor = EXCLUDED.valor,
         padre_grupo = EXCLUDED.padre_grupo,
         orden = EXCLUDED.orden
       RETURNING (xmax = 0) AS inserto`,
      [
        valores.grupo,
        valores.clave,
        valores.valor,
        valores.padre_grupo || null,
        valores.padre_clave || null,
        aNumero(valores.orden) ?? 0
      ]
    );

    if (rows[0]?.inserto) resultado.insertadas++;
    else resultado.actualizadas++;
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error('Fallo la importacion:', error);
    process.exit(1);
  });
