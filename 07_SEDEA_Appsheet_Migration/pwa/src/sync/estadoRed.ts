// Estado de conectividad: eventos online/offline del navegador mas un ping
// ligero a /api/health cada 60 s para detectar redes "conectadas pero muertas".
import { useEffect, useState } from 'react';
import { URL_API } from '../api/cliente';

type Escucha = (enLinea: boolean) => void;

let enLineaActual = typeof navigator !== 'undefined' ? navigator.onLine : true;
const escuchas = new Set<Escucha>();

function difundir(valor: boolean): void {
  if (valor === enLineaActual) return;
  enLineaActual = valor;
  for (const escucha of escuchas) escucha(valor);
}

async function ping(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    difundir(false);
    return;
  }
  try {
    const respuesta = await fetch(`${URL_API}/health`, { cache: 'no-store' });
    difundir(respuesta.ok);
  } catch {
    difundir(false);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => difundir(true));
  window.addEventListener('offline', () => difundir(false));
  setInterval(() => void ping(), 60000);
}

export function estaEnLinea(): boolean {
  return enLineaActual;
}

/** Hook de React con el estado de red actual. */
export function useEstadoRed(): boolean {
  const [enLinea, setEnLinea] = useState(enLineaActual);

  useEffect(() => {
    const escucha: Escucha = (valor) => setEnLinea(valor);
    escuchas.add(escucha);
    // Sincroniza al montar por si cambio antes de suscribirse.
    setEnLinea(typeof navigator !== 'undefined' ? navigator.onLine && enLineaActual : enLineaActual);
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);
    return () => {
      escuchas.delete(escucha);
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
    };
  }, []);

  return enLinea;
}
