// Verificacion de los dos fixes de /catalogos:
//  1) titulo del modal de alta/edicion en singular y con genero correcto
//  2) guard de orden en el refetch (desactivar -> "Mostrar desactivados")
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173';
const SHOTS = 'scratchpad/catalogos-fixes';

// `serviceWorkers: 'block'`: la PWA registra un SW y las peticiones que salen
// de el no pasan por page.route(), asi que sin esto no se puede simular el
// orden de respuestas de la prueba de carrera.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/catalogos`);
  await expect(page.locator('[data-testid="pantalla-catalogos"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-programas"]')).toBeVisible();
  await expect(page.locator('[data-testid^="nodo-programas-"]').first()).toBeVisible();
}

test('titulo del modal de alta en singular para las 6 entidades', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  const casos = [
    { tab: 'tab-programas', boton: 'btn-nuevo-programas', esperado: 'Nuevo programa' },
    { tab: 'tab-programas', boton: 'btn-nuevo-subprogramas', esperado: 'Nuevo subprograma' },
    { tab: 'tab-componentes', boton: 'btn-nuevo-componentes', esperado: 'Nuevo componente' },
    { tab: 'tab-componentes', boton: 'btn-nuevo-modalidades', esperado: 'Nueva modalidad' },
    { tab: 'tab-componentes', boton: 'btn-nuevo-proyectos', esperado: 'Nuevo proyecto' },
    { tab: 'tab-tipos_apoyo', boton: 'btn-nuevo-tipos_apoyo', esperado: 'Nuevo concepto de apoyo' }
  ];

  for (const c of casos) {
    await page.click(`[data-testid="${c.tab}"]`);
    await page.click(`[data-testid="${c.boton}"]`);
    const h2 = page.locator('[data-testid="form-catalogo"] h2');
    await expect(h2).toBeVisible();
    const titulo = (await h2.innerText()).trim();
    console.log(`${c.boton} -> "${titulo}"`);
    expect(titulo).toBe(c.esperado);
    // Nada de plural tecnico de tabla en el titulo
    expect(titulo).not.toMatch(/programas|componentes|modalidades|proyectos|tipos_apoyo|subprogramas/);
    await page.screenshot({ path: `${SHOTS}-titulo-${c.boton}.png` });
    await page.click('[data-testid="btn-cancelar-catalogo"]');
    await expect(page.locator('[data-testid="modal-form-catalogo"]')).toHaveCount(0);
  }
});

test('titulo de edicion y de duplicar en singular', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  const fila = page.locator('[data-testid^="nodo-programas-"]').first();
  const id = (await fila.getAttribute('data-testid')).replace('nodo-programas-', '');

  await page.click(`[data-testid="btn-editar-programas-${id}"]`);
  let titulo = (await page.locator('[data-testid="form-catalogo"] h2').innerText()).trim();
  console.log('editar ->', titulo);
  expect(titulo).toBe('Editar programa');
  await page.click('[data-testid="btn-cancelar-catalogo"]');

  // Duplicar solo esta disponible en proyectos y conceptos de apoyo.
  await page.click('[data-testid="tab-componentes"]');
  const btnDup = page.locator('[data-testid^="btn-duplicar-proyectos-"]').first();
  await expect(btnDup).toBeVisible();
  await btnDup.click();
  titulo = (await page.locator('[data-testid="form-catalogo"] h2').innerText()).trim();
  console.log('duplicar ->', titulo);
  expect(titulo).toBe('Duplicar proyecto');
  await page.screenshot({ path: `${SHOTS}-titulo-duplicar.png` });
  await page.click('[data-testid="btn-cancelar-catalogo"]');
});

/**
 * Carrera REALMENTE alcanzable con clics: el buscador de conceptos de apoyo.
 * `cargarConceptos` no levanta el flag `cargando`, asi que la tabla y el input
 * siguen montados mientras la peticion viaja y el usuario puede seguir
 * tecleando. Retrasamos la peticion de 2 letras para que resuelva DESPUES de la
 * del termino completo: sin el token de orden, la respuesta vieja pisa la lista
 * y quedan en pantalla filas que no coinciden con lo que dice el buscador.
 */
