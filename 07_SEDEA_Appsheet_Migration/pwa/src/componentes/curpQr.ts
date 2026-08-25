// Parseo del texto que trae el codigo QR de la Constancia CURP (RENAPO).
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
