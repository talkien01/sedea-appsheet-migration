-- 007_rol_editor_datos.sql
-- Agrega el rol 'editor_datos' (perfil de gabinete que depura el staging).
-- Cambio aditivo: solo se amplia el CHECK de usuarios.rol, ninguna columna se
-- altera, elimina ni renombra.

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('capturista','auditor','admin','editor_datos'));
