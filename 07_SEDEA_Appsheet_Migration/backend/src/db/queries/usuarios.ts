// SQL de la administracion de usuarios (E34-E39).
// Ninguna consulta selecciona password_hash salvo las que lo necesitan para
// comparar o actualizar: el hash jamas debe llegar a una respuesta HTTP.
import type { PoolClient } from 'pg';
import type { UsuarioAdmin } from '@sedea/shared';
import { consultar, consultarUna, pool } from '../pool.js';

/** Proyeccion publica de un usuario, con Regional y conteo de capturas. */
const SELECT_USUARIO = `
  SELECT u.id, u.usuario, u.nombre_completo, u.rol, u.regional_id,
         r.nombre AS regional, u.activo, u.eliminado, u.debe_cambiar_password,
         u.creado_en, u.actualizado_en, u.password_actualizado_en,
         (SELECT count(*)::int FROM capturas c WHERE c.usuario_id = u.id) AS capturas
    FROM usuarios u
    LEFT JOIN direcciones_regionales r ON r.id = u.regional_id
   WHERE u.eliminado = FALSE
`;

export interface FiltrosUsuarios {
  rol?: string | null;
  regional_id?: number | null;
  activo?: boolean | null;
  eliminado?: boolean | null;
  q?: string | null;
  page: number;
  page_size: number;
}

