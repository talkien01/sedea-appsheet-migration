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
//
// Multi-lectura (E60-v2): antes de aqui la camara se apagaba para siempre en
// cuanto se mandaba UN escaneo ("Listo", pantalla muerta) — para la siguiente
// persona habia que volver a escanear el QR de enlace desde la computadora.
// Ahora, tras enviar uno, la camara sigue prendida: se muestra "Enviado" un
// momento y vuelve sola a escanear, hasta que el capturista cierre la
// vinculacion desde la computadora o venza la vigencia.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { api, ErrorPeticion } from '../api/cliente';

type Estado = 'escaneando' | 'enviando' | 'enviado' | 'cerrado' | 'error';

const MENSAJE_SIN_CAMARA =
  'No hay cámara disponible en este dispositivo o navegador.';
const MENSAJE_PERMISO =
  'No se pudo usar la cámara (permiso denegado o en uso por otra app).';
/** Cuanto se muestra "Enviado" antes de volver solo a escanear. */
const MS_CONFIRMACION = 1200;

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
  const [enviados, setEnviados] = useState(0);

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
        setCurp(datos.curp);
        setEnviados((n) => n + 1);
        setEstado('enviado');
        // La camara NO se apaga: solo se muestra la confirmacion un momento y
        // se vuelve a escanear, lista para la siguiente persona.
        window.setTimeout(() => {
          enviando.current = false;
          setEstado((actual) => (actual === 'enviado' ? 'escaneando' : actual));
        }, MS_CONFIRMACION);
        return true;
      } catch (e) {
        const mensaje =
          e instanceof ErrorPeticion ? e.message : 'No se pudo enviar el escaneo.';
        // Un QR que no es Constancia deja seguir intentando; una sesion
        // cerrada/vencida no tiene remedio desde aqui y apaga la camara.
        const recuperable = e instanceof ErrorPeticion && e.codigo === 'qr_invalido';
        setError(mensaje);
        if (recuperable) {
          enviando.current = false;
          setEstado('escaneando');
        } else {
          detener();
          const cerrada =
            e instanceof ErrorPeticion &&
            (e.codigo === 'sesion_cerrada' || e.codigo === 'sesion_expirada');
          setEstado(cerrada ? 'cerrado' : 'error');
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

  // La camara se mantiene visible en TODOS los estados donde sigue prendida
  // (incluido "enviado"): apagar y volver a montar el <video> perderia el
  // srcObject ya asignado y la camara no volveria a mostrarse sola.
  const camaraActiva = estado === 'escaneando' || estado === 'enviando' || estado === 'enviado';

  return (
    <main className="tarjeta" data-testid="pantalla-escaneo-movil" style={{ padding: 16 }}>
      <h2>Escanear Constancia CURP</h2>

      {/*
        El aviso de "enviado" y el contador van ANTES de la camara a
        proposito: en un celular en vertical, el video ocupaba toda la
        pantalla y el aviso quedaba fuera de la vista sin hacer scroll.
        Aqui siempre se ve sin desplazar nada.
      */}
      {estado === 'enviado' && (
        <div className="mensaje exito" role="status" data-testid="exito-escaneo-movil">
          ✓ Enviado ({curp}). Ya puedes escanear a la siguiente persona.
        </div>
      )}

      {estado === 'enviando' && (
        <p className="dato" data-testid="enviando-escaneo-movil">
          Enviando a la computadora...
        </p>
      )}

      {enviados > 0 && (
        <p className="dato" data-testid="contador-enviados-escaneo-movil">
          Enviados: <strong>{enviados}</strong>
        </p>
      )}

      {camaraActiva && (
        <>
          <p className="dato">
            Encuadra el código QR de la Constancia CURP. Los datos se enviarán solos a la
            computadora, uno tras otro — no hace falta volver a escanear este enlace entre
            personas.
          </p>
          {/*
            Alto topado (no solo `width: 100%`): con la camara trasera de un
            celular en vertical, un video sin tope de alto empujaba el aviso
            de "enviado" fuera de la pantalla. `object-fit: cover` recorta el
            sobrante en vez de deformar la imagen.
          */}
          <video
            ref={video}
            data-testid="video-escaneo-movil"
            playsInline
            muted
            style={{
              width: '100%',
              maxHeight: '45vh',
              objectFit: 'cover',
              borderRadius: 12,
              background: '#000'
            }}
          />
          <canvas ref={lienzo} style={{ display: 'none' }} />
        </>
      )}

      {estado === 'cerrado' && (
        <div className="mensaje aviso" role="status" data-testid="cerrado-escaneo-movil">
          La vinculación se cerró desde la computadora. Pide que generen un código nuevo si
          necesitas seguir escaneando.
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
