#!/usr/bin/env node
// Extrae UNICAMENTE la columna de nombre de concepto de la hoja de conceptos
// de apoyo del catalogo oficial (XLSX) y genera un seed SQL para tipos_apoyo.
//
// Este script NO lee ninguna hoja ni columna de beneficiarios: no toca CURP,
// RFC, telefono, CLABE ni ningun otro dato personal. El archivo XLSX de origen
// nunca se copia ni se commitea; solo se commitea el SQL generado, porque los
// nombres de conceptos de apoyo no son informacion personal.
//
// Uso:
//   npm run extraer-catalogo -- --archivo "<ruta.xlsx>" --hoja APOYO --salida db/seeds/004_tipos_apoyo_apoyo.sql
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Nombres admitidos para la columna del concepto (se comparan normalizados).
const COLUMNAS_CONCEPTO = ['CONCEPTOS DE APOYO', 'CONCEPTO DE APOYO', 'CONCEPTO'];

interface Opciones {
  archivo: string | null;
  hoja: string;
  salida: string;
  prefijo: string;
  ayuda: boolean;
}

function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function leerArgumentos(argv: string[]): Opciones {
  const o: Opciones = {
    archivo: null,
    hoja: 'APOYO',
    salida: 'db/seeds/004_tipos_apoyo_apoyo.sql',
    prefijo: 'AP',
    ayuda: false
  };
  for (let i = 0; i < argv.length; i++) {
    const actual = argv[i];
    const siguiente = argv[i + 1];
    switch (actual) {
      case '--archivo':
        o.archivo = siguiente ?? null;
        i++;
        break;
      case '--hoja':
        o.hoja = siguiente ?? 'APOYO';
        i++;
        break;
      case '--salida':
        o.salida = siguiente ?? o.salida;
        i++;
        break;
      case '--prefijo':
        o.prefijo = siguiente ?? 'AP';
        i++;
        break;
      case '--help':
      case '-h':
        o.ayuda = true;
        break;
    }
  }
  return o;
}

function mostrarAyuda(): void {
  console.log(`
Extractor del catalogo de conceptos de apoyo - SEDEA

Lee solo la columna "CONCEPTOS DE APOYO" de la hoja indicada y genera un seed
SQL idempotente para la tabla tipos_apoyo. No lee datos de beneficiarios.

Uso:
  npm run extraer-catalogo -- --archivo <ruta.xlsx> --hoja APOYO --salida db/seeds/004_tipos_apoyo_apoyo.sql

Opciones:
  --archivo <ruta.xlsx>   Catalogo oficial de origen. Obligatorio.
  --hoja <nombre>         Hoja a leer. Por defecto APOYO.
  --salida <ruta.sql>     Archivo SQL a generar. Por defecto db/seeds/004_tipos_apoyo_apoyo.sql
  --prefijo <texto>       Prefijo de la clave generada. Por defecto AP (AP-001, AP-002, ...).
  --help, -h              Muestra esta ayuda.
`);
}

function escaparSql(texto: string): string {
  return texto.replace(/'/g, "''");
}

function main(): number {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.ayuda || process.argv.slice(2).length === 0) {
    mostrarAyuda();
    return 0;
  }
  if (!opciones.archivo || !fs.existsSync(opciones.archivo)) {
    console.error(`Error: no se encontro el archivo indicado en --archivo (${opciones.archivo}).`);
    return 1;
  }

  const libro = XLSX.readFile(opciones.archivo);
  if (!libro.SheetNames.includes(opciones.hoja)) {
    console.error(
      `Error: la hoja "${opciones.hoja}" no existe. Hojas disponibles: ${libro.SheetNames.join(', ')}`
    );
    return 1;
  }

  const filas = XLSX.utils.sheet_to_json(libro.Sheets[opciones.hoja], {
    defval: '',
    raw: false
  }) as Record<string, string>[];

  if (filas.length === 0) {
    console.error(`Error: la hoja "${opciones.hoja}" no tiene filas de datos.`);
    return 1;
  }

  // Localiza la columna del concepto por nombre normalizado.
  const encabezados = Object.keys(filas[0]);
  const columna = encabezados.find((e) => COLUMNAS_CONCEPTO.includes(normalizar(e)));
  if (!columna) {
    console.error(
      `Error: no se encontro una columna de concepto (${COLUMNAS_CONCEPTO.join(' / ')}) en la hoja "${opciones.hoja}".`
    );
    return 1;
  }

  // Se preserva el orden de aparicion y se descartan vacios y repetidos exactos.
  const vistos = new Set<string>();
  const conceptos: string[] = [];
  for (const fila of filas) {
    const valor = String(fila[columna] ?? '').trim().replace(/\s+/g, ' ');
    if (!valor) continue;
    const llave = normalizar(valor);
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    conceptos.push(valor);
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const lineas: string[] = [];
  lineas.push(`-- ${path.basename(opciones.salida)}`);
  lineas.push('-- Catalogo real de conceptos de apoyo (tipos_apoyo).');
  lineas.push(`-- Origen: hoja "${opciones.hoja}" del catalogo oficial en XLSX.`);
  lineas.push(`-- Generado por scripts/extraer-catalogo-apoyo.ts el ${fecha}.`);
  lineas.push('--');
  lineas.push('-- Se extrae UNICAMENTE el nombre del concepto de apoyo: el archivo XLSX de');
  lineas.push('-- origen contiene datos personales en otras hojas y por eso no se commitea');
  lineas.push('-- (esta cubierto por .gitignore). Los nombres de conceptos no son PII.');
  lineas.push('--');
  lineas.push('-- La hoja "Copia de APOYO" del mismo archivo SE DESCARTA por decision D1 del');
  lineas.push('-- SPEC: es una version divergente del catalogo (173 conceptos, solo 9 en');
  lineas.push('-- comun) que no corresponde al catalogo vigente.');
  lineas.push('');
  lineas.push('INSERT INTO tipos_apoyo (clave, nombre, categoria, activo) VALUES');

  const valores = conceptos.map((nombre, indice) => {
    const clave = `${opciones.prefijo}-${String(indice + 1).padStart(3, '0')}`;
    return `  ('${clave}', '${escaparSql(nombre)}', 'otro', TRUE)`;
  });
  lineas.push(valores.join(',\n'));
  lineas.push('ON CONFLICT (clave) DO UPDATE SET');
  lineas.push('  nombre    = EXCLUDED.nombre,');
  lineas.push('  categoria = EXCLUDED.categoria,');
  lineas.push('  activo    = EXCLUDED.activo;');
  lineas.push('');

  const rutaSalida = path.resolve(opciones.salida);
  fs.mkdirSync(path.dirname(rutaSalida), { recursive: true });
  fs.writeFileSync(rutaSalida, lineas.join('\n'), 'utf8');

  console.log(`Hoja leida:      ${opciones.hoja}`);
  console.log(`Columna usada:   ${columna}`);
  console.log(`Conceptos:       ${conceptos.length}`);
  console.log(`Seed generado:   ${opciones.salida}`);
  return 0;
}

process.exit(main());
