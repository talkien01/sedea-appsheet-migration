// Alta de usuarios en LOTE desde una plantilla CSV (E38b).
//
// Principio rector: este modulo NO tiene reglas de negocio propias. Cada fila
// se valida y se crea con exactamente las mismas funciones que el alta uno por
// uno de E35 (`validarAlta`, `exigirRolAdministrable`, `resolverRegional`,
// `insertarUsuario`, `generarPasswordTemporal`), de modo que un CSV nunca puede
// colar un usuario que el formulario individual habria rechazado.
//
// Lo unico que se agrega aqui es la traduccion de CLAVES legibles (REG-02,
// claves de municipio y de componente) a los ids que espera el resto del
// sistema, porque una plantilla que pidiera ids de base de datos seria
// inutilizable para quien la llena en Excel.
//
// Cada fila es INDEPENDIENTE: corre en su propia transaccion y su fallo no
// arrastra a las demas, igual que el flujo de staging de beneficiarios.
import type { PerfilUsuario, ResultadoFilaLoteUsuario } from '@sedea/shared';
import { consultar } from '../db/pool.js';
import { ErrorApi } from '../plugins/errores.js';
import { generarPasswordTemporal, hashearPassword } from '../servicios/passwords.js';
import { bitacoraEnTransaccion, enTransaccion } from '../servicios/promocion.js';
import { reemplazarAlcance } from '../servicios/alcance.js';
import { existeNombreUsuario, insertarUsuario } from '../db/queries/usuarios.js';
import { error403, error409, error422, exigirRolAdministrable, resolverRegional, validarAlta } from './usuarios.js';
import { generarCsv, parsearCsv } from './csv.js';

/** Columnas de la plantilla, en orden. Es tambien el contrato del parser. */
export const COLUMNAS_LOTE = [
  'usuario',
  'nombre_completo',
  'rol',
  'regional_clave',
  'alcance_municipios',
  'alcance_componentes'
] as const;

/** Separador de las listas dentro de una celda (municipios / componentes). */
const SEPARADOR_LISTA = ';';

/** Tope de filas por archivo: evita que un CSV enorme monopolice el proceso. */
export const MAX_FILAS_LOTE = 500;

/**
 * Fila de ejemplo. Va comentada con `#` en la primera celda a proposito: se
 * descarta al leer, asi que quien descargue la plantilla, la llene y la suba
 * sin borrar el ejemplo no crea un usuario basura.
 */
const FILA_EJEMPLO = [
  '# ejemplo (borra esta línea): juan.perez',
  'Juan Pérez Hernández',
  'ventanilla',
  'REG-02',
  '22009;22010',
  'DIN'
];

/** Plantilla CSV lista para descargar (encabezados + ejemplo comentado). */
export function generarPlantillaLote(): string {
  return generarCsv([...COLUMNAS_LOTE], [FILA_EJEMPLO]);
}

/** El contrato de la respuesta vive en @sedea/shared: backend y PWA lo comparten. */
export type ResultadoFilaLote = ResultadoFilaLoteUsuario;

/** Fila cruda ya mapeada por nombre de columna. */
type FilaLote = Record<(typeof COLUMNAS_LOTE)[number], string>;

/**
 * Convierte el texto del CSV en filas mapeadas por encabezado. Se exige que la
 * primera linea traiga al menos las tres columnas obligatorias; las columnas
 * sobrantes se ignoran y las ausentes quedan vacias, para que un archivo
 * guardado por Excel con columnas extra siga sirviendo.
 */
export function leerFilasLote(texto: string): FilaLote[] {
  const matriz = parsearCsv(texto);
  if (matriz.length === 0) {
    throw error422('csv_vacio', 'El archivo no tiene ninguna fila.');
  }

  const encabezado = matriz[0].map((c) => c.trim().toLowerCase());
  const faltantes = (['usuario', 'nombre_completo', 'rol'] as const).filter(
    (c) => !encabezado.includes(c)
  );
  if (faltantes.length > 0) {
    throw error422(
      'csv_encabezado_invalido',
      `Al archivo le faltan las columnas: ${faltantes.join(', ')}. Descarga la plantilla y vuelve a intentar.`
    );
  }

  const cuerpo = matriz.slice(1).filter((f) => !f[0]?.trim().startsWith('#'));
  if (cuerpo.length === 0) {
    throw error422('csv_vacio', 'El archivo no tiene ninguna fila de usuarios.');
  }
  if (cuerpo.length > MAX_FILAS_LOTE) {
    throw error422(
      'csv_demasiadas_filas',
      `El archivo trae ${cuerpo.length} filas y el máximo por carga es ${MAX_FILAS_LOTE}.`
    );
  }

  return cuerpo.map((celdas) => {
    const fila = {} as FilaLote;
    for (const columna of COLUMNAS_LOTE) {
      const indice = encabezado.indexOf(columna);
      fila[columna] = indice === -1 ? '' : (celdas[indice] ?? '').trim();
    }
    return fila;
  });
}

