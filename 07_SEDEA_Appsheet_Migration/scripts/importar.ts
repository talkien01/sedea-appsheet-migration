#!/usr/bin/env node
// CLI de importacion de padron y catalogos desde CSV/XLSX.
// El mapeo de columnas se define en un JSON externo: ningun nombre de columna
// del cliente esta escrito en el codigo.
//
// IMPORTANTE (build 2): este importador YA NO escribe nunca en las tablas de
// produccion `beneficiarios` / `catalogos`. Todo aterriza en las tablas de
// staging (`staging_beneficiarios`, `staging_catalogos`) en estado
// `pendiente`, con flags de diagnostico calculados. La unica via a produccion
// es la aprobacion humana desde /api/staging (decision D3 del SPEC).
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

Destino:
  --tipo padron    -> staging_beneficiarios (estado_revision = 'pendiente')
  --tipo catalogo  -> staging_catalogos     (estado_revision = 'pendiente')
  Nada llega a produccion sin la aprobacion humana desde la pantalla de
  Depuracion (rol editor_datos o admin).

Ejemplos:
  npm run importar -- --tipo padron --archivo scripts/datos-ejemplo/padron.staging.ejemplo.csv --mapeo scripts/mapeos/padron.staging.ejemplo.json
  npm run importar -- --tipo catalogo --archivo scripts/datos-ejemplo/catalogo.staging.ejemplo.csv --mapeo scripts/mapeos/catalogo.staging.ejemplo.json --dry-run
`);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Normaliza un texto: sin acentos, mayusculas, espacios colapsados. */
function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
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
    const contenido = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '');
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

/** Los 6 flags de diagnostico del staging de padron. */
const FLAGS_PADRON = [
  'folio_duplicado',
  'curp_duplicada_mismo_concepto',
  'curp_duplicada_concepto_distinto',
  'sin_coordenadas',
  'sin_colonia',
  'concepto_no_reconocido'
] as const;

/** Flags del staging de catalogos. */
const FLAGS_CATALOGO = ['clave_duplicada', 'valor_duplicado', 'concepto_no_reconocido'] as const;

interface Resultado {
  leidas: number;
  insertadas: number;
  actualizadas: number;
  omitidas: number;
  errores: Array<{ fila: number; motivo: string }>;
  flags: Record<string, number>;
  niveles: Record<string, number>;
}

function resultadoVacio(leidas: number): Resultado {
  return {
    leidas,
    insertadas: 0,
    actualizadas: 0,
    omitidas: 0,
    errores: [],
    flags: {},
    niveles: {}
  };
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
  const archivoBase = path.basename(opciones.archivo);
  console.log(`Archivo: ${opciones.archivo}`);
  console.log(`Mapeo:   ${opciones.mapeo}`);
  console.log(`Destino: ${opciones.tipo === 'padron' ? 'staging_beneficiarios' : 'staging_catalogos'}`);
  console.log(`Filas leidas: ${filas.length}${opciones.dryRun ? ' (modo --dry-run)' : ''}`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: falta DATABASE_URL. Copia .env.example a .env y configura la conexion.');
    return 1;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const resultado = resultadoVacio(filas.length);
  let importacionId: number | null = null;

  try {
    if (!opciones.dryRun) {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO importaciones (archivo, tipo, mapeo, ejecutado_por)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [archivoBase, opciones.tipo, JSON.stringify(mapeo), os.userInfo().username]
      );
      importacionId = rows[0].id;
    }

    if (opciones.tipo === 'padron') {
      await importarPadron(pool, filas, mapeo, resultado, importacionId, opciones.dryRun, archivoBase);
    } else {
      await importarCatalogo(pool, filas, mapeo, resultado, importacionId, opciones.dryRun, archivoBase);
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

      // Bitacora de auditoria de la importacion a staging.
      await pool.query(
        `INSERT INTO auditoria_log (accion, entidad, entidad_id, detalle)
         VALUES ('staging_import', $1, $2, $3::jsonb)`,
        [
          opciones.tipo === 'padron' ? 'staging_beneficiario' : 'staging_catalogo',
          String(importacionId),
          JSON.stringify({
            archivo: archivoBase,
            tipo: opciones.tipo,
            filas_leidas: resultado.leidas,
            filas_insertadas: resultado.insertadas,
            filas_actualizadas: resultado.actualizadas,
            filas_omitidas: resultado.omitidas,
            filas_error: resultado.errores.length,
            conteo_por_flag: resultado.flags,
            conteo_por_nivel: resultado.niveles
          })
        ]
      );
    }

    console.log('');
    console.log('Resumen de la importacion');
    console.log(`  leidas:       ${resultado.leidas}`);
    console.log(`  insertadas:   ${resultado.insertadas}`);
    console.log(`  actualizadas: ${resultado.actualizadas}`);
    console.log(`  omitidas:     ${resultado.omitidas} (ya revisadas, no se tocan)`);
    console.log(`  errores:      ${resultado.errores.length}`);
    if (importacionId !== null) console.log(`  importacion:  #${importacionId}`);
    for (const error of resultado.errores.slice(0, 10)) {
      console.log(`    - fila ${error.fila}: ${error.motivo}`);
    }

    console.log('');
    console.log('Alertas detectadas');
    const flags = opciones.tipo === 'padron' ? FLAGS_PADRON : FLAGS_CATALOGO;
    for (const flag of flags) {
      console.log(`  ${flag.padEnd(34)} ${resultado.flags[flag] ?? 0}`);
    }
    for (const nivel of ['alta', 'media', 'ninguna']) {
      console.log(`  nivel_alerta=${nivel.padEnd(21)} ${resultado.niveles[nivel] ?? 0}`);
    }
    console.log('');
    console.log(
      'Ninguna fila se aprobo ni se descarto automaticamente: todas quedan en ' +
        'estado "pendiente" a la espera de revision humana en /depuracion.'
    );
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Padron -> staging_beneficiarios
// ---------------------------------------------------------------------------

