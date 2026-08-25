// Alcance granular del usuario de ventanilla (D35/D36).
//
// Semantica (Assumption 44): CERO filas en usuario_municipios /
// usuario_componentes significa "todos" (sin restriccion). Una o mas filas
// restringen al usuario a esa lista exacta.
//
// El alcance se aplica SIEMPRE en el backend: la UI filtra los selects, pero
// eso es cosmetico y no se considera control de acceso.
import type { PoolClient } from 'pg';
import type { PerfilUsuario } from '@sedea/shared';
import { consultar } from '../db/pool.js';
import { ErrorApi } from '../plugins/errores.js';

export interface AlcanceResuelto {
  municipios: 'todos' | number[];
  componentes: 'todos' | number[];
}

/** Verifica si un usuario tiene un rol dentro de su lista multi-rol (ej. "capturista+ventanilla"). */
function tieneRol(usuario: { rol: string }, rolBuscado: string): boolean {
  return usuario.rol.split('+').includes(rolBuscado);
}

/** Error 403 con el codigo del contrato de 12.6.3. */
export function error403Alcance(codigo: string, mensaje: string): ErrorApi {
  return new ErrorApi(403, codigo, mensaje);
}

/**
 * Lee el alcance de un usuario. El `admin` nunca tiene restriccion (D34), asi
 * que ni siquiera se consultan sus tablas de alcance.
 */
export async function leerAlcance(usuario: PerfilUsuario): Promise<AlcanceResuelto> {
  if (tieneRol(usuario, 'admin')) {
    return { municipios: 'todos', componentes: 'todos' };
  }
  return leerAlcancePorId(usuario.id);
}

/** Lee el alcance crudo de un usuario cualquiera (lo usa tambien E47). */
export async function leerAlcancePorId(usuarioId: number): Promise<AlcanceResuelto> {
  const municipios = await consultar<{ municipio_id: string }>(
    'SELECT municipio_id FROM usuario_municipios WHERE usuario_id = $1 ORDER BY municipio_id',
    [usuarioId]
  );
  const componentes = await consultar<{ componente_id: string }>(
    'SELECT componente_id FROM usuario_componentes WHERE usuario_id = $1 ORDER BY componente_id',
    [usuarioId]
  );
  return {
    municipios: municipios.length === 0 ? 'todos' : municipios.map((f) => Number(f.municipio_id)),
    componentes:
      componentes.length === 0 ? 'todos' : componentes.map((f) => Number(f.componente_id))
  };
}

/** true si el id esta dentro del alcance (o si el alcance es "todos"). */
export function dentroDeAlcance(alcance: 'todos' | number[], id: number): boolean {
  return alcance === 'todos' || alcance.includes(id);
}

/**
 * Ventanillas que puede usar el usuario (12.6.1):
 *  - admin: todas.
 *  - ventanilla con Regional: la de su Regional, mas la central (VEN-SED) solo
 *    si su alcance de municipios es "todos" (Assumption 54).
 *  - ventanilla sin Regional y alcance "todos": las 5.
 */
export function ventanillasPermitidas(
  usuario: PerfilUsuario,
  alcance: AlcanceResuelto,
  ventanillas: { id: number; regional_id: number; es_central: boolean }[]
): number[] {
  if (tieneRol(usuario, 'admin')) return ventanillas.map((v) => v.id);

  const sinRestriccionMunicipios = alcance.municipios === 'todos';

  if (usuario.regional_id === null || usuario.regional_id === undefined) {
    return sinRestriccionMunicipios ? ventanillas.map((v) => v.id) : [];
  }

  return ventanillas
    .filter(
      (v) =>
        v.regional_id === usuario.regional_id ||
        (v.es_central && sinRestriccionMunicipios)
    )
    .map((v) => v.id);
}

/**
 * Fragmento SQL "la solicitud es de esta Regional", con el mismo criterio que
 * usan municipioCapturable() y condicionAlcanceSql(): manda el municipio de
 * ubicacion del predio (`s.ubi_municipio_id`), no la Regional de la ventanilla
 * que la capturo. `regionalId` nulo = sin restriccion (SEDEA Central).
 */
