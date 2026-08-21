// Verificacion del rediseno de /catalogos: pestanas por nivel + tabla ancha.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173';
const SHOTS = 'scratchpad/catalogos-pestanas';

test.use({ viewport: { width: 1440, height: 1000 } });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', 'cambiame123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/catalogos`);
  await expect(page.locator('[data-testid="pantalla-catalogos"]')).toBeVisible();
  await expect(page.locator('[data-testid="arbol-catalogos"]')).toBeVisible();
  // `arbol-catalogos` tambien envuelve la tarjeta "Cargando…": esperar la tabla.
  await expect(page.locator('[data-testid="panel-programas"]')).toBeVisible();
  await expect(page.locator('[data-testid^="nodo-programas-"]').first()).toBeVisible();
}

test('pestanas: cambian de contenido y llevan contador', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  for (const t of ['tab-programas', 'tab-componentes', 'tab-tipos_apoyo']) {
    await expect(page.locator(`[data-testid="${t}"]`)).toBeVisible();
  }

  // Contadores presentes y numericos
  for (const c of ['conteo-programas', 'conteo-componentes', 'conteo-tipos_apoyo']) {
    const txt = (await page.locator(`[data-testid="${c}"]`).innerText()).trim();
    console.log(c, '=', txt);
    expect(Number(txt)).toBeGreaterThanOrEqual(0);
  }

  // --- Pestana Programas (por defecto) ---
  await expect(page.locator('[data-testid="panel-programas"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-programas"]')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(await page.locator('[data-testid^="nodo-programas-"]').count()).toBeGreaterThan(0);
  // Los componentes NO estan en esta pestana
  expect(await page.locator('[data-testid^="nodo-componentes-"]').count()).toBe(0);
  await page.screenshot({ path: `${SHOTS}-programas.png`, fullPage: true });

  // Columna de jerarquia: los subprogramas nombran a su programa padre
  const subs = page.locator('[data-testid^="nodo-subprogramas-"]');
  const nSubs = await subs.count();
  console.log('subprogramas visibles:', nSubs);
  for (let i = 0; i < nSubs; i++) {
    const j = (await subs.nth(i).locator('.celda-jerarquia').innerText()).trim();
    console.log('  jerarquia sub:', j);
    expect(j.startsWith('↳ ')).toBe(true);
  }
  // Un programa raiz no tiene padre
  expect(
    (await page.locator('[data-testid^="nodo-programas-"]').first().locator('.celda-jerarquia').innerText()).trim()
  ).toBe('—');

  // --- Pestana Componentes ---
  await page.click('[data-testid="tab-componentes"]');
  await expect(page.locator('[data-testid="panel-componentes"]')).toBeVisible();
  expect(await page.locator('[data-testid^="nodo-programas-"]').count()).toBe(0);
  expect(await page.locator('[data-testid^="nodo-componentes-"]').count()).toBeGreaterThan(0);
  const proys = page.locator('[data-testid^="nodo-proyectos-"]');
  const nProy = await proys.count();
  console.log('proyectos visibles:', nProy);
  expect(nProy).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(nProy, 5); i++) {
    const j = (await proys.nth(i).locator('.celda-jerarquia').innerText()).trim();
    console.log('  jerarquia proyecto:', j);
    expect(j).toContain('→');
  }
  await page.screenshot({ path: `${SHOTS}-componentes.png`, fullPage: true });

  // --- Pestana Conceptos de apoyo ---
  await page.click('[data-testid="tab-tipos_apoyo"]');
  await expect(page.locator('[data-testid="panel-tipos_apoyo"]')).toBeVisible();
  expect(await page.locator('[data-testid^="nodo-tipos_apoyo-"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-testid^="nodo-componentes-"]').count()).toBe(0);
  await page.screenshot({ path: `${SHOTS}-conceptos.png`, fullPage: true });
});

test('la tabla aprovecha el ancho y no hay columna de formulario fija', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // El formulario NO esta montado hasta que se crea/edita algo.
  await expect(page.locator('[data-testid="form-catalogo"]')).toHaveCount(0);

  const anchos = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="arbol-catalogos"]');
    const tabla = document.querySelector('.tabla-catalogos');
    return { panel: panel.getBoundingClientRect().width, tabla: tabla.getBoundingClientRect().width };
  });
  console.log('ANCHOS:', JSON.stringify(anchos));
  expect(anchos.tabla).toBeGreaterThan(800); // antes vivia en una columna del 40%

  // Abrir alta -> el form aparece como modal
  await page.click('[data-testid="btn-nuevo-programas"]');
  await expect(page.locator('[data-testid="modal-form-catalogo"]')).toBeVisible();
  await expect(page.locator('[data-testid="form-catalogo"]')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}-modal-alta.png` });

  // Cancelar -> se cierra y desaparece del DOM
  await page.click('[data-testid="btn-cancelar-catalogo"]');
  await expect(page.locator('[data-testid="form-catalogo"]')).toHaveCount(0);
});