/**
 * Importa el padron a staging. La resolucion de Regional / Municipio /
 * Concepto es de SOLO LECTURA: nunca crea catalogos nuevos, porque un concepto
 * no reconocido debe quedar marcado con su flag y no colarse al catalogo
 * oficial de 152 conceptos.
 */
async function importarPadron(
  pool: pg.Pool,
  filas: Record<string, string>[],
  mapeo: Mapeo,
  resultado: Resultado,
  importacionId: number | null,
  dryRun: boolean,
  archivoBase: string
): Promise<void> {
  const campoExtra = mapeo.guardar_columnas_no_mapeadas_en || 'datos_extra';
  if (campoExtra !== 'datos_extra') {
    console.warn(
      `  ! "${campoExtra}" no es una columna del staging: las columnas no mapeadas ` +
        'se guardaran en datos_extra.'
    );
  }

  const mapaNormalizado = new Map<string, string>();
  for (const [destino, origen] of Object.entries(mapeo.columnas)) {
    mapaNormalizado.set(normalizar(origen), destino);
  }

  const cacheRegionales = new Map<string, number | null>();
  const cacheMunicipios = new Map<string, number | null>();
  const cacheApoyos = new Map<string, number | null>();

  async function resolverRegional(nombre: string): Promise<number | null> {
    const clave = normalizar(nombre);
    if (!clave) return null;
    if (cacheRegionales.has(clave)) return cacheRegionales.get(clave)!;
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM direcciones_regionales
        WHERE activo AND (upper(unaccent(nombre)) = $1 OR upper(clave) = $1) LIMIT 1`,
      [clave]
    );
    const id = rows.length ? rows[0].id : null;
    cacheRegionales.set(clave, id);
    return id;
  }

  async function resolverMunicipio(nombre: string, regionalId: number | null): Promise<number | null> {
    const normalizado = normalizar(nombre);
    if (!normalizado) return null;
    const clave = `${regionalId ?? 0}|${normalizado}`;
    if (cacheMunicipios.has(clave)) return cacheMunicipios.get(clave)!;
    const { rows } = await pool.query<{ id: number }>(
      regionalId
        ? `SELECT id FROM municipios
            WHERE activo AND regional_id = $2 AND (upper(unaccent(nombre)) = $1 OR upper(clave) = $1)
            LIMIT 1`
        : `SELECT id FROM municipios
            WHERE activo AND (upper(unaccent(nombre)) = $1 OR upper(clave) = $1) LIMIT 1`,
      regionalId ? [normalizado, regionalId] : [normalizado]
    );
    const id = rows.length ? rows[0].id : null;
    cacheMunicipios.set(clave, id);
    return id;
  }

  async function resolverTipoApoyo(nombre: string): Promise<number | null> {
    const clave = normalizar(nombre);
    if (!clave) return null;
    if (cacheApoyos.has(clave)) return cacheApoyos.get(clave)!;
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM tipos_apoyo
        WHERE activo AND (upper(unaccent(nombre)) = $1 OR upper(clave) = $1) LIMIT 1`,
      [clave]
    );
    const id = rows.length ? rows[0].id : null;
    cacheApoyos.set(clave, id);
    return id;
  }

  for (const [indice, fila] of filas.entries()) {
    // fila_origen: 1 = primera fila de datos (el encabezado no cuenta).
    const filaOrigen = indice + 1;

    const valores: Record<string, string> = {};
    const extra: Record<string, string> = {};
    for (const [encabezado, valor] of Object.entries(fila)) {
      const destino = mapaNormalizado.get(normalizar(encabezado));
      if (destino) valores[destino] = String(valor ?? '').trim();
      else if (String(valor ?? '').trim() !== '') extra[encabezado.trim()] = String(valor).trim();
    }

    const regionalId = valores.regional ? await resolverRegional(valores.regional) : null;
    const municipioId = valores.municipio
      ? await resolverMunicipio(valores.municipio, regionalId)
      : null;
    const tipoApoyoId = valores.tipo_apoyo ? await resolverTipoApoyo(valores.tipo_apoyo) : null;

    // Una Regional no resoluble NO descarta la fila: se guarda y se anota el
    // motivo para que el revisor la corrija antes de promover.
    const avisos: string[] = [];
    if (!regionalId) {
      avisos.push(`Dirección Regional no resuelta: "${valores.regional ?? ''}"`);
    }
    if (!valores.nombre_completo) avisos.push('Fila sin nombre del beneficiario');

    if (dryRun) {
      resultado.insertadas++;
      continue;
    }

    const { rows } = await pool.query<{ inserto: boolean }>(
      `INSERT INTO staging_beneficiarios (
          importacion_id, archivo, fila_origen, folio, curp, nombre_completo,
          regional_texto, regional_id, municipio_texto, municipio_id, colonia, seccion,
          localidad, domicilio, telefono, tipo_apoyo_texto, tipo_apoyo_id,
          cantidad_asignada, lat_proyecto, lng_proyecto, datos_extra, motivo_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
       ON CONFLICT (archivo, fila_origen) DO UPDATE SET
          importacion_id   = EXCLUDED.importacion_id,
          folio            = EXCLUDED.folio,
          curp             = EXCLUDED.curp,
          nombre_completo  = EXCLUDED.nombre_completo,
          regional_texto   = EXCLUDED.regional_texto,
          regional_id      = EXCLUDED.regional_id,
          municipio_texto  = EXCLUDED.municipio_texto,
          municipio_id     = EXCLUDED.municipio_id,
          colonia          = EXCLUDED.colonia,
          seccion          = EXCLUDED.seccion,
          localidad        = EXCLUDED.localidad,
          domicilio        = EXCLUDED.domicilio,
          telefono         = EXCLUDED.telefono,
          tipo_apoyo_texto = EXCLUDED.tipo_apoyo_texto,
          tipo_apoyo_id    = EXCLUDED.tipo_apoyo_id,
          cantidad_asignada = EXCLUDED.cantidad_asignada,
          lat_proyecto     = EXCLUDED.lat_proyecto,
          lng_proyecto     = EXCLUDED.lng_proyecto,
          datos_extra      = EXCLUDED.datos_extra,
          motivo_revision  = EXCLUDED.motivo_revision,
          actualizado_en   = now()
        -- Las filas ya revisadas (aprobado/descartado/fusionado) no se tocan.
        WHERE staging_beneficiarios.estado_revision = 'pendiente'
       RETURNING (xmax = 0) AS inserto`,
      [
        importacionId,
        archivoBase,
        filaOrigen,
        valores.folio || null,
        valores.curp || null,
        valores.nombre_completo || null,
        valores.regional || null,
        regionalId,
        valores.municipio || null,
        municipioId,
        valores.colonia || null,
        valores.seccion || null,
        valores.localidad || null,
        valores.domicilio || null,
        valores.telefono || null,
        valores.tipo_apoyo || null,
        tipoApoyoId,
        aNumero(valores.cantidad_asignada),
        aNumero(valores.lat_proyecto),
        aNumero(valores.lng_proyecto),
        JSON.stringify(extra),
        avisos.length ? avisos.join(' · ') : null
      ]
    );

    if (rows.length === 0) resultado.omitidas++;
    else if (rows[0].inserto) resultado.insertadas++;
    else resultado.actualizadas++;

    if (avisos.length) {
      resultado.errores.push({ fila: filaOrigen, motivo: avisos.join(' · ') });
    }
  }

  if (dryRun) return;

  await recalcularFlagsPadron(pool, archivoBase);
  await contarFlags(pool, 'staging_beneficiarios', FLAGS_PADRON, archivoBase, resultado);
}

