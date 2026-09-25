// Prueba guiada desde el propio telefono: separa "la red/POST falla" de "las
// fotos guardadas estan danadas". Caso Jose Antonio (iPhone, 122 entregas):
// aparece "En linea" y baja el padron (GET), pero las subidas fallan con "No hay
// conexion con el servidor" sin llegar al servidor.
import { URL_API } from '../api/cliente';
import { db } from '../db/indexeddb';
import { obtenerSesion } from '../db/repositorios';
import { copiarBlobEnMemoria } from '../utilidades/copiarBlob';

export interface LineaPrueba {
  ok: boolean;
  texto: string;
}

async function medir(nombre: string, trabajo: () => Promise<string>): Promise<LineaPrueba> {
  const t0 = Date.now();
  try {
    const detalle = await trabajo();
    return { ok: true, texto: `${nombre}: OK (${Date.now() - t0} ms)${detalle ? ' — ' + detalle : ''}` };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, texto: `${nombre}: FALLA tras ${Date.now() - t0} ms — ${msg}` };
  }
}

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`sin respuesta en ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** POST multipart pequeno/mediano con datos invalidos: el servidor debe contestar 422 (= llego y respondio). */
async function postMultipart(
  bytes: number,
  token: string | null,
  fotoReal?: Blob
): Promise<string> {
  const f = new FormData();
  f.append('uuid', 'prueba-no-valido');
  f.append(
    'foto',
    fotoReal ?? new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    'prueba.jpg'
  );
  const r = await conTope(
    fetch(`${URL_API}/entregas`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: f
    }),
    30_000
  );
  // 422 = el servidor la recibio y la rechazo por datos (lo esperado). 401/403 = sesion/permiso.
  return `respuesta HTTP ${r.status}${r.status === 422 ? ' (esperado: llego al servidor)' : ''}`;
}

export async function ejecutarPruebaConexion(): Promise<LineaPrueba[]> {
  const out: LineaPrueba[] = [];
  const token = (await obtenerSesion())?.token ?? null;

  out.push(
    await medir('1. Servidor responde (GET)', async () => {
      const r = await conTope(fetch(`${URL_API}/health`, { cache: 'no-store' }), 15_000);
      return `HTTP ${r.status}`;
    })
  );
  out.push(await medir('2. Envio POST pequeno (1 KB)', () => postMultipart(1024, token)));
  out.push(await medir('3. Envio POST de 500 KB', () => postMultipart(500 * 1024, token)));
  out.push(await medir('4. Envio POST de 1 MB', () => postMultipart(1024 * 1024, token)));

  // 6/7. La MISMA subida, con una foto real guardada: tal cual (como hacia el
  // envio hasta ahora) y copiada a memoria (como hace ahora).
  const primera = await db.entregas
    .where('estado')
    .anyOf('pendiente', 'error', 'sincronizando')
    .filter((e) => !!e.foto)
    .first();
  if (primera?.foto) {
    const foto = primera.foto;
    out.push(
      await medir(`6. POST con foto guardada TAL CUAL (${Math.round(foto.size / 1024)} KB)`, () =>
        postMultipart(0, token, foto)
      )
    );
    out.push(
      await medir('7. POST con esa foto COPIADA A MEMORIA', async () =>
        postMultipart(0, token, await copiarBlobEnMemoria(foto))
      )
    );
  }

  // 5. Las fotos guardadas se pueden LEER? (iOS puede borrar el archivo detras de un Blob)
  const entregas = await db.entregas.where('estado').anyOf('pendiente', 'error', 'sincronizando').limit(15).toArray();
  let ok = 0;
  let primerError = '';
  for (const e of entregas) {
    try {
      if (!e.foto) throw new Error('sin foto');
      const buf = await conTope(e.foto.arrayBuffer(), 10_000);
      if (buf.byteLength !== e.foto.size) throw new Error(`leyo ${buf.byteLength} de ${e.foto.size} bytes`);
      ok++;
    } catch (err) {
      if (!primerError) primerError = `${e.uuid.slice(0, 8)}: ${err instanceof Error ? err.message : err}`;
    }
  }
  out.push({
    ok: ok === entregas.length,
    texto: `5. Leer fotos guardadas: ${ok} de ${entregas.length} se leen bien${primerError ? ` — 1er fallo ${primerError}` : ''}`
  });
  return out;
}
