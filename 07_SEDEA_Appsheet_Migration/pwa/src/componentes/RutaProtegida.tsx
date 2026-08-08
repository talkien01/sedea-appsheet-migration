// Guarda de rutas: exige sesion y, opcionalmente, un rol permitido.
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSesion } from '../App';
import SinPermiso from '../pantallas/SinPermiso';

interface Props {
  children: ReactNode;
  roles?: string[];
}

export default function RutaProtegida({ children, roles }: Props) {
  const { perfil, cargando } = useSesion();

  if (cargando) {
    return <p className="vacio">Cargando...</p>;
  }

  if (!perfil) {
    return <Navigate to="/login" replace />;
  }

  // El backend tambien devuelve 403; esta comprobacion es solo de experiencia de uso.
  if (roles && !roles.includes(perfil.rol)) {
    return <SinPermiso />;
  }

  return <>{children}</>;
}
