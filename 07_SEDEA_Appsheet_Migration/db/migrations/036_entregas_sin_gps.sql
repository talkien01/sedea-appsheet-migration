-- 036_entregas_sin_gps.sql
-- Permite registrar una entrega de apoyo SIN coordenadas GPS.
--
-- Caso real reportado: entregas en sitios sin señal de datos. El GPS satelital
-- puede funcionar sin señal (no depende de la red celular), pero sin A-GPS
-- (datos de asistencia que normalmente bajan por red) el primer amarre de
-- satélites tarda mucho más -- y en algunos sitios (techados, mala vista al
-- cielo) simplemente nunca se logra. Antes de esta migración, lat/lng/
-- precision_m/geom eran NOT NULL: sin GPS, la entrega completa quedaba
-- bloqueada aunque la foto+folio (la evidencia principal) ya estuvieran listos.
--
-- Columna nueva `sin_gps`: bandera EXPLÍCITA, confirmada por el capturista en
-- pantalla (no un default silencioso) para que quien audite después sepa que
-- esa entrega no tiene coordenadas y por qué. El CHECK garantiza que nunca
-- queden lat/lng nulos SIN que la bandera lo explique.
--
-- Migracion ADITIVA/relajante: no borra ni renombra nada existente.

ALTER TABLE entregas_apoyo ALTER COLUMN geom DROP NOT NULL;
ALTER TABLE entregas_apoyo ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE entregas_apoyo ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE entregas_apoyo ALTER COLUMN precision_m DROP NOT NULL;

ALTER TABLE entregas_apoyo ADD COLUMN IF NOT EXISTS sin_gps BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE entregas_apoyo DROP CONSTRAINT IF EXISTS entregas_apoyo_gps_o_bandera;
ALTER TABLE entregas_apoyo ADD CONSTRAINT entregas_apoyo_gps_o_bandera
  CHECK (sin_gps OR (lat IS NOT NULL AND lng IS NOT NULL AND precision_m IS NOT NULL));

COMMENT ON COLUMN entregas_apoyo.sin_gps IS
  'Confirmado por el capturista en campo cuando el GPS (satelital y por antena/WiFi) no logro resolver ubicacion. lat/lng/geom quedan NULL en ese caso -- la evidencia principal sigue siendo foto+folio.';
