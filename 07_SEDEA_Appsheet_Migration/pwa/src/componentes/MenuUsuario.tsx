// Menu de usuario (build 4). Agrupa las dos acciones de cuenta: cambiar la
// propia contrasena (disponible para los 4 roles) y cerrar sesion.
//
// Build 9: `usuario-actual` se traslada a FranjaEstado (A15-8) para que exista
// y sea visible en los 3 viewports; aqui quedan solo las dos acciones. Deja de
// ser una fila horizontal con margin-left:auto y pasa a bloque vertical, que
// es lo que necesitan el pie del sidebar y la hoja "Mas".
import { Link, useNavigate } from 'react-router-dom';
import { useSesion } from '../App';
import { IconoLlave, IconoSalir } from './Iconos';

interface Props {
  /** En modo rail del sidebar la etiqueta se oculta solo visualmente. */
  compacto?: boolean;
}

export default function MenuUsuario({ compacto = false }: Props) {
  const { cerrarSesion } = useSesion();
  const navegar = useNavigate();

  const salir = async () => {
    await cerrarSesion();
    navegar('/login', { replace: true });
  };

  return (
    <span className="menu-usuario" data-testid="menu-usuario">
      <Link
        className="boton secundario"
        to="/cambiar-password"
        data-testid="nav-cambiar-password"
        aria-label="Cambiar mi contraseña"
        title="Cambiar mi contraseña"
      >
        <IconoLlave tamano={16} />
        <span className={compacto ? 'sr-solo' : ''}>Cambiar mi contraseña</span>
      </Link>

      <button
        type="button"
        className="secundario"
        data-testid="nav-cerrar-sesion"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        onClick={() => void salir()}
      >
        <IconoSalir tamano={16} />
        <span className={compacto ? 'sr-solo' : ''}>Cerrar sesión</span>
      </button>
    </span>
  );
}
