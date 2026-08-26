// Verificacion del rediseno del Folio de Entrega (pwa/src/componentes/FolioEntrega.tsx):
//   1. La pagina 1 lista los conceptos con cantidad + unidad, sin dinero.
//   2. Se imprime en Carta horizontal y el PDF sale de 2 paginas.
//   3. La pagina 2 lleva SOLO el folio, en grande y sin cortarse.
//   4. La caratula de expediente (DetalleSolicitud) sigue en A4 vertical.
//
// Requiere el stack arriba con la PWA reconstruida:
//   docker compose up -d --build pwa
//   npx playwright test test-folio-entrega-carta.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const PASSWORD = process.env.SEED_PASSWORD || 'cambiame123';
// Solicitud real con DOS conceptos distintos (olla de agua + cercado).
const SOLICITUD_ID = Number(process.env.SOLICITUD_ID || 4);
const SALIDA = path.join(__dirname, 'test-results', 'folio-entrega');

test.use({ viewport: { width: 1440, height: 900 } });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
}

/** Dimensiones en puntos de la primera MediaBox del PDF. */
function medidaPdf(buffer) {
  const m = buffer.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return null;
  return { ancho: Math.round(Number(m[1])), alto: Math.round(Number(m[2])) };
}

/** Todos los @page vigentes, en orden de cascada. */
function reglasPage() {
  const encontradas = [];
  for (const hoja of document.styleSheets) {
    let reglas;
    try {
      reglas = hoja.cssRules;
    } catch {
      continue;
    }
    for (const r of reglas) {
      if (r.conditionText && r.conditionText.includes('print')) {
        for (const sub of r.cssRules || []) {
          if (/@page/.test(sub.cssText)) encontradas.push(sub.cssText);
        }
      }
    }
  }
  return encontradas;
}

/** Numero de paginas del PDF, leido del /Count del nodo Pages del arbol. */
function paginasPdf(buffer) {
  const texto = buffer.toString('latin1');
  const counts = [...texto.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1])
  );
  if (counts.length > 0) return Math.max(...counts);
  return [...texto.matchAll(/\/Type\s*\/Page[^s]/g)].length;
}

test.beforeAll(() => fs.mkdirSync(SALIDA, { recursive: true }));

test('folio de entrega: conceptos, Carta horizontal y pagina 2 con folio gigante', async ({
  page
}) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto(`${BASE}/solicitudes/${SOLICITUD_ID}/folio`);
  await page.waitForSelector('[data-testid="folio-entrega"]', { timeout: 30000 });

  // --- 1. Conceptos con cantidad + unidad, y NADA de dinero -----------------
  const filas = page.locator('[data-testid="folio-concepto"]');
  await expect(filas).toHaveCount(2);
  const conceptos = [];
  for (let i = 0; i < 2; i++) {
    conceptos.push({
      nombre: (await filas.nth(i).locator('td').first().innerText()).trim(),
      cantidad: (await filas.nth(i).getByTestId('folio-cantidad').innerText()).trim(),
      unidad: (await filas.nth(i).getByTestId('folio-unidad').innerText()).trim()
    });
  }
  console.log('CONCEPTOS EN EL FOLIO:', JSON.stringify(conceptos, null, 2));
  // Los dos conceptos son distintos y cada uno trae su cantidad y su unidad.
  expect(conceptos[0].nombre).not.toBe(conceptos[1].nombre);
  for (const c of conceptos) {
    expect(c.cantidad).toMatch(/^[\d.,]+$/);
    expect(c.unidad.length).toBeGreaterThan(0);
    expect(c.unidad).not.toBe('—');
  }
  // La cantidad no debe salir como "1.000" (se leeria como mil).
  expect(conceptos.map((c) => c.cantidad)).toEqual(['1', '400']);

  // Ni un signo de peso ni "MXN" en todo el documento.
  const textoDoc = await page.locator('[data-testid="folio-entrega"]').innerText();
  expect(textoDoc).not.toMatch(/\$/);
  expect(textoDoc).not.toMatch(/MXN/i);
  expect(textoDoc).not.toMatch(/Monto/i);

  // --- 2. Impresion: Carta horizontal, 2 paginas ---------------------------
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', landscape: true, printBackground: true });
  fs.writeFileSync(path.join(SALIDA, 'folio-entrega.pdf'), pdf);
  const nPaginas = paginasPdf(pdf);
  console.log('PAGINAS DEL PDF:', nPaginas);
  expect(nPaginas).toBe(2);

  // El @page del componente pide Carta horizontal y, por orden de cascada,
  // gana sobre el A4 compartido de styles/impresion.css.
  const paginas = await page.evaluate(reglasPage);
  console.log('@PAGE VIGENTES EN LA PANTALLA DEL FOLIO:', JSON.stringify(paginas, null, 2));
  expect(paginas.length).toBe(2);
  expect(paginas[0]).toMatch(/a4/i); // el compartido, primero en la cascada
  expect(paginas[1]).toMatch(/letter/i); // el del componente, gana
  expect(paginas[1]).toMatch(/landscape/i);

  // Prueba de fuego: dejando que el CSS mande (preferCSSPageSize), el PDF
  // debe salir en Carta horizontal (792 x 612 pt), no en A4 vertical.
  const pdfCss = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(path.join(SALIDA, 'folio-entrega-cssPageSize.pdf'), pdfCss);
  const medida = medidaPdf(pdfCss);
  console.log('MEDIDA DEL PDF CON preferCSSPageSize:', JSON.stringify(medida));
  expect(medida).toEqual({ ancho: 792, alto: 612 });
  expect(paginasPdf(pdfCss)).toBe(2);

  // --- 3. Pagina 2: solo el folio, grande y sin cortarse -------------------
  const pagina2 = page.getByTestId('folio-pagina2');
  const gigante = page.getByTestId('folio-gigante');
  // Contiene el folio y nada mas.
  const folio = (await gigante.innerText()).trim();
  expect((await pagina2.innerText()).trim()).toBe(folio);
  expect(folio).toMatch(/^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}$/);

  const medidas = await gigante.evaluate((el) => ({
    fontSize: getComputedStyle(el).fontSize,
    fontFamily: getComputedStyle(el).fontFamily,
    ancho: el.getBoundingClientRect().width,
    saltoPagina: getComputedStyle(el.parentElement).breakBefore
  }));
  console.log('FOLIO GIGANTE (impresion):', JSON.stringify(medidas, null, 2));
  expect(medidas.saltoPagina).toBe('page');
  // Muy por encima del texto normal del documento (14px).
  expect(parseFloat(medidas.fontSize)).toBeGreaterThan(60);

  await page.screenshot({ path: path.join(SALIDA, 'folio-print.png'), fullPage: true });
  await page.emulateMedia({ media: null });
});

