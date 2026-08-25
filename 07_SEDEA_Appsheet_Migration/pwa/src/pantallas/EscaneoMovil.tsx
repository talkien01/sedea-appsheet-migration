// E60, lado celular: pantalla que se abre al escanear el QR de vinculacion.
//
// Standalone a proposito: vive FUERA del cascaron y de RutaProtegida porque se
// abre en un telefono donde nadie inicio sesion. No hay menu, no hay perfil, no
// se puede navegar a ningun otro lado desde aqui. Lo unico que puede hacer es
// mandar el texto de un QR a la sesion cuyo token viene en la URL.
//
// El telefono decodifica localmente con jsQR (igual que el escaneo directo) y
// manda el texto crudo; quien decide si es una Constancia valida es el servidor
// con el parser compartido.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { api, ErrorPeticion } from '../api/cliente';

type Estado = 'escaneando' | 'enviando' | 'listo' | 'error';

const MENSAJE_SIN_CAMARA =
  'No hay cámara disponible en este dispositivo o navegador.';
const MENSAJE_PERMISO =
  'No se pudo usar la cámara (permiso denegado o en uso por otra app).';

export default function EscaneoMovil() {
  const { token = '' } = useParams<{ token: string }>();
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const animacion = useRef<number | null>(null);
  // Evita que dos frames seguidos disparen dos envios de la misma sesion.
  const enviando = useRef(false);

  const [estado, setEstado] = useState<Estado>('escaneando');
  const [error, setError] = useState<string | null>(null);
  const [curp, setCurp] = useState<string | null>(null);

  const detener = useCallback(() => {
    if (animacion.current !== null) cancelAnimationFrame(animacion.current);
    animacion.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  /** Punto unico de entrada del texto decodificado (camara o seam de prueba). */
  const procesarTexto = useCallback(
    async (texto: string): Promise<boolean> => {
      if (enviando.current) return false;
      enviando.current = true;
      setEstado('enviando');
      setError(null);
      try {
        const { datos } = await api.entregarEscaneoMovil(token, texto);
        detener();
        setCurp(datos.curp);
        setEstado('listo');
        return true;
      } catch (e) {
        const mensaje =
          e instanceof ErrorPeticion ? e.message : 'No se pudo enviar el escaneo.';
        // Un QR que no es Constancia deja seguir intentando; una sesion muerta
        // (404/409/410) no tiene remedio desde aqui y apaga la camara.
        const recuperable = e instanceof ErrorPeticion && e.codigo === 'qr_invalido';
        setError(mensaje);
        if (recuperable) {
          enviando.current = false;
          setEstado('escaneando');
        } else {
          detener();
          setEstado('error');
        }
        return false;
      }
    },
    [token, detener]
  );

  useEffect(() => {
    let vivo = true;

    const leerFrame = () => {
      if (!vivo) return;
      const v = video.current;
      const c = lienzo.current;
      const ctx = c?.getContext('2d', { willReadFrequently: true });
      if (
        !enviando.current &&
        v &&
        c &&
        ctx &&
        v.readyState === v.HAVE_ENOUGH_DATA &&
        v.videoWidth > 0
      ) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const imagen = ctx.getImageData(0, 0, c.width, c.height);
        const codigo = jsQR(imagen.data, imagen.width, imagen.height, {
          inversionAttempts: 'dontInvert'
        });
        if (codigo?.data) {
          void procesarTexto(codigo.data);
        }
      }
      animacion.current = requestAnimationFrame(leerFrame);
    };

    const abrir = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(MENSAJE_SIN_CAMARA);
        setEstado('error');
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
        setEstado('error');
      }
    };

    void abrir();
    return () => {
      vivo = false;
      detener();
    };
  }, [procesarTexto, detener]);

  // Seam de prueba, igual que en EscanerCurpQr: Playwright no puede poner una
  // Constancia fisica frente a la camara falsa de Chromium.
  useEffect(() => {
    const w = window as unknown as {
      __sedeaEscaneoMovil?: (t: string) => Promise<boolean>;
    };
    w.__sedeaEscaneoMovil = procesarTexto;
    return () => {
      delete w.__sedeaEscaneoMovil;
    };
  }, [procesarTexto]);

  return (
    <main className="tarjeta" data-testid="pantalla-escaneo-movil" style={{ padding: 16 }}>
      <h2>Escanear Constancia CURP</h2>

      {(estado === 'escaneando' || estado === 'enviando') && (
        <>
          <p className="dato">
            Encuadra el código QR de la Constancia CURP. Los datos se enviarán solos a la
            computadora.
          </p>
          <video
            ref={video}
            data-testid="video-escaneo-movil"
            playsInline
            muted
            style={{ width: '100%', borderRadius: 12, background: '#000' }}
          />
          <canvas ref={lienzo} style={{ display: 'none' }} />
        </>
      )}

      {estado === 'enviando' && (
        <p className="dato" data-testid="enviando-escaneo-movil">
          Enviando a la computadora...
        </p>
      )}

      {estado === 'listo' && (
        <div className="mensaje exito" role="status" data-testid="exito-escaneo-movil">
          Listo. Ya puedes volver a la computadora: los datos de {curp} aparecieron en el
          formulario.
        </div>
      )}

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-escaneo-movil">
          {error}
        </div>
      )}
    </main>
  );
}
