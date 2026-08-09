// Guarda de rutas: exige sesion y, opcionalmente, un rol permitido.
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSesion } from '../App';
import SinPermiso from '../pantallas/SinPermiso';

interface Props {
  children: ReactNode;
  roles?: string[];
  /**
   * Build 4: unicamente /cambiar-password se puede abrir mientras el usuario
   * tenga pendiente el cambio de contrasena obligatorio.
   */
  permiteCambioPendiente?: boolean;
}

export default function RutaProtegida({ children, roles, permiteCambioPendiente }: Props) {
  const { perfil, cargando } = useSesion();

  if (cargando) {
    return <p className="vacio">Cargando...</p>;
  }

  if (!perfil) {
    return <Navigate to="/login" replace />;
  }

  // Guarda global del cambio obligatorio: el backend responde 403 igual, esto
  // evita ademas que la pantalla llegue a pintarse.
  if (perfil.debe_cambiar_password === true && !permiteCambioPendiente) {
    return <Navigate to="/cambiar-password" replace />;
  }

  // El backend tambien devuelve 403; esta comprobacion es solo de experiencia de uso.
  if (roles && !roles.includes(perfil.rol)) {
    return <SinPermiso />;
  }

  return <>{children}</>;
}