test('el folio gigante no se corta con folios mas largos', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto(`${BASE}/solicitudes/${SOLICITUD_ID}/folio`);
  await page.waitForSelector('[data-testid="folio-gigante"]', { timeout: 30000 });
  await page.emulateMedia({ media: 'print' });

  // Ancho util real de la hoja Carta horizontal con margenes de 10mm:
  // 279.4mm - 20mm = 259.4mm -> a 96dpi son 259.4 / 25.4 * 96 px.
  const ANCHO_UTIL_PX = (259.4 / 25.4) * 96;

  // Largos posibles del folio segun backend/src/servicios/folios.ts:
  // {prefijo}-{regional}-{municipio}-{consecutivo}-{anio}. Hoy todos los
  // folios de la BD miden 19 (prefijo y claves de 3, consecutivo a 4 digitos),
  // asi que los casos mas largos se construyen con las mismas reglas: un
  // prefijo de proyecto mas largo y un consecutivo de 5-6 digitos.
  const casos = [
    'PEO-QRO-COR-0001-26', // real, 19
    'PEO-SJR-AME-0001-26', // real, 19
    'PEO-QRO-COR-12345-26', // consecutivo desbordado, 20
    'PROAGRO-JAL-AME-123456-26' // prefijo largo + consecutivo largo, 25
  ];

  const resultados = [];
  for (const folio of casos) {
    const m = await page.evaluate((f) => {
      const cont = document.querySelector('[data-testid="folio-pagina2"]');
      const el = document.querySelector('[data-testid="folio-gigante"]');
      el.textContent = f;
      cont.style.setProperty('--folio-chars', String(f.length));
      return {
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        ancho: el.getBoundingClientRect().width
      };
    }, folio);
    resultados.push({ folio, largo: folio.length, ...m, anchoUtil: ANCHO_UTIL_PX });
  }
  console.log('AJUSTE POR LARGO DE FOLIO:', JSON.stringify(resultados, null, 2));

  for (const r of resultados) {
    // No se corta: cabe en el ancho util de la hoja.
    expect(r.ancho).toBeLessThan(r.anchoUtil);
    // Y sigue siendo "gigante": aprovecha al menos el 60% del ancho.
    expect(r.ancho).toBeGreaterThan(r.anchoUtil * 0.6);
  }
  await page.emulateMedia({ media: null });
});

test('regresion: la caratula de expediente sigue en A4 vertical y sin folio gigante', async ({
  page
}) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto(`${BASE}/solicitudes/${SOLICITUD_ID}`);
  await page.waitForSelector('[data-testid="caratula-imprimible"]', {
    state: 'attached',
    timeout: 30000
  });
  await page.emulateMedia({ media: 'print' });

  // En la pantalla del detalle no existe el folio gigante ni el @page Carta.
  await expect(page.getByTestId('folio-gigante')).toHaveCount(0);
  await expect(page.getByTestId('folio-pagina2')).toHaveCount(0);

  const paginas = await page.evaluate(reglasPage);
  console.log('@PAGE ACTIVOS EN LA CARATULA:', JSON.stringify(paginas));
  // El unico @page vigente es el A4 compartido de styles/impresion.css: el
  // override Carta del folio se fue del DOM al desmontarse esa ruta.
  expect(paginas.length).toBe(1);
  expect(paginas[0]).toMatch(/a4/i);
  expect(paginas.join(' ')).not.toMatch(/landscape/i);
  expect(paginas.join(' ')).not.toMatch(/letter/i);

  // Dejando mandar al CSS, la caratula sale en A4 vertical (595 x 842 pt).
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(path.join(SALIDA, 'caratula-a4.pdf'), pdf);
  const medida = medidaPdf(pdf);
  console.log('MEDIDA DEL PDF DE LA CARATULA:', JSON.stringify(medida));
  expect(medida).toEqual({ ancho: 595, alto: 842 });
  await page.emulateMedia({ media: null });
});
