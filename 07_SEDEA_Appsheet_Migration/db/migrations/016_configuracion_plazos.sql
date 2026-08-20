-- Migración 016: Configuración de plazos para ingreso de solicitudes
-- Build 12: Timer de plazo visible en /solicitudes/nueva

CREATE TABLE IF NOT EXISTS configuracion_plazos (
  id SERIAL PRIMARY KEY,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_configuracion_plazos_activo ON configuracion_plazos(activo);

-- Insertar plazo por defecto: 30 días desde hoy
INSERT INTO configuracion_plazos (fecha_inicio, fecha_fin, activo)
VALUES (CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true)
ON CONFLICT DO NOTHING;

-- Función para actualizar actualizado_en
CREATE OR REPLACE FUNCTION actualizar_configuracion_plazos_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_configuracion_plazos_update
  BEFORE UPDATE ON configuracion_plazos
  FOR EACH ROW
  EXECUTE FUNCTION actualizar_configuracion_plazos_timestamp();
