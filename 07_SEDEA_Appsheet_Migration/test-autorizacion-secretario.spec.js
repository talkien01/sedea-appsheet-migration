// Verificacion como usuario real de la Autorizacion del Secretario: el candado
// manual (independiente del dictamen) que habilita el Folio de entrega.
//
// Cubre las dos capas del candado:
//   - Frontend: el boton "Folio de entrega" en el Detalle esta deshabilitado
//     mientras no haya autorizacion capturada.
//   - Backend: entrar por URL directa a /solicitudes/:id/folio no sirve de
//     nada: la pantalla muestra el mensaje del 403.
// Y el control de rol: solo admin ve y toca la tarjeta de autorizacion.
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const SOLICITUD = process.env.SOLICITUD_ID || '1';

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

/** Deja la solicitud en el estado deseado usando el API con sesion de admin. */
async function fijarAutorizacion(request, autorizada) {
  const login = await request.post(`${BASE}/api/auth/login`, {
    data: { usuario: 'admin', password: 'cambiame123' }
  });
  const { token } = await login.json();
  const r = await request.post(
    `${BASE}/api/solicitudes/${SOLICITUD}/autorizacion-secretario`,
    { headers: { Authorization: `Bearer ${token}` }, data: { autorizada } }
  );
  expect(r.status()).toBe(200);
}

test('ventanilla no ve la tarjeta de autorizacion del Secretario', async ({ page }) => {
  await entrar(page, 'ventanilla2', 'cambiame123');
  await page.goto(`${BASE}/solicitudes/${SOLICITUD}`);
  await expect(page.getByTestId('detalle-folio')).toBeVisible({ timeout: 20000 });
  // Ve el detalle completo, pero la decision mas alta del proceso no es suya.
  await expect(page.getByTestId('tarjeta-autorizacion-secretario')).toHaveCount(0);
});

test('sin autorizacion: boton deshabilitado y URL directa bloqueada', async ({ page, request }) => {
  await fijarAutorizacion(request, false);
  await entrar(page, 'admin', 'cambiame123');

  await page.goto(`${BASE}/solicitudes/${SOLICITUD}`);
  await expect(page.getByTestId('detalle-folio')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('estado-autorizacion-secretario')).toContainText(
    'No autorizada aún'
  );
  await expect(page.getByTestId('btn-folio-entrega')).toBeDisabled();

  // Segunda capa: saltarse el boton no sirve, el backend responde 403.
  await page.goto(`${BASE}/solicitudes/${SOLICITUD}/folio`);
  await expect(page.getByTestId('folio-error')).toContainText(
    'autorización del Secretario',
    { timeout: 20000 }
  );
  await expect(page.getByTestId('folio-entrega')).toHaveCount(0);
});

test('admin captura la autorizacion y el folio queda accesible; al quitarla se vuelve a bloquear', async ({
  page,
  request
}) => {
  await fijarAutorizacion(request, false);
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/solicitudes/${SOLICITUD}`);
  await expect(page.getByTestId('detalle-folio')).toBeVisible({ timeout: 20000 });

  await page
    .getByTestId('input-nota-autorizacion')
    .fill('autorizado a pesar de dictamen negativo, ver folio X');
  await page.getByTestId('btn-marcar-autorizacion').click();

  await expect(page.getByTestId('estado-autorizacion-secretario')).toContainText('Sí, capturada', {
    timeout: 20000
  });
  await expect(page.getByTestId('estado-autorizacion-secretario')).toContainText('por admin');

  // Ahora el boton es un enlace real y la pantalla del folio se arma.
  await page.getByTestId('btn-folio-entrega').click();
  await expect(page.getByTestId('folio-entrega')).toBeVisible({ timeout: 20000 });

  // Desmarcar vuelve a cerrar el candado (una captura equivocada se corrige).
  await page.goto(`${BASE}/solicitudes/${SOLICITUD}`);
  await page.getByTestId('btn-quitar-autorizacion').click();
  await expect(page.getByTestId('estado-autorizacion-secretario')).toContainText(
    'No autorizada aún',
    { timeout: 20000 }
  );
  await expect(page.getByTestId('btn-folio-entrega')).toBeDisabled();

  await page.goto(`${BASE}/solicitudes/${SOLICITUD}/folio`);
  await expect(page.getByTestId('folio-error')).toContainText('autorización del Secretario', {
    timeout: 20000
  });
});
