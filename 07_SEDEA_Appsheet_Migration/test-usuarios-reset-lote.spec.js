// Reseteo de contrasena EN LOTE de usuarios que YA EXISTEN (E37b), verificado
// como usuario real contra el stack de Docker (PWA 8081 -> backend 3011).
//
// No confundir con test-usuarios-lote-password-comun.spec.js, que cubre la
// carga masiva CSV (altas nuevas). Aqui los usuarios ya existen y solo se les
// cambia la contrasena desde la tabla de /usuarios.
//
// Lo que se prueba de punta a punta:
//  1. La barra de acciones aparece solo con al menos un usuario seleccionado.
//  2. Con una contrasena comun valida, TODOS los seleccionados quedan con ella
//     y entran al sistema obligados a cambiarla.
//  3. Una contrasena debil se rechaza en el modal y no resetea a nadie.
//  4. Un editor_datos que selecciona a un admin ve ESA fila en error sin que
//     las demas se bloqueen.
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:3011/api';

const COMUN = 'SedeaReset2026';
const SUF = Date.now().toString(36).slice(-5);

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

async function token(peticion, usuario, password) {
  const r = await peticion.post(`${API}/auth/login`, { data: { usuario, password } });
  return (await r.json()).token;
}

/** Crea via API los usuarios que despues se resetean desde la pantalla. */
async function crear(peticion, tok, usuario, rol, regionalId) {
  const data = {
    usuario,
    nombre_completo: `Reset Lote ${usuario}`,
    rol,
    modo_password: 'manual',
    password_manual: 'Inicial12345'
  };
  if (regionalId) data.regional_id = regionalId;
  const r = await peticion.post(`${API}/usuarios`, {
    data,
    headers: { Authorization: `Bearer ${tok}` }
  });
  expect(r.status(), `alta de ${usuario}`).toBe(201);
  return (await r.json()).usuario.id;
}

test.describe.configure({ mode: 'serial' });

let idsCapturistas = [];
let idAdmin = null;
let usuarios = {};

test('prepara usuarios existentes de prueba', async ({ request }) => {
  const tok = await token(request, 'admin', 'cambiame123');
  usuarios = {
    a: `rp.a${SUF}`,
    b: `rp.b${SUF}`,
    c: `rp.c${SUF}`,
    adm: `rp.adm${SUF}`
  };
  idsCapturistas = [
    await crear(request, tok, usuarios.a, 'capturista', 2),
    await crear(request, tok, usuarios.b, 'capturista', 2),
    await crear(request, tok, usuarios.c, 'auditor', null)
  ];
  idAdmin = await crear(request, tok, usuarios.adm, 'admin', null);
});

test('selecciona 3 usuarios y los resetea con una contrasena comun', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await expect(page.getByTestId('tabla-usuarios')).toBeVisible();

  // Sin seleccion no hay barra de acciones.
  await expect(page.getByTestId('barra-acciones-seleccion')).toHaveCount(0);

  for (const id of idsCapturistas) {
    await page.getByTestId(`check-seleccionar-usuario-${id}`).check();
  }
  await expect(page.getByTestId('contador-seleccion')).toHaveText('3 usuarios seleccionados');
  await expect(page.getByTestId('btn-resetear-password-lote')).toContainText(
    'Resetear contraseña de 3 usuarios seleccionados'
  );

  await page.getByTestId('btn-resetear-password-lote').click();
  await expect(page.getByTestId('modal-reset-password-lote')).toBeVisible();

  // Una contrasena debil se detiene en el modal, sin llamar a la API.
  await page.getByTestId('input-password-lote-reset').fill('abc');
  await page.getByTestId('btn-confirmar-reset-lote').click();
  await expect(page.getByTestId('error-password-lote-reset')).toBeVisible();
  await expect(page.getByTestId('modal-reset-password-lote')).toBeVisible();

  await page.getByTestId('input-password-lote-reset').fill(COMUN);
  await page.getByTestId('btn-confirmar-reset-lote').click();

  await expect(page.getByTestId('resumen-reset-lote')).toContainText('3 reseteados, 0 con error');
  // La comun se muestra en claro: es UNA sola y hay que poder dictarla.
  await expect(page.getByTestId('password-comun-reset-lote')).toContainText(COMUN);
  await expect(page.getByTestId('password-comun-reset-lote')).toContainText('Avísales esta contraseña');
  await expect(page.getByTestId('fila-resultado-reset-lote')).toHaveCount(3);
  // La seleccion se limpia al terminar.
  await expect(page.getByTestId('barra-acciones-seleccion')).toHaveCount(0);
});

test('los 3 entran con la MISMA contrasena y deben cambiarla', async ({ request }) => {
  for (const usuario of [usuarios.a, usuarios.b, usuarios.c]) {
    const r = await request.post(`${API}/auth/login`, {
      data: { usuario, password: COMUN }
    });
    expect(r.status(), `login de ${usuario}`).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.usuario.debe_cambiar_password, `${usuario} debe cambiarla`).toBe(true);
  }
});

test('editor_datos: la fila del admin falla sin bloquear a las demas', async ({ page }) => {
  await entrar(page, 'editor1', 'cambiame123');
  await page.goto(`${BASE}/usuarios`);
  await expect(page.getByTestId('tabla-usuarios')).toBeVisible();

  await page.getByTestId(`check-seleccionar-usuario-${idsCapturistas[0]}`).check();
  await page.getByTestId(`check-seleccionar-usuario-${idAdmin}`).check();
  await page.getByTestId(`check-seleccionar-usuario-${idsCapturistas[1]}`).check();

  await page.getByTestId('btn-resetear-password-lote').click();
  await page.getByTestId('input-password-lote-reset').fill('OtraClaveUi2026');
  await page.getByTestId('btn-confirmar-reset-lote').click();

  await expect(page.getByTestId('resumen-reset-lote')).toContainText('2 reseteados, 1 con error');
  const filaAdmin = page
    .getByTestId('fila-resultado-reset-lote')
    .filter({ hasText: usuarios.adm });
  await expect(filaAdmin).toContainText('Error');
  await expect(filaAdmin).toContainText('no puede administrar cuentas de administrador');
});

test('los dos capturistas quedaron con la nueva; el admin de prueba no se toco', async ({
  request
}) => {
  for (const usuario of [usuarios.a, usuarios.b]) {
    const r = await request.post(`${API}/auth/login`, {
      data: { usuario, password: 'OtraClaveUi2026' }
    });
    expect(r.status(), `login de ${usuario}`).toBe(200);
  }
  // El admin de prueba conserva su contrasena original: si se hubiera reseteado,
  // este login habria fallado.
  const r = await request.post(`${API}/auth/login`, {
    data: { usuario: usuarios.adm, password: 'Inicial12345' }
  });
  expect(r.status(), 'el admin de prueba no fue reseteado').toBe(200);
});
