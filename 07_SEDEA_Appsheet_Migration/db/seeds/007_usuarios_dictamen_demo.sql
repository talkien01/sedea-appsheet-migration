-- 007_usuarios_dictamen_demo.sql
-- Build 13: usuarios demo del rol `dictaminador`. Las contrasenas NO viven en
-- este archivo: el seeder sustituye __HASH_VENTANILLA__ por un hash bcrypt
-- generado desde SEED_VENTANILLA_PASSWORD (con fallback a SEED_ADMIN_PASSWORD).
-- CAMBIAR ESTOS USUARIOS ANTES DE PRODUCCION.
--
-- dict.test : rol EXACTAMENTE `dictaminador` (no entra a /solicitudes, A19-12).
-- vent.dict : multi-rol `ventanilla+dictaminador` (D19-2).
--
-- Ambos quedan con debe_cambiar_password = FALSE para poder usarlos directo.
-- El dictaminador ve todas las regionales (A19-6): regional_id = NULL.

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id, debe_cambiar_password)
VALUES ('dict.test', 'Dictaminador de pruebas', '__HASH_VENTANILLA__', 'dictaminador', NULL, FALSE)
ON CONFLICT (usuario) DO UPDATE SET
  password_hash         = EXCLUDED.password_hash,
  rol                   = EXCLUDED.rol,
  regional_id           = NULL,
  debe_cambiar_password = FALSE,
  activo                = TRUE;

INSERT INTO usuarios (usuario, nombre_completo, password_hash, rol, regional_id, debe_cambiar_password)
VALUES ('vent.dict', 'Ventanilla y dictamen', '__HASH_VENTANILLA__', 'ventanilla+dictaminador', NULL, FALSE)
ON CONFLICT (usuario) DO UPDATE SET
  password_hash         = EXCLUDED.password_hash,
  rol                   = EXCLUDED.rol,
  regional_id           = NULL,
  debe_cambiar_password = FALSE,
  activo                = TRUE;

-- vent.dict sin filas de alcance: vacio = todos (Assumption 44).
DELETE FROM usuario_municipios
 WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = 'vent.dict');
DELETE FROM usuario_componentes
 WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = 'vent.dict');
