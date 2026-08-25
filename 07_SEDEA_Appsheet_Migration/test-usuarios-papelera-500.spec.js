// Regresion del 500 en GET /api/usuarios y de la papelera inoperante.
//
// Contexto: e7158b2 (papelera) dejo tres defectos que f32cde4 no resolvio:
//  1. la query de conteo de listarUsuarios aplicaba el WHERE fuera de la
//     subquery, con lo que Postgres tiraba "missing FROM-clause entry for
//     table u" en CADA GET /api/usuarios;
//  2. la ruta nunca leia ?eliminado, asi que la papelera era inalcanzable;
//  3. SELECT_USUARIO traia su propio WHERE y obtenerUsuarioAdmin le sumaba
//     otro, rompiendo el alta y la edicion con doble WHERE.
//
// Este spec verifica como usuario real que /usuarios carga sin error tanto en
// la vista normal como en el toggle de papelera, y que ninguna peticion a
// /api/usuarios responde 5xx durante el recorrido.
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:3011/api';

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

// Registra cualquier 5xx de /api/usuarios para fallar con evidencia concreta.
function vigilarErrores(page) {
  const fallos = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/usuarios') && res.status() >= 500) {
      fallos.push(`${res.status()} ${res.url()}`);
    }
  });
  return fallos;
}

test('/usuarios carga en vista normal y en papelera sin ningun 5xx', async ({ page }) => {
  const fallos = vigilarErrores(page);

  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  // Vista normal: la tabla se pinta con al menos un usuario real.
  await expect(page.getByTestId('btn-toggle-papelera')).toBeVisible();
  await expect(page.getByTestId('fila-usuario').first()).toBeVisible({ timeout: 20000 });
  const filasNormal = await page.getByTestId('fila-usuario').count();
  expect(filasNormal).toBeGreaterThan(0);

  // Toggle a papelera: debe responder sin romper la pantalla.
  await page.getByTestId('btn-toggle-papelera').click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('btn-toggle-papelera')).toBeVisible();

  // Volver a la vista normal y confirmar que sigue trayendo los mismos usuarios.
  await page.getByTestId('btn-toggle-papelera').click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('fila-usuario').first()).toBeVisible({ timeout: 20000 });
  expect(await page.getByTestId('fila-usuario').count()).toBe(filasNormal);

  expect(fallos, `respuestas 5xx observadas: ${fallos.join(', ')}`).toEqual([]);
});

test('el ciclo eliminar/restaurar mueve al usuario entre listado y papelera', async ({ page }) => {
  const fallos = vigilarErrores(page);
  const usuario = `t${Date.now().toString(36).slice(-5)}.pap`;

  await entrar(page, 'admin', 'cambiame123');

  // Se crea el usuario de prueba por API, para no depender del formulario de
  // alta en esta regresion (lo que se prueba aqui es el ciclo de papelera).
  const sesion = await page.request.post(`${API}/auth/login`, {
    data: { usuario: 'admin', password: 'cambiame123' }
  });
  const { token } = await sesion.json();
  const alta = await page.request.post(`${API}/usuarios`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { usuario, nombre_completo: 'Prueba Papelera UI', rol: 'capturista', regional_id: 1 }
  });
  expect(alta.status(), await alta.text()).toBe(201);

  await page.goto(`${BASE}/usuarios`);
  await expect(page.getByText(usuario, { exact: false }).first()).toBeVisible({ timeout: 20000 });

  // Eliminar: la confirmacion va por window.confirm.
  page.on('dialog', (d) => d.accept());
  const fila = page.getByTestId('fila-usuario').filter({ hasText: usuario });
  await fila.getByRole('button', { name: /eliminar/i }).first().click();
  await page.waitForTimeout(1500);

  // Ya no debe estar en el listado normal.
  await expect(page.getByTestId('fila-usuario').filter({ hasText: usuario })).toHaveCount(0);

  // Pero si en la papelera.
  await page.getByTestId('btn-toggle-papelera').click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('fila-usuario').filter({ hasText: usuario })).toHaveCount(1);
  await expect(page.getByTestId('badge-eliminado').first()).toBeVisible();

  // Restaurar desde la papelera.
  await page
    .getByTestId('fila-usuario')
    .filter({ hasText: usuario })
    .getByRole('button', { name: /restaurar/i })
    .first()
    .click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('fila-usuario').filter({ hasText: usuario })).toHaveCount(0);

  // Y vuelve al listado normal.
  await page.getByTestId('btn-toggle-papelera').click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('fila-usuario').filter({ hasText: usuario })).toHaveCount(1);

  expect(fallos, `respuestas 5xx observadas: ${fallos.join(', ')}`).toEqual([]);
});
