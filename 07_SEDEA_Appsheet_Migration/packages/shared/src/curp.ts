// Deriva sexo y fecha de nacimiento directamente del CURP (18 caracteres).
//
// Vive aparte de curpQr.ts (que parsea el TEXTO del QR de la Constancia) porque
// esto no necesita ningun QR: el CURP mismo trae esos dos datos codificados
// por ley, en las posiciones 5-10 (fecha) y 11 (sexo). Se usa como respaldo
// cuando una fuente historica (ej. beneficiarios_historicos, importado de
// CATALOGOS) no capturo esos campos por separado, pero si tiene el CURP.
//
// Formato: AAAA AAMMDD S EE CCC H D
//          [0-3] [4-9]  [10] [11-12] [13-15] [16] [17]
// [4-9]  = fecha de nacimiento, 2 digitos de anio + mes + dia (AAMMDD)
// [10]   = sexo: 'H' o 'M'
// [16]   = diferenciador de siglo: RENAPO usa una LETRA aqui para personas
//          nacidas en el 2000 en adelante, y un DIGITO para nacidas antes
//          del 2000 -- es la unica forma de saber el siglo sin ambiguedad.
import { PATRON_CURP } from './solicitudes.js';

export interface DatosDesdeCurp {
  sexo: 'H' | 'M' | null;
  /** ISO `YYYY-MM-DD`, o null si la fecha resulto invalida (mes/dia fuera de rango). */
  fecha_nacimiento: string | null;
}

const SIN_DATOS: DatosDesdeCurp = { sexo: null, fecha_nacimiento: null };

export function datosDesdeCurp(curp: unknown): DatosDesdeCurp {
  const c = String(curp ?? '')
    .trim()
    .toUpperCase();
  if (!PATRON_CURP.test(c)) return SIN_DATOS;

  const sexo = c[10] === 'H' || c[10] === 'M' ? (c[10] as 'H' | 'M') : null;

  const aa = Number(c.slice(4, 6));
  const mm = Number(c.slice(6, 8));
  const dd = Number(c.slice(8, 10));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return { sexo, fecha_nacimiento: null };
  }
  const siglo = /[A-Z]/.test(c[16]) ? 2000 : 1900;
  const anio = siglo + aa;
  const fecha_nacimiento = `${anio}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  return { sexo, fecha_nacimiento };
}
