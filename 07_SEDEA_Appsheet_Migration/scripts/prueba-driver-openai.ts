/**
 * Prueba del driver `openai_compatible` del pre-dictamen SIN gastar API real:
 * se inyecta un `fetch` stub que captura la peticion y devuelve una respuesta
 * de Chat Completions fabricada.
 *
 *   npx tsx scripts/prueba-driver-openai.ts
 *
 * Verifica:
 *   1. disponible() === false sin PREDICTAMEN_API_KEY / PREDICTAMEN_API_BASE_URL
 *      (es el criterio del 503 ia_no_configurada de la ruta E55).
 *   2. La peticion va a `${BASE_URL}/chat/completions` con Bearer, modelo,
 *      system prompt y bloque `image_url` con data URI.
 *   3. La respuesta del modelo se normaliza al mismo VeredictoIa que devuelven
 *      los drivers `simulado` y `anthropic`.
 */
process.env.DATABASE_URL ??= 'postgres://x:x@127.0.0.1:5432/x';
process.env.JWT_SECRET ??= 'secreto-de-pruebas-1234567890';

const { DriverOpenAiCompatible } = await import('../backend/src/servicios/ia/cliente.js');
const { config } = await import('../backend/src/config.js');

let fallos = 0;
function comprobar(nombre: string, condicion: boolean, extra = ''): void {
  console.log(`${condicion ? 'OK  ' : 'FALLA'} ${nombre}${extra ? ` -> ${extra}` : ''}`);
  if (!condicion) fallos++;
}

const mutable = config as unknown as Record<string, string>;

// --- 1. No configurado -------------------------------------------------------
mutable.predictamenApiKey = '';
mutable.predictamenApiBaseUrl = '';
comprobar('sin key ni base url -> disponible() false', !new DriverOpenAiCompatible().disponible());

mutable.predictamenApiBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
comprobar('con base url pero sin key -> disponible() false', !new DriverOpenAiCompatible().disponible());

mutable.predictamenApiKey = 'sk-de-prueba';
comprobar('con key y base url -> disponible() true', new DriverOpenAiCompatible().disponible());

// --- 2 y 3. Llamada con fetch stub ------------------------------------------
mutable.predictamenModelo = 'qwen-vl-max';

let urlVista = '';
let cuerpoVisto: any = null;
let headersVistos: any = null;

const fetchStub = (async (url: any, init: any) => {
  urlVista = String(url);
  headersVistos = init.headers;
  cuerpoVisto = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '```json\n{"presente":true,"legible":true,"curp_coincide":true,' +
              '"curp_leida":"AAAA000101HQTXXX01","observacion":"Identificación legible."}\n```'
          }
        }
      ]
    })
  };
}) as unknown as typeof fetch;

const veredicto = await new DriverOpenAiCompatible(fetchStub).evaluarDocumento({
  contenido: Buffer.from('imagen-falsa'),
  mediaType: 'image/jpeg',
  archivoNombre: 'ine.jpg',
  archivoHash: null,
  contexto: {
    requisito: 'Identificación oficial',
    curpCapturada: 'AAAA000101HQTXXX01',
    tipoPersona: 'fisica',
    folio: 'SOL-0001'
  }
});

comprobar(
  'url = base + /chat/completions',
  urlVista === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  urlVista
);
comprobar('header Authorization Bearer', headersVistos.authorization === 'Bearer sk-de-prueba');
comprobar('modelo enviado', cuerpoVisto.model === 'qwen-vl-max', cuerpoVisto.model);
comprobar('mensaje system presente', cuerpoVisto.messages[0].role === 'system');
comprobar(
  'bloque image_url con data URI',
  cuerpoVisto.messages[1].content[0].type === 'image_url' &&
    String(cuerpoVisto.messages[1].content[0].image_url.url).startsWith('data:image/jpeg;base64,')
);
comprobar(
  'bloque de texto con el requisito',
  String(cuerpoVisto.messages[1].content[1].text).includes('Identificación oficial')
);
comprobar('temperature 0', cuerpoVisto.temperature === 0);

comprobar('veredicto.presente', veredicto.presente === true);
comprobar('veredicto.legible', veredicto.legible === true);
comprobar('veredicto.curp_coincide', veredicto.curp_coincide === true);
comprobar('veredicto.curp_leida', veredicto.curp_leida === 'AAAA000101HQTXXX01');
comprobar('veredicto.observacion', typeof veredicto.observacion === 'string');

// --- 4. Error HTTP del proveedor --------------------------------------------
const fetchError = (async () => ({
  ok: false,
  status: 401,
  text: async () => '{"error":"invalid api key"}'
})) as unknown as typeof fetch;

let lanzo = false;
try {
  await new DriverOpenAiCompatible(fetchError).evaluarDocumento({
    contenido: Buffer.from('x'),
    mediaType: 'image/png',
    archivoNombre: null,
    archivoHash: null,
    contexto: { requisito: 'CURP', curpCapturada: null, tipoPersona: 'fisica', folio: 'SOL-2' }
  });
} catch {
  lanzo = true;
}
comprobar('respuesta 401 del proveedor -> lanza error', lanzo);

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} comprobacion(es) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
