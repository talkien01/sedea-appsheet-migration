// Franja de estado global: conectividad, pendientes, sincronizacion manual y
// quien esta dentro.
//
// Reconversion de BarraEstado.tsx (A15-7). Pierde TODA responsabilidad de
// navegacion —los enlaces se mudaron a navegacion/menu.ts + BarraLateral /
// BarraInferior— y conserva intacta su logica: useEstadoRed(),
// contarPendientes(), alCambiarCola(), el setInterval de 3 s,
// sincronizarPendientes() y la rama de bloqueo por debe_cambiar_password.
//
// data-testid="usuario-actual" se traslada aqui desde MenuUsuario (A15-8)
// para que exista y sea visible en los 3 viewports: en movil MenuUsuario vive
// dentro de la hoja "Mas", que arranca cerrada.
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSesion } from '../App';
import { contarPendientes } from '../db/repositorios';
import { useEstadoRed } from '../sync/estadoRed';
import { alCambiarCola } from '../sync/motor';
import { tituloDeRuta } from '../navegacion/menu';
import Marca from './Marca';
import ToggleTema from './ToggleTema';

interface Props {
  /** Ancho de trabajo del cascaron; decide que se muestra en la franja. */
  ancho: 'movil' | 'tablet' | 'escritorio';
}

export default function FranjaEstado({ ancho }: Props) {
  const { perfil, cerrarSesion } = useSesion();
  const enLinea = useEstadoRed();
  const ubicacion = useLocation();
  const [pendientes, setPendientes] = useState(0);

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

  const esMovil = ancho === 'movil';

  // Mientras la contrasena temporal no se cambie, la navegacion queda
  // bloqueada: la franja solo deja cerrar sesion (10.8.4).
  const bloqueado = perfil?.debe_cambiar_password === true;

  if (bloqueado) {
    return (
      <header className="franja-estado barra-estado">
        <Marca />
        <span className="usuario" data-testid="usuario-actual">
          {perfil?.nombre_completo}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <ToggleTema />
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
    <header className="franja-estado barra-estado">
      {/* En movil manda la marca; en tablet/escritorio la marca vive en el
          sidebar y aqui se muestra el titulo de la ruta activa. */}
      {esMovil ? (
        <Marca />
      ) : (
        <span className="titulo-ruta">{tituloDeRuta(ubicacion.pathname)}</span>
      )}

      <span
        className={`indicador ${enLinea ? '' : 'sin-conexion'}`}
        data-testid="estado-red"
      >
        <span className={`punto ${enLinea ? '' : 'rojo'}`} />
        {enLinea ? 'En línea' : 'Sin conexión'}
      </span>

      <span
        className={`indicador ${pendientes > 0 ? 'con-pendientes' : ''}`}
        data-testid="contador-pendientes"
      >
        Pendientes: {pendientes}
      </span>

      <span className="usuario" data-testid="usuario-actual">
        {perfil && (
          <>
            {perfil.nombre_completo}
            {esMovil
              ? ''
              : ` (${perfil.rol}${perfil.regional_nombre ? ` · ${perfil.regional_nombre}` : ''})`}
          </>
        )}
      </span>

      {/* Regla de S15.6.3: exactamente un toggle visible por viewport. En
          tablet y escritorio el toggle vive en el pie del sidebar. */}
      {esMovil && <ToggleTema />}
    </header>
  );
}