/** Separa una celda de lista en claves limpias y sin repetidos. */
function clavesDeCelda(celda: string): string[] {
  const claves = celda
    .split(SEPARADOR_LISTA)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return [...new Set(claves)];
}

/**
 * Id que ninguna Regional puede tener. Se usa como marcador de "la clave venia
 * escrita pero no corresponde a ninguna Regional activa". Es positivo a
 * proposito para que pase el esquema Zod del alta y el veredicto lo dicte
 * `resolverRegional`, no este modulo.
 */
const REGIONAL_INEXISTENTE = 2147483647;

/**
 * Traduce la clave de Regional a id. Si la clave viene escrita pero no existe,
 * devuelve el marcador en vez de lanzar: asi `resolverRegional` sigue siendo el
 * UNICO juez de la coherencia rol <-> Regional, y un rol que no lleva Regional
 * recibe `regional_no_aplica` (y no `regional_invalida`), exactamente igual que
 * en el alta individual.
 */
async function resolverClaveRegional(clave: string): Promise<number | null> {
  if (clave.length === 0) return null;
  const filas = await consultar<{ id: string }>(
    'SELECT id FROM direcciones_regionales WHERE upper(clave) = upper($1) AND activo',
    [clave]
  );
  return filas.length === 1 ? Number(filas[0].id) : REGIONAL_INEXISTENTE;
}

/**
 * Traduce claves de municipio a ids. La clave de municipio solo es unica DENTRO
 * de una Regional (`UNIQUE (clave, regional_id)` en 002_catalogos), asi que si
 * la fila trae Regional se busca ahi; sin Regional (ventanilla Central) se
 * busca en todo el estado y una clave ambigua es un error explicito, nunca una
 * eleccion silenciosa.
 */
async function resolverClavesMunicipio(
  claves: string[],
  regionalId: number | null
): Promise<number[]> {
  const ids: number[] = [];
  for (const clave of claves) {
    const filas = await consultar<{ id: string }>(
      regionalId === null
        ? 'SELECT id FROM municipios WHERE upper(clave) = upper($1) AND activo'
        : 'SELECT id FROM municipios WHERE upper(clave) = upper($1) AND activo AND regional_id = $2',
      regionalId === null ? [clave] : [clave, regionalId]
    );
    if (filas.length === 0) {
      throw error422(
        'municipio_invalido',
        `El municipio "${clave}" no existe o está inactivo${regionalId === null ? '' : ' en esa Dirección Regional'}.`
      );
    }
    if (filas.length > 1) {
      throw error422(
        'municipio_ambiguo',
        `La clave de municipio "${clave}" existe en más de una Regional. Indica la Regional en la columna regional_clave.`
      );
    }
    ids.push(Number(filas[0].id));
  }
  return ids;
}

/** Traduce claves de componente a ids (la clave es unica en todo el sistema). */
async function resolverClavesComponente(claves: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const clave of claves) {
    const filas = await consultar<{ id: string }>(
      'SELECT id FROM componentes WHERE upper(clave) = upper($1) AND activo',
      [clave]
    );
    if (filas.length === 0) {
      throw error422(
        'componente_invalido',
        `El componente "${clave}" no existe o está inactivo.`
      );
    }
    ids.push(Number(filas[0].id));
  }
  return ids;
}

/**
 * Procesa UNA fila. Lanza `ErrorApi` con el codigo y el mensaje exactos que
 * habria devuelto el alta individual; quien llama lo convierte en un resultado
 * `error` sin tocar las demas filas.
 */
