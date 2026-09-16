// Bloqueo por inactividad (defensa BYOD): buena parte de los capturistas usan
// su propio celular, no una tablet institucional con bloqueo de pantalla
// garantizado. Tras un rato sin tocar la app se pide la contrasena de nuevo
// para seguir viendola -- a diferencia de "Cerrar sesion", esto NO borra
// nada de IndexedDB (padron, capturas/entregas pendientes de subir): es solo
// una cortina sobre la pantalla, para que quien encuentre el telefono
// desbloqueado por otro motivo (se lo prestaron, se le cayo del bolsillo) no
// pueda hojear el padron ni las fotos sin volver a autenticarse.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSesion } from '../App';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import CampoPassword from './CampoPassword';

const MINUTOS_INACTIVIDAD = 15;
const MS_INACTIVIDAD = MINUTOS_INACTIVIDAD * 60 * 1000;
const EVENTOS_ACTIVIDAD = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export default function BloqueoInactividad({ children }: { children: ReactNode }) {
  const { perfil, cerrarSesion } = useSesion();
  const enLinea = useEstadoRed();
  const [bloqueado, setBloqueado] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const ultimaActividad = useRef(Date.now());

  const marcarActividad = useCallback(() => {
    ultimaActividad.current = Date.now();
  }, []);

  // Reloj de inactividad: solo corre mientras hay sesion. Se reinicia solo
  // (no hace falta desmontar/montar el listener) porque compara contra el
  // reloj real, no contra un setTimeout que un salto de pestana pueda pausar.
  useEffect(() => {
    if (!perfil) return;
    EVENTOS_ACTIVIDAD.forEach((evento) =>
      window.addEventListener(evento, marcarActividad, { passive: true })
    );
    const intervalo = setInterval(() => {
      if (Date.now() - ultimaActividad.current >= MS_INACTIVIDAD) {
        setBloqueado(true);
      }
    }, 15000);
    return () => {
      EVENTOS_ACTIVIDAD.forEach((evento) => window.removeEventListener(evento, marcarActividad));
      clearInterval(intervalo);
    };
  }, [perfil, marcarActividad]);

  const desbloquear = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!perfil) return;
    setVerificando(true);
    setError(null);
    try {
      // Solo se usa para confirmar la contrasena: la sesion ya esta abierta,
      // el token nuevo que devuelve reemplaza al vigente sin ningun efecto
      // adicional (mismo usuario, mismo perfil).
      await api.login(perfil.usuario, password);
      setPassword('');
      setError(null);
      setBloqueado(false);
      marcarActividad();
    } catch (fallo) {
      setError(fallo instanceof ErrorPeticion ? fallo.message : 'No se pudo verificar la contraseña.');
    } finally {
      setVerificando(false);
    }
  };

  if (!perfil || !bloqueado) return <>{children}</>;

  return (
    <>
      {children}
      <div className="modal-fondo" role="dialog" aria-modal="true" data-testid="bloqueo-inactividad">
        <form className="modal tarjeta" onSubmit={(e) => void desbloquear(e)}>
          <h2>Sesión bloqueada por inactividad</h2>
          <p>
            {perfil.nombre_completo}, escribe tu contraseña para seguir. Nada de lo
            capturado se perdió: solo se ocultó la pantalla.
          </p>

          {!enLinea && (
            <div className="mensaje aviso" role="alert">
              Sin conexión: para desbloquear hace falta señal. Si necesitas seguir
              trabajando sin desbloquear, puedes cerrar sesión (tus capturas
              pendientes se avisan antes de perderse).
            </div>
          )}

          {error && (
            <div className="mensaje error" role="alert" data-testid="error-bloqueo-inactividad">
              {error}
            </div>
          )}

          <div className="campo">
            <label htmlFor="input-password-bloqueo">Contraseña</label>
            <CampoPassword
              id="input-password-bloqueo"
              testId="input-password-bloqueo"
              autoComplete="current-password"
              autoFocus
              value={password}
              disabled={!enLinea || verificando}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="acciones">
            <button
              type="submit"
              data-testid="btn-desbloquear"
              disabled={!enLinea || verificando || !password}
            >
              {verificando ? 'Verificando…' : 'Desbloquear'}
            </button>
            <button
              type="button"
              className="secundario"
              data-testid="btn-cerrar-sesion-bloqueo"
              onClick={() => void cerrarSesion()}
            >
              Cerrar sesión
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
