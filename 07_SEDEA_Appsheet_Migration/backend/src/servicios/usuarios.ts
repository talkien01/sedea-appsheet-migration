// Reglas de negocio de la administracion de usuarios (E35-E38).
// Aqui viven la lista blanca de campos, las validaciones de rol/Regional, el
// diff para la bitacora y las protecciones del ultimo administrador.
// Las rutas solo orquestan; toda mutacion corre dentro de una transaccion.
import type { PoolClient } from 'pg';
import {
  CLAVES_ALTA_USUARIO,
  CLAVES_EDICION_USUARIO,
  esquemaCrearUsuario,
  esquemaEditarUsuario,
  validarPasswordManual,
  type CambioUsuario,
  type ModoPassword
} from '@sedea/shared';
import { ErrorApi } from '../plugins/errores.js';
import { contarAdminsActivos, regionalValida } from '../db/queries/usuarios.js';

/** Errores con el codigo exacto del contrato (10.7.1). */
export const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);
export const error409 = (codigo: string, mensaje: string) => new ErrorApi(409, codigo, mensaje);
export const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
export const error404 = (codigo: string, mensaje: string) => new ErrorApi(404, codigo, mensaje);

/**
 * Rechaza de forma atomica cualquier clave fuera de la lista blanca. Se
 * prefiere el fallo ruidoso al descarte silencioso: si alguien intenta colar
 * `password`, `activo` o `debe_cambiar_password` por esta via, no se escribe
 * nada y el intento queda visible en la respuesta.
 */
export function exigirClavesPermitidas(cuerpo: unknown, permitidas: readonly string[]): Record<string, unknown> {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw error422('payload_invalido', 'Datos inválidos.');
  }
  const claves = Object.keys(cuerpo as Record<string, unknown>);
  const invalidas = claves.filter((c) => !permitidas.includes(c));
  if (invalidas.length > 0) {
    throw error422(
      'campo_no_editable',
      `Los campos ${invalidas.join(', ')} no se pueden modificar por esta vía.`
    );
  }
  return cuerpo as Record<string, unknown>;
}

/** Valida el payload de alta (E35). */
export function validarAlta(cuerpo: unknown) {
  const crudo = exigirClavesPermitidas(cuerpo, CLAVES_ALTA_USUARIO);
  const parseado = esquemaCrearUsuario.safeParse(crudo);
  if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');
  return parseado.data;
}

/**
 * Resuelve la contrasena inicial de un alta o un reset segun el modo (11.5).
 * En modo `automatica` se ignora `password_manual` aunque venga (no es error);
 * en modo `manual` se exige y se valida con la politica de 10.5 / D30.
 * Devuelve siempre la cadena en claro, que solo vive en memoria y en la
 * respuesta HTTP: nunca se persiste ni se registra en la bitacora.
 */
export function resolverPasswordInicial(
  modo: ModoPassword,
  passwordManual: string | undefined,
  generar: () => string
): { password: string; modo: ModoPassword } {
  if (modo === 'manual') {
    const fallo = validarPasswordManual(passwordManual);
    if (fallo) throw error422(fallo.codigo, fallo.mensaje);
    return { password: passwordManual as string, modo: 'manual' };
  }
  return { password: generar(), modo: 'automatica' };
}

/** Valida el payload de edicion (E36). `usuario` queda fuera por D21. */
export function validarEdicion(cuerpo: unknown) {
  const crudo = exigirClavesPermitidas(cuerpo, [...CLAVES_EDICION_USUARIO, 'motivo']);
  const claves = Object.keys(crudo).filter((c) => c !== 'motivo');
  if (claves.length === 0) throw error422('sin_cambios', 'No se envió ningún campo editable.');
  const parseado = esquemaEditarUsuario.safeParse(crudo);
  if (!parseado.success) throw error422('payload_invalido', 'Datos inválidos.');
  return parseado.data;
}

/** Verifica si un rol (puede ser multi-rol como "capturista+ventanilla") contiene un rol específico. */
function tieneRol(rol: string, rolBuscado: string): boolean {
  return rol.split('+').includes(rolBuscado);
}

/**
 * Coherencia rol <-> Regional (D22): la Regional es obligatoria para el
 * capturista e inaplicable para los demas roles. Devuelve el valor definitivo.
 * Para multi-rol, se considera 'capturista' si la lista contiene 'capturista'.
 */
export async function resolverRegional(
  rol: string,
  regionalId: number | null | undefined,
  cliente?: PoolClient
): Promise<number | null> {
  const valor = regionalId ?? null;

  // Multi-rol: es 'capturista' si contiene ese rol en la lista
  if (tieneRol(rol, 'capturista')) {
    if (valor === null) {
      throw error422(
        'regional_requerida',
        'Los capturistas deben tener una Dirección Regional asignada.'
      );
    }
    if (!(await regionalValida(valor, cliente))) {
      throw error422(
        'regional_invalida',
        'La Dirección Regional seleccionada no existe o está inactiva.'
      );
    }
    return valor;
  }

  if (valor !== null) {
    throw error422('regional_no_aplica', 'Solo los capturistas llevan Dirección Regional.');
  }
  return null;
}

/**
 * D23: el editor de datos no puede crear ni tocar cuentas admin, ni asignar el
 * rol admin. Evita una escalada de privilegios trivial desde gabinete.
 */
export function exigirRolAdministrable(
  rolActor: string,
  rolObjetivo: string | null | undefined
): void {
  // Multi-rol: si el actor tiene 'admin' en su lista, puede administrar
  if (tieneRol(rolActor, 'admin')) return;
  // Multi-rol: no se puede asignar el rol 'admin' si el actor no es admin
  if (rolObjetivo && tieneRol(rolObjetivo, 'admin')) {
    throw error403('rol_no_asignable', 'Tu rol no puede administrar cuentas de administrador.');
  }
}

/**
 * Protege al ultimo administrador activo: no se puede desactivar ni degradar
 * de rol si es el unico que queda (Assumption 52).
 */
export async function exigirQuedaOtroAdmin(
  cliente: PoolClient,
  usuarioId: number,
  rolActual: string
): Promise<void> {
  if (rolActual !== 'admin') return;
  const otros = await contarAdminsActivos(cliente, usuarioId);
  if (otros === 0) {
    throw error409('ultimo_admin', 'Debe quedar al menos un administrador activo.');
  }
}

/** Diff campo a campo para la bitacora; solo incluye lo que cambio de verdad. */
export function calcularCambios(
  anterior: Record<string, unknown>,
  nuevo: Record<string, unknown>,
  campos: readonly string[]
): CambioUsuario[] {
  const cambios: CambioUsuario[] = [];
  for (const campo of campos) {
    if (!(campo in nuevo)) continue;
    const antes = anterior[campo] ?? null;
    const despues = nuevo[campo] ?? null;
    if (antes !== despues) cambios.push({ campo, anterior: antes, nuevo: despues });
  }
  return cambios;
}
