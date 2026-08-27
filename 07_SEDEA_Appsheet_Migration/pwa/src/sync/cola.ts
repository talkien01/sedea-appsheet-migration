// Cola de sincronizacion: encolar capturas y entregas, y consultar su estado.
import { v4 as uuidv4 } from 'uuid';
import { db, type CapturaLocal, type EntregaLocal } from '../db/indexeddb';

export interface DatosNuevaCaptura {
  beneficiario_id: number;
  foto: Blob;
  lat: number;
  lng: number;
  precision_m: number;
  tipo_apoyo_id: number | null;
  cantidad_entregada: number | null;
  observaciones: string | null;
}

/** Inserta la captura en IndexedDB con estado 'pendiente'. */
export async function encolarCaptura(datos: DatosNuevaCaptura): Promise<CapturaLocal> {
  const captura: CapturaLocal = {
    uuid: uuidv4(),
    beneficiario_id: datos.beneficiario_id,
    foto: datos.foto,
    foto_url: null,
    lat: datos.lat,
    lng: datos.lng,
    precision_m: datos.precision_m,
    tipo_apoyo_id: datos.tipo_apoyo_id,
    cantidad_entregada: datos.cantidad_entregada,
    observaciones: datos.observaciones,
    capturado_en: new Date().toISOString(),
    estado: 'pendiente',
    intentos: 0,
    error_msg: null
  };
  await db.capturas.put(captura);
  return captura;
}

export async function marcarEstado(
  uuid: string,
  estado: CapturaLocal['estado'],
  extra: Partial<CapturaLocal> = {}
): Promise<void> {
  await db.capturas.update(uuid, { estado, ...extra });
}

/** Reencola una captura marcada como error para volver a intentarla. */
export async function reintentarCaptura(uuid: string): Promise<void> {
  await db.capturas.update(uuid, { estado: 'pendiente', intentos: 0, error_msg: null });
}

// --------------------------------------------------------------------------
// Entregas del apoyo (Parte 2). Mismo ciclo que las capturas: el uuid se
// genera AQUI, en el cliente, y es la clave de idempotencia del servidor.
// --------------------------------------------------------------------------

export interface DatosNuevaEntrega {
  solicitud_concepto_id: number;
  folio: string;
  beneficiario_nombre: string;
  concepto_nombre: string;
  foto: Blob;
  lat: number;
  lng: number;
  precision_m: number;
  observaciones: string | null;
}

/** Inserta la entrega en IndexedDB con estado 'pendiente'. */
export async function encolarEntrega(datos: DatosNuevaEntrega): Promise<EntregaLocal> {
  const entrega: EntregaLocal = {
    uuid: uuidv4(),
    solicitud_concepto_id: datos.solicitud_concepto_id,
    folio: datos.folio,
    beneficiario_nombre: datos.beneficiario_nombre,
    concepto_nombre: datos.concepto_nombre,
    foto: datos.foto,
    foto_url: null,
    lat: datos.lat,
    lng: datos.lng,
    precision_m: datos.precision_m,
    observaciones: datos.observaciones,
    entregado_en: new Date().toISOString(),
    estado: 'pendiente',
    intentos: 0,
    error_msg: null
  };
  await db.entregas.put(entrega);
  return entrega;
}

export async function marcarEstadoEntrega(
  uuid: string,
  estado: EntregaLocal['estado'],
  extra: Partial<EntregaLocal> = {}
): Promise<void> {
  await db.entregas.update(uuid, { estado, ...extra });
}
