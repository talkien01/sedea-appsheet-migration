// Apertura de la camara para escaneo de QR, compartida entre los 2 lugares
// donde se lee un codigo QR con jsQR:
//   - `usoEscanerQr.ts` (escaneo directo: EscanerCurpQr y "Entregar apoyos").
//   - `pantallas/EscaneoMovil.tsx` (celular vinculado, standalone, sin sesion).
//
// Deliberadamente NO incluye el ciclo de lectura de jsQR ni el manejo de
// estado de la pantalla: eso SI difiere entre los dos usos (EscaneoMovil
// sigue escaneando tras un exito y reintenta solo; EscanerCurpQr se detiene
// en el primer QR valido) y forzarlo a un molde comun no vale la pena. Lo
// que nunca debio divergir es COMO se abre la camara: dos fixes reales de
// calidad de imagen (resolucion, enfoque) tuvieron que aplicarse por
// separado en cada archivo porque no compartian esto -- de ahi este modulo.
export const MENSAJE_SIN_CAMARA =
  'No hay cámara disponible en este dispositivo o navegador.';
export const MENSAJE_PERMISO =
  'No se pudo usar la cámara (permiso denegado o en uso por otra app).';

/**
 * Cada cuanto se vuelve a pedir enfoque (ms). Antes eran 2000 -- se subio a
 * 5000 (hallazgo de consumo de bateria, 2026-09): pedirle al sensor que
 * reenfoque es una operacion de hardware, no gratis, y hacerlo cada 2s de
 * forma indefinida mientras la camara esta abierta (que puede ser toda una
 * jornada de entregas) sumaba consumo real sin necesidad -- un QR fisico no
 * se mueve solo, 5s sigue siendo mas que suficiente para recuperar el enfoque
 * si el capturista mueve el papel.
 */
const MS_REENFOQUE = 5000;

/** Distingue "este navegador/dispositivo no tiene camara" de un fallo real de `getUserMedia`
 * (permiso denegado, en uso por otra app) -- quien llama muestra un mensaje distinto para cada caso. */
export class ErrorCamaraNoDisponible extends Error {}

/**
 * Abre la camara trasera con la resolucion que jsQR necesita para leer un QR
 * chico y denso de cerca (`ideal`, nunca `exact`: si el dispositivo no la
 * soporta, cae a lo maximo que tenga en vez de fallar). Muchos celulares
 * abren por default a 640x480 -- suficiente para video normal, insuficiente
 * para que jsQR decodifique de cerca. Caso real reportado: la camara abre
 * bien pero nunca detecta el codigo.
 *
 * Lanza `ErrorCamaraNoDisponible` si no hay soporte de camara, o el error que
 * tire `getUserMedia` (permiso denegado, en uso) en cualquier otro caso.
 */
export async function abrirCamaraQr(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ErrorCamaraNoDisponible(MENSAJE_SIN_CAMARA);
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // `ideal`, nunca `exact`: si el dispositivo no lo soporta, cae a su
      // default en vez de fallar. Un QR impreso no se mueve -- no hace falta
      // capturar a 30-60 fps para leerlo, y pedir menos cuadros por segundo
      // baja el consumo del sensor/ISP mientras la camara esta abierta
      // (hallazgo de consumo de bateria, 2026-09).
      frameRate: { ideal: 15 }
    }
  });
}

/**
 * Reenfoque periodico: `focusMode: 'continuous'` se reporto "cazando" foco
 * sin asentarse nunca en Samsung/Android frente a un documento plano de bajo
 * contraste (papel blanco) -- terminaba peor que sin tocar nada. 'single-shot'
 * enfoca una vez y se queda quieto; para no perder foco si el papel se mueve,
 * se vuelve a pedir cada 2s en vez de dejarlo "cazando" en modo continuo.
 * Best-effort: si el navegador no soporta `focusMode`, falla en silencio y
 * sigue con el enfoque que ya trae.
 *
 * Devuelve una funcion de limpieza que detiene el temporizador -- llamarla
 * siempre al apagar la camara.
 */
export function iniciarReenfoquePeriodico(stream: MediaStream): () => void {
  const pista = stream.getVideoTracks()[0];
  if (!pista) return () => undefined;
  const reenfocar = () => {
    void pista
      .applyConstraints({ advanced: [{ focusMode: 'single-shot' } as MediaTrackConstraintSet] })
      .catch(() => undefined);
  };
  reenfocar();
  const temporizador = setInterval(reenfocar, MS_REENFOQUE);
  return () => clearInterval(temporizador);
}
