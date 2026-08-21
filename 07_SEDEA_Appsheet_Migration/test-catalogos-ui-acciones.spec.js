// Verificacion del fix de UI de /catalogos: botones de alta con icono, tooltip
// visible en los iconos de accion y columnas de accion alineadas.
// Build 12: el arbol unico se sustituyo por pestanas + tabla ancha, asi que las
// altas y las filas se buscan DENTRO de la pestana que les corresponde.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173';

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
}

/** Pestana donde vive cada entidad tras el rediseno de Build 12. */
const PESTANA_DE = {
  'btn-nuevo-programas': 'tab-programas',
  'btn-nuevo-subprogramas': 'tab-programas',
  'btn-nuevo-componentes': 'tab-componentes',
  'btn-nuevo-modalidades': 'tab-componentes',
  'btn-nuevo-proyectos': 'tab-componentes',
  'btn-nuevo-tipos_apoyo': 'tab-tipos_apoyo'
};

test('barra de herramientas: botones de alta con icono y nombre accesible', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  const esperado = {
    'btn-nuevo-programas': 'Nuevo programa',
    'btn-nuevo-subprogramas': 'Nuevo subprograma',
    'btn-nuevo-componentes': 'Nuevo componente',
    'btn-nuevo-modalidades': 'Nueva modalidad',
    'btn-nuevo-proyectos': 'Nuevo proyecto',
    'btn-nuevo-tipos_apoyo': 'Nuevo concepto'
  };

  for (const [testId, etiqueta] of Object.entries(esperado)) {
    await page.click(`[data-testid="${PESTANA_DE[testId]}"]`);
    const b = page.locator(`[data-testid="${testId}"]`);
    await expect(b).toBeVisible();
    expect((await b.innerText()).trim()).toBe(etiqueta);
    await expect(b).toHaveAttribute('aria-label', etiqueta);
    await expect(b).toHaveAttribute('title', etiqueta);
    expect(await b.locator('svg').count()).toBe(1); // el glifo "+"
    // Nombre accesible completo: sigue resolviendose por rol + nombre.
    await expect(page.getByRole('button', { name: etiqueta })).toHaveCount(1);
  }

  // El grupo de altas de cada pestana va en UNA sola linea (mismo `top`).
  for (const tab of ['tab-programas', 'tab-componentes', 'tab-tipos_apoyo']) {
    await page.click(`[data-testid="${tab}"]`);
    const grupos = page.locator('.catalogos-barra-altas');
    await expect(grupos).toHaveCount(1);
    const tops = await grupos.locator('button').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top))
    );
    console.log(`${tab} tops:`, JSON.stringify(tops));
    expect(new Set(tops).size).toBe(1);
  }
});

