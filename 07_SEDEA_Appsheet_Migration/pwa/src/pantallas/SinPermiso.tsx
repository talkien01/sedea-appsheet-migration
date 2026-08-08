// Pantalla mostrada cuando el rol del usuario no alcanza para la seccion.
import { Link } from 'react-router-dom';

export default function SinPermiso() {
  return (
    <div className="tarjeta">
      <h1>No tienes permiso para ver esta sección.</h1>
      <p>
        Tu cuenta no cuenta con el rol necesario para consultar el panel de auditoría. Si crees
        que se trata de un error, solicita a la administración que revise tu rol asignado.
      </p>
      <Link className="boton" to="/beneficiarios">
        Volver al padrón
      </Link>
    </div>
  );
}
