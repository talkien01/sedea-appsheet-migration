// Modal de escaneo del codigo QR de la Constancia CURP con la camara del
// dispositivo (celular o webcam). La decodificacion vive en `useEscanerQr`
// (compartida con la pantalla de campo "Entregar apoyos"); aqui solo se decide
// que hacer con el texto: parsearlo como Constancia CURP.
//
// Alcance: solo camara. Los lectores USB que emulan teclado quedan fuera.
// Si la camara no esta disponible o el QR no es el de una Constancia CURP, la
// pantalla avisa y el capturista sigue con la captura manual de siempre.
import { useCallback, useState } from 'react';
import { parsearQrCurp, type DatosCurpQr } from '@sedea/shared';
import { useEscanerQr } from './usoEscanerQr';

interface Props {
  onDatos: (datos: DatosCurpQr) => void;
  onCerrar: () => void;
}

const MENSAJE_QR_INVALIDO =
  'No se pudo leer el CURP, intenta de nuevo o captura los datos manualmente';
const SUFIJO_MANUAL = ' Captura los datos manualmente.';

export default function EscanerCurpQr({ onDatos, onCerrar }: Props) {
  const [errorQr, setErrorQr] = useState<string | null>(null);

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

  const { refVideo, refLienzo, errorCamara } = useEscanerQr({
    alTexto: procesarTexto,
    seamPrueba: '__sedeaEscanerCurp'
  });

  const error = errorCamara ? `${errorCamara}${SUFIJO_MANUAL}` : errorQr;

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
          ref={refVideo}
          data-testid="video-escaneo-curp"
          playsInline
          muted
          style={{ width: '100%', borderRadius: 12, background: '#000' }}
        />
        <canvas ref={refLienzo} style={{ display: 'none' }} />

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
