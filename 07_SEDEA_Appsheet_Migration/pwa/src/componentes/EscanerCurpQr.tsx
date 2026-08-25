// Modal de escaneo del codigo QR de la Constancia CURP con la camara del
// dispositivo (celular o webcam). Decodifica en el cliente con jsQR sobre los
// frames del <video> volcados a un <canvas>: no sube nada al servidor.
//
// Alcance: solo camara. Los lectores USB que emulan teclado quedan fuera.
// Si la camara no esta disponible o el QR no es el de una Constancia CURP, la
// pantalla avisa y el capturista sigue con la captura manual de siempre.
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parsearQrCurp, type DatosCurpQr } from '@sedea/shared';

interface Props {
  onDatos: (datos: DatosCurpQr) => void;
  onCerrar: () => void;
}

const MENSAJE_QR_INVALIDO =
  'No se pudo leer el CURP, intenta de nuevo o captura los datos manualmente';
const MENSAJE_SIN_CAMARA =
  'No hay cámara disponible en este dispositivo o navegador. Captura los datos manualmente.';
const MENSAJE_PERMISO =
  'No se pudo usar la cámara (permiso denegado o en uso por otra app). Captura los datos manualmente.';

export default function EscanerCurpQr({ onDatos, onCerrar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const animacion = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Punto unico de entrada del texto decodificado (camara o seam de prueba). */
  const procesarTexto = useCallback(
    (texto: string): boolean => {
      const datos = parsearQrCurp(texto);
      if (!datos) {
        setError(MENSAJE_QR_INVALIDO);
        return false;
      }
      setError(null);
      onDatos(datos);
      return true;
    },
    [onDatos]
  );

  useEffect(() => {
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
        setError(MENSAJE_SIN_CAMARA);
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
        setError(MENSAJE_PERMISO);
      }
    };

    void abrir();
    return () => {
      vivo = false;
      detener();
    };
  }, [procesarTexto]);

  // Seam de prueba: permite inyectar el texto decodificado sin camara fisica,
  // que es justo lo que Playwright no puede simular. No lee ni expone nada.
  useEffect(() => {
    const w = window as unknown as { __sedeaEscanerCurp?: (t: string) => boolean };
    w.__sedeaEscanerCurp = procesarTexto;
    return () => {
      delete w.__sedeaEscanerCurp;
    };
  }, [procesarTexto]);

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" data-testid="modal-escaneo-curp">
      <div className="modal tarjeta">
        <h3>Escanear Constancia CURP</h3>
        <p className="dato">
          Encuadra el código QR de la Constancia CURP dentro del recuadro de la cámara.
        </p>

        {error && (
          <div className="mensaje error" role="alert" data-testid="error-escaneo-curp">
            {error}
          </div>
        )}

        <video
          ref={video}
          data-testid="video-escaneo-curp"
          playsInline
          muted
          style={{ width: '100%', borderRadius: 12, background: '#000' }}
        />
        <canvas ref={lienzo} style={{ display: 'none' }} />

        <button
          type="button"
          className="secundario"
          data-testid="btn-cerrar-escaneo-curp"
          onClick={onCerrar}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
