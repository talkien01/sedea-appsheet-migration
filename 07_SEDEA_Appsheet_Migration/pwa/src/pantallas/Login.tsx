// Pantalla de inicio de sesion. Permite entrar sin red si ya existe una
// sesion local vigente (el JWT dura 12 h).
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../App';
import { ErrorPeticion, NOMBRE_APP } from '../api/cliente';
import { contarBeneficiarios, sesionVigente } from '../db/repositorios';
import type { PerfilUsuario } from '@sedea/shared';
import { useEstadoRed } from '../sync/estadoRed';
import ToggleTema from '../componentes/ToggleTema';

/**
 * Destino tras iniciar sesion segun el rol: cada perfil aterriza en su propia
 * seccion en vez de en el padron de campo (que no todos pueden ver).
 */
async function destinoPorRol(perfilUsuario: PerfilUsuario | null): Promise<string> {
  // Build 4: la contrasena temporal manda sobre el destino por rol.
  if (perfilUsuario?.debe_cambiar_password === true) return '/cambiar-password';
  // Build 6: el usuario de ventanilla aterriza en su modulo.
  if (perfilUsuario?.rol === 'ventanilla') return '/solicitudes';
  if (perfilUsuario?.rol === 'editor_datos') return '/depuracion';
  if (perfilUsuario?.rol === 'auditor') return '/auditoria';
  const total = await contarBeneficiarios();
  return total === 0 ? '/sync' : '/beneficiarios';
}

export default function Login() {
  const { iniciarSesion, perfil, avisoSesion, limpiarAvisoSesion } = useSesion();
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
        navegar(await destinoPorRol(sesion.perfil), { replace: true });
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
      limpiarAvisoSesion();
      const usuarioAutenticado = await iniciarSesion(usuario.trim(), password);
      navegar(await destinoPorRol(usuarioAutenticado), { replace: true });
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
    <main className="contenido pantalla-rejilla">
      {/* /login no lleva cascaron: el toggle vive suelto arriba a la derecha. */}
      <ToggleTema clase="toggle-login" />

      <div className="tarjeta login-caja">
        {/* Portada oficial del sistema: aqui si va el lockup completo de SEDEA
            (principal) y debajo, mas chico, el de Gobierno del Estado. No se
            usa <Marca> porque su escudo saldria repetido dentro del lockup. */}
        <div className="marca-login">
          <img
            className="logo-sedea"
            src="/logos/sedea-horizontal.png"
            alt="Secretaría de Desarrollo Agropecuario — Poder Ejecutivo del Estado de Querétaro"
            decoding="async"
          />
          <img
            className="logo-gobierno"
            src="/logos/qro-gobierno.png"
            alt="Querétaro — Gobierno del Estado"
            decoding="async"
          />
        </div>
        <h1>{NOMBRE_APP}</h1>
        <p className="dato">Sistema de Programas de Apoyo a Contingencias</p>

        {!enLinea && (
          <div className="mensaje aviso" role="status">
            Sin conexión. Solo puedes entrar si ya iniciaste sesión en este dispositivo.
          </div>
        )}

        {/* Aviso al ser expulsado por una cuenta desactivada (build 4). */}
        {avisoSesion && !error && (
          <div className="mensaje error" role="alert" data-testid="aviso-sesion">
            {avisoSesion}
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

          <button type="submit" className="boton-entrar" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </main>
  );
}
