-- 033_autorizacion_de_facto_configurable.sql
-- Convierte la excepcion "autorizado de facto" al candado de autorizacion
-- del Secretario (backend/src/servicios/autorizacion-operativa.ts) de una
-- lista de IDs fija en codigo a una columna editable en el catalogo.
--
-- Por que: la excepcion vivia como IDS_TIPOS_APOYO_AUTORIZADOS_DE_FACTO =
-- [160, 161] (avena/garbanzo), hardcodeada — prenderla o apagarla, o
-- extenderla a otro concepto futuro, exigia editar codigo y hacer deploy.
-- Con la columna se administra desde Catalogos -> Conceptos de apoyo.
--
-- No modifica solicitudes.autorizada_secretario ni atribuye la autorizacion
-- al Secretario (mismo criterio que ya declaraba el codigo): solo resuelve
-- el candado operativo de impresion de folio y registro de entrega.
--
-- Aditiva e idempotente.

ALTER TABLE tipos_apoyo
  ADD COLUMN IF NOT EXISTS autorizado_de_facto BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserva el estado actual: avena y garbanzo ya operaban de facto
-- autorizados antes de esta migracion.
UPDATE tipos_apoyo
   SET autorizado_de_facto = TRUE
 WHERE clave IN ('CFA-AVENA', 'CFG-GARBANZO')
   AND autorizado_de_facto = FALSE;
