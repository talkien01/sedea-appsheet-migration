-- 017_multi_rol.sql
-- Permitir múltiples roles por usuario (ej. "capturista+ventanilla").
-- El campo rol acepta cualquier combinación de roles separados por "+".

-- Quitar el constraint antiguo
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;

-- Los roles válidos son: capturista, ventanilla, auditor, admin, editor_datos
-- Se pueden combinar con "+" (ej. "capturista+ventanilla")
-- El primer rol es el "principal" para efectos de UI y permisos base.
