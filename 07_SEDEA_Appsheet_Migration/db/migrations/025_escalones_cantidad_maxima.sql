-- 025_escalones_cantidad_maxima.sql
-- Cantidad maxima por superficie: ESCALONES FIJOS, no formula lineal.
--
-- Correccion de la migracion 022. El documento oficial "Compra y distribucion
-- de semilla para establecimiento de cultivos forrajeros" (Programa Apoyo al
-- Campo Queretano 2026) NO define una recta: define rangos de superficie, y
-- dentro de cada rango se entrega SIEMPRE la misma cantidad fija.
--
--   Superficie (ha)        Avena (kg)   Garbanzo (kg)
--   >= 0.25 y <= 0.5           50            25
--   >  0.5  y <= 1            100            50
--   >  1    y <= 1.5          150            75
--   >  1.5  y <= 2            200           100
--
--   - Superficie < 0.25 ha  -> el concepto NO ES ELEGIBLE (se rechaza).
--   - Superficie > 2 ha     -> queda TOPADA en el ultimo escalon (2 ha es un
--                              techo real: 5 ha recibe lo mismo que 2 ha).
--
-- La formula de la 022 (kg_por_hectarea x superficie) solo coincidia con el
-- documento en los 4 puntos limite; en cualquier punto intermedio daba de
-- menos. Sus columnas ya no tienen sentido, asi que la tabla se reemplaza.
-- `reglas_cantidad_maxima` se creo en esta misma iteracion, nada mas la usa
-- fuera de esta regla y no tiene datos de produccion: se elimina.

DROP TABLE IF EXISTS reglas_cantidad_maxima;

-- Un renglon por escalon. Semi-generico: cualquier concepto futuro puede
-- tener sus propios escalones dando de alta filas, sin tocar codigo.
CREATE TABLE IF NOT EXISTS reglas_cantidad_maxima_escalon (
  id                BIGSERIAL PRIMARY KEY,
  tipo_apoyo_id     BIGINT NOT NULL REFERENCES tipos_apoyo(id),
  -- Limite inferior del rango. Inclusivo en el PRIMER escalon del concepto
  -- (define la superficie minima para ser elegible) y exclusivo en los demas,
  -- tal como esta escrito el documento oficial (">= 0.25 y <= 0.5",
  -- "> 0.5 y <= 1", ...). El calculo selecciona el escalon con el
  -- `superficie_hasta` mas chico que alcance a cubrir la superficie, asi que
  -- los limites nunca quedan ambiguos.
  superficie_desde  NUMERIC(14, 4) NOT NULL CHECK (superficie_desde >= 0),
  -- Limite superior del rango, inclusivo. El `superficie_hasta` mas grande de
  -- un concepto es su techo: por encima de el la cantidad ya no crece.
  superficie_hasta  NUMERIC(14, 4) NOT NULL CHECK (superficie_hasta > 0),
  -- Cantidad fija del escalon, en la unidad de medida del tipo de apoyo.
  cantidad          NUMERIC(14, 4) NOT NULL CHECK (cantidad > 0),
  creada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reglas_cantidad_maxima_escalon_rango CHECK (superficie_hasta > superficie_desde),
  CONSTRAINT reglas_cantidad_maxima_escalon_unico UNIQUE (tipo_apoyo_id, superficie_desde)
);

CREATE INDEX IF NOT EXISTS idx_escalon_cantidad_tipo_apoyo
  ON reglas_cantidad_maxima_escalon (tipo_apoyo_id, superficie_hasta);

-- Los 8 escalones oficiales (4 avena + 4 garbanzo). Las claves CFA-AVENA y
-- CFG-GARBANZO ya existen en `tipos_apoyo` desde la migracion 022.
INSERT INTO reglas_cantidad_maxima_escalon
  (tipo_apoyo_id, superficie_desde, superficie_hasta, cantidad)
SELECT t.id, v.superficie_desde, v.superficie_hasta, v.cantidad
FROM (VALUES
    ('CFA-AVENA',    0.25, 0.5,  50.0),
    ('CFA-AVENA',    0.5,  1.0, 100.0),
    ('CFA-AVENA',    1.0,  1.5, 150.0),
    ('CFA-AVENA',    1.5,  2.0, 200.0),
    ('CFG-GARBANZO', 0.25, 0.5,  25.0),
    ('CFG-GARBANZO', 0.5,  1.0,  50.0),
    ('CFG-GARBANZO', 1.0,  1.5,  75.0),
    ('CFG-GARBANZO', 1.5,  2.0, 100.0)
  ) AS v(clave, superficie_desde, superficie_hasta, cantidad)
JOIN tipos_apoyo t ON t.clave = v.clave
ON CONFLICT ON CONSTRAINT reglas_cantidad_maxima_escalon_unico DO UPDATE
  SET superficie_hasta = EXCLUDED.superficie_hasta,
      cantidad         = EXCLUDED.cantidad;
