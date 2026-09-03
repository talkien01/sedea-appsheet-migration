// Parseo del texto que trae el codigo QR de la Constancia CURP (RENAPO).
//
// Vive en @sedea/shared porque lo usan los dos lados: la PWA cuando decodifica
// con la camara del propio equipo, y el backend cuando el celular vinculado
// manda el texto crudo del QR (E60). Una sola implementacion, un solo criterio
// de validez.
//
// Formato real confirmado con una constancia de muestra, campos separados por
// `|` y con espacios/comas sobrantes en algunos de ellos:
//
//   CURP_actual|CURP_anterior|paterno|materno|nombre(s)|sexo|nacimiento|entidad|codigo|
//   VAXL660626HGTLXS07|VAXL660626HDFLXS08, |VALLIN| |JOSE LUIS|HOMBRE|26/06/1966|GUANAJUATO|11|
//
// Solo se usan los campos que existen en el formulario de ventanilla: CURP
// actual, nombre completo, sexo y fecha de nacimiento. La CURP anterior y el
// codigo INEGI de la entidad se ignoran a proposito.

/** Datos ya normalizados, listos para volcarse al formulario. */
export interface DatosCurpQr {
  curp: string;
  /** Nombre(s) + apellidos, en mayusculas y sin espacios dobles. */
  nombre_solicitante: string;
  /** 'H' | 'M' | '' — mismos valores que el <select> de sexo. */
  sexo: string;
  /** ISO `YYYY-MM-DD`, el formato que espera <input type="date">. */
  fecha_nacimiento: string;
}

const CAMPOS_MINIMOS = 8;
const PATRON_CURP = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]{2}$/;

/** Quita espacios y comas sobrantes que trae el QR alrededor de cada campo. */
function limpiar(campo: string): string {
  return (campo ?? '').replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').trim();
}

/** Convierte `DD/MM/YYYY` a `YYYY-MM-DD`; cadena vacia si no calza. */
function aFechaIso(texto: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (!m) return '';
  const [, dia, mes, anio] = m;
  return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/** `HOMBRE` -> `H`, `MUJER` -> `M`; vacio si viene otra cosa. */
function aSexo(texto: string): string {
  const t = texto.toUpperCase();
  if (t.startsWith('HOMBRE') || t === 'H') return 'H';
  if (t.startsWith('MUJER') || t === 'M') return 'M';
  return '';
}

/**
 * Parsea el texto del QR de la Constancia CURP.
 * Devuelve `null` si el texto no tiene la forma esperada, para que la pantalla
 * avise y el capturista siga con la captura manual de siempre.
 */
export function parsearQrCurp(texto: string): DatosCurpQr | null {
  if (!texto) return null;
  const campos = texto.split('|').map(limpiar);
  if (campos.length < CAMPOS_MINIMOS) return null;

  const curp = campos[0].toUpperCase();
  if (curp.length !== 18 || !PATRON_CURP.test(curp)) return null;

  const paterno = campos[2].toUpperCase();
  const materno = campos[3].toUpperCase();
  const nombres = campos[4].toUpperCase();
  const nombre_solicitante = [nombres, paterno, materno]
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    curp,
    nombre_solicitante,
    sexo: aSexo(campos[5]),
    fecha_nacimiento: aFechaIso(campos[6])
  };
}

// ============================================================================
// E60: sesion de escaneo con celular vinculado
// ============================================================================
//
// El equipo de ventanilla suele ser un escritorio sin camara util. En vez de
// pedirle al capturista que teclee 18 caracteres, abre una sesion efimera, la
// muestra como QR en pantalla, el capturista la abre con su celular y escanea
// ahi la Constancia. El celular manda SOLO el texto del QR; el servidor lo
// parsea y el navegador de escritorio lo recoge.
//
// El celular NO se autentica: el token de la sesion es la credencial, por eso
// es aleatorio, de un solo uso y de vida corta.

/** Minutos de vida de una sesion desde que se crea. */
export const MINUTOS_VIGENCIA_ESCANEO = 10;

/**
 * Estado de la sesion visto por el escritorio.
 * - `pendiente`: sigue viva y acepta escaneos (0, 1 o varios ya recibidos).
 * - `completada`: se cerro a proposito desde el escritorio ("Terminar
 *   vinculación"). Ya NO admite escaneos nuevos, a diferencia del significado
 *   anterior ("ya recibio un resultado, un solo uso").
 * - `expirada`: se agoto la vigencia de 10 minutos.
 */
export type EstadoSesionEscaneo = 'pendiente' | 'completada' | 'expirada';

/** Respuesta de POST /api/escaneo-curp/sesiones. */
export interface SesionEscaneoCreada {
  token: string;
  expira_en: string;
}

/**
 * Respuesta de GET /api/escaneo-curp/sesiones/:token (sondeo del escritorio).
 * Multi-lectura (E60-v2): `datos` es SIEMPRE el ultimo escaneo recibido (o
 * `null` si ninguno todavia), y `version` sube 1 en cada escaneo nuevo que
 * entrega el celular. El escritorio compara `version` contra la ultima que ya
 * proceso: si subio, hay un dato nuevo que aplicar; si no, sigue esperando.
 */
export interface EstadoSesionEscaneoRespuesta {
  estado: EstadoSesionEscaneo;
  expira_en: string;
  datos: DatosCurpQr | null;
  version: number;
}

/**
 * Cuerpo de POST /api/escaneo-curp/sesiones/:token/resultado (lo manda el
 * celular). Va el texto crudo del QR, no los campos ya parseados: asi el
 * criterio de validez vive en un solo lugar y el celular no puede inventar
 * una CURP que el parser habria rechazado.
 */
export interface ResultadoEscaneoMovilCuerpo {
  texto_qr: string;
}
