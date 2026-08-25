// E60, lado escritorio: modal que vincula un celular para escanear la
// Constancia CURP cuando el equipo de ventanilla no tiene camara util.
//
// Flujo: abre una sesion en la API, pinta el token como QR (generado aqui en el
// navegador con `qrcode`, sin llamar a ningun servicio externo), y sondea hasta
// que el celular entrega el resultado o se agota la vigencia.
//
// El QR contiene la URL absoluta de `/escaneo-movil/:token` construida sobre el
// origen actual: el celular tiene que llegar al mismo servidor que ve el
// escritorio, y en la red de la oficina eso es una IP/host local.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { DatosCurpQr } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';

interface Props {
  onDatos: (datos: DatosCurpQr) => void;
  onCerrar: () => void;
}

/** Cada cuanto se le pregunta a la API si el celular ya mando algo. */
const MS_SONDEO = 1500;

export default function VincularCelular({ onDatos, onCerrar }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [imagenQr, setImagenQr] = useState<string | null>(null);
  const [estado, setEstado] = useState<'abriendo' | 'esperando' | 'expirada' | 'error'>(
    'abriendo'
  );
  const [error, setError] = useState<string | null>(null);
  // `onDatos` en un ref: el efecto de sondeo no debe reiniciarse porque el
  // padre reconstruya el callback en cada render.
  const entregar = useRef(onDatos);
  entregar.current = onDatos;

  const fallar = useCallback((mensaje: string) => {
    setEstado('error');
    setError(mensaje);
  }, []);

  useEffect(() => {
    let vivo = true;
    let temporizador: number | undefined;

    const sondear = async (token: string) => {
      if (!vivo) return;
      try {
        const sesion = await api.estadoSesionEscaneo(token);
        if (!vivo) return;

        if (sesion.estado === 'completada' && sesion.datos) {
          entregar.current(sesion.datos);
          return; // el padre desmonta el modal
        }
        if (sesion.estado === 'expirada') {
          setEstado('expirada');
          return;
        }
        temporizador = window.setTimeout(() => void sondear(token), MS_SONDEO);
      } catch (e) {
        if (!vivo) return;
        // Un corte de red momentaneo no debe matar la espera; se reintenta.
        if (e instanceof ErrorPeticion && e.codigo === 'sin_red') {
          temporizador = window.setTimeout(() => void sondear(token), MS_SONDEO);
          return;
        }
        fallar(
          e instanceof ErrorPeticion
            ? e.message
            : 'No se pudo consultar la sesión de escaneo.'
        );
      }
    };

    const abrir = async () => {
      try {
        const sesion = await api.abrirSesionEscaneo();
        if (!vivo) return;

        const destino = `${window.location.origin}/escaneo-movil/${sesion.token}`;
        setUrl(destino);
        setImagenQr(
          await QRCode.toDataURL(destino, { width: 260, margin: 1, errorCorrectionLevel: 'M' })
        );
        if (!vivo) return;

        setEstado('esperando');
        void sondear(sesion.token);
      } catch (e) {
        if (!vivo) return;
        fallar(
          e instanceof ErrorPeticion
            ? e.message
            : 'No se pudo abrir la sesión de escaneo.'
        );
      }
    };

    void abrir();
    return () => {
      vivo = false;
      if (temporizador) window.clearTimeout(temporizador);
    };
  }, [fallar]);

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" data-testid="modal-vincular-celular">
      <div className="modal tarjeta">
        <h3>Escanear con el celular</h3>

        {estado === 'abriendo' && (
          <p className="dato" data-testid="vincular-abriendo">
            Generando el código de vinculación...
          </p>
        )}

        {estado === 'esperando' && (
          <>
            <p className="dato">
              Escanea este código con la cámara de tu celular y ahí lee el QR de la Constancia
              CURP. Los datos aparecerán solos en esta pantalla.
            </p>
            {imagenQr && (
              <img
                src={imagenQr}
                alt="Código QR para vincular el celular"
                data-testid="qr-vincular-celular"
                style={{ display: 'block', margin: '0 auto', width: 260, height: 260 }}
              />
            )}
            <p className="dato" data-testid="estado-vincular-celular">
              Esperando al celular... El código vence en 10 minutos.
            </p>
            {url && (
              <p className="dato" style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>
                Si la cámara no lo lee, abre esta dirección en el celular:{' '}
                <code data-testid="url-vincular-celular">{url}</code>
              </p>
            )}
          </>
        )}

        {estado === 'expirada' && (
          <div className="mensaje error" role="alert" data-testid="expirada-vincular-celular">
            El código venció sin recibir el escaneo. Cierra y genera uno nuevo.
          </div>
        )}

        {estado === 'error' && (
          <div className="mensaje error" role="alert" data-testid="error-vincular-celular">
            {error}
          </div>
        )}

        <button
          type="button"
          className="secundario"
          data-testid="btn-cerrar-vincular-celular"
          onClick={onCerrar}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
