// Contexto de sesion + arranque de la sincronizacion automatica.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PerfilUsuario } from '@sedea/shared';
import { api, ErrorPeticion, registrarManejadoresSesion } from './api/cliente';
import {
  actualizarPerfilSesion,
  contarEntregasPendientes,
  contarPendientes,
  guardarSesion,
  limpiarBaseLocal,
  sesionVigente
} from './db/repositorios';
import { iniciarSincronizacionAutomatica } from './sync/motor';
import BloqueoInactividad from './componentes/BloqueoInactividad';
import Rutas from './rutas';

interface ContextoSesionValor {
  perfil: PerfilUsuario | null;
  cargando: boolean;
  iniciarSesion: (usuario: string, password: string) => Promise<PerfilUsuario>;
  /**
   * Borra sesion Y todos los datos locales (padron, capturas, entregas):
   * el dispositivo puede ser un celular personal compartido con otras
   * personas, no solo una tablet de la Secretaria. Si hay capturas/entregas
   * sin sincronizar, pide confirmacion antes de perderlas -- salvo cierre
   * forzado (cuenta desactivada), que no puede esperar una respuesta.
   * Devuelve false si el usuario cancela por datos pendientes.
   */
  cerrarSesion: (opciones?: { forzado?: boolean }) => Promise<boolean>;
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
  cerrarSesion: async () => false,
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

  const cerrar = useCallback(async (opciones?: { forzado?: boolean }) => {
    if (!opciones?.forzado) {
      const [capturasPendientes, entregasPendientes] = await Promise.all([
        contarPendientes(),
        contarEntregasPendientes()
      ]);
      const total = capturasPendientes + entregasPendientes;
      if (total > 0) {
        const continuar = window.confirm(
          `Este dispositivo tiene ${total} captura(s)/entrega(s) sin sincronizar. ` +
            'Si cierras sesión se perderán junto con el resto de los datos ' +
            'guardados en este equipo (padrón, fotos, capturas). ' +
            '¿Cerrar sesión de todas formas?'
        );
        if (!continuar) return false;
      }
    }
    await limpiarBaseLocal();
    setPerfil(null);
    return true;
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
          await cerrar({ forzado: true });
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

  return (
    <ContextoSesion.Provider value={valor}>
      <BloqueoInactividad>{children}</BloqueoInactividad>
    </ContextoSesion.Provider>
  );
}

export { ErrorPeticion };

export default function App() {
  return (
    <ProveedorSesion>
      <Rutas />
    </ProveedorSesion>
  );
}
