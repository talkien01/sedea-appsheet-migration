// Captura de pantalla de /catalogos en escritorio 1440px (antes/despues del fix de UI).
// Uso: FASE=antes npx playwright test test-catalogos-shot.spec.js
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173';
const FASE = process.env.FASE || 'actual';

test.use({ viewport: { width: 1440, height: 1000 } });

test(`captura /catalogos (${FASE})`, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/catalogos`);
  await expect(page.locator('[data-testid="pantalla-catalogos"]')).toBeVisible();
  await expect(page.locator('[data-testid="arbol-catalogos"]')).toBeVisible();
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `scratchpad/catalogos-${FASE}-full.png`, fullPage: true });
  await page
    .locator('[data-testid="arbol-catalogos"]')
    .screenshot({ path: `scratchpad/catalogos-${FASE}-arbol.png` });

  // Zoom a la barra de herramientas y a la primera fila con Duplicar
  // (Build 12: los proyectos viven en la pestana "Componentes").
  const enc = page.locator('.catalogos-barra').first();
  await enc.screenshot({ path: `scratchpad/catalogos-${FASE}-encabezado.png` });

  await page.click('[data-testid="tab-componentes"]');
  const filaDup = page.locator('[data-testid^="btn-duplicar-proyectos-"]').first();
  if (await filaDup.count()) {
    const fila = filaDup.locator('xpath=ancestor::tr');
    await fila.screenshot({ path: `scratchpad/catalogos-${FASE}-fila-duplicar.png` });
  }

  // Inventario de testids que no deben romperse.
  const ids = await page.$$eval('[data-testid]', (els) =>
    els.map((e) => e.getAttribute('testid') || e.getAttribute('data-testid'))
  );
  const relevantes = ids.filter((i) => /^btn-(nuevo|editar|duplicar|desactivar|reactivar)-/.test(i));
  console.log('TESTIDS_ACCION:', JSON.stringify(relevantes.sort()));
});
