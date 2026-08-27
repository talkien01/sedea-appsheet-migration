// Lectura de codigos QR con la camara del dispositivo.
//
// Extraido de EscanerCurpQr para que la pantalla de campo "Entregar apoyos"
// (Parte 2) lea el QR del Folio de entrega sin reimplementar la decodificacion.
// Lo unico que cambia entre usos es QUE se hace con el texto decodificado.
//
// Todo ocurre en el cliente: los frames del <video> se vuelcan a un <canvas>
// oculto y jsQR los decodifica. No se sube nada al servidor.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import jsQR from 'jsqr';

export const MENSAJE_SIN_CAMARA =
  'No hay cámara disponible en este dispositivo o navegador.';
export const MENSAJE_PERMISO =
  'No se pudo usar la cámara (permiso denegado o en uso por otra app).';

interface Opciones {
  /**
   * Recibe el texto de cada QR decodificado. Devolver `true` significa "era el
   * codigo que esperaba": la camara se apaga. Devolver `false` deja el escaneo
   * corriendo para que el operador vuelva a encuadrar.
   */
  alTexto: (texto: string) => boolean;
  /**
   * Nombre de la funcion global que Playwright usa para inyectar un texto
   * decodificado. Chromium no puede poner un papel fisico frente a su camara
   * falsa, asi que cada pantalla expone su propio seam de prueba.
   */
  seamPrueba?: string;
  /** Permite montar el hook sin encender la camara todavia. */
  activo?: boolean;
}

export interface EscanerQr {
  refVideo: RefObject<HTMLVideoElement>;
  refLienzo: RefObject<HTMLCanvasElement>;
  errorCamara: string | null;
}

export function useEscanerQr({ alTexto, seamPrueba, activo = true }: Opciones): EscanerQr {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const animacion = useRef<number | null>(null);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);

  // Se guarda en un ref para que cambiar el callback no reinicie la camara.
  const manejador = useRef(alTexto);
  useEffect(() => {
    manejador.current = alTexto;
  }, [alTexto]);

  const procesarTexto = useCallback((texto: string): boolean => manejador.current(texto), []);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;

    const detener = () => {
      if (animacion.current !== null) cancelAnimationFrame(animacion.current);
      animacion.current = null;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };

    const leerFrame = () => {
      if (!vivo) return;
      const v = video.current;
      const c = lienzo.current;
      const ctx = c?.getContext('2d', { willReadFrequently: true });
      if (v && c && ctx && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const imagen = ctx.getImageData(0, 0, c.width, c.height);
        const codigo = jsQR(imagen.data, imagen.width, imagen.height, {
          inversionAttempts: 'dontInvert'
        });
        if (codigo?.data && procesarTexto(codigo.data)) {
          detener();
          return;
        }
      }
      animacion.current = requestAnimationFrame(leerFrame);
    };

    const abrir = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorCamara(MENSAJE_SIN_CAMARA);
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (!vivo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        animacion.current = requestAnimationFrame(leerFrame);
      } catch {
        setErrorCamara(MENSAJE_PERMISO);
      }
    };

    void abrir();
    return () => {
      vivo = false;
      detener();
    };
  }, [procesarTexto, activo]);

  // Seam de prueba: inyecta el texto decodificado sin camara fisica. No lee ni
  // expone nada del dispositivo.
  useEffect(() => {
    if (!seamPrueba || !activo) return;
    const w = window as unknown as Record<string, unknown>;
    w[seamPrueba] = procesarTexto;
    return () => {
      delete w[seamPrueba];
    };
  }, [procesarTexto, seamPrueba, activo]);

  return { refVideo: video, refLienzo: lienzo, errorCamara };
}
