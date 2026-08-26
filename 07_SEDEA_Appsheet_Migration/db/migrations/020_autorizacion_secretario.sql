-- 020_autorizacion_secretario.sql
-- Autorizacion del Secretario: el candado manual que habilita el Folio de
-- entrega de una solicitud.
--
-- Por que vive en `solicitudes` y no en una tabla aparte: la firma del
-- Secretario ocurre EN PAPEL, fuera del sistema (firma la Solicitud completa
-- impresa). Lo que se guarda aqui es la CAPTURA de esa firma: un estado simple
-- de la solicitud, no un flujo con historial propio. El rastro de cada cambio
-- (marcar y desmarcar) queda en `auditoria_log` con accion
-- 'autorizacion_secretario'.
--
-- Es independiente del dictamen (`dictamenes`): el Secretario puede autorizar
-- algo con dictamen negativo o rechazar algo con dictamen positivo.
--
-- Migracion ADITIVA e IDEMPOTENTE: solo agrega columnas con default, no toca
-- ninguna existente. Las solicitudes ya capturadas quedan en FALSE (no
-- autorizadas), que es el estado correcto: nadie ha capturado su firma.

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS autorizada_secretario     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autorizada_secretario_en  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autorizada_secretario_por BIGINT REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS autorizada_secretario_nota TEXT;

COMMENT ON COLUMN solicitudes.autorizada_secretario IS
  'TRUE cuando alguien capturo en el sistema la firma fisica del Secretario. Es el candado del Folio de entrega, independiente del dictamen.';
COMMENT ON COLUMN solicitudes.autorizada_secretario_nota IS
  'Nota opcional de la captura (ej. "autorizado a pesar de dictamen negativo, ver folio X").';
