// Pausa del ENVIO de capturas y entregas (fotos). Es una preferencia del
// dispositivo, no de la sesion: por eso vive en localStorage y NO se borra al
// cerrar sesion (limpiarBaseLocal solo limpia IndexedDB).
//
// Pedido de campo: el capturista quiere poder usar el celular con datos moviles
// (WhatsApp, etc.) sin que la app suba fotos sola. Bajar el padron o el paquete
// de entrega NO se pausa nunca -- solo la subida. Por default el envio esta
// ACTIVO (comportamiento de siempre); pausar es opt-in.
//
// Web no puede distinguir WiFi de datos moviles de forma confiable
// (navigator.connection.type solo existe en Chrome Android y a veces vacio; en
// iPhone no existe), asi que la pausa es manual y funciona igual en todos.
import { useEffect, useState } from 'react';

const CLAVE = 'sedea_envio_pausado';
const escuchas = new Set<() => void>();

export function envioPausado(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '1';
  } catch {
    return false;
  }
}

export function fijarEnvioPausado(pausado: boolean): void {
  try {
    if (pausado) localStorage.setItem(CLAVE, '1');
    else localStorage.removeItem(CLAVE);
  } catch {
    // Sin localStorage (modo privado estricto): la pausa no se puede guardar.
  }
  for (const escucha of escuchas) escucha();
}

export function alCambiarPausa(escucha: () => void): () => void {
  escuchas.add(escucha);
  return () => escuchas.delete(escucha);
}

/** Hook de React: se re-renderiza cuando cambia la pausa (esta u otra pestana). */
export function useEnvioPausado(): boolean {
  const [pausado, setPausado] = useState(envioPausado());
  useEffect(() => {
    const actualizar = () => setPausado(envioPausado());
    const quitar = alCambiarPausa(actualizar);
    window.addEventListener('storage', actualizar);
    return () => {
      quitar();
      window.removeEventListener('storage', actualizar);
    };
  }, []);
  return pausado;
}
