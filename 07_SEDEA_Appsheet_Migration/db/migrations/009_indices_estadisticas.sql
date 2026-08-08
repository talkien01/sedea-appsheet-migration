-- 009_indices_estadisticas.sql
-- Indices de apoyo para las agregaciones del dashboard (no cambian el esquema
-- logico: ninguna tabla ni columna se agrega, altera o elimina).
CREATE INDEX IF NOT EXISTS idx_capturas_tipo_apoyo ON capturas (tipo_apoyo_id);
CREATE INDEX IF NOT EXISTS idx_benef_tipo_apoyo    ON beneficiarios (tipo_apoyo_id);
