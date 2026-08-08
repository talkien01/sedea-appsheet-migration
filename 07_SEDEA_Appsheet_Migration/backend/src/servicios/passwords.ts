// Generacion de contrasenas temporales (10.4).
// La cadena en claro solo existe en memoria durante la peticion y en el cuerpo
// de la respuesta HTTP: nunca se persiste, nunca se registra en la bitacora.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  ALFABETO_PASSWORD_TEMPORAL,
  LONGITUD_PASSWORD_TEMPORAL,
  validarFuerzaPassword
} from '@sedea/shared';

/** Coste de bcrypt usado en todo el proyecto. */
export const COSTE_BCRYPT = 10;

/**
 * Devuelve un caracter aleatorio del alfabeto sin sesgo de modulo: se descartan
 * los bytes >= 256 - (256 % longitud) para que todos los simbolos sean
 * equiprobables. Nunca se usa Math.random.
 */
function caracterAleatorio(alfabeto: string): string {
  const limite = 256 - (256 % alfabeto.length);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < limite) return alfabeto[byte % alfabeto.length];
  }
}

/**
 * Genera una contrasena temporal de 14 caracteres con el alfabeto sin
 * ambiguos. Se regenera hasta que cumple la propia politica (al menos una
 * letra y un digito), de modo que el usuario pueda iniciar sesion con ella.
 */
export function generarPasswordTemporal(): string {
  for (let intento = 0; intento < 50; intento++) {
    let candidata = '';
    for (let i = 0; i < LONGITUD_PASSWORD_TEMPORAL; i++) {
      candidata += caracterAleatorio(ALFABETO_PASSWORD_TEMPORAL);
    }
    if (validarFuerzaPassword(candidata) === null) return candidata;
  }
  // Practicamente inalcanzable; se prefiere fallar a devolver algo debil.
  throw new Error('No fue posible generar una contrasena temporal valida.');
}

/** Hash bcrypt (coste 10), la unica representacion que se persiste. */
export function hashearPassword(password: string): string {
  return bcrypt.hashSync(password, COSTE_BCRYPT);
}

/** Comparacion de una contrasena en claro contra su hash. */
export function verificarPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
