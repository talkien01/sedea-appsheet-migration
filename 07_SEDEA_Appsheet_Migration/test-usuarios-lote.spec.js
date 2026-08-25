// Alta de usuarios en LOTE via plantilla CSV, verificada como usuario real
// contra el stack de Docker (PWA 8081 -> backend 3011).
//
// Lo que se prueba de punta a punta:
//  1. La plantilla se descarga y es un CSV valido con las columnas del contrato.
//  2. Un CSV con filas validas e invalidas mezcladas crea SOLO las validas y
//     muestra el motivo exacto de cada error, sin abortar el resto del archivo.
//  3. La tabla de usuarios se refresca sola con los recien creados.
//  4. El CSV de contrasenas trae unicamente a los creados en ESA corrida.
//  5. Un usuario creado por lote entra con su temporal y el sistema le exige
//     cambiarla, igual que en el alta individual.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:3011/api';

// Sufijo unico por corrida: el spec crea usuarios reales y no hay DELETE.
const SUF = Date.now().toString(36).slice(-5);
const CAP = `t${SUF}.cap`;
const VENT = `t${SUF}.vent`;
const TMP = path.join(__dirname, 'scratchpad_lote');

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

test.beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

test('la plantilla se descarga como CSV con las columnas del contrato', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await expect(page.getByTestId('seccion-carga-lote')).toBeVisible();

  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-descargar-plantilla-usuarios').click()
  ]);
  expect(descarga.suggestedFilename()).toMatch(/\.csv$/);

  const destino = path.join(TMP, `plantilla_${SUF}.csv`);
  await descarga.saveAs(destino);
  const texto = fs.readFileSync(destino, 'utf8').replace(/^﻿/, '');
  const lineas = texto.trim().split(/\r?\n/);

  expect(lineas[0]).toBe(
    'usuario,nombre_completo,rol,regional_clave,alcance_municipios,alcance_componentes'
  );
  // La fila de ejemplo va comentada: subir la plantilla sin tocarla no debe
  // crear un usuario basura.
  expect(lineas[1].startsWith('#')).toBe(true);
});

test('un CSV mixto crea las filas validas y explica cada error', async ({ page }) => {
  const csv = [
    'usuario,nombre_completo,rol,regional_clave,alcance_municipios,alcance_componentes',
    `${CAP},Capturista de Prueba Lote,capturista,REG-02,,`,
    `${VENT},Ventanilla de Prueba Lote,ventanilla,REG-01,22004;22005,DIN`,
    'admin,Intento de Duplicado,capturista,REG-02,,',
    `t${SUF}.sinreg,Capturista sin Regional,capturista,,,`,
    `t${SUF}.regmala,Regional Inexistente,capturista,REG-99,,`
  ].join('\r\n');
  const archivo = path.join(TMP, `mixto_${SUF}.csv`);
  fs.writeFileSync(archivo, '﻿' + csv + '\r\n', 'utf8');

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  await page.getByTestId('input-archivo-lote').setInputFiles(archivo);
  await page.getByTestId('btn-subir-lote').click();

  const tabla = page.getByTestId('tabla-resultados-lote');
  await expect(tabla).toBeVisible({ timeout: 20000 });
  await expect(tabla.locator('[data-testid="fila-resultado-lote"]')).toHaveCount(5);

  const fila = (usuario) =>
    tabla.locator('[data-testid="fila-resultado-lote"]', { hasText: usuario }).first();

  // Las dos validas: chip "Creado".
  await expect(fila(CAP).getByTestId('chip-estado-lote')).toHaveText('Creado');
  await expect(fila(VENT).getByTestId('chip-estado-lote')).toHaveText('Creado');

  // Las tres invalidas: chip "Error" y el MISMO motivo que daria el alta
  // individual para ese mismo caso.
  await expect(fila('admin').getByTestId('chip-estado-lote')).toHaveText('Error');
  await expect(fila('admin')).toContainText('Ya existe un usuario con ese nombre de acceso.');
  await expect(fila(`t${SUF}.sinreg`)).toContainText(
    'Los capturistas deben tener una Dirección Regional asignada.'
  );
  await expect(fila(`t${SUF}.regmala`)).toContainText(
    'La Dirección Regional seleccionada no existe o está inactiva.'
  );

  // La tabla de usuarios se refresco sola: los nuevos ya estan listados.
  const usuarios = page.getByTestId('tabla-usuarios');
  await expect(usuarios).toContainText(CAP);
  await expect(usuarios).toContainText(VENT);
  // Y las invalidas NO se crearon.
  await expect(usuarios).not.toContainText(`t${SUF}.sinreg`);
  await expect(usuarios).not.toContainText(`t${SUF}.regmala`);

  // El CSV de contrasenas trae solo a los creados en esta corrida.
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-descargar-passwords-lote').click()
  ]);
  const destino = path.join(TMP, `passwords_${SUF}.csv`);
  await descarga.saveAs(destino);
  const lineas = fs
    .readFileSync(destino, 'utf8')
    .replace(/^﻿/, '')
    .trim()
    .split(/\r?\n/);

  expect(lineas[0]).toBe('usuario,password_temporal');
  expect(lineas).toHaveLength(3); // encabezado + los 2 creados
  const porUsuario = Object.fromEntries(lineas.slice(1).map((l) => l.split(',')));
  expect(Object.keys(porUsuario).sort()).toEqual([CAP, VENT].sort());
  for (const password of Object.values(porUsuario)) {
    expect(password).toHaveLength(14);
  }
  // Ninguna fila con error aparece en el archivo de contrasenas.
  expect(lineas.join('\n')).not.toContain('sinreg');

  // La contrasena de un creado por lote sirve para entrar, y el sistema exige
  // cambiarla: mismo flujo que el alta individual.
  const login = await page.request.post(`${API}/auth/login`, {
    data: { usuario: CAP, password: porUsuario[CAP] }
  });
  expect(login.ok()).toBeTruthy();
  const sesion = await login.json();
  expect(sesion.usuario.debe_cambiar_password).toBe(true);

  // Con la temporal, el backend bloquea cualquier otro endpoint.
  const bloqueado = await page.request.get(`${API}/catalogos`, {
    headers: { Authorization: `Bearer ${sesion.token}` }
  });
  expect(bloqueado.status()).toBe(403);
  expect((await bloqueado.json()).error.codigo).toBe('cambio_password_requerido');
});
