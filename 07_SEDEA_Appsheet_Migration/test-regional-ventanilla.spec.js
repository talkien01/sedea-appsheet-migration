// Verificacion del fix: la Regional aplica tambien al rol `ventanilla`.
//
// Bug: la ventanilla PURA nunca recibia regional_id (el select estaba
// deshabilitado y el backend rechazaba el valor), asi que regionalForzada()
// devolvia null y el usuario veia los 18 municipios del estado en 2.2 y 4.1.
//
// Excepcion preservada: la ventanilla Central de SEDEA (regional_id NULL) SI
// debe seguir viendo todo el estado.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8081';

const MUNICIPIOS_JALPAN = [
  'Arroyo Seco',
  'Jalpan de Serra',
  'Landa de Matamoros',
  'Pinal de Amoles'
];

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

/** Opciones reales de un <select>, sin el placeholder. */
async function opciones(select) {
  const textos = await select.locator('option').allTextContents();
  return textos.map((t) => t.trim()).filter((t) => t && !/^(Selecciona|Todos|—)/i.test(t));
}

/** Los catalogos llegan por fetch: hay que esperar a que el select se llene. */
async function municipiosDe(page, testid) {
  const select = page.locator(`[data-testid="${testid}"]`);
  await expect(select).toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => (await opciones(select)).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  return opciones(select);
}

test('El select de Regional se habilita para el rol ventanilla puro', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await page.click('[data-testid="btn-nuevo-usuario"]');
  await expect(page.locator('[data-testid="form-usuario"]')).toBeVisible();

  const selectRegional = page.locator('[data-testid="select-regional"]');

  // Rol por defecto = capturista: la Regional ya aplicaba antes del fix.
  await expect(selectRegional).toBeEnabled();

  // Se cambia a ventanilla PURA: primero se agrega ventanilla, luego se quita
  // capturista (no se permite dejar la lista de roles vacia).
  const casillas = page.locator('[data-testid="form-usuario"] .casilla');
  await casillas.filter({ hasText: /^Ventanilla$/ }).locator('input').check();
  await casillas.filter({ hasText: /^Capturista$/ }).locator('input').uncheck();

  // ANTES del fix este select quedaba disabled y mostraba "No aplica".
  await expect(selectRegional).toBeEnabled();
  const regionales = await opciones(selectRegional);
  expect(regionales).toContain('Jalpan');
  // La excepcion de la ventanilla Central se ofrece explicita, no por descuido.
  expect(regionales.join('|')).toContain('SEDEA Central');
});

test('Alta E2E: un ventanilla puro creado desde la UI queda con su Regional', async ({ page }) => {
  const acceso = `vent.ui${Date.now().toString().slice(-6)}`;

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await page.click('[data-testid="btn-nuevo-usuario"]');

  await page.fill('[data-testid="input-usuario"]', acceso);
  await page.fill('[data-testid="input-nombre-completo"]', 'Ventanilla creada desde la UI');

  const casillas = page.locator('[data-testid="form-usuario"] .casilla');
  await casillas.filter({ hasText: /^Ventanilla$/ }).locator('input').check();
  await casillas.filter({ hasText: /^Capturista$/ }).locator('input').uncheck();

  // ANTES del fix esta seleccion era imposible: el select estaba deshabilitado.
  await page
    .locator('[data-testid="select-regional"]')
    .selectOption({ label: 'Jalpan' });

  await page.click('[data-testid="btn-guardar-usuario"]');
  await expect(page.locator('[data-testid="error-form-usuario"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="form-usuario"]')).toHaveCount(0, { timeout: 15000 });

  // El alta muestra la contrasena temporal de un solo uso: se cierra el modal.
  await page.click('[data-testid="btn-cerrar-modal-password"]');

  // La tabla de usuarios muestra la Regional del ventanilla recien creado.
  await page.fill('[data-testid="input-busqueda-usuarios"]', acceso);
  const fila = page.locator('[data-testid="fila-usuario"]', { hasText: acceso });
  await expect(fila).toBeVisible({ timeout: 15000 });
  await expect(fila).toContainText('Jalpan');
});

test('La ventanilla de Jalpan solo captura en municipios de Jalpan (2.2 y 4.1)', async ({
  page
}) => {
  // Usuario del seed 006: rol ventanilla puro, Regional Jalpan (REG-02),
  // sin alcance granular (el recorte lo hace su Regional).
  await entrar(page, 'vent.jalpan', 'cambiame123');
  await page.goto(`${BASE}/solicitudes/nueva`);

  // 4.1 - ubicacion del predio.
  const predio = await municipiosDe(page, 'select-ubi-municipio');
  expect(predio.sort()).toEqual([...MUNICIPIOS_JALPAN].sort());

  // 2.2 - domicilio del solicitante.
  const domicilio = await municipiosDe(page, 'select-dom-municipio');
  expect(domicilio.sort()).toEqual([...MUNICIPIOS_JALPAN].sort());
});

test('La ventanilla Central de SEDEA sigue viendo los 18 municipios', async ({ page }) => {
  await entrar(page, 'ventanilla2', 'cambiame123');
  await page.goto(`${BASE}/solicitudes/nueva`);
  expect((await municipiosDe(page, 'select-ubi-municipio')).length).toBe(18);
});

test('El capturista conserva el aislamiento por su Regional', async ({ page }) => {
  await entrar(page, 'capturista1', 'cambiame123');
  await page.goto(`${BASE}/solicitudes/nueva`);

  const municipios = await municipiosDe(page, 'select-ubi-municipio');
  // Cadereyta (REG-01) tiene 6 municipios y NO incluye los de Jalpan.
  expect(municipios.length).toBe(6);
  expect(municipios).toContain('Cadereyta de Montes');
  expect(municipios).not.toContain('Jalpan de Serra');
});
