// Regresion: el selector de Concepto en /catalogos/documentos debe listar
// los conceptos reales del catalogo tipos_apoyo (incluidos los recien creados),
// no una lista hardcodeada.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8081';
const API = 'http://localhost:3011/api';

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

async function token(request) {
  const r = await request.post(`${API}/auth/login`, {
    data: { usuario: 'admin', password: 'cambiame123' }
  });
  return (await r.json()).token;
}

test('el selector de concepto lista un concepto recien creado y guarda la regla', async ({ page }) => {
  const sufijo = Date.now().toString().slice(-6);
  const clave = `ZZTEST-${sufijo}`;
  const nombre = `ZZ CONCEPTO PRUEBA ${sufijo}`;

  await login(page);

  // 1) Alta del concepto desde la UI real: /catalogos > pestana Conceptos de apoyo
  await page.goto(`${BASE}/catalogos`);
  await page.click('[data-testid="tab-tipos_apoyo"]');
  await page.click('[data-testid="btn-nuevo-tipos_apoyo"]');
  const modal = page.locator('[data-testid="modal-form-catalogo"]');
  await expect(modal).toBeVisible();
  await modal.locator('input[name="clave"]').fill(clave);
  await modal.locator('input[name="nombre"], textarea[name="nombre"]').first().fill(nombre);
  await modal.locator('button[type="submit"]').click();
  await expect(modal).toBeHidden({ timeout: 10000 });

  // 2) El concepto debe estar disponible en el selector de reglas
  await page.goto(`${BASE}/catalogos/documentos`);
  await page.click('[data-testid="btn-nueva-regla"]');
  await expect(page.locator('[data-testid="form-regla-documento"]')).toBeVisible();

  const select = page.locator('[data-testid="select-apoyo"]');
  // Espera a que carguen las referencias
  await expect(select.locator('option')).not.toHaveCount(1, { timeout: 10000 });

  const opciones = await select.locator('option').allTextContents();
  // El concepto nuevo debe estar
  expect(opciones.join('|')).toContain(nombre);
  // Los conceptos "antiguos" siguen apareciendo (no rompimos nada)
  expect(opciones.join('|')).toContain('TR: ELABORACIÓN DE PROYECTO EJECUTIVO');
  // Lista completa, no una pagina de 50
  expect(opciones.length).toBeGreaterThan(150);

  // Guardar una regla referenciando el concepto nuevo
  const requisito = `ZZ Requisito prueba ${sufijo}`;
  await page.fill('[data-testid="input-requisito"]', requisito);
  await select.selectOption({ label: `${clave} — ${nombre}` });
  await page.click('[data-testid="btn-guardar-regla"]');

  const fila = page.locator('[data-testid="fila-regla-documento"]', { hasText: requisito });
  await expect(fila).toBeVisible({ timeout: 10000 });
  // La columna Concepto muestra la clave del concepto nuevo
  await expect(fila).toContainText(clave);
});

test('el selector de excepcion tambien lista el catalogo real', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/catalogos/documentos`);
  await page.click('[data-testid="btn-nueva-regla"]');
  const select = page.locator('[data-testid="select-apoyo-excluir"]');
  await expect(select.locator('option')).not.toHaveCount(1, { timeout: 10000 });
  expect(await select.locator('option').count()).toBeGreaterThan(150);
});

test('editar una regla preselecciona su concepto y lo conserva al guardar', async ({ page, request }) => {
  const tk = await token(request);
  const sufijo = Date.now().toString().slice(-6);
  const requisito = `ZZ Regla edicion ${sufijo}`;

  const refs = await (await request.get(`${API}/admin/catalogos/referencias`, {
    headers: { Authorization: `Bearer ${tk}` }
  })).json();
  const apoyo = refs.tipos_apoyo.find((t) => t.activo);

  const alta = await request.post(`${API}/admin/catalogos/documentos_requeridos`, {
    headers: { Authorization: `Bearer ${tk}` },
    data: { requisito, apoyo_id: apoyo.id, orden: 0 }
  });
  expect(alta.ok()).toBeTruthy();
  const reglaId = (await alta.json()).registro.id;

  await login(page);
  await page.goto(`${BASE}/catalogos/documentos`);
  const fila = page.locator('[data-testid="fila-regla-documento"]', { hasText: requisito });
  await expect(fila).toBeVisible({ timeout: 10000 });
  await fila.locator('[data-testid="btn-editar-regla"]').click();

  // El concepto guardado llega preseleccionado (no se pierde al cargar la lista)
  await expect(page.locator('[data-testid="select-apoyo"]')).toHaveValue(String(apoyo.id));

  // Guardar sin tocar el concepto lo conserva
  await page.click('[data-testid="btn-guardar-regla"]');
  await expect(page.locator('[data-testid="form-regla-documento"]')).toBeHidden({ timeout: 10000 });

  const lista = await (await request.get(`${API}/admin/catalogos/documentos_requeridos?por_pagina=200`, {
    headers: { Authorization: `Bearer ${tk}` }
  })).json();
  const registro = lista.datos.find((r) => r.id === reglaId);
  expect(registro).toBeTruthy();
  expect(registro.apoyo_id).toBe(apoyo.id);
});

test('el selector de proyecto no ofrece proyectos inexistentes', async ({ page, request }) => {
  const tk = await token(request);
  const refs = await (await request.get(`${API}/admin/catalogos/referencias`, {
    headers: { Authorization: `Bearer ${tk}` }
  })).json();
  const clavesReales = refs.proyectos.map((p) => p.clave).sort();

  await login(page);
  await page.goto(`${BASE}/catalogos/documentos`);
  await page.click('[data-testid="btn-nueva-regla"]');
  const select = page.locator('[data-testid="select-proyecto-regla"]');
  const valores = (await select.locator('option').allTextContents()).filter((t) => t !== 'Cualquier proyecto');
  expect(valores.sort()).toEqual(clavesReales);
});