export function condicionRegionalSql(
  regionalId: number | null | undefined,
  indice: number,
  alias = 's'
): { sql: string; valores: unknown[] } {
  if (regionalId === null || regionalId === undefined) {
    return { sql: 'TRUE', valores: [] };
  }
  return {
    sql: `${alias}.ubi_municipio_id IN (SELECT id FROM municipios WHERE regional_id = $${indice})`,
    valores: [regionalId]
  };
}

/**
 * Version por fila del filtro anterior, para proteger el detalle y las
 * escrituras sobre UNA solicitud (no solo ocultarla del listado).
 */
export async function solicitudEnRegional(
  solicitudId: number,
  regionalId: number | null
): Promise<boolean> {
  if (regionalId === null) return true;
  const fila = await consultar<{ uno: number }>(
    `SELECT 1 AS uno
       FROM solicitudes s
       JOIN municipios m ON m.id = s.ubi_municipio_id
      WHERE s.id = $1 AND m.regional_id = $2`,
    [solicitudId, regionalId]
  );
  return fila.length > 0;
}

/**
 * Fragmento SQL de aislamiento para las consultas de solicitudes (E43/E44).
 * Devuelve la condicion y los parametros a concatenar; para "todos" devuelve
 * una condicion siempre verdadera.
 *
 * `regionalId` es la Regional forzada del usuario (regionalForzada()). Si se
 * da, el filtro de municipio se amplia con "o es de esa Regional", igual que
 * hace municipioCapturable() para el alta y exigirAlcanceSobre() para el
 * detalle: el listado no puede ser mas estricto que esas dos operaciones o el
 * usuario captura solicitudes que luego no ve en su propia bandeja.
 */
export function condicionAlcanceSql(
  alcance: AlcanceResuelto,
  indiceInicial: number,
  regionalId?: number | null
): { sql: string; valores: unknown[] } {
  const partes: string[] = [];
  const valores: unknown[] = [];
  let indice = indiceInicial;

  if (alcance.municipios !== 'todos') {
    if (regionalId !== null && regionalId !== undefined) {
      const regional = condicionRegionalSql(regionalId, indice + 1);
      partes.push(`(s.ubi_municipio_id = ANY($${indice}::bigint[]) OR ${regional.sql})`);
      valores.push(alcance.municipios, ...regional.valores);
      indice += 1 + regional.valores.length;
    } else {
      // Un alcance vacio de verdad (lista sin ids) no deja ver nada.
      partes.push(`s.ubi_municipio_id = ANY($${indice}::bigint[])`);
      valores.push(alcance.municipios);
      indice++;
    }
  }
  if (alcance.componentes !== 'todos') {
    partes.push(`s.componente_id = ANY($${indice}::bigint[])`);
    valores.push(alcance.componentes);
    indice++;
  }

  return { sql: partes.length === 0 ? 'TRUE' : partes.join(' AND '), valores };
}

/** Reemplaza por completo el alcance de un usuario (E48). */
export async function reemplazarAlcance(
  cliente: PoolClient,
  usuarioId: number,
  municipios: 'todos' | number[],
  componentes: 'todos' | number[]
): Promise<void> {
  await cliente.query('DELETE FROM usuario_municipios WHERE usuario_id = $1', [usuarioId]);
  await cliente.query('DELETE FROM usuario_componentes WHERE usuario_id = $1', [usuarioId]);

  if (municipios !== 'todos' && municipios.length > 0) {
    await cliente.query(
      `INSERT INTO usuario_municipios (usuario_id, municipio_id)
       SELECT $1, m FROM unnest($2::bigint[]) AS m
       ON CONFLICT DO NOTHING`,
      [usuarioId, municipios]
    );
  }
  if (componentes !== 'todos' && componentes.length > 0) {
    await cliente.query(
      `INSERT INTO usuario_componentes (usuario_id, componente_id)
       SELECT $1, c FROM unnest($2::bigint[]) AS c
       ON CONFLICT DO NOTHING`,
      [usuarioId, componentes]
    );
  }
}