test('race: respuesta vieja del buscador de conceptos no pisa la lista fresca', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/catalogos/tipos_apoyo*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const lenta = q.length === 2;
    console.log(`[route] tipos_apoyo q="${q}" ${lenta ? 'RETRASADA 3s' : 'rapida'}`);
    if (lenta) await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });

  await login(page);
  await page.click('[data-testid="tab-tipos_apoyo"]');
  const filas = page.locator('[data-testid^="nodo-tipos_apoyo-"]');
  await expect(filas.first()).toBeVisible();

  // Termino de busqueda tomado de un registro real: 5 caracteres, cuyo prefijo
  // de 2 letras devuelve un conjunto estrictamente mayor.
  const nombre = (await filas.first().locator('.celda-nombre').innerText()).trim();
  const termino = nombre.slice(0, 5);
  console.log('termino final:', JSON.stringify(termino));

  const input = page.locator('[data-testid="input-buscar-tipos_apoyo"]');
  await input.click();
  // Teclear letra por letra: dispara q de 2, 3, 4 y 5 caracteres. La de 2 es la
  // retrasada, asi que resuelve al final.
  await input.type(termino, { delay: 120 });

  // Dejar que resuelva TODO, incluida la respuesta vieja retrasada.
  await page.waitForTimeout(7000);

  await expect(input).toHaveValue(termino);
  const n = await filas.count();
  console.log('filas finales:', n);
  expect(n).toBeGreaterThan(0);
  // Toda fila visible tiene que coincidir con lo que el buscador muestra.
  // Sin el guard aparecen aqui los resultados del prefijo de 2 letras.
  for (let i = 0; i < n; i++) {
    const texto = (await filas.nth(i).locator('.celda-nombre').innerText()).trim();
    expect(texto.toUpperCase()).toContain(termino.toUpperCase());
  }

  // Contraste con el servidor: la misma consulta, sin interceptar nada.
  await page.unroute('**/catalogos/tipos_apoyo*');
  await page.reload();
  await page.click('[data-testid="tab-tipos_apoyo"]');
  await page.locator('[data-testid="input-buscar-tipos_apoyo"]').fill(termino);
  await page.waitForTimeout(3000);
  const nServidor = await filas.count();
  console.log('filas segun el servidor:', nServidor);
  expect(n).toBe(nServidor);

  await page.screenshot({ path: `${SHOTS}-race-conceptos.png`, fullPage: true });
});

/**
 * Variante sobre el arbol: desactivar y marcar "Mostrar desactivados" de
 * inmediato. Aqui la pantalla desmonta la tabla mientras `cargando` es true, asi
 * que el clic en el checkbox no llega a solaparse; la prueba comprueba que el
 * guard tampoco rompe este camino y que la lista final es la del servidor.
 */
test('desactivar + "Mostrar desactivados" deja la lista en el estado del servidor', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/catalogos/arbol*', async (route) => {
    const url = route.request().url();
    const vieja = !url.includes('incluir_inactivos');
    if (vieja) await new Promise((r) => setTimeout(r, 3000));
    console.log(`[route] arbol ${vieja ? 'VIEJA (retrasada 3s)' : 'NUEVA'} -> ${url}`);
    await route.continue();
  });

  await login(page);

  const fila = page.locator('[data-testid^="nodo-programas-"]').first();
  const id = (await fila.getAttribute('data-testid')).replace('nodo-programas-', '');
  const clave = (await fila.locator('.celda-clave').innerText()).trim();
  console.log('programa bajo prueba:', id, clave);
  await expect(fila.locator('[data-testid="chip-activo"]')).toBeVisible();

  // 1) Desactivar -> dispara cargarArbol() SIN incluir_inactivos (la retrasada)
  await page.click(`[data-testid="btn-desactivar-programas-${id}"]`);
  await page.click('[data-testid="btn-confirmar-baja"]');

  // 2) De inmediato (<1s) marcar "Mostrar desactivados"
  await page.waitForTimeout(200);
  await page.click('[data-testid="toggle-incluir-inactivos"]');

  // 3) Dejar que resuelva TODO, incluida la respuesta vieja retrasada
  await page.waitForTimeout(6000);

  const filaFinal = page.locator(`[data-testid="nodo-programas-${id}"]`);
  try {
    // La UI, tras la carrera, debe seguir mostrando el estado real del
    // servidor: checkbox marcado + fila visible con chip "Desactivado".
    // Sin el guard, la respuesta vieja (sin inactivos) pisa la lista y la fila
    // desaparece pese a que el checkbox quedo marcado.
    await expect(page.locator('[data-testid="toggle-incluir-inactivos"]')).toBeChecked();
    await expect(filaFinal).toBeVisible();
    await expect(filaFinal.locator('[data-testid="chip-inactivo"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}-race-final.png`, fullPage: true });
    console.log('post-carrera: fila visible y desactivada');

    // Contraste con el servidor: recarga limpia, sin interceptar nada.
    await page.unroute('**/catalogos/arbol*');
    await page.reload();
    await expect(page.locator('[data-testid="panel-programas"]')).toBeVisible();
    await page.click('[data-testid="toggle-incluir-inactivos"]');
    await expect(filaFinal.locator('[data-testid="chip-inactivo"]')).toBeVisible({ timeout: 15000 });
    console.log('recarga limpia: el servidor confirma que esta desactivado');
  } finally {
    // Limpieza: dejar el registro como estaba (activo), pase lo que pase.
    await page.unroute('**/catalogos/arbol*');
    await page.reload();
    await expect(page.locator('[data-testid="panel-programas"]')).toBeVisible();
    if (!(await page.locator('[data-testid="toggle-incluir-inactivos"]').isChecked())) {
      await page.click('[data-testid="toggle-incluir-inactivos"]');
    }
    await page.click(`[data-testid="btn-reactivar-programas-${id}"]`);
    await expect(filaFinal.locator('[data-testid="chip-activo"]')).toBeVisible({ timeout: 15000 });
    console.log('limpieza: programa', clave, 'reactivado');
  }
});
