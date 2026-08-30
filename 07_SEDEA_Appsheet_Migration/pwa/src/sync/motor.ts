// Motor de sincronizacion de capturas pendientes.
// - Se dispara al abrir la app, con el evento 'online' y con el boton manual.
// - Idempotente: el backend hace UPSERT por uuid, reenviar no duplica.
// - Reintentos: hasta 5 con backoff exponencial (2^n segundos).
import { api, ErrorPeticion } from '../api/cliente';
import { db } from '../db/indexeddb';
import { capturasPendientes, entregasPendientes } from '../db/repositorios';
import { marcarEstado, marcarEstadoEntrega } from './cola';
import { estaEnLinea } from './estadoRed';

const MAX_INTENTOS = 5;

let sincronizando = false;
const escuchas = new Set<() => void>();

/** Permite a la UI refrescar contadores cuando cambia la cola. */
export function alCambiarCola(escucha: () => void): () => void {
  escuchas.add(escucha);
  return () => escuchas.delete(escucha);
}

function notificar(): void {
  for (const escucha of escuchas) escucha();
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ResultadoSync {
  enviadas: number;
  duplicadas: number;
  fallidas: number;
}

/** Envia todas las capturas pendientes. Devuelve el resumen del intento. */
export async function sincronizarPendientes(): Promise<ResultadoSync> {
  const resultado: ResultadoSync = { enviadas: 0, duplicadas: 0, fallidas: 0 };
  if (sincronizando) return resultado;
  if (!estaEnLinea()) return resultado;

  sincronizando = true;
  try {
    const pendientes = await capturasPendientes();

    for (const captura of pendientes) {
      if (!captura.foto) {
        // Sin foto local no hay nada que enviar: se marca como error visible.
        await marcarEstado(captura.uuid, 'error', {
          error_msg: 'La fotografia local ya no esta disponible.'
        });
        resultado.fallidas++;
        continue;
      }

      await marcarEstado(captura.uuid, 'sincronizando');
      notificar();

      const formulario = new FormData();
      formulario.append('uuid', captura.uuid);
      formulario.append('beneficiario_id', String(captura.beneficiario_id));
      formulario.append('lat', String(captura.lat));
      formulario.append('lng', String(captura.lng));
      formulario.append('precision_m', String(captura.precision_m));
      formulario.append('capturado_en', captura.capturado_en);
      if (captura.tipo_apoyo_id !== null && captura.tipo_apoyo_id !== undefined) {
        formulario.append('tipo_apoyo_id', String(captura.tipo_apoyo_id));
      }
      if (captura.cantidad_entregada !== null && captura.cantidad_entregada !== undefined) {
        formulario.append('cantidad_entregada', String(captura.cantidad_entregada));
      }
      if (captura.observaciones) formulario.append('observaciones', captura.observaciones);
      // El servidor exige un mimetype image/*; si el Blob perdio el tipo se reetiqueta.
      const archivoFoto = captura.foto.type.startsWith('image/')
        ? captura.foto
        : new Blob([captura.foto], { type: 'image/jpeg' });
      formulario.append('foto', archivoFoto, `${captura.uuid}.jpg`);

      let intentos = captura.intentos ?? 0;
      let enviado = false;
      let ultimoError = '';

      while (!enviado && intentos < MAX_INTENTOS) {
        try {
          const respuesta = await api.subirCaptura(formulario);
          // Al exito se libera el Blob de IndexedDB y se guarda la URL remota.
          await db.capturas.update(captura.uuid, {
            estado: 'sincronizada',
            foto: null,
            foto_url: respuesta.foto_url,
            error_msg: null,
            intentos
          });
          if (respuesta.duplicado) resultado.duplicadas++;
          else resultado.enviadas++;
          enviado = true;
        } catch (error) {
          intentos++;
          ultimoError =
            error instanceof ErrorPeticion ? error.message : 'Error desconocido al sincronizar.';

          // Un 422/403 no se resuelve reintentando.
          if (error instanceof ErrorPeticion && [403, 404, 422].includes(error.estado)) {
            intentos = MAX_INTENTOS;
            break;
          }
          if (intentos < MAX_INTENTOS) {
            await esperar(Math.pow(2, intentos) * 1000);
          }
        }
      }

      if (!enviado) {
        await marcarEstado(captura.uuid, 'error', {
          intentos,
          error_msg: ultimoError || 'No fue posible enviar la captura al servidor.'
        });
        resultado.fallidas++;
      }
      notificar();
    }

    // Entregas del apoyo (Parte 2): misma cola, mismo ciclo, mismo uuid de
    // idempotencia. Van despues de las capturas para no retrasarlas.
    await enviarEntregas(resultado);
  } finally {
    sincronizando = false;
    notificar();
  }

  return resultado;
}

/**
 * Sube las entregas registradas en campo. Un 409 `concepto_ya_entregado`
 * significa que el concepto ya tiene entrega con OTRO uuid (p. ej. otro
 * dispositivo se adelanto): no se resuelve reintentando, se deja en error
 * visible.
 *
 * Los errores transitorios (red/5xx) reciben hasta MAX_INTENTOS dentro del
 * ciclo actual. Si los agotan, la entrega vuelve a `pendiente` con intentos=0
 * para que el disparador automatico de 20 s pueda recuperarla despues. Los
 * 403/404/409/422 quedan en `error` porque requieren intervencion humana.
 */
async function enviarEntregas(resultado: ResultadoSync): Promise<void> {
  const pendientes = await entregasPendientes();

  for (const entrega of pendientes) {
    if (!entrega.foto) {
      await marcarEstadoEntrega(entrega.uuid, 'error', {
        error_msg: 'La fotografia local ya no esta disponible.'
      });
      resultado.fallidas++;
      continue;
    }

    await marcarEstadoEntrega(entrega.uuid, 'sincronizando');
    notificar();

    const formulario = new FormData();
    formulario.append('uuid', entrega.uuid);
    formulario.append('solicitud_concepto_id', String(entrega.solicitud_concepto_id));
    formulario.append('lat', String(entrega.lat));
    formulario.append('lng', String(entrega.lng));
    formulario.append('precision_m', String(entrega.precision_m));
    formulario.append('entregado_en', entrega.entregado_en);
    if (entrega.observaciones) formulario.append('observaciones', entrega.observaciones);
    const archivoFoto = entrega.foto.type.startsWith('image/')
      ? entrega.foto
      : new Blob([entrega.foto], { type: 'image/jpeg' });
    formulario.append('foto', archivoFoto, `${entrega.uuid}.jpg`);

    let intentos = entrega.intentos ?? 0;
    let enviado = false;
    let ultimoError = '';
    let errorPermanente = false;

    while (!enviado && intentos < MAX_INTENTOS) {
      try {
        const respuesta = await api.subirEntrega(formulario);
        await db.entregas.update(entrega.uuid, {
          estado: 'sincronizada',
          foto: null,
          foto_url: respuesta.foto_url,
          error_msg: null,
          intentos
        });
        if (respuesta.duplicado) resultado.duplicadas++;
        else resultado.enviadas++;
        enviado = true;
      } catch (error) {
        intentos++;
        ultimoError =
          error instanceof ErrorPeticion ? error.message : 'Error desconocido al sincronizar.';
        if (error instanceof ErrorPeticion && [403, 404, 409, 422].includes(error.estado)) {
          errorPermanente = true;
          intentos = MAX_INTENTOS;
          break;
        }
        if (intentos < MAX_INTENTOS) {
          await esperar(Math.pow(2, intentos) * 1000);
        }
      }
    }

    if (!enviado) {
      const mensaje = ultimoError || 'No fue posible enviar la entrega al servidor.';
      if (errorPermanente) {
        await marcarEstadoEntrega(entrega.uuid, 'error', {
          intentos,
          error_msg: mensaje
        });
      } else {
        // No perder una entrega por una caida temporal: conserva foto + uuid
        // y vuelve a quedar elegible para el siguiente ciclo automatico.
        await marcarEstadoEntrega(entrega.uuid, 'pendiente', {
          intentos: 0,
          error_msg: `${mensaje} Se reintentara automaticamente.`
        });
      }
      resultado.fallidas++;
    }
    notificar();
  }
}

/** Registra los disparadores automaticos de sincronizacion. */
export function iniciarSincronizacionAutomatica(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('online', () => {
    void sincronizarPendientes();
  });

  // Al abrir la app, si hay pendientes y hay red.
  setTimeout(() => void sincronizarPendientes(), 1500);

  // Red de seguridad: revisa la cola cada 20 s.
  setInterval(() => void sincronizarPendientes(), 20000);
}
