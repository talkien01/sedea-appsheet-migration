// E60, lado escritorio: modal que vincula un celular para escanear la
// Constancia CURP cuando el equipo de ventanilla no tiene camara util.
//
// Flujo: abre una sesion en la API, pinta el token como QR (generado aqui en el
// navegador con `qrcode`, sin llamar a ningun servicio externo), y sondea hasta
// que el celular entrega un resultado o se agota la vigencia.
//
// El QR contiene la URL absoluta de `/escaneo-movil/:token` construida sobre el
// origen actual: el celular tiene que llegar al mismo servidor que ve el
// escritorio, y en la red de la oficina eso es una IP/host local.
//
// Multi-lectura (E60-v2): antes cada vinculacion servia para UN escaneo — el
// celular quedaba en pantalla muerta despues del primero y habia que volver a
// escanear el QR de enlace para la siguiente persona (se sentia como que "se
// trababa"). Ahora el mismo token se guarda en localStorage y se REUSA entre
// solicitudes distintas mientras siga vigente (10 min) o hasta que el
// capturista lo cierre a proposito: el celular puede seguir escaneando CURP
// tras CURP sin que nadie vuelva a apuntar la camara al QR de enlace.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { DatosCurpQr } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';
import { useSesion } from '../App';

interface Props {
  onDatos: (datos: DatosCurpQr) => void;
  onCerrar: () => void;
}

/** Cada cuanto se le pregunta a la API si el celular ya mando algo nuevo. */
const MS_SONDEO = 1500;

/** Una llave de localStorage por usuario: no cruzar sesiones en un equipo compartido. */
function llaveToken(usuarioId: number): string {
  return `sedea_escaneo_curp_token_${usuarioId}`;
}

interface TokenGuardado {
  token: string;
  expira_en: string;
}

