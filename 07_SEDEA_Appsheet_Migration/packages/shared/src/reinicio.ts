// Reinicio de datos de prueba: FUENTE UNICA DE VERDAD.
//
// Este modulo define QUE se borra y CON QUE frase se confirma. Lo consumen:
//   - backend/src/servicios/reinicioDatos.ts  (endpoint POST /api/admin/reiniciar-datos-prueba)
//   - backend/src/generarSqlReinicio.ts       (genera scripts/reiniciar_datos_prueba.sql)
//   - pwa  (texto de la frase que el admin debe teclear)
//
// Si se agrega una tabla de datos capturados al esquema, se agrega AQUI y se
// vuelve a correr `npm run generar-sql-reinicio -w backend`. No se edita el .sql
// a mano.

/**
 * Frase exacta (mayusculas, con espacios) que el admin debe teclear para
 * confirmar. Se valida en el frontend Y en el backend (defensa en profundidad).
 */
export const FRASE_CONFIRMACION_REINICIO = 'BORRAR TODOS LOS DATOS';

/**
 * Tablas que se vacian, en orden de hijo -> padre respetando las llaves
 * foraneas reales del esquema (verificadas con pg_constraint contra la BD).
 *
 * Notas de FK que obligan este orden y esta lista completa:
 *   - `beneficiarios.solicitud_id -> solicitudes(id)` NO tiene ON DELETE CASCADE,
 *     y a su vez `solicitud_conceptos.beneficiario_id -> beneficiarios(id)`.
 *     Es un ciclo entre ambas tablas: por eso se emite UN SOLO `TRUNCATE` con
 *     todas las tablas en la misma sentencia (Postgres resuelve el ciclo si
 *     todas las tablas referenciantes estan incluidas).
 *   - `importaciones` es padre de `beneficiarios`, `staging_beneficiarios` y
 *     `staging_catalogos`: si se vacia, las tres deben ir en la misma lista.
 *   - `auditoria_log` solo referencia `usuarios`, asi que NO bloquea el truncate
 *     y la bitacora del reinicio sobrevive.
 *
 * NO se toca el catalogo del sistema: usuarios, direcciones_regionales,
 * municipios, componentes, programas, subprogramas, modalidades, proyectos,
 * tipos_apoyo, documentos_requeridos, ventanillas, catalogos,
 * configuracion_plazos.
 */
export const TABLAS_REINICIO_DATOS_PRUEBA: readonly string[] = [
  // Dictamen (Build 13): hijos de solicitudes, ambos con ON DELETE CASCADE.
  'dictamenes',
  'predictamenes_ia',
  // Detalle de la solicitud de ventanilla (Build 6).
  'solicitud_documentos',
  'solicitud_conceptos',
  'solicitudes',
  // Capturas de campo.
  'capturas',
  // Staging de importaciones y su bitacora de lotes.
  'staging_beneficiarios',
  'staging_catalogos',
  'importaciones',
  // Padron capturado.
  'beneficiarios',
  // Sesiones efimeras de escaneo de Constancia CURP (traen datos personales).
  'sesiones_escaneo_curp',
  // Contador de folios: se reinicia para que el siguiente folio real sea -0001-.
  'solicitud_folios'
] as const;

/**
 * SQL exacto del vaciado. Una sola sentencia con todas las tablas para que
 * Postgres resuelva el ciclo beneficiarios <-> solicitudes. `RESTART IDENTITY`
 * regresa las secuencias a 1; `CASCADE` NO se usa a proposito: si quedara una
 * tabla fuera de la lista preferimos que Postgres falle y no que borre de mas.
 */
export function sqlTruncateReinicio(tablas: readonly string[] = TABLAS_REINICIO_DATOS_PRUEBA): string {
  return `TRUNCATE TABLE ${tablas.join(', ')} RESTART IDENTITY;`;
}

/** Respuesta del endpoint: evidencia de cuantas filas habia en cada tabla. */
export interface ResultadoReinicioDatos {
  ok: true;
  ejecutado_en: string;
  ejecutado_por: string;
  /** Filas que tenia cada tabla ANTES del truncate, en el orden de borrado. */
  filas_borradas: Record<string, number>;
  total_filas_borradas: number;
  /** Recordatorio: los archivos fisicos de /media NO se tocan. */
  media_sin_tocar: true;
}
