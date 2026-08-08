// Paso B de la captura: ubicacion GPS con precision en metros y semaforo.
import { useCallback, useEffect, useState } from 'react';

export interface Ubicacion {
  lat: number;
  lng: number;
  precision_m: number;
}

interface Props {
  onUbicacion: (ubicacion: Ubicacion | null) => void;
}

type Nivel = 'verde' | 'ambar' | 'rojo';

function nivelPrecision(metros: number): Nivel {
  if (metros <= 20) return 'verde';
  if (metros <= 50) return 'ambar';
  return 'rojo';
}

export default function CapturaGPS({ onUbicacion }: Props) {
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [confirmaBaja, setConfirmaBaja] = useState(false);

  const solicitar = useCallback(() => {
    setError(null);
    setBuscando(true);

    if (!('geolocation' in navigator)) {
      setError('Este dispositivo no permite obtener la ubicación.');
      setBuscando(false);
      onUbicacion(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        const nueva: Ubicacion = {
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
          precision_m: Math.max(0, Math.round(posicion.coords.accuracy ?? 0))
        };
        setUbicacion(nueva);
        setBuscando(false);
        setConfirmaBaja(false);
        // Con precision mala la captura queda bloqueada hasta que se confirme.
        onUbicacion(nueva.precision_m > 50 ? null : nueva);
      },
      (fallo) => {
        setBuscando(false);
        setUbicacion(null);
        onUbicacion(null);
        if (fallo.code === fallo.PERMISSION_DENIED) {
          setError('Activa el permiso de ubicación del navegador para continuar.');
        } else if (fallo.code === fallo.TIMEOUT) {
          setError('Se agotó el tiempo para obtener la ubicación. Intenta de nuevo.');
        } else {
          setError('No fue posible obtener la ubicación.');
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [onUbicacion]);

  useEffect(() => {
    solicitar();
    // Solo al montar la pantalla de captura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alConfirmarBaja = (marcado: boolean) => {
    setConfirmaBaja(marcado);
    onUbicacion(marcado && ubicacion ? ubicacion : null);
  };

  const nivel = ubicacion ? nivelPrecision(ubicacion.precision_m) : null;

  return (
    <div>
      <h2>Paso 2 · Ubicación GPS</h2>

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-gps">
          {error}
        </div>
      )}

      {buscando && <p className="dato">Obteniendo ubicación…</p>}

      {ubicacion && (
        <>
          <p className="dato" data-testid="coordenadas">
            <strong>Latitud:</strong> {ubicacion.lat.toFixed(6)} &nbsp;
            <strong>Longitud:</strong> {ubicacion.lng.toFixed(6)}
          </p>
          <p>
            <span className={`semaforo ${nivel}`} data-testid="precision-gps">
              Precisión: ±{ubicacion.precision_m} m
            </span>
          </p>

          {ubicacion.precision_m > 50 && (
            <div className="mensaje aviso">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={confirmaBaja}
                  onChange={(e) => alConfirmarBaja(e.target.checked)}
                  data-testid="confirmar-baja-precision"
                />
                Guardar con baja precisión
              </label>
            </div>
          )}
        </>
      )}

      <button type="button" className="secundario" onClick={solicitar} disabled={buscando}>
        Reintentar ubicación
      </button>
    </div>
  );
}
