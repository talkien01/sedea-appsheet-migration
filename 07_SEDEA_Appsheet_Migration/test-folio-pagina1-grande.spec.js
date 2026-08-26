// Verifica que el folio de la PAGINA 1 del Folio de Entrega se vea grande:
//   1. El numero de folio de la pagina 1 tiene un font-size claramente mayor
//      que el texto normal del documento (14px) y que el viejo renglon de 20px.
//   2. No se desborda del ancho util ni se empalma con el cuerpo de 3 columnas.
//   3. La pagina 2 (folio gigante) queda intacta y el PDF sigue en 2 paginas.
//
// Requiere el stack arriba con la PWA reconstruida:
//   docker compose up -d --build pwa
//   npx playwright test test-folio-pagina1-grande.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
const PASSWORD = process.env.SEED_PASSWORD || 'cambiame123';
const SOLICITUD_ID = Number(process.env.SOLICITUD_ID || 4);
// Playwright borra su outputDir al arrancar; si un visor tiene abierto algun
// PDF de una corrida anterior el borrado falla con EBUSY en Windows. Por eso
// la carpeta de evidencia es configurable y puede vivir fuera de test-results.
const SALIDA = process.env.FOLIO_SALIDA
  ? path.resolve(process.env.FOLIO_SALIDA)
  : path.join(__dirname, 'test-results', 'folio-pagina1');

test.use({ viewport: { width: 1440, height: 900 } });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', 'admin');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
}

function paginasPdf(buffer) {
  const texto = buffer.toString('latin1');
  const counts = [...texto.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1])
  );
  if (counts.length > 0) return Math.max(...counts);
  return [...texto.matchAll(/\/Type\s*\/Page[^s]/g)].length;
}

function medidaPdf(buffer) {
  const m = buffer.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return null;
  return { ancho: Math.round(Number(m[1])), alto: Math.round(Number(m[2])) };
}

test.beforeAll(() => fs.mkdirSync(SALIDA, { recursive: true }));

test('el folio de la pagina 1 es grande y no se empalma', async ({ page }) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto(`${BASE}/solicitudes/${SOLICITUD_ID}/folio`);
  await page.waitForSelector('[data-testid="folio-entrega"]', { timeout: 30000 });
  await page.emulateMedia({ media: 'print' });

  const numero = page.getByTestId('folio-numero');
  const m = await numero.evaluate((el) => {
    const cuerpo = document.querySelector('.folio-cuerpo');
    const banner = el.closest('.folio-folio');
    const hoja = document.querySelector('.folio-entrega-print');
    const r = el.getBoundingClientRect();
    return {
      texto: el.textContent.trim(),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      fontFamily: getComputedStyle(el).fontFamily,
      anchoTexto: r.width,
      bannerBottom: banner.getBoundingClientRect().bottom,
      cuerpoTop: cuerpo.getBoundingClientRect().top,
      anchoHoja: hoja.getBoundingClientRect().width,
      altoHoja: hoja.getBoundingClientRect().height,
      // referencia: el texto normal de los bloques de datos
      fontSeccion: parseFloat(
        getComputedStyle(document.querySelector('.folio-seccion p')).fontSize
      )
    };
  });
  console.log('FOLIO EN PAGINA 1 (impresion):', JSON.stringify(m, null, 2));

  // Grande de verdad: mas del triple del texto normal, y muy por encima de
  // los 20px que tenia el renglon anterior.
  expect(m.fontSeccion).toBe(14);
  expect(m.fontSize).toBeGreaterThanOrEqual(48);
  expect(m.fontSize).toBeGreaterThan(m.fontSeccion * 3);

  // No se corta: el numero cabe holgado en el ancho UTIL del papel, no en el
  // del viewport. Carta horizontal con margenes de 10mm: 279.4 - 20 = 259.4mm.
  const ANCHO_UTIL_PX = (259.4 / 25.4) * 96;
  console.log('ANCHO DEL NUMERO:', m.anchoTexto, 'de', ANCHO_UTIL_PX, 'utiles');
  expect(m.anchoTexto).toBeLessThan(ANCHO_UTIL_PX * 0.9);
  // No se empalma: el banner termina antes de que empiece la rejilla.
  expect(m.bannerBottom).toBeLessThanOrEqual(m.cuerpoTop + 0.5);

  // La pagina 1 sigue cabiendo en una hoja Carta horizontal (alto util
  // 215.9mm - 20mm = 195.9mm -> ~740px a 96dpi).
  const ALTO_UTIL_PX = (195.9 / 25.4) * 96;
  console.log('ALTO DE LA PAGINA 1:', m.altoHoja, 'de', ALTO_UTIL_PX, 'disponibles');
  expect(m.altoHoja).toBeLessThan(ALTO_UTIL_PX);

  // --- Regresion de la pagina 2 -------------------------------------------
  const gigante = await page.getByTestId('folio-gigante').evaluate((el) => ({
    texto: el.textContent.trim(),
    fontSize: parseFloat(getComputedStyle(el).fontSize),
    ancho: el.getBoundingClientRect().width,
    saltoPagina: getComputedStyle(el.parentElement).breakBefore
  }));
  console.log('FOLIO GIGANTE PAGINA 2 (regresion):', JSON.stringify(gigante, null, 2));
  expect(gigante.texto).toBe(m.texto);
  expect(gigante.saltoPagina).toBe('page');
  expect(gigante.fontSize).toBeGreaterThan(60);
  // El folio de la pagina 1 es grande, pero el de la pagina 2 sigue mandando.
  expect(gigante.fontSize).toBeGreaterThan(m.fontSize);

  const pdf = await page.pdf({ format: 'Letter', landscape: true, preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(path.join(SALIDA, 'folio-entrega.pdf'), pdf);
  console.log('PDF:', JSON.stringify(medidaPdf(pdf)), 'paginas:', paginasPdf(pdf));
  expect(medidaPdf(pdf)).toEqual({ ancho: 792, alto: 612 });
  expect(paginasPdf(pdf)).toBe(2);

  await page.screenshot({ path: path.join(SALIDA, 'folio-print.png'), fullPage: true });
  await page.emulateMedia({ media: null });
});
