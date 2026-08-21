// Fixture del modulo de dictamen (SPEC 19.11). IDEMPOTENTE: correrlo dos veces
// deja el mismo estado, no duplica solicitudes.
//
// Deja tres solicitudes contra las que el Evaluator verifica los criterios
// 551-600, usando SOLO endpoints que ya existen (E40, E42 y **E46**): Build 13
// no construye ninguna pieza nueva de subida de archivos.
//
//   S_POS  todas sus filas de solicitud_documentos con archivo, nombres sin
//          `NEG` ni `CURPMAL`            -> pre-dictamen `positivo`
//   S_NEG  todas con archivo, exactamente UNA con `NEG` en el nombre
//                                        -> pre-dictamen `negativo`
//   S_SIN  checklist materializado y CERO archivos
//                                        -> pre-dictamen `negativo` (0 con archivo)
//
// Uso:  npx tsx scripts/fixture-dictamen.ts
// Requiere el backend arriba (API_URL, por defecto http://localhost:3000).

const API = process.env.API_URL ?? 'http://localhost:3000';
const USUARIO = process.env.FIXTURE_USUARIO ?? 'ventanilla2';
const PASSWORD =
  process.env.SEED_VENTANILLA_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? 'cambiame123';

/** Marca que hace reconocible (e idempotente) la solicitud de cada caso. */
const MARCAS = {
  S_POS: 'FIXTURE DICTAMEN POSITIVO',
  S_NEG: 'FIXTURE DICTAMEN NEGATIVO',
  S_SIN: 'FIXTURE DICTAMEN SIN ARCHIVOS'
} as const;

type Caso = keyof typeof MARCAS;

/** CURP valida de prueba; la IA simulada la devuelve tal cual en los docs de CURP/INE. */
const CURP_FIXTURE = 'PEGJ850101HQTRRN08';

let token = '';

async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras = new Headers(opciones.headers);
  if (token) cabeceras.set('Authorization', `Bearer ${token}`);
  if (opciones.body && !(opciones.body instanceof FormData)) {
    cabeceras.set('Content-Type', 'application/json');
  }
  const respuesta = await fetch(`${API}${ruta}`, { ...opciones, headers: cabeceras });
  const texto = await respuesta.text();
  const cuerpo = texto ? JSON.parse(texto) : null;
  if (!respuesta.ok) {
    throw new Error(`${opciones.method ?? 'GET'} ${ruta} -> ${respuesta.status} ${texto}`);
  }
  return cuerpo as T;
}

/** JPEG minimo valido (1x1 px) para poder ejercitar E46 sin archivos externos. */
function jpegMinimo(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64'
  );
}

async function login(): Promise<void> {
  const datos = await api<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: USUARIO, password: PASSWORD })
  });
  token = datos.token;
}

/** Devuelve la solicitud del caso si ya existe (idempotencia). */
async function buscarExistente(caso: Caso): Promise<number | null> {
  const parametros = new URLSearchParams({ q: MARCAS[caso], page_size: '5' });
  const datos = await api<{ data: Array<{ id: number; nombre_solicitante?: string }> }>(
    `/api/solicitudes?${parametros.toString()}`
  );
  return datos.data.length > 0 ? datos.data[0].id : null;
}

async function crearSolicitud(caso: Caso): Promise<number> {
  const catalogos = await api<any>('/api/solicitudes/catalogos');
  const componente = catalogos.componentes[0];
  const proyecto =
    catalogos.proyectos.find((p: any) => p.componente_id === componente.id) ?? catalogos.proyectos[0];
  const ventanilla = catalogos.ventanillas[0];
  const municipio = (catalogos.municipios_captura ?? catalogos.municipios)[0];
  const tipoApoyo = catalogos.tipos_apoyo[0];
  const programa = catalogos.programas[0];

  const cuerpo = {
    programa_id: programa.id,
    componente_id: componente.id,
    proyecto_id: proyecto.id,
    ventanilla_id: ventanilla.id,
    tipo_persona: 'fisica' as const,
    nombre_solicitante: MARCAS[caso],
    curp: CURP_FIXTURE,
    apoyo: {
      descripcion_proyecto: 'Fixture automatico del modulo de dictamen.',
      ubicacion: { municipio_id: municipio.id, localidad: 'Localidad de prueba' }
    },
    conceptos: [
      {
        tipo_apoyo_id: tipoApoyo.id,
        descripcion: 'Concepto de fixture',
        cantidad: 1,
        unidad_medida: tipoApoyo.unidad_medida ?? 'pieza'
      }
    ],
    declaracion_aceptada: true
  };

  const datos = await api<{ solicitud: { id: number; folio: string } }>('/api/solicitudes', {
    method: 'POST',
    body: JSON.stringify(cuerpo)
  });
  return datos.solicitud.id;
}

interface DocumentoFila {
  id: number;
  requisito: string;
  archivo_url: string | null;
}

async function documentos(solicitudId: number): Promise<DocumentoFila[]> {
  // El checklist viaja dentro del detalle de la solicitud (E44).
  const datos = await api<{ documentos: DocumentoFila[] }>(`/api/solicitudes/${solicitudId}`);
  return datos.documentos ?? [];
}

/** Sube un archivo a un documento con E46 (endpoint ya existente, no se toca). */
async function subir(solicitudId: number, docId: number, nombre: string): Promise<void> {
  const formulario = new FormData();
  formulario.append('archivo', new Blob([jpegMinimo()], { type: 'image/jpeg' }), nombre);
  await api(`/api/solicitudes/${solicitudId}/documentos/${docId}/archivo`, {
    method: 'POST',
    body: formulario
  });
}

async function prepararCaso(caso: Caso): Promise<{ caso: Caso; solicitud_id: number; folio?: string }> {
  let solicitudId = await buscarExistente(caso);
  if (solicitudId === null) solicitudId = await crearSolicitud(caso);

  const filas = await documentos(solicitudId);
  if (filas.length === 0) {
    throw new Error(`La solicitud ${solicitudId} (${caso}) no tiene checklist materializado.`);
  }

  if (caso === 'S_SIN') {
    // Nada que subir: el caso es justamente "cero archivos".
    return { caso, solicitud_id: solicitudId };
  }

  for (const [indice, fila] of filas.entries()) {
    if (fila.archivo_url) continue; // ya subido en una corrida anterior
    // En S_NEG exactamente el primer documento lleva `NEG` en el nombre.
    const marcaNegativa = caso === 'S_NEG' && indice === 0;
    const nombre = marcaNegativa ? `documento-NEG-${fila.id}.jpg` : `documento-ok-${fila.id}.jpg`;
    await subir(solicitudId, fila.id, nombre);
  }

  return { caso, solicitud_id: solicitudId };
}

async function principal(): Promise<void> {
  await login();
  const salida = [];
  for (const caso of ['S_POS', 'S_NEG', 'S_SIN'] as Caso[]) {
    salida.push(await prepararCaso(caso));
  }
  console.log(JSON.stringify(salida, null, 2));
}

principal().catch((error) => {
  console.error('Fallo el fixture de dictamen:', (error as Error).message);
  process.exit(1);
});
