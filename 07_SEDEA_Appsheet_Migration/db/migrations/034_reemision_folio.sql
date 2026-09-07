-- 034_reemision_folio.sql
-- Historial de reemision de folio (solo admin, cuando un dato que compone
-- el folio -tipicamente el municipio de la ubicacion del apoyo- se capturo
-- mal y ya se corrigio via PATCH /api/admin/solicitudes/:id).
--
-- El folio original NUNCA se reutiliza por diseno: el consecutivo de
-- solicitud_folios es monotono y no retrocede (Assumption 47), asi que una
-- vez reemplazado el folio viejo queda inalcanzable para cualquier alta
-- nueva sin necesidad de un candado aparte. Esta tabla es el registro de
-- auditoria y la forma de resolver "este folio viejo... ¿a donde se fue?".
--
-- Aditiva.

CREATE TABLE IF NOT EXISTS solicitudes_folios_historicos (
  id              BIGSERIAL PRIMARY KEY,
  solicitud_id    BIGINT NOT NULL REFERENCES solicitudes(id),
  folio_anterior  TEXT NOT NULL UNIQUE,
  folio_nuevo     TEXT NOT NULL,
  motivo          TEXT NOT NULL,
  reemplazado_por BIGINT NOT NULL REFERENCES usuarios(id),
  reemplazado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folios_historicos_solicitud
  ON solicitudes_folios_historicos (solicitud_id);
