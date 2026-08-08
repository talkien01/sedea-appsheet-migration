// Barra de estado global: conectividad, usuario, pendientes y sincronizacion manual.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSesion } from '../App';
import { NOMBRE_APP } from '../api/cliente';
import { contarPendientes } from '../db/repositorios';
import { useEstadoRed } from '../sync/estadoRed';
import { alCambiarCola, sincronizarPendientes } from '../sync/motor';

export default function BarraEstado() {
  const { perfil, cerrarSesion } = useSesion();
  const enLinea = useEstadoRed();
  const navegar = useNavigate();
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

  const salir = async () => {
    await cerrarSesion();
    navegar('/login', { replace: true });
  };

  return (
    <header className="barra-estado">
      <span className="marca">
        {NOMBRE_APP}
        {perfil && (
          <span className="usuario" data-testid="usuario-actual">
            {perfil.nombre_completo} ({perfil.rol}
            {perfil.regional_nombre ? ` · ${perfil.regional_nombre}` : ''})
          </span>
        )}
      </span>

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
      <Link className="boton secundario" to="/sync">
        Sincronización
      </Link>
      <button type="button" className="secundario" onClick={() => void salir()}>
        Salir
      </button>
    </header>
  );
}
