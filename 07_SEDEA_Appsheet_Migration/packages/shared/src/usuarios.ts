// Contrato compartido de la administracion de usuarios (build 4):
// validaciones Zod, politica de contrasenas y tipos de la API /api/usuarios.
// Se usa igual en el backend y en la PWA para que cliente y servidor rechacen
// exactamente lo mismo.
import { z } from 'zod';
import type { Rol } from './dto.js';

/** Roles que pueden administrar cuentas (D15). */
export const ROLES_ADMIN_USUARIOS = ['admin', 'editor_datos'] as const;

/** Los 4 roles del sistema, en el orden en que se muestran en los select. */
export const ROLES_USUARIO = ['capturista', 'auditor', 'editor_datos', 'admin'] as const;

/** Etiquetas en espanol de cada rol (UI y bitacora legible). */
export const ETIQUETAS_ROL: Record<string, string> = {
  capturista: 'Capturista',
  auditor: 'Auditor',
  editor_datos: 'Editor de datos',
  admin: 'Administrador'
};

/** Patron del nombre de acceso: minusculas, digitos, punto, guion y guion bajo. */
export const PATRON_USUARIO = /^[a-z0-9._-]+$/;

/** Longitud fija de la contrasena temporal generada (10.4). */
export const LONGITUD_PASSWORD_TEMPORAL = 14;

/**
 * Alfabeto sin caracteres ambiguos (sin I, l, O, 0, 1) y sin simbolos, para
 * que la temporal se pueda dictar y copiar sin errores.
 */
export const ALFABETO_PASSWORD_TEMPORAL =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Aviso unico que acompana a toda contrasena temporal devuelta por la API. */
export const AVISO_PASSWORD_TEMPORAL = 'Cópiala ahora: no se volverá a mostrar.';

/**
 * Modo con el que se decide la contrasena inicial de un usuario al crearlo o
 * al resetearlo (build 5, D27):
 *  - `automatica`: el backend genera la temporal aleatoria de 14 caracteres.
 *  - `manual`: el admin/editor_datos escribe la contrasena y se usa tal cual.
 * En AMBOS casos el usuario queda con debe_cambiar_password = true (D28).
 */
export const MODOS_PASSWORD = ['automatica', 'manual'] as const;
export type ModoPassword = (typeof MODOS_PASSWORD)[number];

/** Mensaje unico de la politica aplicada a la contrasena manual (D30). */
export const MENSAJE_PASSWORD_MANUAL_DEBIL =
  'La contraseña debe tener al menos 10 caracteres e incluir una letra y un número.';

/** Ayuda mostrada bajo el campo de contrasena manual en la PWA. */
export const AYUDA_PASSWORD_MANUAL =
  'Mínimo 10 caracteres, con al menos una letra y un número. El usuario deberá cambiarla en su primer inicio de sesión.';

// --------------------------------------------------------------------------
// Politica de contrasenas (10.5)
// --------------------------------------------------------------------------

export interface FalloPassword {
  codigo: 'password_debil';
  mensaje: string;
}

/**
 * Valida la fuerza de una contrasena nueva. Devuelve null si es valida.
 * No compara contra la actual: eso lo resuelve quien tenga el valor anterior.
 */
export function validarFuerzaPassword(password: unknown): FalloPassword | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { codigo: 'password_debil', mensaje: 'La contraseña debe tener al menos 10 caracteres.' };
  }
  const tieneLetra = /[A-Za-z]/.test(password);
  const tieneDigito = /[0-9]/.test(password);
  if (!tieneLetra || !tieneDigito) {
    return {
      codigo: 'password_debil',
      mensaje: 'La contraseña debe incluir al menos una letra y un número.'
    };
  }
  return null;
}

/**
 * Valida la contrasena manual escrita por el admin/editor_datos (D30). Usa la
 * MISMA politica de fuerza que el cambio propio, pero con el mensaje unico de
 * 11.5.3 y con un codigo propio cuando viene vacia o ausente.
 */
export function validarPasswordManual(
  password: unknown
): { codigo: 'password_manual_requerida' | 'password_debil'; mensaje: string } | null {
  if (typeof password !== 'string' || password.length === 0) {
    return {
      codigo: 'password_manual_requerida',
      mensaje: 'Escribe la contraseña que quieres asignar.'
    };
  }
  if (validarFuerzaPassword(password) !== null) {
    return { codigo: 'password_debil', mensaje: MENSAJE_PASSWORD_MANUAL_DEBIL };
  }
  return null;
}

// --------------------------------------------------------------------------
// Esquemas Zod
// --------------------------------------------------------------------------

