// Barra de estado global: conectividad, usuario, pendientes y sincronizacion manual.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../App';
import { NOMBRE_APP } from '../api/cliente';
import { contarPendientes } from '../db/repositorios';
import { useEstadoRed } from '../sync/estadoRed';
import { alCambiarCola, sincronizarPendientes } from '../sync/motor';
import MenuUsuario from './MenuUsuario';

export default function BarraEstado() {
  const { perfil, cerrarSesion } = useSesion();
  const enLinea = useEstadoRed();
  const [pendientes, setPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);

  const refrescar = useCallback(async () => {
    setPendientes(await contarPendientes());
  }, []);

  useEffect(() => {
    void refrescar();
    const quitar = alCambiarCola(() => void refrescar());
    const intervalo = setInterval(() => void refrescar(), 3000);
    return () => {
      quitar();
      clearInterval(intervalo);
    };
  }, [refrescar]);

  const sincronizarAhora = async () => {
    setSincronizando(true);
    try {
      await sincronizarPendientes();
    } finally {
      setSincronizando(false);
      await refrescar();
    }
  };

  // Mientras la contrasena temporal no se cambie, la navegacion queda
  // bloqueada: la barra solo deja cerrar sesion (10.8.4).
  const bloqueado = perfil?.debe_cambiar_password === true;

  if (bloqueado) {
    return (
      <header className="barra-estado">
        <span className="marca">
          {NOMBRE_APP}
          <span className="usuario" data-testid="usuario-actual">
            {perfil?.nombre_completo}
          </span>
        </span>
        <button
          type="button"
          className="secundario"
          data-testid="nav-cerrar-sesion"
          onClick={() => void cerrarSesion()}
        >
          Cerrar sesión
        </button>
      </header>
    );
  }

  return (
    <header className="barra-estado">
      <span className="marca">{NOMBRE_APP}</span>

      <span
        className={`indicador ${enLinea ? '' : 'sin-conexion'}`}
        data-testid="estado-red"
      >
        <span className={`punto ${enLinea ? '' : 'rojo'}`} />
        {enLinea ? 'En línea' : 'Sin conexión'}
      </span>

      <span className="indicador" data-testid="contador-pendientes">
        Pendientes: {pendientes}
      </span>

      <button
        type="button"
        onClick={() => void sincronizarAhora()}
        disabled={!enLinea || pendientes === 0 || sincronizando}
      >
        {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
      </button>

      {perfil && (perfil.rol === 'auditor' || perfil.rol === 'admin') && (
        <Link className="boton secundario" to="/auditoria">
          Auditoría
        </Link>
      )}

      {/* Depuracion y correcciones son exclusivas del editor de datos y del admin. */}
      {perfil && (perfil.rol === 'editor_datos' || perfil.rol === 'admin') && (
        <Link className="boton secundario" to="/depuracion" data-testid="nav-depuracion">
          Depuración
        </Link>
      )}
      {perfil && (perfil.rol === 'editor_datos' || perfil.rol === 'admin') && (
        <Link className="boton secundario" to="/correcciones" data-testid="nav-correcciones">
          Correcciones
        </Link>
      )}

      {/* El dashboard es informacion agregada de gestion: el capturista no la ve. */}
      {perfil &&
        (perfil.rol === 'admin' || perfil.rol === 'auditor' || perfil.rol === 'editor_datos') && (
          <Link className="boton secundario" to="/dashboard" data-testid="nav-dashboard">
            Dashboard
          </Link>
        )}

      {perfil && (perfil.rol === 'capturista' || perfil.rol === 'admin') && (
        <Link className="boton secundario" to="/sync">
          Sincronización
        </Link>
      )}

      {/* La administracion de usuarios es exclusiva de admin y editor de datos (D15). */}
      {perfil && (perfil.rol === 'admin' || perfil.rol === 'editor_datos') && (
        <Link className="boton secundario" to="/usuarios" data-testid="nav-usuarios">
          Usuarios
        </Link>
      )}

      <MenuUsuario />
    </header>
  );
}