/**
 * Recalcula los 6 flags de las filas pendientes del archivo importado,
 * comparandolas contra el resto del staging pendiente y contra produccion.
 * Es deterministico y no provoca ninguna accion automatica.
 */
async function recalcularFlagsPadron(pool: pg.Pool, archivo: string): Promise<void> {
  // Concepto comparable: el id resuelto si existe; si no, el texto normalizado.
  const conceptoStaging = (a: string) =>
    `coalesce(${a}.tipo_apoyo_id::text, 'T:' || upper(unaccent(coalesce(${a}.tipo_apoyo_texto, ''))))`;

  await pool.query(
    `UPDATE staging_beneficiarios s
        SET folio_duplicado                  = c.folio_dup,
            curp_duplicada_mismo_concepto    = c.curp_mismo,
            curp_duplicada_concepto_distinto = c.curp_distinto,
            sin_coordenadas                  = c.sin_coord,
            sin_colonia                      = c.sin_col,
            concepto_no_reconocido           = c.sin_concepto,
            nivel_alerta = CASE
              WHEN c.folio_dup OR c.curp_mismo THEN 'alta'
              WHEN c.curp_distinto OR c.sin_coord OR c.sin_col OR c.sin_concepto THEN 'media'
              ELSE 'ninguna' END,
            actualizado_en = now()
       FROM (
         SELECT f.id,
           (nullif(btrim(f.folio), '') IS NOT NULL AND (
              EXISTS (SELECT 1 FROM staging_beneficiarios o
                       WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
                         AND upper(unaccent(btrim(coalesce(o.folio, '')))) = upper(unaccent(btrim(f.folio))))
              OR EXISTS (SELECT 1 FROM beneficiarios b
                       WHERE upper(unaccent(btrim(b.folio))) = upper(unaccent(btrim(f.folio))))
           )) AS folio_dup,

           (nullif(btrim(f.curp), '') IS NOT NULL AND (
              EXISTS (SELECT 1 FROM staging_beneficiarios o
                       WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
                         AND upper(btrim(coalesce(o.curp, ''))) = upper(btrim(f.curp))
                         AND ${conceptoStaging('o')} = ${conceptoStaging('f')})
              OR EXISTS (SELECT 1 FROM beneficiarios b
                       WHERE upper(btrim(coalesce(b.curp, ''))) = upper(btrim(f.curp))
                         AND coalesce(b.tipo_apoyo_id::text, 'T:') = ${conceptoStaging('f')})
           )) AS curp_mismo,

           (nullif(btrim(f.curp), '') IS NOT NULL AND (
              EXISTS (SELECT 1 FROM staging_beneficiarios o
                       WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
                         AND upper(btrim(coalesce(o.curp, ''))) = upper(btrim(f.curp))
                         AND ${conceptoStaging('o')} <> ${conceptoStaging('f')})
              OR EXISTS (SELECT 1 FROM beneficiarios b
                       WHERE upper(btrim(coalesce(b.curp, ''))) = upper(btrim(f.curp))
                         AND coalesce(b.tipo_apoyo_id::text, 'T:') <> ${conceptoStaging('f')})
           )) AS curp_distinto,

           (f.lat_proyecto IS NULL OR f.lng_proyecto IS NULL
              OR f.lat_proyecto NOT BETWEEN -90 AND 90
              OR f.lng_proyecto NOT BETWEEN -180 AND 180
              OR (f.lat_proyecto = 0 AND f.lng_proyecto = 0)) AS sin_coord,

           (nullif(btrim(coalesce(f.colonia, '')), '') IS NULL) AS sin_col,
           (f.tipo_apoyo_id IS NULL) AS sin_concepto
         FROM staging_beneficiarios f
        WHERE f.archivo = $1 AND f.estado_revision = 'pendiente'
       ) c
      WHERE s.id = c.id`,
    [archivo]
  );
}