const campoUsuario = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => v.length >= 3 && v.length <= 32, 'El nombre de acceso debe tener entre 3 y 32 caracteres.')
  .refine((v) => PATRON_USUARIO.test(v), 'Solo se permiten minúsculas, números, punto, guion y guion bajo.');

const campoNombre = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length >= 3 && v.length <= 120, 'El nombre completo debe tener entre 3 y 120 caracteres.');

const campoRol = z.enum(['capturista', 'auditor', 'admin', 'editor_datos']);

const campoRegional = z
  .union([z.number().int().positive(), z.null()])
  .optional();

/**
 * Modo de contrasena (build 5). Ausente ⇒ `automatica`, para que los clientes
 * y scripts que ya llamaban con el body de 10.7 sigan funcionando igual.
 */
const campoModoPassword = z.enum(MODOS_PASSWORD).optional().default('automatica');

/**
 * Contrasena escrita a mano; solo se lee si modo_password === 'manual'.
 * Sin limite en el esquema a proposito: la longitud la juzga
 * `validarPasswordManual` para devolver `password_debil` y no `payload_invalido`.
 */
const campoPasswordManual = z.string().optional();

/** Alta de usuario (E35). Estricto: cualquier otra clave se rechaza antes. */
export const esquemaCrearUsuario = z
  .object({
    usuario: campoUsuario,
    nombre_completo: campoNombre,
    rol: campoRol,
    regional_id: campoRegional,
    modo_password: campoModoPassword,
    password_manual: campoPasswordManual
  })
  .strict();
export type EntradaCrearUsuario = z.infer<typeof esquemaCrearUsuario>;

/** Edicion de usuario (E36). `usuario` NO figura: es inmutable (D21). */
export const esquemaEditarUsuario = z
  .object({
    nombre_completo: campoNombre.optional(),
    rol: campoRol.optional(),
    regional_id: campoRegional,
    motivo: z.string().max(300).optional().nullable()
  })
  .strict();
export type EntradaEditarUsuario = z.infer<typeof esquemaEditarUsuario>;

/** Activacion / desactivacion (E38). */
export const esquemaActivoUsuario = z
  .object({
    activo: z.boolean(),
    motivo: z.string().max(300).optional().nullable()
  })
  .strict();

/** Reseteo de contrasena (E37). Acepta el modo de contrasena del build 5. */
export const esquemaResetPassword = z
  .object({
    motivo: z.string().max(300).optional().nullable(),
    modo_password: campoModoPassword,
    password_manual: campoPasswordManual
  })
  .strict();

/**
 * Cambio de la propia contrasena (E39, 11.4).
 * `password_actual` es OPCIONAL en el esquema porque su obligatoriedad depende
 * del estado `debe_cambiar_password` leido de BD, no del body: la resuelve la
 * ruta. En el flujo obligatorio se ignora en silencio (D25); en el voluntario
 * sigue siendo obligatoria y se valida contra el hash (D26).
 */
export const esquemaCambioPassword = z
  .object({
    password_actual: z.string().min(1).max(PASSWORD_MAX).optional(),
    password_nueva: z.string().min(1).max(PASSWORD_MAX)
  })
  .strict();

/** Claves de datos aceptadas en el alta y en la edicion (lista blanca). */
export const CLAVES_ALTA_USUARIO = [
  'usuario',
  'nombre_completo',
  'rol',
  'regional_id',
  'modo_password',
  'password_manual'
] as const;
export const CLAVES_EDICION_USUARIO = ['nombre_completo', 'rol', 'regional_id'] as const;

// --------------------------------------------------------------------------
// Tipos de respuesta
// --------------------------------------------------------------------------

export interface UsuarioAdmin {
  id: number;
  usuario: string;
  nombre_completo: string;
  rol: Rol;
  regional_id: number | null;
  regional: string | null;
  activo: boolean;
  debe_cambiar_password: boolean;
  creado_en: string;
  actualizado_en: string | null;
  password_actualizado_en: string | null;
  capturas: number;
}

export interface PaginaUsuarios {
  data: UsuarioAdmin[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface CambioUsuario {
  campo: string;
  anterior: unknown;
  nuevo: unknown;
}

export interface RespuestaAltaUsuario {
  ok: true;
  usuario: UsuarioAdmin;
  /** La generada o la que escribio el actor: se muestra UNA sola vez (D29). */
  password_temporal: string;
  modo_password: ModoPassword;
  aviso: string;
}

export interface RespuestaResetPassword {
  ok: true;
  usuario_id: number;
  usuario: string;
  password_temporal: string;
  modo_password: ModoPassword;
  aviso: string;
}
