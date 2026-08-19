// Modo claro/oscuro: origen, persistencia y aplicacion al documento.
// Reglas (S15.6.1):
//   1. Modo inicial = modoGuardado() ?? modoDelSistema().
//   2. Solo se escribe localStorage cuando el usuario pulsa el toggle.
//   3. Mientras no exista la clave, la app sigue en vivo la preferencia
//      del sistema; en cuanto el usuario elige, deja de seguirla.
//   4. data-mode va en <html>, nunca en <body>.
//   5. El toggle no dispara ninguna peticion HTTP ni escribe en IndexedDB.
import { useCallback, useEffect, useState } from 'react';

export type Modo = 'dark' | 'light';

const CLAVE = 'sedea.tema';

/** Color de la barra del navegador por modo (debe coincidir con --bg). */
const COLOR_TEMA: Record<Modo, string> = {
  dark: '#0A0A0C',
  light: '#F5F4EE'
};

/** Lee el modo elegido por el usuario. Ignora cualquier valor invalido. */
export function modoGuardado(): Modo | null {
  try {
    const valor = localStorage.getItem(CLAVE);
    return valor === 'dark' || valor === 'light' ? valor : null;
  } catch {
    return null;
  }
}

/** Preferencia del sistema. Sin preferencia expresada -> oscuro (A15-4). */
export function modoDelSistema(): Modo {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Escribe data-mode en <html> y sincroniza <meta name="theme-color">. */
export function aplicarModo(m: Modo): void {
  document.documentElement.setAttribute('data-mode', m);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', COLOR_TEMA[m]);
}

/** Modo con el que arranca la app (el mismo que calcula el script inline). */
export function modoInicial(): Modo {
  const guardado = modoGuardado();
  if (guardado) return guardado;
  const atributo = document.documentElement.getAttribute('data-mode');
  if (atributo === 'dark' || atributo === 'light') return atributo;
  return modoDelSistema();
}

export interface EstadoTema {
  modo: Modo;
  alternar: () => void;
  /** true cuando el usuario ya eligio y la app deja de seguir al sistema. */
  esExplicito: boolean;
}

export function useTema(): EstadoTema {
  const [modo, setModo] = useState<Modo>(() => modoInicial());
  const [esExplicito, setEsExplicito] = useState<boolean>(() => modoGuardado() !== null);

  // El atributo puede haberlo puesto ya el script anti-parpadeo; se
  // reafirma para que meta[theme-color] quede siempre en sincronia.
  useEffect(() => {
    aplicarModo(modo);
  }, [modo]);

  // Seguimiento del sistema mientras el usuario no haya elegido.
  useEffect(() => {
    if (esExplicito) return;
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = (evento: MediaQueryListEvent) => setModo(evento.matches ? 'dark' : 'light');
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, [esExplicito]);

  const alternar = useCallback(() => {
    setModo((previo) => {
      const siguiente: Modo = previo === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(CLAVE, siguiente);
      } catch {
        /* modo privado sin almacenamiento: el cambio vale solo esta sesion */
      }
      return siguiente;
    });
    setEsExplicito(true);
  }, []);

  return { modo, alternar, esExplicito };
}
