// Actualizacion del Service Worker.
//
// Reportado en produccion: un fix critico (camara/escaneo) no llegaba a un
// celular que ya tenia la PWA abierta, aun despues del deploy -- el registro
// minimo que vite-plugin-pwa inyecta por default (`injectRegister: 'auto'`)
// solo hace `navigator.serviceWorker.register()` una vez al cargar, sin
// volver a revisar despues ni recargar la pagina cuando encuentra version
// nueva. skipWaiting+clientsClaim (vite.config.ts) ya activan el SW nuevo
// solo, pero el JS que YA esta corriendo en memoria en una pestana abierta
// sigue siendo el viejo hasta que la pagina se recarga -- por eso "el
// celular sigue abriendo una version vieja" incluso despues del deploy.
import { registerSW } from 'virtual:pwa-register';

/** Cada cuanto se revisa si hay version nueva mientras la app sigue abierta. */
const MS_ENTRE_REVISIONES = 30 * 60 * 1000;

export function activarActualizacionAutomatica(): void {
  if (!('serviceWorker' in navigator)) return;

  // Si YA habia un controlador al cargar, es una visita de vuelta (la app
  // ya estaba instalada) -- un controllerchange despues de esto SI es una
  // version nueva de verdad. Si no habia controlador, es la primera
  // instalacion: ese primer controllerchange no es una actualizacion, ya se
  // cargo con la version correcta, no hace falta recargar.
  const yaHabiaControlador = Boolean(navigator.serviceWorker.controller);

  registerSW({ immediate: true });

  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !yaHabiaControlador) return;
    recargando = true;
    window.location.reload();
  });

  void navigator.serviceWorker.ready.then((registration) => {
    // Revisa version nueva cada 30 min mientras la app siga abierta, y
    // tambien cada vez que vuelve a primer plano (celular que estuvo en
    // segundo plano horas/dias, el caso real reportado).
    setInterval(() => void registration.update(), MS_ENTRE_REVISIONES);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update();
    });
  });
}