// ---------------------------------------------------------------------------
// Catalogo -> staging_catalogos
// ---------------------------------------------------------------------------

async function importarCatalogo(
  pool: pg.Pool,
  filas: Record<string, string>[],
  mapeo: Mapeo,
  resultado: Resultado,
  importacionId: number | null,
  dryRun: boolean,
  archivoBase: string
): Promise<void> {
  const mapaNormalizado = new Map<string, string>();
  for (const [destino, origen] of Object.entries(mapeo.columnas)) {
    mapaNormalizado.set(normalizar(origen), destino);
  }

  for (const [indice, fila] of filas.entries()) {
    const filaOrigen = indice + 1;
    const valores: Record<string, string> = {};
    const extra: Record<string, string> = {};
    for (const [encabezado, valor] of Object.entries(fila)) {
      const destino = mapaNormalizado.get(normalizar(encabezado));
      if (destino) valores[destino] = String(valor ?? '').trim();
      else if (String(valor ?? '').trim() !== '') extra[encabezado.trim()] = String(valor).trim();
    }

    if (!valores.grupo || !valores.clave || !valores.valor) {
      resultado.errores.push({ fila: filaOrigen, motivo: 'Faltan grupo, clave o valor' });
      continue;
    }
    if (dryRun) {
      resultado.insertadas++;
      continue;
    }

    const { rows } = await pool.query<{ inserto: boolean }>(
      `INSERT INTO staging_catalogos (
          importacion_id, archivo, fila_origen, grupo, clave, valor,
          padre_grupo, padre_clave, orden, datos_extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (archivo, fila_origen) DO UPDATE SET
          importacion_id = EXCLUDED.importacion_id,
          grupo          = EXCLUDED.grupo,
          clave          = EXCLUDED.clave,
          valor          = EXCLUDED.valor,
          padre_grupo    = EXCLUDED.padre_grupo,
          padre_clave    = EXCLUDED.padre_clave,
          orden          = EXCLUDED.orden,
          datos_extra    = EXCLUDED.datos_extra,
          actualizado_en = now()
        WHERE staging_catalogos.estado_revision = 'pendiente'
       RETURNING (xmax = 0) AS inserto`,
      [
        importacionId,
        archivoBase,
        filaOrigen,
        valores.grupo,
        valores.clave,
        valores.valor,
        valores.padre_grupo || null,
        valores.padre_clave || null,
        aNumero(valores.orden) ?? 0,
        JSON.stringify(extra)
      ]
    );

    if (rows.length === 0) resultado.omitidas++;
    else if (rows[0].inserto) resultado.insertadas++;
    else resultado.actualizadas++;
  }

  if (dryRun) return;

  await recalcularFlagsCatalogo(pool, archivoBase);
  await contarFlags(pool, 'staging_catalogos', FLAGS_CATALOGO, archivoBase, resultado);
}

