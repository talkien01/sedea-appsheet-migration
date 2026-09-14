// Lectura de codigos QR con la camara del dispositivo.
//
// Extraido de EscanerCurpQr para que la pantalla de campo "Entregar apoyos"
// (Parte 2) lea el QR del Folio de entrega sin reimplementar la decodificacion.
// Lo unico que cambia entre usos es QUE se hace con el texto decodificado.
//
// Todo ocurre en el cliente: los frames del <video> se vuelcan a un <canvas>
// oculto y jsQR los decodifica. No se sube nada al servidor.
//
// La apertura de camara (resolucion, enfoque) vive en `camaraQr.ts`,
// compartida con `pantallas/EscaneoMovil.tsx` (celular vinculado, que tiene
// su propio ciclo de lectura porque su comportamiento difiere a proposito).
// Si tocas como se abre la camara, revisa tambien ese archivo.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import jsQR from 'jsqr';
import {
  abrirCamaraQr,
  iniciarReenfoquePeriodico,
  ErrorCamaraNoDisponible,
  MENSAJE_SIN_CAMARA,
  MENSAJE_PERMISO
} from './camaraQr';

export { MENSAJE_SIN_CAMARA, MENSAJE_PERMISO };

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
  /**
   * Alternativa al video en vivo: decodifica un QR de una foto tomada con la
   * cámara NATIVA del sistema (no `getUserMedia`). Pensado para dispositivos
   * donde el control de enfoque vía web no funciona bien (hallazgo real,
   * Samsung Galaxy A54: el video se ve nítido al abrir pero nunca reenfoca al
   * acercar el QR) -- la cámara nativa sí enfoca correctamente porque el
   * sistema operativo la controla directo, sin pasar por la limitación de
   * `MediaStreamTrack.applyConstraints` en el navegador.
   * Devuelve `true` si se decodificó un QR y `alTexto` lo aceptó.
   */
  escanearArchivo: (archivo: File) => Promise<boolean>;
}

/**
 * Decodifica el QR de una imagen estática (foto de la cámara nativa, no
 * video). Mismo pipeline que `leerFrame` (canvas + getImageData + jsQR), pero
 * corrido una sola vez sobre una foto en vez de en loop sobre un stream. El
 * lado máximo es mayor que el del video (2400 vs 1920) porque una foto nativa
 * suele venir con más resolución real y no hay costo de mantenerla en
 * memoria por más de un instante.
 */
const LADO_MAXIMO_FOTO_QR = 2400;

async function decodificarQrDeImagen(archivo: File): Promise<string | null> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO_FOTO_QR / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext('2d', { willReadFrequently: true });
  if (!contexto) return null;
  contexto.drawImage(bitmap, 0, 0, ancho, alto);

  const imagen = contexto.getImageData(0, 0, ancho, alto);
  const codigo = jsQR(imagen.data, imagen.width, imagen.height, {
    inversionAttempts: 'attemptBoth'
  });
  return codigo?.data ?? null;
}

/**
 * Cada cuanto se procesa un cuadro del video (ms). Antes se procesaba CADA
 * frame que entregara `requestAnimationFrame` (hasta 60-120 veces por
 * segundo en pantallas ProMotion) -- un QR impreso no se mueve, así que
 * decodificar esa cantidad de veces por segundo no mejoraba nada la
 * detección, solo el consumo de CPU/batería (hallazgo real, 2026-09: >15% de
 * batería en un iPhone 14 Pro Max para ~60 fotos de entrega, con la cámara
 * de escaneo abierta y procesando todo el tiempo entre beneficiario y
 * beneficiario). Se sigue pidiendo `requestAnimationFrame` en cada vuelta
 * (para no perder el ritmo del video), pero el trabajo pesado (drawImage +
 * getImageData + jsQR) solo corre cada `MS_ENTRE_LECTURAS`.
 */
const MS_ENTRE_LECTURAS = 150;

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

  const escanearArchivo = useCallback(
    async (archivo: File): Promise<boolean> => {
      const texto = await decodificarQrDeImagen(archivo);
      if (!texto) return false;
      return procesarTexto(texto);
    },
    [procesarTexto]
  );

  useEffect(() => {
    if (!activo) return;
    let vivo = true;

    let detenerReenfoque: (() => void) | null = null;
    let ultimaLectura = 0;

    const detener = () => {
      if (animacion.current !== null) cancelAnimationFrame(animacion.current);
      animacion.current = null;
      detenerReenfoque?.();
      detenerReenfoque = null;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };

    const leerFrame = (marca: number) => {
      if (!vivo) return;
      if (marca - ultimaLectura >= MS_ENTRE_LECTURAS) {
        ultimaLectura = marca;
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
      }
      animacion.current = requestAnimationFrame(leerFrame);
    };

    const abrir = async () => {
      try {
        const s = await abrirCamaraQr();
        if (!vivo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        detenerReenfoque = iniciarReenfoquePeriodico(s);
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        animacion.current = requestAnimationFrame(leerFrame);
      } catch (e) {
        setErrorCamara(e instanceof ErrorCamaraNoDisponible ? MENSAJE_SIN_CAMARA : MENSAJE_PERMISO);
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

  return { refVideo: video, refLienzo: lienzo, errorCamara, escanearArchivo };
}
