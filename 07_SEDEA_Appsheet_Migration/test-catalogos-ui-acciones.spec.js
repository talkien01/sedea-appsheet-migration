// Verificacion del fix de UI de /catalogos: cabecera compacta (icono + etiqueta
// corta), tooltip visible en los iconos de accion y columnas de accion alineadas.
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

test('cabecera: botones de alta compactos con icono + etiqueta corta', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  const esperado = {
    'btn-nuevo-programas': ['Programa', 'Nuevo programa'],
    'btn-nuevo-subprogramas': ['Subprograma', 'Nuevo subprograma'],
    'btn-nuevo-componentes': ['Componente', 'Nuevo componente'],
    'btn-nuevo-modalidades': ['Modalidad', 'Nueva modalidad'],
    'btn-nuevo-proyectos': ['Proyecto', 'Nuevo proyecto'],
    'btn-nuevo-tipos_apoyo': ['Concepto', 'Nuevo concepto']
  };

  for (const [testId, [corta, larga]] of Object.entries(esperado)) {
    const b = page.locator(`[data-testid="${testId}"]`);
    await expect(b).toBeVisible();
    expect((await b.innerText()).trim()).toBe(corta);
    await expect(b).toHaveAttribute('aria-label', larga);
    await expect(b).toHaveAttribute('title', larga);
    expect(await b.locator('svg').count()).toBe(1); // el glifo "+"
    // Nombre accesible completo: sigue resolviendose por rol + nombre.
    await expect(page.getByRole('button', { name: larga })).toHaveCount(1);
  }

  // Cada grupo de altas va en UNA sola linea (mismo `top` para todos sus botones).
  const grupos = page.locator('.arbol-encabezado-acciones');
  const n = await grupos.count();
  expect(n).toBe(3);
  for (let i = 0; i < n; i++) {
    const cajas = await grupos.nth(i).locator('button').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top))
    );
    console.log(`GRUPO ${i} tops:`, JSON.stringify(cajas));
    expect(new Set(cajas).size).toBe(1);
  }
});

test('acciones de fila: 3 columnas alineadas y orden fijo editar|duplicar|desactivar', async ({
  page
}) => {
  test.setTimeout(120000);
  await login(page);

  // El orden de los botones dentro de .arbol-acciones no cambia (SPEC crit. 533).
  const orden = await page.$$eval('.arbol-acciones', (nodos) =>
    nodos.map((n) =>
      Array.from(n.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'))
    )
  );
  for (const fila of orden) {
    const tipos = fila.map((t) => t.split('-')[1]);
    const esperado = tipos.filter((t) => ['editar', 'duplicar', 'desactivar', 'reactivar'].includes(t));
    expect(tipos).toEqual(esperado);
    expect(tipos[0]).toBe('editar');
    expect(['desactivar', 'reactivar']).toContain(tipos[tipos.length - 1]);
  }

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
  console.log('COLUMNAS X:', JSON.stringify({
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
});

test('tooltip visible al pasar el cursor sobre Duplicar', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

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

  // Alta desde la cabecera compacta.
  await page.locator('[data-testid="btn-nuevo-programas"]').click();
  await expect(page.locator('[data-testid="form-catalogo"]')).toBeVisible();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Nuevo');

  // Editar.
  await page.locator('[data-testid^="btn-editar-programas-"]').first().click();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Editar');

  // Duplicar: abre alta con aviso de duplicado y clave vacia.
  await page.locator('[data-testid^="btn-duplicar-tipos_apoyo-"]').first().click();
  await expect(page.locator('[data-testid="form-catalogo"] h2')).toContainText('Nuevo');
  await expect(page.locator('[data-testid="aviso-duplicado"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-clave"]')).toHaveValue('');
});
