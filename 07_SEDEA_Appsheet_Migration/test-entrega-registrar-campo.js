// Verificacion de extremo a extremo de la Parte 2 ("Entregar apoyos"): la
// pantalla de campo del registro de entrega del apoyo.
//
// Se corre con la BIBLIOTECA de Playwright, no con el runner:
//
//     node test-entrega-registrar-campo.js
//
// Es a proposito. Necesita cortar la red a media entrega, volver a conectarla y
// leer IndexedDB en los dos momentos; eso se controla mejor desde Node.
//
// Requisitos de datos (stack levantado con docker compose):
//   - la solicitud del folio PEO-QRO-COR-0001-26 autorizada por el Secretario;
//   - DOS conceptos suyos de tipo_apoyo 13 sin entrega previa, para poder
//     comprobar la pantalla de seleccion de concepto:
//
//     INSERT INTO solicitud_conceptos
//       (solicitud_id, tipo_apoyo_id, orden, descripcion, cantidad, unidad_medida)
//     VALUES (4, 13, 3, 'Olla de 2000 m3 con geomembrana', 1, 'Obra');
//
// El script deja registrada UNA entrega real en `entregas_apoyo`. Para volver a
// correrlo desde cero:  DELETE FROM entregas_apoyo WHERE solicitud_concepto_id = 4;
const { chromium } = require('playwright');

const BASE = 'http://localhost:8081';
const FOLIO = 'PEO-QRO-COR-0001-26';

// JPEG 8x8 real, minimo, para el input de foto.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z',
  'base64'
);

