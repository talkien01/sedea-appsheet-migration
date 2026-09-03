-- 031_escaneo_curp_multilectura.sql
-- E60 pasa de "un solo escaneo por vinculacion" a "varios escaneos seguidos
-- con el mismo celular vinculado", mientras la sesion siga vigente (10 min) y
-- no se cierre explicitamente.
--
-- Antes: `estado` pasaba a 'completada' en cuanto llegaba el primer QR, y esa
-- fila quedaba muerta — el celular se "trababa" (nada que hacer salvo volver
-- a vincular desde cero). Ahora: `estado = 'pendiente'` sigue aceptando
-- escaneos indefinidamente (hasta vencer o cerrarse); `datos` guarda SOLO el
-- ultimo escaneo recibido, y `version` sube 1 en cada uno para que el
-- escritorio, sondeando, sepa si lo que ve ya lo proceso o es nuevo.
-- `estado = 'completada'` ahora significa "cerrada a proposito desde el
-- escritorio" (boton "Terminar vinculacion"), no "ya se uso una vez".

ALTER TABLE sesiones_escaneo_curp
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
