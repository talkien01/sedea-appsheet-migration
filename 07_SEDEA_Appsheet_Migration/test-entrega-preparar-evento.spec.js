// Verificacion como usuario real de la Parte 1 del Registro de entrega:
// la precarga offline del evento efectivamente deja los datos en IndexedDB.
//
// Lo que importa comprobar aqui no es el HTML, sino que despues de pulsar el
// boton la base local del navegador tiene los conceptos por entregar, con la
// forma exacta que la pantalla de campo (Parte 2) va a consumir.
const { test, expect } = require('@playwright/test');

const BASE = process.env.PWA_URL || 'http://localhost:8081';
// Concepto 13 de la solicitud 4: el que sigue pendiente despues de que se
// entrego el concepto 16 de esa MISMA solicitud (entregas independientes).
const TIPO_APOYO = process.env.TIPO_APOYO_ID || '13';

async function entrar(page, usuario, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="usuario"]', usuario);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
}

/** Lee una tabla completa de la base Dexie desde el propio navegador. */
async function leerTabla(page, tabla) {
  return page.evaluate(
    (nombre) =>
      new Promise((resolver, rechazar) => {
        const solicitud = indexedDB.open('sedea_campo');
        solicitud.onerror = () => rechazar(solicitud.error);
        solicitud.onsuccess = () => {
          const bd = solicitud.result;
          if (!bd.objectStoreNames.contains(nombre)) return resolver(null);
          const tx = bd.transaction(nombre, 'readonly');
          const pedido = tx.objectStore(nombre).getAll();
          pedido.onsuccess = () => resolver(pedido.result);
          pedido.onerror = () => rechazar(pedido.error);
        };
      }),
    tabla
  );
}

test('el paquete del evento de entrega queda guardado en IndexedDB', async ({ page }) => {
  await entrar(page, 'admin', 'cambiame123');

  // El padron/catalogos primero: el selector de concepto se llena desde la
  // tabla local de catalogos, igual que el resto de la app de campo.
  await page.goto(`${BASE}/sync`);
  await page.getByRole('button', { name: /Descargar padrón/i }).click();
  await expect(page.getByTestId('progreso-descarga')).toBeVisible({ timeout: 60000 });

  await page.goto(`${BASE}/entregas/preparar`);
  await expect(page.getByTestId('entrega-tipo-apoyo')).toBeVisible({ timeout: 20000 });

  // Antes de descargar no hay nada local.
  await expect(page.getByTestId('entrega-total-local')).toContainText('0');

  await page.getByTestId('entrega-tipo-apoyo').selectOption(TIPO_APOYO);
  await page.getByTestId('entrega-descargar').click();
  await expect(page.getByTestId('entrega-mensaje')).toBeVisible({ timeout: 30000 });

  // 1) Lo que ve el usuario.
  await expect(page.getByTestId('entrega-total-local')).not.toContainText('guardados: 0');

  // 2) Lo que de verdad quedo en el navegador.
  const conceptos = await leerTabla(page, 'conceptos_entrega');
  expect(Array.isArray(conceptos)).toBe(true);
  expect(conceptos.length).toBeGreaterThan(0);

  const uno = conceptos[0];
  // Forma del registro que consumira la Parte 2.
  for (const campo of [
    'solicitud_concepto_id',
    'solicitud_id',
    'folio',
    'beneficiario_nombre',
    'curp',
    'tipo_apoyo_id',
    'tipo_apoyo_nombre',
    'cantidad',
    'unidad_medida'
  ]) {
    expect(uno, `falta el campo ${campo}`).toHaveProperty(campo);
  }
  expect(typeof uno.solicitud_concepto_id).toBe('number');
  expect(typeof uno.folio).toBe('string');

  // 3) Metadatos del paquete (registro unico id = 1).
  const evento = await leerTabla(page, 'evento_entrega');
  expect(evento.length).toBe(1);
  expect(evento[0].id).toBe(1);
  expect(evento[0].total).toBe(conceptos.length);
  expect(evento[0].tipo_apoyo_id).toBe(Number(TIPO_APOYO));
  expect(evento[0].descargado_en).toBeTruthy();

  // 4) Los conceptos ya entregados NO viajan en el paquete: el concepto 5
  //    (tipo 16 de la misma solicitud) ya se entrego y no debe aparecer.
  expect(conceptos.some((c) => c.solicitud_concepto_id === 5)).toBe(false);

  // 5) Persiste al recargar: es lo que lo hace util sin señal. (Va en el mismo
  //    test a proposito: cada test de Playwright estrena contexto y perderia
  //    la base local.)
  await page.reload();
  await expect(page.getByTestId('entrega-total-local')).toContainText(String(conceptos.length), {
    timeout: 20000
  });
});
