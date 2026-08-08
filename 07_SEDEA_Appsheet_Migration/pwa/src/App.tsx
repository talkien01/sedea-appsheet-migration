// Contexto de sesion + arranque de la sincronizacion automatica.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PerfilUsuario } from '@sedea/shared';
import { api, ErrorPeticion } from './api/cliente';
import {
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
}

const ContextoSesion = createContext<ContextoSesionValor>({
  perfil: null,
  cargando: true,
  iniciarSesion: async () => {
    throw new Error('Contexto de sesion no inicializado');
  },
  cerrarSesion: async () => undefined
});

export function useSesion(): ContextoSesionValor {
  return useContext(ContextoSesion);
}

function ProveedorSesion({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // Si hay una sesion local no expirada la app abre sin red.
    void (async () => {
      const sesion = await sesionVigente();
      setPerfil(sesion?.perfil ?? null);
      setCargando(false);
    })();
    iniciarSincronizacionAutomatica();
  }, []);

  const iniciarSesion = useCallback(async (usuario: string, password: string) => {
    const respuesta = await api.login(usuario, password);
    await guardarSesion(respuesta.token, respuesta.usuario);
    setPerfil(respuesta.usuario);
    return respuesta.usuario;
  }, []);

  const cerrar = useCallback(async () => {
    await borrarSesion();
    setPerfil(null);
  }, []);

  const valor = useMemo(
    () => ({ perfil, cargando, iniciarSesion, cerrarSesion: cerrar }),
    [perfil, cargando, iniciarSesion, cerrar]
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