function leerTokenGuardado(usuarioId: number): TokenGuardado | null {
  try {
    const crudo = window.localStorage.getItem(llaveToken(usuarioId));
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as TokenGuardado;
    if (!datos.token || !datos.expira_en) return null;
    if (new Date(datos.expira_en).getTime() <= Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

function guardarToken(usuarioId: number, datos: TokenGuardado): void {
  try {
    window.localStorage.setItem(llaveToken(usuarioId), JSON.stringify(datos));
  } catch {
    // Almacenamiento no disponible (privado/lleno): la vinculacion sigue
    // funcionando, solo no se reusa entre solicitudes.
  }
}

function borrarTokenGuardado(usuarioId: number): void {
  try {
    window.localStorage.removeItem(llaveToken(usuarioId));
  } catch {
    // Sin efecto si no habia nada que borrar.
  }
}

export default function VincularCelular({ onDatos, onCerrar }: Props) {
  const { perfil } = useSesion();
  const usuarioId = perfil?.id ?? 0;

  const [url, setUrl] = useState<string | null>(null);
  const [imagenQr, setImagenQr] = useState<string | null>(null);
  const [estado, setEstado] = useState<'abriendo' | 'esperando' | 'expirada' | 'error'>(
    'abriendo'
  );
  const [error, setError] = useState<string | null>(null);
  const [escaneos, setEscaneos] = useState(0);
  const [cerrando, setCerrando] = useState(false);

  // `onDatos` en un ref: el efecto de sondeo no debe reiniciarse porque el
  // padre reconstruya el callback en cada render.
  const entregar = useRef(onDatos);
  entregar.current = onDatos;
  // Token activo (nuevo o reusado) y la ultima version ya procesada: al
  // reusar una sesion existente, el escaneo anterior NO debe volver a
  // aplicarse a la solicitud nueva que se esta capturando ahora.
  const tokenActivo = useRef<string | null>(null);
  const ultimaVersionVista = useRef(0);

  const fallar = useCallback((mensaje: string) => {
    setEstado('error');
    setError(mensaje);
  }, []);

  useEffect(() => {
    let vivo = true;
    let temporizador: number | undefined;

    const pintarQr = async (token: string) => {
      const destino = `${window.location.origin}/escaneo-movil/${token}`;
      setUrl(destino);
      setImagenQr(
        await QRCode.toDataURL(destino, { width: 260, margin: 1, errorCorrectionLevel: 'M' })
      );
    };

    const sondear = async (token: string) => {
      if (!vivo) return;
      try {
        const sesion = await api.estadoSesionEscaneo(token);
        if (!vivo) return;

        if (sesion.estado === 'completada') {
          setEstado('expirada');
          borrarTokenGuardado(usuarioId);
          return;
        }
        if (sesion.estado === 'expirada') {
          setEstado('expirada');
          borrarTokenGuardado(usuarioId);
          return;
        }
        // Hay un escaneo mas nuevo que el ultimo que ya se aplico: se manda
        // al formulario y se sigue sondeando (multi-lectura), no se cierra.
        if (sesion.datos && sesion.version > ultimaVersionVista.current) {
          ultimaVersionVista.current = sesion.version;
          setEscaneos(sesion.version);
          entregar.current(sesion.datos);
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

    const abrirNueva = async () => {
      const sesion = await api.abrirSesionEscaneo();
      if (!vivo) return;
      guardarToken(usuarioId, sesion);
      tokenActivo.current = sesion.token;
      ultimaVersionVista.current = 0;
      setEscaneos(0);
      await pintarQr(sesion.token);
      if (!vivo) return;
      setEstado('esperando');
      void sondear(sesion.token);
    };

    const iniciar = async () => {
      try {
        // Reusa una vinculacion previa todavia vigente para no obligar a
        // volver a escanear el QR de enlace en cada solicitud nueva.
        const guardado = usuarioId ? leerTokenGuardado(usuarioId) : null;
        if (guardado) {
          const sesion = await api.estadoSesionEscaneo(guardado.token);
          if (!vivo) return;
          if (sesion.estado === 'pendiente') {
            tokenActivo.current = guardado.token;
            // Lo ya escaneado antes de reabrir el modal no se vuelve a
            // aplicar: solo cuenta lo que llegue de aqui en adelante.
            ultimaVersionVista.current = sesion.version;
            setEscaneos(sesion.version);
            await pintarQr(guardado.token);
            if (!vivo) return;
            setEstado('esperando');
            void sondear(guardado.token);
            return;
          }
          borrarTokenGuardado(usuarioId);
        }
        await abrirNueva();
      } catch (e) {
        if (!vivo) return;
        fallar(
          e instanceof ErrorPeticion
            ? e.message
            : 'No se pudo abrir la sesión de escaneo.'
        );
      }
    };

    void iniciar();
    return () => {
      vivo = false;
      if (temporizador) window.clearTimeout(temporizador);
    };
  }, [fallar, usuarioId]);

  // "Cerrar": solo oculta el modal, el celular sigue vinculado para la
  // siguiente solicitud (se reusa al volver a abrir "Escanear con celular").
  const cerrarModal = () => onCerrar();

  // "Terminar vinculación": invalida el token de una vez, sin esperar los 10
  // minutos de vigencia — para cuando ya se acabo de usar el celular.
  const terminarVinculacion = async () => {
    if (!tokenActivo.current) {
      onCerrar();
      return;
    }
    setCerrando(true);
    try {
      await api.cerrarSesionEscaneo(tokenActivo.current);
    } catch {
      // Si falla el cierre explicito, la sesion igual vence sola a los 10
      // min: no vale la pena bloquear al capturista por esto.
    } finally {
      borrarTokenGuardado(usuarioId);
      setCerrando(false);
      onCerrar();
    }
  };

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
              CURP. Los datos aparecerán solos en esta pantalla y el celular queda listo para
              escanear a la siguiente persona sin volver a mostrarle este código.
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
              Esperando al celular... El código vence en 10 minutos si nadie lo usa.
            </p>
            {escaneos > 0 && (
              <p className="dato" data-testid="contador-escaneos-vincular-celular">
                Escaneos recibidos en esta vinculación: <strong>{escaneos}</strong>
              </p>
            )}
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
            El código venció o se cerró. Cierra y genera uno nuevo.
          </div>
        )}

        {estado === 'error' && (
          <div className="mensaje error" role="alert" data-testid="error-vincular-celular">
            {error}
          </div>
        )}

        <div className="acciones-modal">
          <button
            type="button"
            className="secundario"
            data-testid="btn-cerrar-vincular-celular"
            onClick={cerrarModal}
            disabled={cerrando}
          >
            Cerrar
          </button>
          {estado === 'esperando' && (
            <button
              type="button"
              className="secundario"
              data-testid="btn-terminar-vinculacion"
              onClick={() => void terminarVinculacion()}
              disabled={cerrando}
            >
              {cerrando ? 'Terminando…' : 'Terminar vinculación'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
