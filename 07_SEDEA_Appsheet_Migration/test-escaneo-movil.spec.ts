// Verificacion de E60: traspaso celular -> PC para el escaneo de la Constancia
// CURP.
//
// La prueba central levanta DOS contextos de navegador en el mismo test: uno
// hace de escritorio de ventanilla (con sesion iniciada) y otro de celular
// (sin sesion, como un telefono cualquiera). Es la unica forma de comprobar lo
// que importa: que el dato cruza de un dispositivo al otro.
//
// La camara fisica no se puede simular, asi que el celular usa el seam
// `window.__sedeaEscaneoMovil` para inyectar el texto que devolveria jsQR,
// igual que hace test-curp-qr.spec.ts con el escaneo directo.
//
// Requiere el stack arriba con la PWA reconstruida y la migracion 019 aplicada:
//   docker compose -p sedea_e60 up -d --build
//   PWA_URL=http://localhost:8092 npx playwright test test-escaneo-movil.spec.ts
import { execFileSync } from 'node:child_process';
import { test, expect, type Browser, type Page } from '@playwright/test';

const BASE = process.env.PWA_URL || 'http://localhost:8092';
const PROYECTO = process.env.COMPOSE_PROYECTO || 'sedea_e60';
const PASSWORD = process.env.SEED_PASSWORD || 'cambiame123';

const QR_REAL =
  'VAXL660626HGTLXS07|VAXL660626HDFLXS08, |VALLIN| |JOSE LUIS|HOMBRE|26/06/1966|GUANAJUATO|11|';

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  }
});

