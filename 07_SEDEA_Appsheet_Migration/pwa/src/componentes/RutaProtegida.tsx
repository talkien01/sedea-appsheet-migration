// Guarda de rutas: exige sesion y, opcionalmente, un rol permitido.
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSesion } from '../App';

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
  const ubicacion = useLocation();

  if (cargando) {
    return <p className="vacio">Cargando...</p>;
  }

  if (!perfil) {
    // Se guarda la ruta pedida (ej. el QR de /entregas/registrar) para volver
    // ahi despues de iniciar sesion, en vez de caer siempre en la pantalla
    // por default del rol (ver Login.tsx, destinoPorRol).
    return <Navigate to="/login" state={{ desde: ubicacion.pathname }} replace />;
  }

  // Guarda global del cambio obligatorio: el backend responde 403 igual, esto
  // evita ademas que la pantalla llegue a pintarse.
  if (perfil.debe_cambiar_password === true && !permiteCambioPendiente) {
    return <Navigate to="/cambiar-password" replace />;
  }

  // El backend tambien devuelve 403; esta comprobacion es solo de experiencia de uso.
  // F-19: se redirige a /sin-permiso (no se pinta en sitio) para que la URL refleje
  // el rechazo cuando se navega directo a una ruta restringida.
  // Multi-rol: se permite si el usuario tiene AL MENOS uno de los roles requeridos.
  if (roles) {
    const rolesUsuario = perfil.rol.split('+');
    const tieneAlguno = roles.some(r => rolesUsuario.includes(r));
    if (!tieneAlguno) {
      return <Navigate to="/sin-permiso" replace />;
    }
  }

  return <>{children}</>;
}
