// Cascaron responsivo de la aplicacion.
//
// REGLA CRITICA (S15.5.2): la barra lateral y la barra inferior se MONTAN y
// DESMONTAN con matchMedia (useAncho), nunca se ocultan con display:none. Si
// coexistieran en el DOM, cada data-testid de navegacion aparecería dos veces
// y todos los page.click('[data-testid=nav-...]') de los criterios 1-386
// fallarían por selector ambiguo.
//
//   movil (<768)        -> FranjaEstado + contenido + BarraInferior
//   tablet (768-1023)   -> FranjaEstado + BarraLateral (rail) + contenido
//   escritorio (>=1024) -> FranjaEstado + BarraLateral (expandida) + contenido
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Outlet } from 'react-router-dom';
import { useSesion } from '../App';
import { useAncho } from '../tema/viewport';
import BarraInferior from './BarraInferior';
import BarraLateral, { type ModoLateral } from './BarraLateral';
import FranjaEstado from './FranjaEstado';
import { usoPresencia } from './usoPresencia';

const CLAVE_LATERAL = 'sedea.lateral';

/** Estado guardado del sidebar; si no hay nada, depende del ancho (A15-5). */
function modoLateralInicial(esEscritorio: boolean): ModoLateral {
  try {
    const valor = localStorage.getItem(CLAVE_LATERAL);
    if (valor === 'rail' || valor === 'expandido') return valor;
  } catch {
    /* sin almacenamiento: se usa el default por ancho */
  }
  return esEscritorio ? 'expandido' : 'rail';
}

export default function Cascaron() {
  const { perfil } = useSesion();
  const ancho = useAncho();
  const [modoLateral, setModoLateral] = useState<ModoLateral>(() =>
    modoLateralInicial(ancho === 'escritorio')
  );
  // En tablet, tocar la marca abre el sidebar como overlay sobre el contenido.
  const [overlay, setOverlay] = useState(false);

  const alternarLateral = useCallback(() => {
    setModoLateral((previo) => {
      const siguiente: ModoLateral = previo === 'rail' ? 'expandido' : 'rail';
      try {
        localStorage.setItem(CLAVE_LATERAL, siguiente);
      } catch {
        /* sin almacenamiento: el cambio vale solo esta sesion */
      }
      return siguiente;
    });
  }, []);

  // El overlay solo tiene sentido en tablet.
  useEffect(() => {
    if (ancho !== 'tablet') setOverlay(false);
  }, [ancho]);

  // Mientras la contrasena temporal no se cambie no hay navegacion: ni
  // sidebar ni barra inferior, solo la franja (criterio 10.8.4).
  const bloqueado = perfil?.debe_cambiar_password === true;

  // Latido de presencia para el monitor del admin. Va aqui porque el cascaron
  // envuelve a todas las pantallas con sesion; falla en silencio.
  usoPresencia(Boolean(perfil) && !bloqueado);

  const anchoLateral = modoLateral === 'rail' ? '72px' : '256px';

  if (bloqueado) {
    return (
      <div className="cascaron" data-ancho={ancho} data-bloqueado="si">
        <a className="salto-contenido" href="#contenido">
          Ir al contenido
        </a>
        <FranjaEstado ancho={ancho} />
        <main className="contenido" id="contenido">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div
      className="cascaron"
      data-ancho={ancho}
      style={
        {
          '--ancho-lateral': ancho === 'movil' ? '0px' : anchoLateral
        } as CSSProperties
      }
    >
      <a className="salto-contenido" href="#contenido">
        Ir al contenido
      </a>

      {ancho !== 'movil' && (
        <BarraLateral
          rol={perfil?.rol}
          modo={overlay ? 'expandido' : modoLateral}
          esOverlay={overlay}
          alAlternarModo={alternarLateral}
          alNavegar={overlay ? () => setOverlay(false) : undefined}
          alPulsarMarca={
            ancho === 'tablet' && !overlay ? () => setOverlay(true) : undefined
          }
        />
      )}

      {overlay && (
        <div className="velo-lateral" onClick={() => setOverlay(false)} aria-hidden="true" />
      )}

      <FranjaEstado ancho={ancho} />

      <main className="contenido" id="contenido">
        <Outlet />
      </main>

      {ancho === 'movil' && <BarraInferior rol={perfil?.rol} />}
    </div>
  );
}
