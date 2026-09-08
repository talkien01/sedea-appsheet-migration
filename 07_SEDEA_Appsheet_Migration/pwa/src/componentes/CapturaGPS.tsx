// Paso B de la captura: ubicacion GPS con precision en metros y semaforo.
import { useCallback, useEffect, useState } from 'react';

export interface Ubicacion {
  lat: number;
  lng: number;
  precision_m: number;
}

/**
 * `null` = todavia no hay ubicacion utilizable (bloquea Guardar).
 * `'sin_gps'` = el capturista confirmo explicitamente seguir sin coordenadas
 * (ver `permitirSinGps`) -- la pantalla que lo use debe mandar la bandera
 * `sin_gps: true` al backend en vez de lat/lng.
 */
export type ResultadoUbicacion = Ubicacion | 'sin_gps' | null;

interface Props {
  onUbicacion: (ubicacion: ResultadoUbicacion) => void;
  /** Encabezado del bloque; la pantalla de entrega del apoyo usa el suyo. */
  titulo?: string;
  /**
   * Si el GPS (satelital y por antena/WiFi) no logra resolver ubicacion,
   * ofrece un checkbox para continuar sin coordenadas. Default false a
   * proposito: pantallas que no lo pidan explicitamente conservan el
   * bloqueo total de siempre (ej. captura de campo generica).
   */
  permitirSinGps?: boolean;
}

type Nivel = 'verde' | 'ambar' | 'rojo';

function nivelPrecision(metros: number): Nivel {
  if (metros <= 20) return 'verde';
  if (metros <= 50) return 'ambar';
  return 'rojo';
}

// Caso real reportado (entregas en sitios sin señal de datos): el GPS
// satelital SI puede funcionar sin señal celular, pero sin A-GPS (datos de
// asistencia que normalmente bajan por red) el primer amarre de satelites
// tarda mucho mas. Por eso el intento de alta precision tiene un margen
// largo. El segundo intento (antena/WiFi) es rapido a proposito: solo sirve
// si hay algo de señal, no tiene sentido esperarlo mucho.
const TIEMPO_ALTA_PRECISION_MS = 45000;
const TIEMPO_BAJA_PRECISION_MS = 8000;

function pedirPosicion(altaPrecision: boolean, timeout: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: altaPrecision,
      timeout,
      maximumAge: altaPrecision ? 0 : 60000
    });
  });
}

function mensajeDeFallo(fallo: GeolocationPositionError): string {
  if (fallo.code === fallo.PERMISSION_DENIED) {
    return 'Activa el permiso de ubicación del navegador para continuar.';
  }
  if (fallo.code === fallo.TIMEOUT) {
    return 'No se logró obtener el GPS a tiempo (pasa seguido en sitios sin señal o techados).';
  }
  return 'No fue posible obtener la ubicación.';
}

export default function CapturaGPS({ onUbicacion, titulo, permitirSinGps = false }: Props) {
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [confirmaBaja, setConfirmaBaja] = useState(false);
  const [ofrecerSinGps, setOfrecerSinGps] = useState(false);
  const [confirmaSinGps, setConfirmaSinGps] = useState(false);

  const solicitar = useCallback(async () => {
    setError(null);
    setBuscando(true);
    setOfrecerSinGps(false);
    setConfirmaSinGps(false);

    if (!('geolocation' in navigator)) {
      setError('Este dispositivo no permite obtener la ubicación.');
      setBuscando(false);
      onUbicacion(null);
      return;
    }

    const aplicar = (posicion: GeolocationPosition) => {
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
    };

    try {
      aplicar(await pedirPosicion(true, TIEMPO_ALTA_PRECISION_MS));
      return;
    } catch {
      // GPS satelital fallo o se agoto el tiempo -- reintenta rapido por
      // antena/WiFi (solo ayuda si hay algo de señal, aunque sea debil).
    }

    try {
      aplicar(await pedirPosicion(false, TIEMPO_BAJA_PRECISION_MS));
      return;
    } catch (fallo) {
      setBuscando(false);
      setUbicacion(null);
      onUbicacion(null);
      setError(mensajeDeFallo(fallo as GeolocationPositionError));
      if (permitirSinGps) setOfrecerSinGps(true);
    }
  }, [onUbicacion, permitirSinGps]);

  useEffect(() => {
    void solicitar();
    // Solo al montar la pantalla de captura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alConfirmarBaja = (marcado: boolean) => {
    setConfirmaBaja(marcado);
    onUbicacion(marcado && ubicacion ? ubicacion : null);
  };

  const alConfirmarSinGps = (marcado: boolean) => {
    setConfirmaSinGps(marcado);
    onUbicacion(marcado ? 'sin_gps' : null);
  };

  const nivel = ubicacion ? nivelPrecision(ubicacion.precision_m) : null;

  return (
    <div>
      <h2>{titulo ?? 'Paso 2 · Ubicación GPS'}</h2>

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-gps">
          {error}
        </div>
      )}

      {buscando && <p className="dato">Obteniendo ubicación… puede tardar hasta un minuto sin señal.</p>}

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

      {ofrecerSinGps && (
        <div className="mensaje aviso" data-testid="aviso-sin-gps">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={confirmaSinGps}
              onChange={(e) => alConfirmarSinGps(e.target.checked)}
              data-testid="confirmar-sin-gps"
            />
            Continuar sin ubicación GPS (queda marcado para revisión)
          </label>
        </div>
      )}

      <button type="button" className="secundario" onClick={() => void solicitar()} disabled={buscando}>
        Reintentar ubicación
      </button>
    </div>
  );
}
