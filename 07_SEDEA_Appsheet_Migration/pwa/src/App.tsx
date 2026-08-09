// Contexto de sesion + arranque de la sincronizacion automatica.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PerfilUsuario } from '@sedea/shared';
import { api, ErrorPeticion, registrarManejadoresSesion } from './api/cliente';
import {
  actualizarPerfilSesion,
  cerrarSesion as borrarSesion,
  guardarSesion,
  sesionVigente
} from './db/repositorios';
import { iniciarSincronizacionAutomatica } from './sync/motor';
import Rutas from './rutas';

interface ContextoSesionValor {
  perfil: PerfilUsuario | null;
  cargando: boolean;
  iniciarSesion: (usuario: string, password: string) => Promise<PerfilUsuario>;
  cerrarSesion: () => Promise<void>;
  /** Relee el perfil de la API (usado tras cambiar la contrasena). */
  refrescarPerfil: () => Promise<PerfilUsuario | null>;
  /** Mensaje que la pantalla de login debe mostrar tras una expulsion. */
  avisoSesion: string | null;
  limpiarAvisoSesion: () => void;
}

const ContextoSesion = createContext<ContextoSesionValor>({
  perfil: null,
  cargando: true,
  iniciarSesion: async () => {
    throw new Error('Contexto de sesion no inicializado');
  },
  cerrarSesion: async () => undefined,
  refrescarPerfil: async () => null,
  avisoSesion: null,
  limpiarAvisoSesion: () => undefined
});

export function useSesion(): ContextoSesionValor {
  return useContext(ContextoSesion);
}

function ProveedorSesion({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [avisoSesion, setAvisoSesion] = useState<string | null>(null);
  const navegar = useNavigate();

  useEffect(() => {
    // Si hay una sesion local no expirada la app abre sin red.
    void (async () => {
      const sesion = await sesionVigente();
      setPerfil(sesion?.perfil ?? null);
      setCargando(false);
    })();
    iniciarSincronizacionAutomatica();
  }, []);

  const cerrar = useCallback(async () => {
    await borrarSesion();
    setPerfil(null);
  }, []);

  // Guarda global del build 4: el cliente HTTP avisa aqui cuando el backend
  // exige cambiar la contrasena o cuando la cuenta ya no esta activa.
  useEffect(() => {
    registrarManejadoresSesion({
      alCambioRequerido: () => {
        setPerfil((previo) => (previo ? { ...previo, debe_cambiar_password: true } : previo));
        navegar('/cambiar-password', { replace: true });
      },
      alCuentaDesactivada: (mensaje) => {
        setAvisoSesion(mensaje);
        void (async () => {
          await cerrar();
          navegar('/login', { replace: true });
        })();
      }
    });
  }, [navegar, cerrar]);

  const iniciarSesion = useCallback(async (usuario: string, password: string) => {
    const respuesta = await api.login(usuario, password);
    await guardarSesion(respuesta.token, respuesta.usuario);
    setPerfil(respuesta.usuario);
    setAvisoSesion(null);
    return respuesta.usuario;
  }, []);

  const refrescarPerfil = useCallback(async () => {
    try {
      const { usuario } = await api.perfil();
      await actualizarPerfilSesion(usuario);
      setPerfil(usuario);
      return usuario;
    } catch {
      return null;
    }
  }, []);

  const valor = useMemo(
    () => ({
      perfil,
      cargando,
      iniciarSesion,
      cerrarSesion: cerrar,
      refrescarPerfil,
      avisoSesion,
      limpiarAvisoSesion: () => setAvisoSesion(null)
    }),
    [perfil, cargando, iniciarSesion, cerrar, refrescarPerfil, avisoSesion]
  );

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export { ErrorPeticion };

export default function App() {
  return (
    <ProveedorSesion>
      <Rutas />
    </ProveedorSesion>
  );
}
