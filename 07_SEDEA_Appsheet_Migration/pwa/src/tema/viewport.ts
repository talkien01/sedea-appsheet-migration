// Ancho de trabajo del cascaron.
//
// Este modulo existe por una razon dura (S15.5.2): el cambio entre sidebar y
// barra inferior se hace MONTANDO Y DESMONTANDO componentes, no con
// display:none. Si ambas barras coexistieran en el DOM, cada data-testid de
// navegacion (nav-dashboard, nav-usuarios, ...) aparecería dos veces y todos
// los page.click('[data-testid=nav-...]') fallarian por selector ambiguo.
//
// Invariante: en cualquier viewport, cada data-testid que empieza con `nav-`
// aparece como maximo una vez en el DOM.
import { useEffect, useState } from 'react';

export type Ancho = 'movil' | 'tablet' | 'escritorio';

const TABLET = '(min-width: 768px)';
const ESCRITORIO = '(min-width: 1024px)';

/** Calculo sincrono: se usa tambien para el estado inicial, sin parpadeo. */
export function anchoActual(): Ancho {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'escritorio';
  }
  if (window.matchMedia(ESCRITORIO).matches) return 'escritorio';
  if (window.matchMedia(TABLET).matches) return 'tablet';
  return 'movil';
}

export function useAncho(): Ancho {
  const [ancho, setAncho] = useState<Ancho>(() => anchoActual());

  useEffect(() => {
    const tablet = window.matchMedia(TABLET);
    const escritorio = window.matchMedia(ESCRITORIO);
    const recalcular = () => setAncho(anchoActual());

    tablet.addEventListener('change', recalcular);
    escritorio.addEventListener('change', recalcular);
    // Por si el viewport cambio entre el primer render y el efecto.
    recalcular();

    return () => {
      tablet.removeEventListener('change', recalcular);
      escritorio.removeEventListener('change', recalcular);
    };
  }, []);

  return ancho;
}