/** Deja el escritorio en la seccion 2.1 con la sesion de ventanilla iniciada. */
async function abrirNuevaSolicitud(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'ventanilla2');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/solicitudes/nueva`);
  await expect(page.getByTestId('seccion-solicitante')).toBeVisible({ timeout: 30000 });
}

/** Abre el modal de vinculacion y devuelve la URL que el QR codifica. */
async function vincularCelular(page: Page): Promise<string> {
  await page.getByTestId('btn-vincular-celular').click();
  await expect(page.getByTestId('modal-vincular-celular')).toBeVisible();
  await expect(page.getByTestId('qr-vincular-celular')).toBeVisible({ timeout: 15000 });
  const url = await page.getByTestId('url-vincular-celular').innerText();
  expect(url).toContain('/escaneo-movil/');
  return url.trim();
}

/** Contexto limpio: un celular no trae la sesion del escritorio. */
async function abrirComoCelular(browser: Browser, url: string): Promise<Page> {
  const contexto = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 390, height: 844 }
  });
  const page = await contexto.newPage();
  await page.goto(url);
  return page;
}

/** Envejece una sesion en la base para probar la expiracion sin esperar 10 min. */
function expirarEnBase(token: string): void {
  execFileSync(
    'docker',
    [
      'compose', '-p', PROYECTO, 'exec', '-T', 'db',
      'psql', '-U', 'sedea', '-d', 'sedea', '-c',
      `UPDATE sesiones_escaneo_curp SET expira_en = now() - interval '1 minute' WHERE token = '${token}'`
    ],
    { stdio: 'pipe' }
  );
}

test.describe('E60: escaneo del CURP con un celular vinculado', () => {
  test('el dato cruza del celular al formulario del escritorio', async ({ page, browser }) => {
    await abrirNuevaSolicitud(page);
    const url = await vincularCelular(page);

    // Mientras el celular no manda nada, el escritorio espera y el formulario
    // sigue vacio y capturable a mano.
    await expect(page.getByTestId('estado-vincular-celular')).toContainText('Esperando');
    await expect(page.getByTestId('input-curp')).toHaveValue('');

    const celular = await abrirComoCelular(browser, url);
    await expect(celular.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });
    // El celular NO tiene sesion: no hay cascaron ni menu de la app.
    await expect(celular.getByTestId('video-escaneo-movil')).toBeVisible();

    const ok = await celular.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL);
    expect(ok).toBe(true);
    await expect(celular.getByTestId('exito-escaneo-movil')).toBeVisible();
    await expect(celular.getByTestId('exito-escaneo-movil')).toContainText('VAXL660626HGTLXS07');

    // Lo que importa: sin tocar el escritorio, el sondeo trae los cuatro campos.
    await expect(page.getByTestId('modal-vincular-celular')).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId('exito-escaneo-curp')).toBeVisible();
    await expect(page.getByTestId('input-curp')).toHaveValue('VAXL660626HGTLXS07');
    await expect(page.getByTestId('input-nombre-solicitante')).toHaveValue('JOSE LUIS VALLIN');
    await expect(page.getByTestId('select-sexo')).toHaveValue('H');
    await expect(page.getByTestId('input-fecha-nacimiento')).toHaveValue('1966-06-26');

    await celular.context().close();
  });

  test('un QR que no es Constancia deja seguir intentando desde el celular', async ({
    page,
    browser
  }) => {
    await abrirNuevaSolicitud(page);
    const url = await vincularCelular(page);
    const celular = await abrirComoCelular(browser, url);
    await expect(celular.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });

    const malo = await celular.evaluate(() =>
      window.__sedeaEscaneoMovil?.('https://www.gob.mx/curp')
    );
    expect(malo).toBe(false);
    await expect(celular.getByTestId('error-escaneo-movil')).toContainText(
      'No se pudo leer el CURP'
    );
    // La camara sigue viva y el escritorio sigue esperando: el error es recuperable.
    await expect(celular.getByTestId('video-escaneo-movil')).toBeVisible();
    await expect(page.getByTestId('modal-vincular-celular')).toBeVisible();

    // Y el segundo intento, con el QR bueno, si pasa.
    const bueno = await celular.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL);
    expect(bueno).toBe(true);
    await expect(page.getByTestId('input-curp')).toHaveValue('VAXL660626HGTLXS07', {
      timeout: 20000
    });

    await celular.context().close();
  });

  test('un token inexistente no acepta escaneos', async ({ browser }) => {
    const celular = await abrirComoCelular(
      browser,
      `${BASE}/escaneo-movil/token-que-nunca-existio`
    );
    await expect(celular.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });

    const ok = await celular.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL);
    expect(ok).toBe(false);
    await expect(celular.getByTestId('error-escaneo-movil')).toContainText('no encontrada');
    await expect(celular.getByTestId('exito-escaneo-movil')).toHaveCount(0);

    await celular.context().close();
  });

  test('un token vencido no acepta escaneos y el escritorio lo avisa', async ({
    page,
    browser
  }) => {
    await abrirNuevaSolicitud(page);
    const url = await vincularCelular(page);
    const token = url.split('/escaneo-movil/')[1];

    expirarEnBase(token);

    // El celular que llega tarde se queda sin poder entregar.
    const celular = await abrirComoCelular(browser, url);
    await expect(celular.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });
    const ok = await celular.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL);
    expect(ok).toBe(false);
    await expect(celular.getByTestId('error-escaneo-movil')).toContainText('expiró');

    // Y el escritorio deja de esperar en vez de girar para siempre.
    await expect(page.getByTestId('expirada-vincular-celular')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('input-curp')).toHaveValue('');

    await celular.context().close();
  });

  test('la sesion es de un solo uso', async ({ page, browser }) => {
    await abrirNuevaSolicitud(page);
    const url = await vincularCelular(page);

    const celular = await abrirComoCelular(browser, url);
    await expect(celular.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });
    expect(await celular.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL)).toBe(true);
    await expect(celular.getByTestId('exito-escaneo-movil')).toBeVisible();

    // Un segundo celular con el mismo token ya no entra.
    const otro = await abrirComoCelular(browser, url);
    await expect(otro.getByTestId('pantalla-escaneo-movil')).toBeVisible({ timeout: 30000 });
    const repetido = await otro.evaluate((t) => window.__sedeaEscaneoMovil?.(t), QR_REAL);
    expect(repetido).toBe(false);
    await expect(otro.getByTestId('error-escaneo-movil')).toContainText('ya se usó');

    await celular.context().close();
    await otro.context().close();
  });

  test('cerrar el modal deja el formulario capturable a mano', async ({ page }) => {
    await abrirNuevaSolicitud(page);
    await vincularCelular(page);
    await page.getByTestId('btn-cerrar-vincular-celular').click();
    await expect(page.getByTestId('modal-vincular-celular')).toHaveCount(0);
    await expect(page.getByTestId('input-curp')).toBeEditable();
    await page.getByTestId('input-curp').fill('MASL900101MQTRRR03');
    await expect(page.getByTestId('input-curp')).toHaveValue('MASL900101MQTRRR03');
  });
});

declare global {
  interface Window {
    __sedeaEscaneoMovil?: (texto: string) => Promise<boolean>;
  }
}
