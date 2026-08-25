-- 019_sesiones_escaneo_curp.sql
-- E60: traspaso celular -> PC para el escaneo de la Constancia CURP.
--
-- Migracion ADITIVA e IDEMPOTENTE: crea una sola tabla nueva y no toca ninguna
-- columna existente. En particular NO escribe en `solicitudes`: la sesion es un
-- buzon efimero entre dos navegadores, no parte del expediente. Los datos
-- llegan al formulario y se guardan por la via de siempre (E41), cuando el
-- capturista los revisa y envia.

CREATE TABLE IF NOT EXISTS sesiones_escaneo_curp (
  id          BIGSERIAL PRIMARY KEY,
  -- Credencial del celular: el telefono NO se autentica, presenta este token y
  -- nada mas. Por eso es aleatorio (24 bytes), de un solo uso y de vida corta.
  token       TEXT UNIQUE NOT NULL,
  -- Quien abrio la sesion desde el escritorio. Solo ese usuario puede sondearla.
  creada_por  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','completada')),
  -- Los cuatro campos ya parseados por @sedea/shared. Nunca se guarda el texto
  -- crudo del QR: la CURP anterior y la entidad no le hacen falta a nadie aqui.
  datos       JSONB,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La expiracion se compara contra now() en cada lectura; no hay job de
  -- limpieza y una fila vencida simplemente deja de servir.
  expira_en   TIMESTAMPTZ NOT NULL,
  completada_en TIMESTAMPTZ
);

-- Unico patron de acceso: buscar por token.
CREATE INDEX IF NOT EXISTS idx_sesion_escaneo_token
  ON sesiones_escaneo_curp (token);

-- Para poder barrer las vencidas si algun dia se agrega una limpieza.
CREATE INDEX IF NOT EXISTS idx_sesion_escaneo_expira
  ON sesiones_escaneo_curp (expira_en);
