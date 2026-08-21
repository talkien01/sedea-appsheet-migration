-- 018_predictamen_ia.sql
-- Build 13: pre-dictaminacion con IA (SPEC seccion 19).
--
-- Migracion ADITIVA e IDEMPOTENTE. No altera ninguna tabla previa salvo por
-- indices nuevos. NO crea ninguna tabla de expediente unico ni ninguna columna
-- en `solicitudes` ni en `solicitud_documentos` (A19-1, A19-8).
--
-- La entrada de la IA son los adjuntos por documento que E46 ya guarda en
-- `solicitud_documentos.archivo_url`. El vinculo con los archivos vive dentro
-- de `predictamenes_ia.detalle[].solicitud_documento_id`.

-- Una fila por EJECUCION del pre-dictamen sobre una solicitud (historial
-- append-only, D19-6: regenerar inserta, nunca actualiza).
CREATE TABLE IF NOT EXISTS predictamenes_ia (
  id            BIGSERIAL PRIMARY KEY,
  solicitud_id  BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  -- Filas de solicitud_documentos consideradas en esta ejecucion.
  documentos_evaluados   INTEGER NOT NULL DEFAULT 0,
  -- De esas, cuantas tenian archivo_url no nulo.
  documentos_con_archivo INTEGER NOT NULL DEFAULT 0,
  -- 'error' es un valor de primera clase (A19-5): un fallo tecnico no puede
  -- parecer un expediente incompleto del ciudadano.
  estado        TEXT NOT NULL CHECK (estado IN ('positivo','negativo','error')),
  detalle       JSONB NOT NULL DEFAULT '[]'::jsonb,
  resumen       TEXT,
  error_mensaje TEXT,
  modelo_usado  TEXT NOT NULL,
  latencia_ms   INTEGER,
  generado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  generado_por  BIGINT REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_predictamen_solicitud
  ON predictamenes_ia (solicitud_id, generado_en DESC);

-- Veredicto HUMANO. La IA nunca escribe aqui (D19-8): la unica via es E58 con
-- un usuario autenticado con rol dictaminador/admin.
CREATE TABLE IF NOT EXISTS dictamenes (
  id              BIGSERIAL PRIMARY KEY,
  solicitud_id    BIGINT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  resultado       TEXT NOT NULL CHECK (resultado IN ('positivo','negativo')),
  nota            TEXT,
  detalle         JSONB NOT NULL DEFAULT '[]'::jsonb,
  predictamen_id  BIGINT REFERENCES predictamenes_ia(id),
  -- Se calcula en el servidor; si el cliente lo manda, se ignora.
  coincide_con_ia BOOLEAN,
  dictaminado_por BIGINT NOT NULL REFERENCES usuarios(id),
  dictaminado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dictamen_solicitud
  ON dictamenes (solicitud_id, dictaminado_en DESC);
