// Lectura de los colores del tema activo para las graficas de Chart.js.
//
// Las graficas no pueden llevar colores fijos: el verde institucional que se
// veia bien sobre blanco es ilegible sobre el fondo oscuro. Los colores se
// leen de las variables CSS del modo activo y las graficas se vuelven a
// construir cuando cambia data-mode.
import { useEffect, useState } from 'react';

export interface ColoresTema {
  acento: string;
  exito: string;
  aviso: string;
  info: string;
  tenue: string;
  borde: string;
  texto: string;
}

function leer(nombre: string, respaldo: string): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return valor || respaldo;
}

export function coloresDelTema(): ColoresTema {
  return {
    acento: leer('--accent', '#FF5A1F'),
    exito: leer('--exito', '#4ADE80'),
    aviso: leer('--aviso', '#FBBF24'),
    info: leer('--info', '#A8B8FF'),
    tenue: leer('--fg-muted', '#9A9AA8'),
    borde: leer('--border', 'rgba(255,255,255,0.08)'),
    texto: leer('--fg', '#FAFAF7')
  };
}

/**
 * Colores del tema activo, recalculados cuando cambia el atributo data-mode
 * de <html>. Se observa el DOM en vez de compartir estado con useTema para
 * que funcione sea quien sea el que alterne el tema.
 */
export function useColoresTema(): ColoresTema {
  const [colores, setColores] = useState<ColoresTema>(() => coloresDelTema());

  useEffect(() => {
    const observador = new MutationObserver(() => setColores(coloresDelTema()));
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode']
    });
    return () => observador.disconnect();
  }, []);

  return colores;
}
