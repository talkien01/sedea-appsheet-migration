// Verificacion UI del aislamiento por Regional de la bandeja de dictamen.
//
// Fixture (se deja fuera del spec para no mutar la base al correr los demas):
//   -- solicitudes 3 y 4 movidas a un municipio de Jalpan (Regional 2);
//   -- 1 y 2 se quedan en Amealco (Regional 4).
//   UPDATE solicitudes SET ubi_municipio_id = 8 WHERE id IN (3, 4);
//   -- usuarios: dict.jalpan (rol dictaminador, regional_id 2) y
//   --           dict.central (rol dictaminador, regional_id NULL).
// Al terminar: UPDATE solicitudes SET ubi_municipio_id = 18 WHERE id IN (3, 4);
const { test, expect } = require('@playwright/test');

const PWA = 'http://localhost:8081';

async function entrar(page, usuario, password) {
  await page.goto(`${PWA}/login`);
  await page.getByLabel(/usuario/i).first().fill(usuario);
  await page.getByLabel(/contrase/i).first().fill(password);
  await page.getByRole('button', { name: /entrar|iniciar/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test('dictaminador de Jalpan solo ve su Regional; Central ve todo', async ({ page }) => {
  page.on('response', async (r) => {
    if (r.url().includes('/api/dictamen/')) {
      console.log('API', r.status(), r.url(), (await r.text().catch(() => '')).slice(0, 200));
    }
  });
  await entrar(page, 'dict.jalpan', 'JalpanDict2026!');
  await page.goto(`${PWA}/dictamen`);
  await expect(page.getByText('PEO-CAD-AME-0003-26')).toBeVisible({ timeout: 20000 });
  const textoJalpan = await page.locator('body').innerText();
  await page.screenshot({ path: 'test-results/dictamen-jalpan.png', fullPage: true });

  expect(textoJalpan).toContain('PEO-CAD-AME-0003-26');
  expect(textoJalpan).not.toContain('PEO-CAD-AME-0001-26');
  expect(textoJalpan).not.toContain('PEO-CAD-AME-0002-26');

  // Detalle de una solicitud AJENA por URL directa: rechazado.
  await page.goto(`${PWA}/dictamen/1`);
  await page.waitForResponse((r) => r.url().includes('/api/dictamen/1'), { timeout: 20000 });
  await page.waitForTimeout(1500);
  const textoAjeno = await page.locator('body').innerText();
  await page.screenshot({ path: 'test-results/dictamen-jalpan-ajena.png', fullPage: true });
  expect(textoAjeno).not.toContain('PEO-CAD-AME-0001-26');
  // La UI no distingue el 404 de otros fallos: muestra su mensaje generico.
  expect(textoAjeno).toMatch(/no se pudo cargar el detalle/i);

  // Detalle propio: si abre.
  await page.goto(`${PWA}/dictamen/3`);
  await expect(page.locator('body')).toContainText('PEO-CAD-AME-0003-26', { timeout: 20000 });
});

test('dictaminador de SEDEA Central sigue viendo todas las Regionales', async ({ page }) => {
  await entrar(page, 'dict.central', 'CentralDict2026!');
  await page.goto(`${PWA}/dictamen`);
  // Ve la de Jalpan (Regional 2) aunque no es la suya: sin restriccion.
  await expect(page.locator('body')).toContainText('PEO-CAD-AME-0003-26', { timeout: 20000 });
  await page.screenshot({ path: 'test-results/dictamen-central.png', fullPage: true });

  // Y abre el detalle de una de la Regional 4 sin problema.
  await page.goto(`${PWA}/dictamen/1`);
  await expect(page.locator('body')).toContainText('PEO-CAD-AME-0001-26', { timeout: 20000 });
});
