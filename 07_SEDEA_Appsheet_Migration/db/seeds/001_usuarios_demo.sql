-- 001_usuarios_demo.sql
-- Usuarios de demostracion. Las contrasenas NO viven en este archivo:
-- el script db/seeds ejecutado por `npm run seed` sustituye los marcadores
-- __HASH_ADMIN__, __HASH_CAPTURISTA__ y __HASH_AUDITOR__ por hashes bcrypt
-- generados a partir de las variables de entorno SEED_ADMIN_PASSWORD.
-- CAMBIAR ESTOS USUARIOS ANTES DE PRODUCCION.

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id)
VALUES ('__USUARIO_ADMIN__', 'Administrador SEDEA', '__HASH_ADMIN__', 'admin', NULL)
ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id)
SELECT 'capturista1', 'Capturista Regional Centro', '__HASH_CAPTURISTA__', 'capturista', r.id
FROM direcciones_regionales r WHERE r.clave = 'REG-01'
ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id)
VALUES ('auditor1', 'Auditor Estatal', '__HASH_AUDITOR__', 'auditor', NULL)
ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash;
