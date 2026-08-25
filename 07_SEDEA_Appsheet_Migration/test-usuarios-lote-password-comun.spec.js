// Contrasena temporal COMUN para un lote CSV de usuarios, verificada como
// usuario real contra el stack de Docker (PWA 8081 -> backend 3011).
//
// Lo que se prueba de punta a punta:
//  1. Una contrasena comun debil se rechaza de entrada y NO crea ninguna fila.
//  2. Con contrasena comun valida, TODAS las filas reciben la misma temporal,
//     el CSV de descarga la repite y el usuario entra con ella y debe cambiarla.
//  3. Sin marcar el checkbox, el lote sigue generando aleatorias distintas.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:3011/api';

const COMUN = 'Sedea2026Test!';
const SUF = Date.now().toString(36).slice(-5);
const TMP = path.join(__dirname, 'scratchpad_lote');

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

function escribirCsv(nombre, usuarios) {
  const csv = [
    'usuario,nombre_completo,rol,regional_clave,alcance_municipios,alcance_componentes',
    ...usuarios.map(([u, rol]) => `${u},Prueba Comun ${u},${rol},REG-02,,`)
  ].join('\r\n');
  const archivo = path.join(TMP, nombre);
  fs.writeFileSync(archivo, csv, 'utf8');
  return archivo;
}

/**
 * Descarga el CSV de contrasenas de la corrida y devuelve el mapa
 * usuario -> password_temporal. La tabla en pantalla NO muestra la contrasena a
 * proposito (solo fila / usuario / estado / motivo): el CSV de descarga es el
 * unico lugar donde se puede leer, y por eso es lo que se verifica aqui.
 */
async function passwordsDescargadas(page, nombre) {
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-descargar-passwords-lote').click()
  ]);
  const destino = path.join(TMP, nombre);
  await descarga.saveAs(destino);
  const texto = fs.readFileSync(destino, 'utf8').replace(/^﻿/, '');
  const lineas = texto.trim().split(/\r?\n/);
  const encabezado = lineas[0].split(',').map((c) => c.trim().toLowerCase());
  const iUsuario = encabezado.indexOf('usuario');
  const iPassword = encabezado.findIndex((c) => c.includes('password') || c.includes('contrase'));
  const mapa = {};
  for (const linea of lineas.slice(1)) {
    const celdas = linea.split(',');
    mapa[celdas[iUsuario]?.trim()] = celdas[iPassword]?.trim();
  }
  return mapa;
}

/**
 * Abre una pestana con sesion limpia. Se usa para el login del recien creado:
 * reusar la del admin solo redirigiria a la portada.
 */
async function paginaLimpia(browser) {
  const contexto = await browser.newContext();
  return { contexto, pagina: await contexto.newPage() };
}

test.beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

test('una contrasena comun debil rechaza el lote entero sin crear nada', async ({ page }) => {
  const usuarios = [[`pc${SUF}.x1`, 'ventanilla'], [`pc${SUF}.x2`, 'capturista']];
  const archivo = escribirCsv(`debil_${SUF}.csv`, usuarios);

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  await page.getByTestId('check-password-comun-lote').check();
  await page.getByTestId('input-password-comun-lote').fill('123');
  await page.getByTestId('input-archivo-lote').setInputFiles(archivo);
  await page.getByTestId('btn-subir-lote').click();

  // Error del lote COMPLETO: no hay tabla de resultados porque no se proceso
  // ninguna fila.
  await expect(page.getByTestId('error-lote')).toBeVisible();
  await expect(page.getByTestId('error-lote')).toContainText(/10 caracteres/i);
  await expect(page.getByTestId('tabla-resultados-lote')).toHaveCount(0);

  // Y ninguno de los dos usuarios existe: el login contra la API es 401.
  for (const [u] of usuarios) {
    const r = await page.request.post(`${API}/auth/login`, {
      data: { usuario: u, password: '123' }
    });
    expect(r.status()).toBe(401);
  }
});

test('con contrasena comun todas las filas reciben la misma temporal', async ({ page, browser }) => {
  const usuarios = [
    [`pc${SUF}.a`, 'ventanilla'],
    [`pc${SUF}.b`, 'capturista'],
    [`pc${SUF}.c`, 'ventanilla']
  ];
  const archivo = escribirCsv(`comun_${SUF}.csv`, usuarios);

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  await page.getByTestId('check-password-comun-lote').check();
  await page.getByTestId('input-password-comun-lote').fill(COMUN);
  await page.getByTestId('input-archivo-lote').setInputFiles(archivo);
  await page.getByTestId('btn-subir-lote').click();

  await expect(page.getByTestId('resumen-lote')).toContainText('3 creados');
  await expect(page.getByTestId('fila-resultado-lote')).toHaveCount(3);

  // La descarga sigue funcionando y repite LA MISMA contrasena en cada fila.
  const mapa = await passwordsDescargadas(page, `passwords_comun_${SUF}.csv`);
  expect(Object.keys(mapa).sort()).toEqual(usuarios.map(([u]) => u).sort());
  for (const [u] of usuarios) expect(mapa[u]).toBe(COMUN);

  // Login real con la comun, en sesion limpia: entra y el sistema le exige
  // cambiarla (debe_cambiar_password sigue en true, como en el alta individual).
  for (const [u] of [usuarios[0], usuarios[2]]) {
    const { contexto, pagina } = await paginaLimpia(browser);
    await entrar(pagina, u, COMUN);
    await expect(pagina).toHaveURL(/cambiar-password/);
    await contexto.close();
  }
});

test('sin marcar el checkbox el lote sigue generando aleatorias distintas', async ({ page }) => {
  const usuarios = [[`pc${SUF}.r1`, 'ventanilla'], [`pc${SUF}.r2`, 'capturista']];
  const archivo = escribirCsv(`regresion_${SUF}.csv`, usuarios);

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  // El campo de contrasena comun ni siquiera se muestra hasta marcar la casilla.
  await expect(page.getByTestId('input-password-comun-lote')).toHaveCount(0);

  await page.getByTestId('input-archivo-lote').setInputFiles(archivo);
  await page.getByTestId('btn-subir-lote').click();

  await expect(page.getByTestId('resumen-lote')).toContainText('2 creados');

  const mapa = await passwordsDescargadas(page, `passwords_regresion_${SUF}.csv`);
  const temporales = usuarios.map(([u]) => mapa[u]);
  // Cada fila trae la suya: aleatoria de 14 caracteres y distinta de la otra.
  for (const p of temporales) {
    expect(p).not.toBe(COMUN);
    expect(p).toHaveLength(14);
  }
  expect(temporales[0]).not.toBe(temporales[1]);
});
