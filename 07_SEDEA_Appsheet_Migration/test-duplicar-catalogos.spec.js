// Verificacion del boton "Duplicar" en /catalogos (proyectos y tipos_apoyo).
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173';
const SUFIJO = String(Date.now()).slice(-6);

function letrasAleatorias(n) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/** Consulta la API con un token propio (el token de la app vive en IndexedDB). */
async function apiListar(page, entidad) {
  return page.evaluate(async (ent) => {
    const rl = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'admin', password: 'cambiame123' })
    });
    const sesion = await rl.json();
    const r = await fetch(`/api/admin/catalogos/${ent}?incluir_inactivos=true&por_pagina=200`, {
      headers: { Authorization: `Bearer ${sesion.token}` }
    });
    const j = await r.json();
    return j.datos;
  }, entidad);
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/catalogos`);
  await expect(page.locator('[data-testid="pantalla-catalogos"]')).toBeVisible();
  await expect(page.locator('[data-testid="arbol-catalogos"]')).toBeVisible();
}

/** Build 12: cada entidad vive en su pestana; hay que abrirla antes de buscar filas. */
async function abrirPestana(page, tab) {
  await page.click(`[data-testid="${tab}"]`);
  await expect(page.locator(`[data-testid="panel-${tab.replace('tab-', '')}"]`)).toBeVisible();
}

test('Duplicar proyecto: alta precargada, clave/prefijo vacios, original intacto', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // --- Proyecto origen: el primero de la pestana Componentes ---
  await abrirPestana(page, 'tab-componentes');
  const botonDuplicar = page.locator('[data-testid^="btn-duplicar-proyectos-"]').first();
  await expect(botonDuplicar).toBeVisible();
  const testId = await botonDuplicar.getAttribute('data-testid');
  const idOrigen = testId.replace('btn-duplicar-proyectos-', '');
  const filaOrigen = page.locator(`[data-testid="nodo-proyectos-${idOrigen}"]`);
  const textoOrigen = (await filaOrigen.locator('.celda-clave').innerText()).trim();
  console.log('PROYECTO ORIGEN:', idOrigen, textoOrigen);

  // Datos del original leidos de la API (para comparar FKs al final)
  const original = (await apiListar(page, 'proyectos')).find(
    (p) => String(p.id) === String(idOrigen)
  );
  console.log('ORIGINAL:', JSON.stringify(original));

  // --- Pulsar Duplicar ---
  await botonDuplicar.click();
  const form = page.locator('[data-testid="form-catalogo"]');
  await expect(form).toBeVisible();

  // Modo ALTA (no edicion): titulo "Nuevo ..." y aviso de duplicado
  await expect(form.locator('h2')).toContainText('Nuevo');
  await expect(page.locator('[data-testid="aviso-duplicado"]')).toBeVisible();
  // No debe haber leyendas de campo inmutable (esas son de edicion)
  await expect(page.locator('[data-testid="leyenda-clave-inmutable"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="leyenda-prefijo-inmutable"]')).toHaveCount(0);

  // Campos unicos vacios y editables
  const inputClave = page.locator('[data-testid="input-clave"]');
  const inputPrefijo = page.locator('[data-testid="input-prefijo-folio"]');
  await expect(inputClave).toHaveValue('');
  await expect(inputPrefijo).toHaveValue('');
  await expect(inputClave).toBeEditable();
  await expect(inputPrefijo).toBeEditable();

  // Resto de campos precargados con los del original
  await expect(page.locator('[data-testid="input-nombre"]')).toHaveValue(original.nombre);
  await expect(page.locator('[data-testid="select-padre-componente"]')).toHaveValue(
    original.componente_id == null ? '' : String(original.componente_id)
  );
  await expect(page.locator('[data-testid="select-padre-modalidad"]')).toHaveValue(
    original.modalidad_id == null ? '' : String(original.modalidad_id)
  );

  // --- Completar clave/prefijo/nombre y guardar ---
  const claveNueva = `ZDUP${SUFIJO}`;
  const prefijoNuevo = letrasAleatorias(5);
  const nombreNuevo = `Duplicado de prueba ${SUFIJO}`;
  await inputClave.fill(claveNueva);
  await inputPrefijo.fill(prefijoNuevo);
  await page.locator('[data-testid="input-nombre"]').fill(nombreNuevo);
  await page.locator('[data-testid="btn-guardar-catalogo"]').click();

  await expect(page.locator('[data-testid="toast-exito"]')).toBeVisible({ timeout: 15000 });

  // --- Dos proyectos independientes ---
  const despues = await apiListar(page, 'proyectos');
  const orig2 = despues.find((p) => String(p.id) === String(idOrigen));
  const nuevo = despues.find((p) => p.clave === claveNueva);

  console.log('ORIGINAL DESPUES:', JSON.stringify(orig2));
  console.log('NUEVO:', JSON.stringify(nuevo));

  // Original intacto
  expect(orig2.clave).toBe(original.clave);
  expect(orig2.nombre).toBe(original.nombre);
  expect(orig2.prefijo_folio).toBe(original.prefijo_folio);

  // Nuevo, independiente, con las mismas FKs
  expect(nuevo).toBeTruthy();
  expect(nuevo.id).not.toBe(orig2.id);
  expect(nuevo.nombre).toBe(nombreNuevo);
  expect(nuevo.prefijo_folio).toBe(prefijoNuevo);
  expect(nuevo.componente_id).toBe(original.componente_id);
  expect(nuevo.modalidad_id).toBe(original.modalidad_id);
  expect(nuevo.activo).toBe(true);

  // Ambos visibles en la tabla de la pestana Componentes
  await expect(page.locator(`[data-testid="nodo-proyectos-${idOrigen}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="nodo-proyectos-${nuevo.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="nodo-proyectos-${nuevo.id}"]`)).toContainText(claveNueva);
  console.log('TEXTO ORIGEN TRAS DUPLICAR:', textoOrigen);
});

test('Duplicar proyecto con clave repetida: rechazo por validacion normal de alta', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  await abrirPestana(page, 'tab-componentes');
  const botonDuplicar = page.locator('[data-testid^="btn-duplicar-proyectos-"]').first();
  const testId = await botonDuplicar.getAttribute('data-testid');
  const idOrigen = testId.replace('btn-duplicar-proyectos-', '');
  const claveOrigen = (
    await page.locator(`[data-testid="nodo-proyectos-${idOrigen}"] .celda-clave`).innerText()
  ).trim();

  await botonDuplicar.click();
  await page.locator('[data-testid="input-clave"]').fill(claveOrigen);
  await page.locator('[data-testid="input-prefijo-folio"]').fill(letrasAleatorias(5));
  await page.locator('[data-testid="btn-guardar-catalogo"]').click();

  const error = page.locator('[data-testid="error-catalogo"]');
  await expect(error).toBeVisible({ timeout: 15000 });
  console.log('ERROR CLAVE DUPLICADA:', await error.innerText());
});

test('Duplicar concepto de apoyo (tipos_apoyo)', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  await abrirPestana(page, 'tab-tipos_apoyo');
  const botonDuplicar = page.locator('[data-testid^="btn-duplicar-tipos_apoyo-"]').first();
  await expect(botonDuplicar).toBeVisible({ timeout: 15000 });
  const testId = await botonDuplicar.getAttribute('data-testid');
  const idOrigen = testId.replace('btn-duplicar-tipos_apoyo-', '');

  const original = (await apiListar(page, 'tipos_apoyo')).find(
    (t) => String(t.id) === String(idOrigen)
  );
  console.log('CONCEPTO ORIGEN:', JSON.stringify(original));

  await botonDuplicar.click();
  const form = page.locator('[data-testid="form-catalogo"]');
  await expect(form).toBeVisible();
  await expect(form.locator('h2')).toContainText('Nuevo');
  await expect(page.locator('[data-testid="aviso-duplicado"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-clave"]')).toHaveValue('');
  await expect(page.locator('[data-testid="input-nombre"]')).toHaveValue(original.nombre);
  await expect(page.locator('[data-testid="input-categoria"]')).toHaveValue(original.categoria ?? '');
  await expect(page.locator('[data-testid="input-unidad-medida"]')).toHaveValue(
    original.unidad_medida ?? ''
  );

  const claveNueva = `ZDUPAP${SUFIJO}`;
  const nombreNuevo = `Concepto duplicado ${SUFIJO}`;
  await page.locator('[data-testid="input-clave"]').fill(claveNueva);
  await page.locator('[data-testid="input-nombre"]').fill(nombreNuevo);
  await page.locator('[data-testid="btn-guardar-catalogo"]').click();
  await expect(page.locator('[data-testid="toast-exito"]')).toBeVisible({ timeout: 15000 });

  const despues = await apiListar(page, 'tipos_apoyo');
  const orig2 = despues.find((t) => String(t.id) === String(idOrigen));
  const nuevo = despues.find((t) => t.clave === claveNueva);
  console.log('CONCEPTO ORIGINAL DESPUES:', JSON.stringify(orig2));
  console.log('CONCEPTO NUEVO:', JSON.stringify(nuevo));

  expect(orig2.nombre).toBe(original.nombre);
  expect(nuevo).toBeTruthy();
  expect(nuevo.id).not.toBe(orig2.id);
  expect(nuevo.nombre).toBe(nombreNuevo);
  expect(nuevo.categoria).toBe(original.categoria);
  expect(nuevo.unidad_medida).toBe(original.unidad_medida);
});
