// Verificacion de las pantallas del modulo de dictamen (SPEC 19.7, criterios
// 584-597 y 600a). Requiere el stack arriba y el fixture ya cargado:
//   API_URL=http://localhost:3011 npx tsx scripts/fixture-dictamen.ts
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:3011';
const PASSWORD = process.env.SEED_PASSWORD || 'cambiame123';

test.use({ viewport: { width: 1440, height: 900 } });

async function login(page, usuario) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
}

/** Ids de las tres solicitudes del fixture, leidos de la API por su marca. */
async function idsFixture(request) {
  const login = await request.post(`${API}/api/auth/login`, {
    data: { usuario: 'dict.test', password: PASSWORD }
  });
  const { token } = await login.json();
  const respuesta = await request.get(`${API}/api/dictamen/bandeja?estado=todas&por_pagina=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { filas } = await respuesta.json();
  const buscar = (marca) => filas.find((f) => f.solicitante.includes(marca));
  return {
    token,
    S_POS: buscar('POSITIVO'),
    S_NEG: buscar('NEGATIVO'),
    S_SIN: buscar('SIN ARCHIVOS')
  };
}

test('584-591: bandeja /dictamen', async ({ page, request }) => {
  test.setTimeout(180000);
  const f = await idsFixture(request);
  expect(f.S_POS && f.S_NEG && f.S_SIN).toBeTruthy();

  await login(page, 'dict.test');

  // 584: el destino de navegacion existe y lleva a la pantalla.
  await expect(page.locator('[data-testid="nav-dictamen"]').first()).toBeVisible();
  await page.locator('[data-testid="nav-dictamen"]').first().click();
  await expect(page).toHaveURL(/\/dictamen$/);
  await expect(page.locator('[data-testid="pantalla-dictamen"]')).toBeVisible();

  // 586: al menos 3 filas.
  await expect(page.locator('[data-testid="tabla-dictamen"]')).toBeVisible();
  const filas = page.locator('[data-testid^="fila-dictamen-"]');
  expect(await filas.count()).toBeGreaterThanOrEqual(3);

  // 587: el boton de lote arranca deshabilitado y se habilita con una seleccion.
  const boton = page.locator('[data-testid="btn-predictaminar"]');
  await expect(boton).toBeDisabled();
  await page.locator(`[data-testid="chk-dictamen-${f.S_NEG.solicitud_id}"]`).check();
  await expect(boton).toBeEnabled();
  await expect(boton).toHaveText(/\(1\)/);

  // 588: "seleccionar todo" marca todas y el contador cuadra.
  await page.locator('[data-testid="chk-dictamen-todos"]').check();
  const casillas = page.locator('[data-testid^="chk-dictamen-"]:not([data-testid="chk-dictamen-todos"])');
  const n = await casillas.count();
  for (let i = 0; i < n; i++) await expect(casillas.nth(i)).toBeChecked();
  await expect(boton).toHaveText(new RegExp(`\\(${n}\\)`));

  // 589: pre-dictaminar S_NEG deja mensaje de exito y chip Negativo.
  await page.locator('[data-testid="chk-dictamen-todos"]').uncheck();
  await page.locator(`[data-testid="chk-dictamen-${f.S_NEG.solicitud_id}"]`).check();
  await boton.click();
  await expect(page.locator('[data-testid="mensaje-predictamen"]')).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator(`[data-testid="chip-predictamen-${f.S_NEG.solicitud_id}"]`)
  ).toHaveText('Negativo');

  // 590: S_POS pre-dictaminada muestra Positivo.
  await page.locator(`[data-testid="chk-dictamen-${f.S_POS.solicitud_id}"]`).check();
  await boton.click();
  await expect(page.locator('[data-testid="mensaje-predictamen"]')).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator(`[data-testid="chip-predictamen-${f.S_POS.solicitud_id}"]`)
  ).toHaveText('Positivo');

  // 591: contador de documentos por fila.
  await expect(page.locator(`[data-testid="docs-dictamen-${f.S_SIN.solicitud_id}"]`)).toHaveText(/^0\//);
  const textoPos = await page
    .locator(`[data-testid="docs-dictamen-${f.S_POS.solicitud_id}"]`)
    .innerText();
  const [con, total] = textoPos.trim().split('/').map(Number);
  expect(con).toBe(total);
  expect(con).toBeGreaterThan(0);

  // 600a: sin confirmar, el dictamen humano sigue Pendiente.
  await expect(
    page.locator(`[data-testid="chip-dictamen-${f.S_POS.solicitud_id}"]`)
  ).toHaveText('Pendiente');
});

test('585: un capturista no entra a /dictamen', async ({ page }) => {
  test.setTimeout(90000);
  await login(page, 'capturista1');
  await page.goto(`${BASE}/dictamen`);
  await expect(page).toHaveURL(/\/sin-permiso$/);
});

test('592-597: detalle del dictamen', async ({ page, request }) => {
  test.setTimeout(180000);
  const f = await idsFixture(request);
  await login(page, 'dict.test');
  await page.goto(`${BASE}/dictamen`);
  await expect(page.locator('[data-testid="tabla-dictamen"]')).toBeVisible();

  // 592: el boton de la fila abre el detalle.
  await page.locator(`[data-testid="btn-ver-dictamen-${f.S_NEG.solicitud_id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/dictamen/${f.S_NEG.solicitud_id}$`));
  await expect(page.locator('[data-testid="pantalla-dictamen-detalle"]')).toBeVisible();

  // 593: no hay visor de expediente ni iframes; si hay enlaces a /media.
  expect(await page.locator('[data-testid="visor-expediente"]').count()).toBe(0);
  expect(await page.locator('iframe').count()).toBe(0);
  const enlaces = page.locator('[data-testid^="enlace-archivo-"]');
  expect(await enlaces.count()).toBeGreaterThan(0);
  expect(await enlaces.first().getAttribute('href')).toContain('/media/solicitudes/');

  // 594: un bloque por documento del checklist.
  const detalleApi = await (
    await request.get(`${API}/api/dictamen/${f.S_NEG.solicitud_id}`, {
      headers: { Authorization: `Bearer ${f.token}` }
    })
  ).json();
  expect(await page.locator('[data-testid^="doc-dictamen-"]').count()).toBe(
    detalleApi.documentos.length
  );

  // 595: el documento con `NEG` sale Ilegible y precarga el radio "ilegible".
  const malo = detalleApi.documentos.find((d) => d.ia && d.ia.legible === false);
  expect(malo).toBeTruthy();
  const clave = malo.documento_requerido_id;
  await expect(page.locator(`[data-testid="ia-legible-${clave}"]`)).toHaveText('Ilegible');
  await expect(page.locator(`[data-testid="veredicto-ilegible-${clave}"]`)).toBeChecked();

  // 597: confirmar sin resultado esta bloqueado; negativo con nota vacia falla
  // en el cliente y NO llama al backend.
  const confirmar = page.locator('[data-testid="btn-confirmar-dictamen"]');
  await expect(confirmar).toBeDisabled();
  await page.locator('[data-testid="select-resultado-dictamen"]').selectOption('negativo');
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  const errorDictamen = page.locator('[data-testid="error-dictamen"]');
  await expect(errorDictamen).toBeVisible();
  await expect(errorDictamen).toHaveAttribute('role', 'alert');

  // 596: en S_SIN cada documento avisa que no hay archivo.
  await page.goto(`${BASE}/dictamen/${f.S_SIN.solicitud_id}`);
  await expect(page.locator('[data-testid="pantalla-dictamen-detalle"]')).toBeVisible();
  const sinArchivo = page.locator('[data-testid^="sin-archivo-"]');
  expect(await sinArchivo.count()).toBeGreaterThan(0);
  await expect(sinArchivo.first()).toHaveText('Sin archivo adjunto.');
  expect(await page.locator('[data-testid^="enlace-archivo-"]').count()).toBe(0);
});
