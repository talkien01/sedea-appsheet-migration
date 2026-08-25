-- =====================================================================
-- =====================================================================
-- ==                                                                 ==
-- ==   !!!  A D V E R T E N C I A   -   I R R E V E R S I B L E  !!!  ==
-- ==                                                                 ==
-- ==   Este script BORRA PARA SIEMPRE todos los datos capturados:    ==
-- ==   padron de beneficiarios, capturas de campo, solicitudes de    ==
-- ==   ventanilla con sus documentos y conceptos, pre-dictamenes,    ==
-- ==   dictamenes, staging de importaciones y el contador de folios. ==
-- ==                                                                 ==
-- ==   NO hay papelera. NO hay undo. NO es un borrado logico.        ==
-- ==   Si no tienes respaldo, NO LO CORRAS.                          ==
-- ==                                                                 ==
-- =====================================================================
-- =====================================================================
--
-- Que SI borra (todas las tablas de datos capturados):
--   - dictamenes
--   - predictamenes_ia
--   - solicitud_documentos
--   - solicitud_conceptos
--   - solicitudes
--   - capturas
--   - staging_beneficiarios
--   - staging_catalogos
--   - importaciones
--   - beneficiarios
--   - sesiones_escaneo_curp
--   - solicitud_folios
--
-- Que NO toca (el catalogo del sistema queda intacto):
--   usuarios, direcciones_regionales, municipios, componentes, programas,
--   subprogramas, modalidades, proyectos, tipos_apoyo, documentos_requeridos,
--   ventanillas, catalogos, configuracion_plazos, auditoria_log.
--
-- Que NO hace: no borra los archivos fisicos de /media. Esos quedan huerfanos
-- y se limpian aparte, a mano. Ver la seccion "Reiniciar datos de prueba" del
-- README para el comando exacto de `docker exec`.
--
-- ---------------------------------------------------------------------
-- ARCHIVO GENERADO. No editar a mano.
-- Fuente: packages/shared/src/reinicio.ts
-- Regenerar: npm run generar-sql-reinicio -w backend
-- Es el MISMO SQL que ejecuta POST /api/admin/reiniciar-datos-prueba, para
-- que el script manual y el boton de la app no se desincronicen.
-- ---------------------------------------------------------------------
--
-- Como correrlo contra el stack de Docker:
--
--   docker compose exec -T db psql -U sedea -d sedea -v ON_ERROR_STOP=1 \
--     < scripts/reiniciar_datos_prueba.sql
--
-- Es idempotente: correrlo dos veces seguidas deja el mismo estado (la segunda
-- corrida simplemente vacia tablas que ya estaban vacias).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Bloque 1: rastro en la bitacora ANTES de borrar.
--
-- Se escribe primero para que quede evidencia aunque el vaciado falle a la
-- mitad. usuario_id se resuelve al admin sembrado; si no existe queda NULL,
-- que la columna admite. auditoria_log NO se vacia en el bloque 2.
-- ---------------------------------------------------------------------
INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle)
SELECT
  (SELECT id FROM usuarios WHERE rol LIKE '%admin%' ORDER BY id LIMIT 1),
  'reiniciar_datos_prueba',
  'sistema',
  NULL,
  jsonb_build_object(
    'origen', 'scripts/reiniciar_datos_prueba.sql',
    'ejecutado_en', now(),
    'irreversible', true,
    'media_sin_tocar', true
  );

-- ---------------------------------------------------------------------
-- Bloque 2: el vaciado.
--
-- Va en UNA SOLA sentencia TRUNCATE a proposito. Hay un ciclo de llaves
-- foraneas entre las tablas:
--
--   beneficiarios.solicitud_id        -> solicitudes(id)    (SIN cascada)
--   solicitud_conceptos.beneficiario_id -> beneficiarios(id)
--
-- Postgres solo resuelve el ciclo si todas las tablas referenciantes van en la
-- misma sentencia. Por eso no se puede partir en varios DELETE/TRUNCATE.
--
-- RESTART IDENTITY regresa las secuencias a 1 (los ids vuelven a empezar en 1).
-- NO se usa CASCADE a proposito: si alguna tabla nueva quedara fuera de la
-- lista, preferimos que Postgres falle a que borre de mas en silencio.
--
-- solicitud_folios va incluida: es el contador de consecutivos por
-- (prefijo, regional, municipio, anio). Al vaciarla, la siguiente solicitud
-- real vuelve a generar el folio -0001-.
-- ---------------------------------------------------------------------
TRUNCATE TABLE dictamenes, predictamenes_ia, solicitud_documentos, solicitud_conceptos, solicitudes, capturas, staging_beneficiarios, staging_catalogos, importaciones, beneficiarios, sesiones_escaneo_curp, solicitud_folios RESTART IDENTITY;

COMMIT;

-- ---------------------------------------------------------------------
-- Bloque 3: verificacion. Todas las filas deben salir en 0.
-- ---------------------------------------------------------------------
SELECT 'dictamenes' AS tabla, count(*) AS filas FROM dictamenes
UNION ALL
SELECT 'predictamenes_ia' AS tabla, count(*) AS filas FROM predictamenes_ia
UNION ALL
SELECT 'solicitud_documentos' AS tabla, count(*) AS filas FROM solicitud_documentos
UNION ALL
SELECT 'solicitud_conceptos' AS tabla, count(*) AS filas FROM solicitud_conceptos
UNION ALL
SELECT 'solicitudes' AS tabla, count(*) AS filas FROM solicitudes
UNION ALL
SELECT 'capturas' AS tabla, count(*) AS filas FROM capturas
UNION ALL
SELECT 'staging_beneficiarios' AS tabla, count(*) AS filas FROM staging_beneficiarios
UNION ALL
SELECT 'staging_catalogos' AS tabla, count(*) AS filas FROM staging_catalogos
UNION ALL
SELECT 'importaciones' AS tabla, count(*) AS filas FROM importaciones
UNION ALL
SELECT 'beneficiarios' AS tabla, count(*) AS filas FROM beneficiarios
UNION ALL
SELECT 'sesiones_escaneo_curp' AS tabla, count(*) AS filas FROM sesiones_escaneo_curp
UNION ALL
SELECT 'solicitud_folios' AS tabla, count(*) AS filas FROM solicitud_folios
ORDER BY tabla;

-- Y el catalogo debe seguir intacto (todos estos conteos > 0 si ya estaba
-- sembrado el sistema):
SELECT 'usuarios' AS tabla, count(*) AS filas FROM usuarios
UNION ALL SELECT 'direcciones_regionales', count(*) FROM direcciones_regionales
UNION ALL SELECT 'municipios', count(*) FROM municipios
UNION ALL SELECT 'programas', count(*) FROM programas
UNION ALL SELECT 'subprogramas', count(*) FROM subprogramas
UNION ALL SELECT 'componentes', count(*) FROM componentes
UNION ALL SELECT 'modalidades', count(*) FROM modalidades
UNION ALL SELECT 'proyectos', count(*) FROM proyectos
UNION ALL SELECT 'tipos_apoyo', count(*) FROM tipos_apoyo
UNION ALL SELECT 'documentos_requeridos', count(*) FROM documentos_requeridos
UNION ALL SELECT 'ventanillas', count(*) FROM ventanillas
ORDER BY tabla;

-- Recordatorio final: los archivos de /media siguen ahi. Limpialos a mano.
-- Frase de confirmacion equivalente en la app: BORRAR TODOS LOS DATOS
