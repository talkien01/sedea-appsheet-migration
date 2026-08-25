-- 006_usuarios_ventanilla_demo.sql
-- Build 6: dos usuarios demo del rol `ventanilla`. Las contrasenas NO viven en
-- este archivo: el seeder sustituye __HASH_VENTANILLA__ por un hash bcrypt
-- generado desde SEED_VENTANILLA_PASSWORD (con fallback a SEED_ADMIN_PASSWORD).
-- CAMBIAR ESTOS USUARIOS ANTES DE PRODUCCION.
--
-- ventanilla1  : perfil de Regional, con alcance RESTRINGIDO (2 municipios, 1 componente).
-- ventanilla2  : perfil de SEDEA central, SIN filas de alcance => "todos" (Assumption 44).
-- vent.jalpan  : perfil de Regional SIN alcance granular. Es el caso que aisla
--                el fix de la Regional en el rol ventanilla: sin regional_id el
--                usuario capturaria en los 18 municipios del estado; con
--                REG-02 solo ve los 4 de Jalpan en 2.2 y 4.1.

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id, debe_cambiar_password)
SELECT 'ventanilla1', 'Ventanilla San Juan del Río', '__HASH_VENTANILLA__', 'ventanilla', r.id, FALSE
  FROM direcciones_regionales r WHERE r.clave = 'REG-04'
ON CONFLICT (usuario) DO UPDATE SET
  password_hash          = EXCLUDED.password_hash,
  rol                    = EXCLUDED.rol,
  regional_id            = EXCLUDED.regional_id,
  debe_cambiar_password  = FALSE,
  activo                 = TRUE;

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id, debe_cambiar_password)
VALUES ('ventanilla2', 'Ventanilla SEDEA Central', '__HASH_VENTANILLA__', 'ventanilla', NULL, FALSE)
ON CONFLICT (usuario) DO UPDATE SET
  password_hash          = EXCLUDED.password_hash,
  rol                    = EXCLUDED.rol,
  regional_id            = NULL,
  debe_cambiar_password  = FALSE,
  activo                 = TRUE;

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id, debe_cambiar_password)
SELECT 'vent.jalpan', 'Ventanilla Jalpan', '__HASH_VENTANILLA__', 'ventanilla', r.id, FALSE
  FROM direcciones_regionales r WHERE r.clave = 'REG-02'
ON CONFLICT (usuario) DO UPDATE SET
  password_hash          = EXCLUDED.password_hash,
  rol                    = EXCLUDED.rol,
  regional_id            = EXCLUDED.regional_id,
  debe_cambiar_password  = FALSE,
  activo                 = TRUE;

-- Alcance de ventanilla1: se reemplaza por completo para que el seed sea
-- idempotente aunque un administrador lo haya cambiado antes.
DELETE FROM usuario_municipios
 WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = 'ventanilla1');
DELETE FROM usuario_componentes
 WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = 'ventanilla1');

INSERT INTO usuario_municipios (usuario_id, municipio_id)
SELECT u.id, m.id
  FROM usuarios u, municipios m
 WHERE u.usuario = 'ventanilla1'
   AND m.clave IN ('22001', '22016')   -- Amealco de Bonfil y San Juan del Río
ON CONFLICT DO NOTHING;

INSERT INTO usuario_componentes (usuario_id, componente_id)
SELECT u.id, c.id
  FROM usuarios u, componentes c
 WHERE u.usuario = 'ventanilla1' AND c.clave = 'TR'
ON CONFLICT DO NOTHING;

-- ventanilla2 y vent.jalpan no llevan ninguna fila de alcance: vacio = todos.
-- En vent.jalpan el recorte lo hace su Regional, no el alcance granular.
DELETE FROM usuario_municipios
 WHERE usuario_id IN (SELECT id FROM usuarios WHERE usuario IN ('ventanilla2', 'vent.jalpan'));
DELETE FROM usuario_componentes
 WHERE usuario_id IN (SELECT id FROM usuarios WHERE usuario IN ('ventanilla2', 'vent.jalpan'));
