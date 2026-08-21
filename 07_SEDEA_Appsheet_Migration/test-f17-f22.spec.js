// Verificacion de los fixes F-17 (por_pagina en la respuesta de E50) y F-22
// (404 antes que 422 en el PATCH de catalogos).
// Aqui se cubre el lado UI de F-17: que la paginacion real de "Conceptos de
// apoyo" (160+ registros) siga funcionando despues del rename del campo.
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = 'scratchpad/f17-f22';

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/catalogos`);
  await expect(page.locator('[data-testid="pantalla-catalogos"]')).toBeVisible();
}

test('F-17: la paginacion de conceptos de apoyo cambia de pagina', async ({ page }) => {
  const respuestas = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/admin/catalogos/tipos_apoyo') && r.request().method() === 'GET') {
      try {
        respuestas.push(await r.json());
      } catch {
        /* ignorar */
      }
    }
  });

  await login(page);
  await page.click('[data-testid="tab-tipos_apoyo"]');
  await expect(page.locator('[data-testid="paginacion-tipos_apoyo"]')).toBeVisible();

  const primeraFila = page.locator('[data-testid^="nodo-tipos_apoyo-"]').first();
  await expect(primeraFila).toBeVisible();
  const claveP1 = (await primeraFila.textContent()) || '';
  await page.screenshot({ path: `${SHOTS}/pagina-1.png` });

  await page.click('[data-testid="btn-conceptos-siguiente"]');
  await expect(page.locator('[data-testid^="nodo-tipos_apoyo-"]').first()).not.toHaveText(claveP1);
  const claveP2 = (await page.locator('[data-testid^="nodo-tipos_apoyo-"]').first().textContent()) || '';
  await page.screenshot({ path: `${SHOTS}/pagina-2.png` });

  await page.click('[data-testid="btn-conceptos-anterior"]');
  await expect(page.locator('[data-testid^="nodo-tipos_apoyo-"]').first()).toHaveText(claveP1);

  expect(claveP1).not.toBe(claveP2);

  // El contrato de la respuesta trae por_pagina (snake_case) y no porPagina.
  expect(respuestas.length).toBeGreaterThan(0);
  for (const r of respuestas) {
    expect(r).toHaveProperty('por_pagina');
    expect(r.porPagina).toBeUndefined();
  }
});