async function procesarFila(
  actor: PerfilUsuario,
  fila: FilaLote,
  contexto: { ip: string; userAgent: string | null }
): Promise<{ usuario: string; password_temporal: string }> {
  // Mismo payload y misma validacion que E35: lista blanca de claves + Zod.
  const datos = validarAlta({
    usuario: fila.usuario,
    nombre_completo: fila.nombre_completo,
    rol: fila.rol,
    regional_id: await resolverClaveRegional(fila.regional_clave),
    modo_password: 'automatica'
  });

  exigirRolAdministrable(actor.rol, datos.rol);

  if (await existeNombreUsuario(datos.usuario)) {
    throw error409('usuario_duplicado', 'Ya existe un usuario con ese nombre de acceso.');
  }

  const regionalId = await resolverRegional(datos.rol, datos.regional_id);

  // Alcance granular: mismas dos reglas que E48, que es quien lo administra en
  // el alta individual. No se relajan por venir de un CSV.
  const clavesMunicipio = clavesDeCelda(fila.alcance_municipios);
  const clavesComponente = clavesDeCelda(fila.alcance_componentes);
  const traeAlcance = clavesMunicipio.length > 0 || clavesComponente.length > 0;
  if (traeAlcance && datos.rol !== 'ventanilla') {
    throw error422('rol_sin_alcance', 'El alcance solo aplica a usuarios de ventanilla.');
  }
  if (traeAlcance && !actor.rol.split('+').includes('admin')) {
    throw error403('rol_no_autorizado', 'No tienes permiso para ver esta sección.');
  }
  // Celda vacia = "todos" dentro de su Regional (cero filas de alcance).
  const municipios = traeAlcance
    ? await resolverClavesMunicipio(clavesMunicipio, regionalId)
    : [];
  const componentes = traeAlcance ? await resolverClavesComponente(clavesComponente) : [];

  // La cadena en claro solo vive en memoria y en la respuesta HTTP (D27/D29).
  const passwordTemporal = generarPasswordTemporal();
  const hash = hashearPassword(passwordTemporal);

  await enTransaccion(async (cliente) => {
    if (await existeNombreUsuario(datos.usuario, cliente)) {
      throw error409('usuario_duplicado', 'Ya existe un usuario con ese nombre de acceso.');
    }
    const nuevoId = await insertarUsuario(cliente, {
      usuario: datos.usuario,
      nombre_completo: datos.nombre_completo,
      rol: datos.rol,
      regional_id: regionalId,
      password_hash: hash
    });
    if (traeAlcance) {
      await reemplazarAlcance(
        cliente,
        nuevoId,
        municipios.length > 0 ? municipios : 'todos',
        componentes.length > 0 ? componentes : 'todos'
      );
    }
    await bitacoraEnTransaccion(cliente, {
      usuarioId: actor.id,
      accion: 'usuario_creado',
      entidad: 'usuario',
      entidadId: nuevoId,
      // NUNCA se registra la contrasena: solo el modo y el origen.
      detalle: {
        usuario: datos.usuario,
        rol: datos.rol,
        regional_id: regionalId,
        creado_por_rol: actor.rol,
        modo_password: 'automatica',
        origen: 'lote_csv'
      },
      ip: contexto.ip,
      userAgent: contexto.userAgent
    });
  });

  return { usuario: datos.usuario, password_temporal: passwordTemporal };
}

/**
 * Procesa el CSV completo. Nunca lanza por una fila: devuelve un resultado por
 * cada una, en el mismo orden del archivo. El numero de `fila` es el que ve el
 * usuario en Excel (encabezado = 1), para que localizar el error sea trivial.
 */
export async function procesarLote(
  actor: PerfilUsuario,
  texto: string,
  contexto: { ip: string; userAgent: string | null }
): Promise<{ resultados: ResultadoFilaLote[]; creados: number; errores: number }> {
  const filas = leerFilasLote(texto);
  const resultados: ResultadoFilaLote[] = [];

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const numeroFila = i + 2; // +1 por el encabezado, +1 porque Excel cuenta desde 1.
    try {
      const creado = await procesarFila(actor, fila, contexto);
      resultados.push({
        fila: numeroFila,
        usuario: creado.usuario,
        estado: 'creado',
        password_temporal: creado.password_temporal
      });
    } catch (fallo) {
      const api = fallo instanceof ErrorApi ? fallo : null;
      resultados.push({
        fila: numeroFila,
        // Se devuelve tal cual se escribio: si el nombre es el invalido, hay
        // que poder verlo para corregirlo en el archivo.
        usuario: fila.usuario,
        estado: 'error',
        codigo: api?.codigo ?? 'error',
        motivo: api?.message ?? 'No fue posible crear este usuario.'
      });
    }
  }

  return {
    resultados,
    creados: resultados.filter((r) => r.estado === 'creado').length,
    errores: resultados.filter((r) => r.estado === 'error').length
  };
}
