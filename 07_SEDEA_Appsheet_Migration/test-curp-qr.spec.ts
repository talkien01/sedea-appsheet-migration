// Verificacion del escaneo del QR de la Constancia CURP en la seccion 2.1.
//
// Dos bloques:
//   1. Parseo puro (sin navegador) de `parsearQrCurp` contra la muestra real.
//   2. UI en el navegador: boton, modal, cierre y aviso de QR invalido. La
//      camara fisica no se puede simular, asi que se usa la camara falsa de
//      Chromium para abrir el stream y el seam `window.__sedeaEscanerCurp`
//      para inyectar el texto que devolveria el decodificador.
//
// Requiere el stack arriba (docker compose up -d) con la PWA reconstruida:
//   npx playwright test test-curp-qr.spec.ts
import { test, expect } from '@playwright/test';
import { parsearQrCurp } from './pwa/src/componentes/curpQr';

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const PASSWORD = process.env.SEED_PASSWORD || 'cambiame123';

// La camara falsa de Chromium permite abrir el stream sin hardware real.
test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  }
});

const QR_REAL =
  'VAXL660626HGTLXS07|VAXL660626HDFLXS08, |VALLIN| |JOSE LUIS|HOMBRE|26/06/1966|GUANAJUATO|11|';

test.describe('parseo del texto del QR de la Constancia CURP', () => {
  test('la muestra real se parsea a los cuatro campos del formulario', () => {
    expect(parsearQrCurp(QR_REAL)).toEqual({
      curp: 'VAXL660626HGTLXS07',
      nombre_solicitante: 'JOSE LUIS VALLIN',
      sexo: 'H',
      fecha_nacimiento: '1966-06-26'
    });
  });

  test('con apellido materno y sexo MUJER arma el nombre completo', () => {
    const datos = parsearQrCurp(
      'MASL900101MQTRRR03|  |MARTINEZ|SERRANO|LAURA|MUJER|01/01/1990|QUERETARO|22|'
    );
    expect(datos?.nombre_solicitante).toBe('LAURA MARTINEZ SERRANO');
    expect(datos?.sexo).toBe('M');
    expect(datos?.fecha_nacimiento).toBe('1990-01-01');
  });

  test('textos que no son una Constancia CURP devuelven null', () => {
    expect(parsearQrCurp('https://www.gob.mx/curp')).toBeNull();
    expect(parsearQrCurp('VAXL660626HGTLXS07|VALLIN|JOSE LUIS')).toBeNull();
    expect(parsearQrCurp('NOESUNACURP|x|VALLIN| |JOSE|HOMBRE|26/06/1966|GTO|11|')).toBeNull();
    expect(parsearQrCurp('')).toBeNull();
  });
});

test.describe('escaneo del CURP en la pantalla de nueva solicitud', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="usuario"]', 'ventanilla2');
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
    await page.goto(`${BASE}/solicitudes/nueva`);
    await expect(page.getByTestId('seccion-solicitante')).toBeVisible({ timeout: 30000 });
  });

  test('el modal de camara se abre y se cierra liberando el video', async ({ page }) => {
    await expect(page.getByTestId('btn-escanear-curp')).toBeVisible();
    await page.getByTestId('btn-escanear-curp').click();
    await expect(page.getByTestId('modal-escaneo-curp')).toBeVisible();
    await expect(page.getByTestId('video-escaneo-curp')).toBeVisible();
    await page.getByTestId('btn-cerrar-escaneo-curp').click();
    await expect(page.getByTestId('modal-escaneo-curp')).toHaveCount(0);
    // El formulario sigue disponible para captura manual.
    await expect(page.getByTestId('input-curp')).toBeEditable();
  });

  test('un QR que no es Constancia CURP muestra el aviso y no toca el formulario', async ({
    page
  }) => {
    await page.getByTestId('btn-escanear-curp').click();
    await expect(page.getByTestId('modal-escaneo-curp')).toBeVisible();
    const ok = await page.evaluate(() => window.__sedeaEscanerCurp?.('texto que no es un CURP'));
    expect(ok).toBe(false);
    await expect(page.getByTestId('error-escaneo-curp')).toContainText(
      'No se pudo leer el CURP'
    );
    await page.getByTestId('btn-cerrar-escaneo-curp').click();
    await expect(page.getByTestId('input-curp')).toHaveValue('');
  });

  test('un QR valido llena CURP, nombre, sexo y fecha y cierra el modal', async ({ page }) => {
    await page.getByTestId('btn-escanear-curp').click();
    await expect(page.getByTestId('modal-escaneo-curp')).toBeVisible();
    const ok = await page.evaluate(
      (texto) => window.__sedeaEscanerCurp?.(texto),
      QR_REAL
    );
    expect(ok).toBe(true);
    await expect(page.getByTestId('modal-escaneo-curp')).toHaveCount(0);
    await expect(page.getByTestId('exito-escaneo-curp')).toBeVisible();
    await expect(page.getByTestId('input-curp')).toHaveValue('VAXL660626HGTLXS07');
    await expect(page.getByTestId('input-nombre-solicitante')).toHaveValue('JOSE LUIS VALLIN');
    await expect(page.getByTestId('select-sexo')).toHaveValue('H');
    await expect(page.getByTestId('input-fecha-nacimiento')).toHaveValue('1966-06-26');
  });
});

declare global {
  interface Window {
    __sedeaEscanerCurp?: (texto: string) => boolean;
  }
}
