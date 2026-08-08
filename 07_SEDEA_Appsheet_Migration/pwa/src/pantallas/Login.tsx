// Pantalla de inicio de sesion. Permite entrar sin red si ya existe una
// sesion local vigente (el JWT dura 12 h).
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../App';
import { ErrorPeticion, NOMBRE_APP } from '../api/cliente';
import { contarBeneficiarios, sesionVigente } from '../db/repositorios';
import { useEstadoRed } from '../sync/estadoRed';

export default function Login() {
  const { iniciarSesion, perfil } = useSesion();
  const navegar = useNavigate();
  const enLinea = useEstadoRed();

  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Si ya hay sesion vigente en IndexedDB se entra directo (modo offline).
  useEffect(() => {
    void (async () => {
      const sesion = await sesionVigente();
      if (sesion) {
        const total = await contarBeneficiarios();
        navegar(total === 0 ? '/sync' : '/beneficiarios', { replace: true });
      }
    })();
  }, [navegar, perfil]);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);

    if (!enLinea) {
      const sesion = await sesionVigente();
      if (!sesion) {
        setError('Necesitas conexión para iniciar sesión por primera vez.');
        return;
      }
    }

    setEnviando(true);
    try {
      await iniciarSesion(usuario.trim(), password);
      const total = await contarBeneficiarios();
      navegar(total === 0 ? '/sync' : '/beneficiarios', { replace: true });
    } catch (fallo) {
      if (fallo instanceof ErrorPeticion) {
        if (fallo.estado === 401) setError('Usuario o contraseña incorrectos.');
        else if (fallo.estado === 0)
          setError('Necesitas conexión para iniciar sesión por primera vez.');
        else setError(fallo.message);
      } else {
        setError('No fue posible iniciar sesión.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="contenido">
      <div className="tarjeta login-caja">
        <h1>{NOMBRE_APP}</h1>
        <p className="dato">
          Evidencia de entrega de apoyos agropecuarios — SEDEA Querétaro
        </p>

        {!enLinea && (
          <div className="mensaje aviso" role="status">
            Sin conexión. Solo puedes entrar si ya iniciaste sesión en este dispositivo.
          </div>
        )}

        {error && (
          <div className="mensaje error" role="alert" data-testid="error-login">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void enviar(e)}>
          <div className="campo">
            <label htmlFor="usuario">Usuario</label>
            <input
              id="usuario"
              name="usuario"
              type="text"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </main>
  );
}
