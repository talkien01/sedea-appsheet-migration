// Latido de presencia: reporta al backend en que pantalla esta el usuario.
//
// Reglas que NO se deben relajar:
//   - Falla en silencio. Es informacion para el admin, jamas puede bloquear ni
//     mostrarle un error a quien esta capturando.
//   - No late con la pestana en segundo plano (document.visibilityState): asi
//     el monitor no muestra "activo" a alguien que dejo la pestana abierta y se
//     fue, y se ahorra trafico en las tabletas de campo.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/cliente';
import { tituloDeRuta } from '../navegacion/menu';

/** Cada cuanto se repite el latido mientras la pestana este visible. */
export const INTERVALO_LATIDO_MS = 60_000;

/**
 * Late al montar, en cada cambio de ruta, al volver la pestana a primer plano
 * y cada INTERVALO_LATIDO_MS.
 *
 * @param habilitado false mientras no haya sesion utilizable (p. ej. con el
 *        cambio de contrasena temporal pendiente): ahi no se reporta nada.
 */
export function usoPresencia(habilitado: boolean): void {
  const ubicacion = useLocation();
  const ruta = ubicacion.pathname;
  // La ruta viaja por ref para que el temporizador no haya que recrearlo con
  // cada navegacion y siga mandando siempre la pantalla actual.
  const rutaRef = useRef(ruta);
  rutaRef.current = ruta;

  useEffect(() => {
    if (!habilitado) return;

    const enviar = () => {
      if (document.visibilityState !== 'visible') return;
      const actual = rutaRef.current;
      void api
        .reportarPresencia(actual, tituloDeRuta(actual) || actual)
        .catch(() => undefined);
    };

    enviar();
    const temporizador = window.setInterval(enviar, INTERVALO_LATIDO_MS);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') enviar();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    return () => {
      window.clearInterval(temporizador);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [habilitado, ruta]);
}
