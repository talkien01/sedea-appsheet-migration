-- 022_reglas_cantidad_maxima.sql
-- Regla de cantidad maxima por superficie para conceptos de apoyo.
--
-- Origen: "Compra y distribucion de semilla para establecimiento de cultivos
-- forrajeros", Programa Apoyo al Campo Queretano 2026. El documento publica una
-- tabla de rangos de superficie, pero es exactamente una recta:
--   avena    = superficie_ha * 100 kg   (tope 2 ha  ->  200 kg)
--   garbanzo = superficie_ha *  50 kg   (tope 2 ha  ->  100 kg)
-- Se guarda la formula (kg por hectarea + tope de hectareas), no los rangos:
-- da el mismo resultado y permite dar de alta reglas de otros conceptos sin
-- volver a tocar codigo.
--
-- Aditiva: no altera ninguna tabla existente.

CREATE TABLE IF NOT EXISTS reglas_cantidad_maxima (
  id               BIGSERIAL PRIMARY KEY,
  tipo_apoyo_id    BIGINT   NOT NULL UNIQUE REFERENCES tipos_apoyo(id),
  -- Cantidad maxima por hectarea, en la unidad de medida del tipo de apoyo.
  kg_por_hectarea  NUMERIC(14, 4) NOT NULL CHECK (kg_por_hectarea > 0),
  -- Superficie maxima computable: mas alla de este tope el maximo no crece.
  tope_hectareas   NUMERIC(14, 4) NOT NULL CHECK (tope_hectareas > 0),
  creada_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conceptos de avena y garbanzo del proyecto "Semillas para el establecimiento
-- de cultivos forrajeros". Claves segun el instructivo oficial de alta
-- (Pasos_Alta_Avena_Garbanzo.docx, pasos 5).
INSERT INTO tipos_apoyo (clave, nombre, categoria, unidad_medida, activo) VALUES
  ('CFA-AVENA',    'CFA: SEMILLA DE AVENA',    'agricola', 'kg', TRUE),
  ('CFG-GARBANZO', 'CFG: SEMILLA DE GARBANZO', 'agricola', 'kg', TRUE)
ON CONFLICT (clave) DO UPDATE
  SET nombre        = EXCLUDED.nombre,
      categoria     = EXCLUDED.categoria,
      unidad_medida = EXCLUDED.unidad_medida,
      activo        = EXCLUDED.activo;

INSERT INTO reglas_cantidad_maxima (tipo_apoyo_id, kg_por_hectarea, tope_hectareas)
SELECT t.id, r.kg_por_hectarea, r.tope_hectareas
FROM (VALUES
    ('CFA-AVENA',    100.0, 2.0),
    ('CFG-GARBANZO',  50.0, 2.0)
  ) AS r(clave, kg_por_hectarea, tope_hectareas)
JOIN tipos_apoyo t ON t.clave = r.clave
ON CONFLICT (tipo_apoyo_id) DO UPDATE
  SET kg_por_hectarea = EXCLUDED.kg_por_hectarea,
      tope_hectareas  = EXCLUDED.tope_hectareas;
