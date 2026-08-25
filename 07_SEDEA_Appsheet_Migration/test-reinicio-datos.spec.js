// Verificacion como usuario real del reinicio de datos de prueba.
//
// Cubre: visibilidad de la zona de peligro solo para admin, el candado de la
// frase exacta en el frontend, y el borrado efectivo con su evidencia.
// La verificacion de la BD (tablas en 0, catalogo intacto, folio reiniciado)
// se hace aparte con psql; aqui se verifica la parte de interfaz.
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const FRASE = 'BORRAR TODOS LOS DATOS';

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

test('editor_datos no ve la zona de peligro en /usuarios', async ({ page }) => {
  await entrar(page, 'editor1', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await expect(page.getByTestId('btn-nuevo-usuario')).toBeVisible({ timeout: 20000 });
  // Administra usuarios, pero la seccion destructiva no existe para el.
  await expect(page.getByTestId('zona-peligro-sistema')).toHaveCount(0);
  await expect(page.getByTestId('btn-reiniciar-datos-prueba')).toHaveCount(0);
});

test('admin: el boton de confirmar solo se habilita con la frase EXACTA', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  const abrir = page.getByTestId('btn-reiniciar-datos-prueba');
  await expect(abrir).toBeVisible({ timeout: 20000 });
  await abrir.click();

  await expect(page.getByTestId('modal-reiniciar-datos')).toBeVisible();
  const confirmar = page.getByTestId('btn-confirmar-reinicio');
  const input = page.getByTestId('input-confirmar-reinicio');

  // Vacio: deshabilitado.
  await expect(confirmar).toBeDisabled();

  // Variantes que NO deben habilitarlo.
  for (const malo of [
    'borrar todos los datos', // minusculas
    'Borrar Todos Los Datos', // capitalizado
    'BORRAR TODOS', // parcial
    'BORRAR  TODOS  LOS  DATOS', // espacios dobles
    `${FRASE} `, // espacio al final
    ` ${FRASE}` // espacio al inicio
  ]) {
    await input.fill(malo);
    await expect(confirmar).toBeDisabled();
  }

  // La frase exacta lo habilita.
  await input.fill(FRASE);
  await expect(confirmar).toBeEnabled();

  // Y volver a romperla lo vuelve a deshabilitar.
  await input.fill(`${FRASE}X`);
  await expect(confirmar).toBeDisabled();

  // Se cancela sin borrar nada.
  await page.getByTestId('btn-cancelar-reinicio').click();
  await expect(page.getByTestId('modal-reiniciar-datos')).toHaveCount(0);
});

test('admin: confirmar con la frase exacta borra y muestra la evidencia', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);

  await page.getByTestId('btn-reiniciar-datos-prueba').click();
  await expect(page.getByTestId('modal-reiniciar-datos')).toBeVisible();

  // El modal enumera exactamente las 12 tablas que se van a vaciar.
  await expect(page.getByTestId('lista-tablas-reinicio').locator('li')).toHaveCount(12);

  await page.getByTestId('input-confirmar-reinicio').fill(FRASE);
  await page.getByTestId('btn-confirmar-reinicio').click();

  // El modal se cierra y aparece la evidencia con una fila por tabla.
  await expect(page.getByTestId('modal-reiniciar-datos')).toHaveCount(0, { timeout: 30000 });
  const resultado = page.getByTestId('resultado-reinicio');
  await expect(resultado).toBeVisible();
  await expect(page.getByTestId('fila-reinicio')).toHaveCount(12);
  await expect(resultado).toContainText('Datos reiniciados por admin');
  await expect(resultado).toContainText('/media');
});