async function recalcularFlagsCatalogo(pool: pg.Pool, archivo: string): Promise<void> {
  await pool.query(
    `UPDATE staging_catalogos s
        SET clave_duplicada        = c.clave_dup,
            valor_duplicado        = c.valor_dup,
            concepto_no_reconocido = c.no_reconocido,
            nivel_alerta = CASE
              WHEN c.clave_dup THEN 'alta'
              WHEN c.valor_dup OR c.no_reconocido THEN 'media'
              ELSE 'ninguna' END,
            actualizado_en = now()
       FROM (
         SELECT f.id,
           (EXISTS (SELECT 1 FROM staging_catalogos o
                     WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
                       AND o.grupo IS NOT DISTINCT FROM f.grupo
                       AND upper(unaccent(coalesce(o.clave, ''))) = upper(unaccent(coalesce(f.clave, ''))))
            OR EXISTS (SELECT 1 FROM catalogos g
                     WHERE g.grupo = f.grupo AND g.clave = f.clave)) AS clave_dup,

           EXISTS (SELECT 1 FROM staging_catalogos o
                    WHERE o.id <> f.id AND o.estado_revision = 'pendiente'
                      AND o.grupo IS NOT DISTINCT FROM f.grupo
                      AND upper(unaccent(coalesce(o.valor, ''))) = upper(unaccent(coalesce(f.valor, '')))
                      AND upper(unaccent(coalesce(o.clave, ''))) <> upper(unaccent(coalesce(f.clave, '')))) AS valor_dup,

           (f.grupo = 'concepto_apoyo' AND NOT EXISTS (
              SELECT 1 FROM tipos_apoyo t
               WHERE t.activo AND upper(unaccent(t.nombre)) = upper(unaccent(coalesce(f.valor, ''))))
           ) AS no_reconocido
         FROM staging_catalogos f
        WHERE f.archivo = $1 AND f.estado_revision = 'pendiente'
       ) c
      WHERE s.id = c.id`,
    [archivo]
  );
}

/** Lee de la base el conteo de cada flag y de cada nivel para el resumen. */
async function contarFlags(
  pool: pg.Pool,
  tabla: 'staging_beneficiarios' | 'staging_catalogos',
  flags: readonly string[],
  archivo: string,
  resultado: Resultado
): Promise<void> {
  const { rows } = await pool.query<Record<string, number>>(
    `SELECT ${flags.map((f) => `count(*) FILTER (WHERE ${f})::int AS "${f}"`).join(', ')},
            count(*) FILTER (WHERE nivel_alerta = 'alta')::int    AS alta,
            count(*) FILTER (WHERE nivel_alerta = 'media')::int   AS media,
            count(*) FILTER (WHERE nivel_alerta = 'ninguna')::int AS ninguna
       FROM ${tabla} WHERE archivo = $1`,
    [archivo]
  );
  const fila = rows[0] ?? {};
  for (const flag of flags) resultado.flags[flag] = Number(fila[flag] ?? 0);
  for (const nivel of ['alta', 'media', 'ninguna']) {
    resultado.niveles[nivel] = Number(fila[nivel] ?? 0);
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error('Fallo la importacion:', error);
    process.exit(1);
  });
