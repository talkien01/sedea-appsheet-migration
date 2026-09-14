// Modal de escaneo del codigo QR de la Constancia CURP con la camara del
// dispositivo (celular o webcam). La decodificacion vive en `useEscanerQr`
// (compartida con la pantalla de campo "Entregar apoyos"); aqui solo se decide
// que hacer con el texto: parsearlo como Constancia CURP.
//
// Alcance: solo camara. Los lectores USB que emulan teclado quedan fuera.
// Si la camara no esta disponible o el QR no es el de una Constancia CURP, la
// pantalla avisa y el capturista sigue con la captura manual de siempre.
import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { parsearQrCurp, type DatosCurpQr } from '@sedea/shared';
import { useEscanerQr } from './usoEscanerQr';

interface Props {
  onDatos: (datos: DatosCurpQr) => void;
  onCerrar: () => void;
}

const MENSAJE_QR_INVALIDO =
  'No se pudo leer el CURP, intenta de nuevo o captura los datos manualmente';
const MENSAJE_QR_INVALIDO_FOTO =
  'No se pudo leer el CURP en esa foto. Intenta con más luz y el QR bien encuadrado, o captura los datos manualmente.';
const SUFIJO_MANUAL = ' Captura los datos manualmente.';

export default function EscanerCurpQr({ onDatos, onCerrar }: Props) {
  const [errorQr, setErrorQr] = useState<string | null>(null);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const entradaFoto = useRef<HTMLInputElement>(null);

  /** Punto unico de entrada del texto decodificado (camara o seam de prueba). */
  const procesarTexto = useCallback(
    (texto: string): boolean => {
      const datos = parsearQrCurp(texto);
      if (!datos) {
        setErrorQr(MENSAJE_QR_INVALIDO);
        return false;
      }
      setErrorQr(null);
      onDatos(datos);
      return true;
    },
    [onDatos]
  );

  const { refVideo, refLienzo, errorCamara, escanearArchivo } = useEscanerQr({
    alTexto: procesarTexto,
    seamPrueba: '__sedeaEscanerCurp'
  });

  /**
   * Alternativa al video en vivo: abre la cámara NATIVA del sistema (no
   * `getUserMedia`) y decodifica el QR de la foto resultante. Pensada para
   * dispositivos donde el control de enfoque vía web no funciona (hallazgo
   * real, Samsung Galaxy A54: el video se ve bien al abrir pero nunca
   * reenfoca al acercar el papel) -- la cámara nativa sí enfoca porque la
   * controla el sistema operativo, no el navegador.
   */
  const alTomarFoto = async (evento: ChangeEvent<HTMLInputElement>) => {
    const archivo = evento.target.files?.[0];
    if (entradaFoto.current) entradaFoto.current.value = '';
    if (!archivo) return;
    setErrorQr(null);
    setLeyendoFoto(true);
    try {
      const ok = await escanearArchivo(archivo);
      if (!ok) setErrorQr(MENSAJE_QR_INVALIDO_FOTO);
    } finally {
      setLeyendoFoto(false);
    }
  };

  const error = errorCamara ? `${errorCamara}${SUFIJO_MANUAL}` : errorQr;

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" data-testid="modal-escaneo-curp">
      <div className="modal tarjeta">
        <h3>Escanear Constancia CURP</h3>
        <p className="dato">
          Encuadra el código QR de la Constancia CURP dentro del recuadro de la cámara.
        </p>
        <p className="dato">
          Si no lo detecta, inclina un poco el papel o la pantalla del celular — casi
          siempre es un reflejo de luz sobre el QR, no falta de enfoque.
        </p>

        {error && (
          <div className="mensaje error" role="alert" data-testid="error-escaneo-curp">
            {error}
          </div>
        )}

        <video
          ref={refVideo}
          data-testid="video-escaneo-curp"
          playsInline
          muted
          style={{ width: '100%', borderRadius: 12, background: '#000' }}
        />
        <canvas ref={refLienzo} style={{ display: 'none' }} />

        <div className="campo">
          <input
            ref={entradaFoto}
            id="foto-qr-curp"
            data-testid="input-foto-qr-curp"
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => void alTomarFoto(e)}
          />
          <button
            type="button"
            className="secundario"
            data-testid="btn-tomar-foto-curp"
            disabled={leyendoFoto}
            onClick={() => entradaFoto.current?.click()}
          >
            {leyendoFoto ? 'Leyendo foto…' : '¿No enfoca? Tomar foto del QR'}
          </button>
          <p className="dato">
            Usa la cámara del sistema en vez del video: en algunos celulares enfoca mejor.
          </p>
        </div>

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