test('barra de herramientas: buscador, altas y mostrar desactivados', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // Buscador local en programas
  const antes = await page.locator('[data-testid^="nodo-"]').count();
  await page.fill('[data-testid="input-buscar-programas"]', 'zzzzzzz');
  await expect(page.locator('[data-testid="tabla-vacia"]')).toBeVisible();
  await page.fill('[data-testid="input-buscar-programas"]', '');
  expect(await page.locator('[data-testid^="nodo-"]').count()).toBe(antes);

  // Botones de alta por pestana (mismos data-testid de siempre)
  const porPestana = {
    'tab-programas': ['btn-nuevo-programas', 'btn-nuevo-subprogramas'],
    'tab-componentes': ['btn-nuevo-componentes', 'btn-nuevo-modalidades', 'btn-nuevo-proyectos'],
    'tab-tipos_apoyo': ['btn-nuevo-tipos_apoyo']
  };
  for (const [tab, botones] of Object.entries(porPestana)) {
    await page.click(`[data-testid="${tab}"]`);
    for (const b of botones) {
      await expect(page.locator(`[data-testid="${b}"]`)).toBeVisible();
    }
  }

  // "Mostrar desactivados" sigue funcionando (recarga el arbol con inactivos)
  await page.click('[data-testid="tab-programas"]');
  const toggle = page.locator('[data-testid="toggle-incluir-inactivos"]');
  await expect(toggle).toHaveCount(1);
  const conActivos = await page.locator('[data-testid^="nodo-"]').count();
  await toggle.check();
  await page.waitForTimeout(1500);
  const conTodos = await page.locator('[data-testid^="nodo-"]').count();
  console.log('filas activos:', conActivos, ' | con desactivados:', conTodos);
  expect(conTodos).toBeGreaterThanOrEqual(conActivos);
});

test('acciones de fila: orden fijo y alineacion por columna', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  for (const tab of ['tab-programas', 'tab-componentes', 'tab-tipos_apoyo']) {
    await page.click(`[data-testid="${tab}"]`);
    const orden = await page.$$eval('.arbol-acciones', (nodos) =>
      nodos.map((n) => Array.from(n.querySelectorAll('button')).map((b) => b.getAttribute('data-testid')))
    );
    expect(orden.length).toBeGreaterThan(0);
    for (const fila of orden) {
      const tipos = fila.map((t) => t.split('-')[1]);
      expect(tipos[0]).toBe('editar');
      expect(['desactivar', 'reactivar']).toContain(tipos[tipos.length - 1]);
    }

    const xs = await page.evaluate(() => {
      const izq = (sel) =>
        Array.from(document.querySelectorAll(sel)).map((e) =>
          Math.round(e.getBoundingClientRect().left)
        );
      return {
        editar: izq('.arbol-acciones [data-testid^="btn-editar-"]'),
        ultimo: izq(
          '.arbol-acciones [data-testid^="btn-desactivar-"], .arbol-acciones [data-testid^="btn-reactivar-"]'
        )
      };
    });
    console.log(tab, 'X editar unicos:', new Set(xs.editar).size, '| X ultimo unicos:', new Set(xs.ultimo).size);
    expect(new Set(xs.editar).size).toBe(1);
    expect(new Set(xs.ultimo).size).toBe(1);
  }
});

test('editar y desactivar/reactivar siguen funcionando', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // Editar un concepto de apoyo: abre el modal en modo edicion
  await page.click('[data-testid="tab-tipos_apoyo"]');
  const btnEditar = page.locator('[data-testid^="btn-editar-tipos_apoyo-"]').first();
  const id = (await btnEditar.getAttribute('data-testid')).replace('btn-editar-tipos_apoyo-', '');
  await btnEditar.click();
  const form = page.locator('[data-testid="form-catalogo"]');
  await expect(form).toBeVisible();
  await expect(form.locator('h2')).toContainText('Editar');
  await page.click('[data-testid="btn-cancelar-catalogo"]');

  // Desactivar: pide confirmacion en el modal existente, luego reactivar
  const fila = page.locator(`[data-testid="nodo-tipos_apoyo-${id}"]`);
  await page.locator(`[data-testid="btn-desactivar-tipos_apoyo-${id}"]`).click();
  await expect(page.locator('[data-testid="modal-confirmar-baja"]')).toBeVisible();
  await page.click('[data-testid="btn-confirmar-baja"]');
  // La fila desaparece de la lista de activos: senal de que la recarga termino.
  await expect(fila).toHaveCount(0, { timeout: 15000 });

  await page.locator('[data-testid="toggle-incluir-inactivos"]').check();
  await expect(fila.locator('[data-testid="chip-inactivo"]')).toBeVisible({ timeout: 15000 });
  console.log('DESACTIVADO OK:', id);

  await page.locator(`[data-testid="btn-reactivar-tipos_apoyo-${id}"]`).click();
  await expect(fila.locator('[data-testid="chip-activo"]')).toBeVisible({ timeout: 15000 });
  console.log('REACTIVADO OK:', id);
});
