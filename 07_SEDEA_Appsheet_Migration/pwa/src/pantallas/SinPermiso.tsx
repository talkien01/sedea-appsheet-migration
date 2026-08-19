// Pantalla mostrada cuando el rol del usuario no alcanza para la seccion.
import { Link } from 'react-router-dom';
import { IconoCandado } from '../componentes/Iconos';

export default function SinPermiso() {
  return (
    <div className="pantalla-rejilla">
      <div className="tarjeta login-caja" style={{ textAlign: 'center' }}>
        <IconoCandado tamano={48} style={{ color: 'var(--fg-subtle)' }} />
        <h1>No tienes permiso para ver esta sección.</h1>
        <p>
          Tu cuenta no cuenta con el rol necesario para acceder a esta sección. Si crees
          que se trata de un error, solicita a la administración que revise tu rol asignado.
        </p>
        <Link className="boton" to="/beneficiarios">
          Volver al padrón
        </Link>
      </div>
    </div>
  );
}