test('acciones de fila: 3 columnas alineadas y orden fijo editar|duplicar|desactivar', async ({
  page
}) => {
  test.setTimeout(120000);
  await login(page);

  // Las filas con "Duplicar" (proyectos y conceptos) viven en estas pestanas.
  for (const tab of ['tab-componentes', 'tab-tipos_apoyo']) {
    await page.click(`[data-testid="${tab}"]`);

    // El orden de los botones dentro de .arbol-acciones no cambia (SPEC crit. 533).
    const orden = await page.$$eval('.arbol-acciones', (nodos) =>
      nodos.map((n) =>
        Array.from(n.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'))
      )
    );
    expect(orden.length).toBeGreaterThan(0);
    for (const fila of orden) {
      const tipos = fila.map((t) => t.split('-')[1]);
      const esperado = tipos.filter((t) =>
        ['editar', 'duplicar', 'desactivar', 'reactivar'].includes(t)
      );
      expect(tipos).toEqual(esperado);
      expect(tipos[0]).toBe('editar');
      expect(['desactivar', 'reactivar']).toContain(tipos[tipos.length - 1]);
    }
    await verificarColumnas(page, tab);
  }
});

/** Las tres ranuras de accion caen siempre en la misma X dentro de una pestana. */
async function verificarColumnas(page, tab) {
  // Alineacion: editar siempre en la misma X; desactivar/reactivar siempre en la misma X.
  const xs = await page.evaluate(() => {
    const izq = (sel) =>
      Array.from(document.querySelectorAll(sel)).map((e) =>
        Math.round(e.getBoundingClientRect().left)
      );
    return {
      editar: izq('.arbol-acciones [data-testid^="btn-editar-"]'),
      duplicar: izq('.arbol-acciones [data-testid^="btn-duplicar-"]'),
      estado: izq(
        '.arbol-acciones [data-testid^="btn-desactivar-"], .arbol-acciones [data-testid^="btn-reactivar-"]'
      )
    };
  });
  console.log(`COLUMNAS X (${tab}):`, JSON.stringify({
    editar: [...new Set(xs.editar)],
    duplicar: [...new Set(xs.duplicar)],
    estado: [...new Set(xs.estado)]
  }));
  expect(new Set(xs.editar).size).toBe(1);
  expect(new Set(xs.duplicar).size).toBe(1);
  expect(new Set(xs.estado).size).toBe(1);
  // Duplicar cae entre editar y desactivar.
  expect(xs.duplicar[0]).toBeGreaterThan(xs.editar[0]);
  expect(xs.estado[0]).toBeGreaterThan(xs.duplicar[0]);
}

test('tooltip visible al pasar el cursor sobre Duplicar', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  await page.click('[data-testid="tab-tipos_apoyo"]');
  const dup = page.locator('[data-testid^="btn-duplicar-tipos_apoyo-"]').first();
  await dup.scrollIntoViewIfNeeded();
  await expect(dup).toBeVisible();

  // Contrato de BotonIcono intacto: 1 svg, innerText vacio, aria-label + title.
  expect(await dup.locator('svg').count()).toBe(1);
  expect((await dup.innerText()).trim()).toBe('');
  await expect(dup).toHaveAttribute('aria-label', 'Duplicar');
  await expect(dup).toHaveAttribute('title', 'Duplicar');
  await expect(dup).toHaveAttribute('data-tooltip', 'Duplicar');

  const leer = () =>
    dup.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return { contenido: cs.content, opacidad: cs.opacity, visibilidad: cs.visibility };
    });

  const reposo = await leer();
  console.log('TOOLTIP EN REPOSO:', JSON.stringify(reposo));
  expect(reposo.visibilidad).toBe('hidden');

  await dup.hover();
  await page.waitForTimeout(300);
  const hover = await leer();
  console.log('TOOLTIP EN HOVER:', JSON.stringify(hover));
  expect(hover.contenido).toContain('Duplicar');
  expect(hover.visibilidad).toBe('visible');
  expect(Number(hover.opacidad)).toBe(1);

  await page.screenshot({ path: 'scratchpad/catalogos-despues-tooltip.png' });
});

test('las acciones siguen funcionando: editar, duplicar y alta', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // Alta desde la barra de herramientas de la pestana.
  await page.locator('[data-testid="btn-nuevo-programas"]').click();
  await expect(page.locator('[data-testid="form-catalogo"]')).toBeVisible();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Nuevo');
  await page.locator('[data-testid="btn-cancelar-catalogo"]').click();

  // Editar.
  await page.locator('[data-testid^="btn-editar-programas-"]').first().click();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Editar');
  await page.locator('[data-testid="btn-cancelar-catalogo"]').click();

  // Duplicar: abre alta con aviso de duplicado y clave vacia.
  await page.click('[data-testid="tab-tipos_apoyo"]');
  await page.locator('[data-testid^="btn-duplicar-tipos_apoyo-"]').first().click();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Nuevo');
  await expect(page.locator('[data-testid="aviso-duplicado"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-clave"]')).toHaveValue('');
});
