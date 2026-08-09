// Menu de usuario de la barra de estado (build 4).
// Agrupa el nombre de quien esta dentro con las dos acciones de cuenta:
// cambiar la propia contrasena (disponible para los 4 roles) y cerrar sesion.
import { Link, useNavigate } from 'react-router-dom';
import { useSesion } from '../App';

export default function MenuUsuario() {
  const { perfil, cerrarSesion } = useSesion();
  const navegar = useNavigate();

  const salir = async () => {
    await cerrarSesion();
    navegar('/login', { replace: true });
  };

  return (
    <span className="menu-usuario" data-testid="menu-usuario">
      {perfil && (
        <span className="usuario" data-testid="usuario-actual">
          {perfil.nombre_completo} ({perfil.rol}
          {perfil.regional_nombre ? ` · ${perfil.regional_nombre}` : ''})
        </span>
      )}

      <Link className="boton secundario" to="/cambiar-password" data-testid="nav-cambiar-password">
        Cambiar mi contraseña
      </Link>

      <button
        type="button"
        className="secundario"
        data-testid="nav-cerrar-sesion"
        onClick={() => void salir()}
      >
        Cerrar sesión
      </button>
    </span>
  );
}