/** E34 - Listado paginado y filtrado. Orden: activos primero, luego nombre. */
export async function listarUsuarios(
  filtros: FiltrosUsuarios
): Promise<{ data: UsuarioAdmin[]; total: number }> {
  const condiciones: string[] = [];
  const parametros: unknown[] = [];

  if (filtros.rol) {
    parametros.push(filtros.rol);
    condiciones.push(`u.rol = $${parametros.length}`);
  }
  if (filtros.regional_id) {
    parametros.push(filtros.regional_id);
    condiciones.push(`u.regional_id = $${parametros.length}`);
  }
  if (filtros.activo === true || filtros.activo === false) {
    parametros.push(filtros.activo);
    condiciones.push(`u.activo = $${parametros.length}`);
  }
  // Filtro para papelera: eliminado=true (solo admin)
  if (filtros.eliminado === true) {
    condiciones.push(`u.eliminado = TRUE`);
  } else if (filtros.eliminado === false) {
    condiciones.push(`u.eliminado = FALSE`);
  } else {
    // Por defecto, solo no eliminados
    condiciones.push(`u.eliminado = FALSE`);
  }

  if (filtros.q && filtros.q.trim().length >= 2) {
    parametros.push(`%${filtros.q.trim()}%`);
    const i = parametros.length;
    condiciones.push(
      `(unaccent(lower(u.usuario)) LIKE unaccent(lower($${i}))
        OR unaccent(lower(u.nombre_completo)) LIKE unaccent(lower($${i})))`
    );
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const sqlBase = `SELECT u.id, u.usuario, u.nombre_completo, u.rol, u.regional_id,
             r.nombre AS regional, u.activo, u.eliminado, u.debe_cambiar_password,
             u.creado_en, u.actualizado_en, u.password_actualizado_en,
             (SELECT count(*)::int FROM capturas c WHERE c.usuario_id = u.id) AS capturas
       FROM usuarios u
       LEFT JOIN direcciones_regionales r ON r.id = u.regional_id`;

  const totalFila = await consultarUna<{ total: number }>(
    `SELECT count(*)::int AS total FROM (${sqlBase}) _ ${where}`,
    parametros
  );
  const total = totalFila?.total ?? 0;
  const desplazamiento = (filtros.page - 1) * filtros.page_size;

  const data = await consultar<UsuarioAdmin>(
    `${sqlBase} ${where}
      ORDER BY u.eliminado ASC, u.activo DESC, u.nombre_completo ASC
      LIMIT ${filtros.page_size} OFFSET ${desplazamiento}`,
    parametros
  );

  return { data, total };
}

/** Un usuario por id, en la misma proyeccion publica del listado. */
export async function obtenerUsuarioAdmin(
  id: number,
  cliente?: PoolClient
): Promise<UsuarioAdmin | null> {
  const ejecutor = cliente ?? pool;
  const { rows } = await ejecutor.query(`${SELECT_USUARIO} WHERE u.id = $1`, [id]);
  return (rows[0] as UsuarioAdmin) ?? null;
}

/** Fila cruda (incluye rol, activo y eliminado) para las validaciones de negocio. */
export async function obtenerFilaUsuario(
  id: number,
  cliente?: PoolClient
): Promise<{ id: number; usuario: string; rol: string; regional_id: number | null; activo: boolean; eliminado: boolean; nombre_completo: string } | null> {
  const ejecutor = cliente ?? pool;
  const { rows } = await ejecutor.query(
    `SELECT id, usuario, nombre_completo, rol, regional_id, activo, eliminado FROM usuarios WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Unicidad case-insensitive del nombre de acceso. */
export async function existeNombreUsuario(usuario: string, cliente?: PoolClient): Promise<boolean> {
  const ejecutor = cliente ?? pool;
  const { rows } = await ejecutor.query(`SELECT 1 FROM usuarios WHERE lower(usuario) = lower($1)`, [
    usuario
  ]);
  return rows.length > 0;
}

/** Valida que la Regional exista y este activa (D22). */
export async function regionalValida(regionalId: number, cliente?: PoolClient): Promise<boolean> {
  const ejecutor = cliente ?? pool;
  const { rows } = await ejecutor.query(
    `SELECT 1 FROM direcciones_regionales WHERE id = $1 AND activo`,
    [regionalId]
  );
  return rows.length > 0;
}

/** Obtiene todos los municipios activos de una regional. */
export async function obtenerMunicipiosDeRegional(
  regionalId: number,
  cliente?: PoolClient
): Promise<{ id: number; clave: string; nombre: string }[]> {
  const ejecutor = cliente ?? pool;
  const { rows } = await ejecutor.query(
    `SELECT id, clave, nombre FROM municipios WHERE regional_id = $1 AND activo ORDER BY nombre`,
    [regionalId]
  );
  return rows;
}

/** Cuenta administradores activos, opcionalmente excluyendo a uno. */
export async function contarAdminsActivos(
  cliente: PoolClient,
  excluirId?: number
): Promise<number> {
  const { rows } = await cliente.query(
    `SELECT count(*)::int AS total FROM usuarios
      WHERE rol = 'admin' AND activo = true ${excluirId ? 'AND id <> $1' : ''}`,
    excluirId ? [excluirId] : []
  );
  return rows[0]?.total ?? 0;
}

/** E35 - Alta. Siempre activo y con cambio de contrasena pendiente. */
export async function insertarUsuario(
  cliente: PoolClient,
  datos: {
    usuario: string;
    nombre_completo: string;
    rol: string;
    regional_id: number | null;
    password_hash: string;
  }
): Promise<number> {
  const { rows } = await cliente.query(
    `INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id,
                           activo, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, $5, true, true)
     RETURNING id`,
    [datos.usuario, datos.nombre_completo, datos.password_hash, datos.rol, datos.regional_id]
  );
  return rows[0].id as number;
}

/** E36 - Actualiza solo los campos de datos editables. */
export async function actualizarDatosUsuario(
  cliente: PoolClient,
  id: number,
  campos: Record<string, unknown>
): Promise<void> {
  const nombres = Object.keys(campos);
  if (nombres.length === 0) return;
  const asignaciones = nombres.map((campo, i) => `${campo} = $${i + 2}`);
  await cliente.query(
    `UPDATE usuarios SET ${asignaciones.join(', ')}, actualizado_en = now() WHERE id = $1`,
    [id, ...nombres.map((campo) => campos[campo])]
  );
}

/** E37 - Reset: nueva contrasena temporal y flag de cambio obligatorio. */
export async function actualizarPasswordTemporal(
  cliente: PoolClient,
  id: number,
  hash: string
): Promise<void> {
  await cliente.query(
    `UPDATE usuarios
        SET password_hash = $2, debe_cambiar_password = true,
            password_actualizado_en = NULL, actualizado_en = now()
      WHERE id = $1`,
    [id, hash]
  );
}

/** E39 - Cambio propio: apaga el flag y sella la fecha. */
export async function actualizarPasswordPropia(
  cliente: PoolClient,
  id: number,
  hash: string
): Promise<void> {
  await cliente.query(
    `UPDATE usuarios
        SET password_hash = $2, debe_cambiar_password = false,
            password_actualizado_en = now(), actualizado_en = now()
      WHERE id = $1`,
    [id, hash]
  );
}

/** E38 - Alta/baja logica. Nunca se borra la fila (D16). */
export async function actualizarActivo(
  cliente: PoolClient,
  id: number,
  activo: boolean
): Promise<void> {
  await cliente.query(`UPDATE usuarios SET activo = $2, actualizado_en = now() WHERE id = $1`, [
    id,
    activo
  ]);
}

/** E38b - Eliminación lógica: marca usuario como eliminado (solo admin). */
export async function marcarEliminado(
  cliente: PoolClient,
  id: number,
  eliminado: boolean
): Promise<void> {
  await cliente.query(
    `UPDATE usuarios SET eliminado = $2, activo = FALSE, actualizado_en = now() WHERE id = $1`,
    [id, eliminado]
  );
}

/** Hash actual de un usuario (solo para comparar en el cambio propio). */
export async function obtenerHash(id: number): Promise<string | null> {
  const fila = await consultarUna<{ password_hash: string }>(
    `SELECT password_hash FROM usuarios WHERE id = $1`,
    [id]
  );
  return fila?.password_hash ?? null;
}

/**
 * Perfil vivo leido en cada peticion autenticada (10.6.1): permite que
 * desactivar una cuenta invalide el token al instante y que el cambio de
 * contrasena desbloquee el token vigente sin re-login.
 */
export async function perfilVigente(id: number): Promise<{
  id: number;
  usuario: string;
  nombre_completo: string;
  rol: string;
  regional_id: number | null;
  regional_nombre: string | null;
  activo: boolean;
  debe_cambiar_password: boolean;
} | null> {
  return consultarUna(
    `SELECT u.id, u.usuario, u.nombre_completo, u.rol, u.regional_id,
            r.nombre AS regional_nombre, u.activo, u.debe_cambiar_password
       FROM usuarios u
       LEFT JOIN direcciones_regionales r ON r.id = u.regional_id
      WHERE u.id = $1`,
    [id]
  );
}