const ok = [];
const fail = [];
function chk(cond, texto) {
  (cond ? ok : fail).push(texto);
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${texto}`);
}

/** Lee una tabla completa de la base Dexie desde el propio navegador. */
function leerTabla(page, tabla) {
  return page.evaluate(
    (nombre) =>
      new Promise((resolver, rechazar) => {
        const s = indexedDB.open('sedea_campo');
        s.onerror = () => rechazar(s.error);
        s.onsuccess = () => {
          const bd = s.result;
          if (!bd.objectStoreNames.contains(nombre)) return resolver(null);
          const tx = bd.transaction(nombre, 'readonly');
          const p = tx.objectStore(nombre).getAll();
          p.onsuccess = () => resolver(p.result.map((r) => ({ ...r, foto: r.foto ? 'blob' : null })));
          p.onerror = () => rechazar(p.error);
        };
      }),
    tabla
  );
}

async function esperar(page, testId, timeout = 20000) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

(async () => {
  const navegador = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const contexto = await navegador.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 20.5888, longitude: -100.3899, accuracy: 12 },
    ignoreHTTPSErrors: true
  });
  const page = await contexto.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  try {
    // ---------------------------------------------------------------- login
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="usuario"]', 'admin');
    await page.fill('input[name="password"]', 'cambiame123');
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    // ------------------------------------------------- menu "Entregar apoyos"
    const menu = await page.locator('[data-testid="nav-entregar-apoyos"]').count();
    chk(menu > 0, 'la entrada de menu "Entregar apoyos" existe para el rol');

    // ------------------------------------------- padron + paquete del evento
    await page.goto(`${BASE}/sync`);
    await page.getByRole('button', { name: /Descargar padrón/i }).click();
    await esperar(page, 'progreso-descarga', 60000);

    // El padron termina cuando el contador local deja de ser 0.
    await page.waitForFunction(
      () => !/:\s*0\s*$/.test(document.querySelector('[data-testid="total-local"]').innerText.trim()),
      { timeout: 120000 }
    );

    await page.goto(`${BASE}/entregas/preparar`);
    await esperar(page, 'entrega-tipo-apoyo');
    // Los catalogos se leen de IndexedDB al montar: se espera a que el select
    // tenga de verdad la opcion del concepto.
    await page.waitForFunction(
      () =>
        !!document.querySelector('[data-testid="entrega-tipo-apoyo"] option[value="13"]'),
      { timeout: 60000 }
    );
    await page.getByTestId('entrega-tipo-apoyo').selectOption('13');
    await page.getByTestId('entrega-descargar').click();
    await esperar(page, 'entrega-mensaje', 30000);
    const conceptos = await leerTabla(page, 'conceptos_entrega');
    console.log('  paquete descargado:', conceptos.length, 'conceptos');

    // --------------------------------------------------- pantalla de campo
    await page.goto(`${BASE}/entregas/registrar`);
    await esperar(page, 'pantalla-registrar-entrega');

    // Modo de campo: sin barra lateral ni barra inferior.
    const lateral = await page.locator('.barra-lateral, [data-testid="nav-beneficiarios"]').count();
    chk(lateral === 0, 'modo de campo: no hay barra lateral ni barra inferior en /entregas/registrar');
    chk(
      (await page.locator('[data-testid="entrega-salir"]').count()) === 1,
      'modo de campo: hay un boton "Salir"'
    );

    const contador0 = await page.getByTestId('entrega-contador').innerText();
    chk(/^0 de \d+ entregas registradas/.test(contador0), `contador inicial visible: "${contador0}"`);

    // -------- (b) folio con 2 conceptos pendientes -> lista de seleccion ----
    const leido = await page.evaluate((f) => window.__sedeaEscanerFolio(f), FOLIO);
    chk(leido === true, 'el seam del escaner acepta el texto del QR (folio)');
    await esperar(page, 'entrega-conceptos');
    const opciones = await page.locator('[data-testid="entrega-conceptos"] > li').count();
    chk(opciones === 2, `folio con 2 conceptos pendientes muestra lista de seleccion (${opciones} opciones)`);
    const textoLista = await page.getByTestId('entrega-conceptos').innerText();
    chk(
      /Olla de 5000 m3/.test(textoLista) && /Olla de 2000 m3/.test(textoLista),
      'la lista nombra los dos conceptos del folio'
    );

    // -------- (a) datos correctos en la confirmacion -----------------------
    await page.getByTestId('entrega-concepto-4').click();
    await esperar(page, 'entrega-confirmacion');
    const nombre = await page.getByTestId('entrega-dato-nombre').innerText();
    const folio = await page.getByTestId('entrega-dato-folio').innerText();
    const concepto = await page.getByTestId('entrega-dato-concepto').innerText();
    const cantidad = await page.getByTestId('entrega-dato-cantidad').innerText();
    console.log(`  confirmacion -> ${nombre} | ${folio} | ${concepto} | ${cantidad}`);
    chk(folio === FOLIO, 'la confirmacion muestra el folio escaneado');
    chk(concepto === 'Olla de 5000 m3 con geomembrana', 'la confirmacion muestra el concepto elegido');
    chk(cantidad === '1 Obra', 'la confirmacion muestra cantidad + unidad de medida');
    chk(nombre.length > 3, 'la confirmacion muestra el nombre del beneficiario');

    // -------- (d) SIN CONEXION: se guarda igual en local --------------------
    await contexto.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await page.getByTestId('entrega-tomar-foto').click();
    await esperar(page, 'entrega-evidencia');
    await page.setInputFiles('[data-testid="input-foto"]', {
      name: 'evidencia.jpg',
      mimeType: 'image/jpeg',
      buffer: JPEG
    });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="entrega-confirmar"]').disabled,
      { timeout: 20000 }
    );
    const coords = await page.getByTestId('coordenadas').innerText();
    chk(/20\.58/.test(coords), `se capturaron coordenadas GPS: ${coords.replace(/\s+/g, ' ')}`);

    await page.getByTestId('entrega-confirmar').click();
    await esperar(page, 'entrega-exito');
    const exitoOffline = await page.getByTestId('entrega-exito').innerText();
    chk(
      /se subirá cuando haya señal/i.test(exitoOffline),
      `sin conexion el mensaje es el correcto: "${exitoOffline}"`
    );

    // -------- (c) quedo en la cola offline y volvio al escaneo --------------
    let entregas = await leerTabla(page, 'entregas');
    chk(entregas.length === 1, 'la entrega quedo en IndexedDB (tabla `entregas`)');
    chk(entregas[0].estado === 'pendiente', `estado en la cola = ${entregas[0].estado}`);
    chk(entregas[0].solicitud_concepto_id === 4, 'la fila local apunta al concepto elegido');
    chk(!!entregas[0].foto, 'la fila local guarda el Blob de la foto');
    chk(
      entregas[0].lat.toFixed(2) === '20.59' && entregas[0].precision_m > 0,
      `la fila local guarda lat/lng/precision (${entregas[0].lat}, ${entregas[0].lng}, ±${entregas[0].precision_m}m)`
    );
    chk(
      /^[0-9a-f-]{36}$/.test(entregas[0].uuid),
      `el uuid se genero en el cliente: ${entregas[0].uuid}`
    );
    chk(
      (await page.locator('[data-testid="entrega-video"]').count()) === 1,
      'la pantalla volvio sola al estado de escaneo, lista para el siguiente'
    );
    const contador1 = await page.getByTestId('entrega-contador').innerText();
    chk(/^1 de /.test(contador1), `el contador avanzo: "${contador1}"`);
    chk(
      (await page.locator('[data-testid="entrega-por-subir"]').count()) === 1,
      'se avisa que hay entregas por subir'
    );

    // -------- (d bis) al reconectar sincroniza sola -------------------------
    await contexto.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // Sondeo desde Node: waitForFunction con predicado async no sirve aqui
    // (una Promesa siempre es "truthy" para el polling).
    const limite = Date.now() + 90000;
    while (Date.now() < limite) {
      entregas = await leerTabla(page, 'entregas');
      if (entregas.every((e) => e.estado === 'sincronizada')) break;
      await page.waitForTimeout(1000);
    }
    entregas = await leerTabla(page, 'entregas');
    chk(entregas[0].estado === 'sincronizada', 'al volver la señal la cola se vacio sola');
    chk(!!entregas[0].foto_url, `el servidor devolvio la url de la foto: ${entregas[0].foto_url}`);
    console.log('  UUID_SINCRONIZADO=' + entregas[0].uuid);

    // -------- el folio ya entregado no se vuelve a ofrecer ------------------
    await page.evaluate((f) => window.__sedeaEscanerFolio(f), FOLIO);
    await esperar(page, 'entrega-confirmacion');
    const concepto2 = await page.getByTestId('entrega-dato-concepto').innerText();
    chk(
      concepto2 === 'Olla de 2000 m3 con geomembrana',
      `re-escanear el folio ofrece solo el concepto que falta: "${concepto2}"`
    );

    // -------- folio que no esta en el paquete: aviso, sin romperse ----------
    await page.getByRole('button', { name: 'No es este' }).click();
    await page.evaluate(() => window.__sedeaEscanerFolio('PEO-XXX-XXX-9999-99'));
    await esperar(page, 'entrega-aviso');
    const aviso = await page.getByTestId('entrega-aviso').innerText();
    chk(/No se encontró/.test(aviso), `folio ajeno al paquete avisa sin romper: "${aviso}"`);
    chk(
      (await page.locator('[data-testid="entrega-video"]').count()) === 1,
      'tras el aviso la camara sigue lista para el siguiente escaneo'
    );

    // -------- fallback manual sin QR ---------------------------------------
    await page.getByTestId('entrega-abrir-busqueda').click();
    await page.getByTestId('entrega-busqueda').fill(FOLIO.slice(0, 11));
    await page.waitForSelector('[data-testid="entrega-resultados"] li button', { timeout: 10000 });
    const nres = await page.locator('[data-testid="entrega-resultados"] li button').count();
    chk(nres >= 1, `la busqueda manual por texto encuentra al beneficiario (${nres} resultado/s)`);
  } catch (e) {
    fail.push('EXCEPCION: ' + e.message);
    console.log('EXCEPCION:', e);
    await page.screenshot({ path: 'fallo-entrega.png', fullPage: true }).catch(() => {});
  } finally {
    console.log(`\n=== ${ok.length} OK, ${fail.length} fallas ===`);
    fail.forEach((f) => console.log('  FALLA:', f));
    await navegador.close();
    process.exit(fail.length ? 1 : 0);
  }
})();
