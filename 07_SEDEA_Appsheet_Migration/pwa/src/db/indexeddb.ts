// Base de datos local (IndexedDB via Dexie). Es la fuente de verdad offline.
import Dexie, { type Table } from 'dexie';
import type { Beneficiario, ConceptoPorEntregar, PerfilUsuario } from '@sedea/shared';

export interface SesionLocal {
  id: number; // siempre 1
  token: string;
  perfil: PerfilUsuario;
  expiracion: number; // epoch ms
  ultima_sincronizacion: string | null; // ISO 8601
}

export type BeneficiarioLocal = Beneficiario;

export interface EntradaCatalogoLocal {
  id?: number;
  grupo: 'regional' | 'municipio' | 'tipo_apoyo' | 'colonia' | 'seccion' | string;
  clave: string;
  valor: string;
  padre_grupo?: string | null;
  padre_clave?: string | null;
  orden?: number;
  datos?: Record<string, unknown>;
}

export interface CapturaLocal {
  uuid: string;
  beneficiario_id: number;
  foto?: Blob | null;
  foto_url?: string | null;
  lat: number;
  lng: number;
  precision_m: number;
  tipo_apoyo_id: number | null;
  cantidad_entregada: number | null;
  observaciones: string | null;
  capturado_en: string;
  estado: 'pendiente' | 'sincronizando' | 'sincronizada' | 'error';
  intentos: number;
  error_msg?: string | null;
}

/**
 * Un concepto por entregar, tal como viene del paquete de "preparar evento".
 * Es la copia local que la pantalla de campo (Parte 2) consulta SIN RED: se
 * busca por `folio` (lo que trae el QR del Folio de entrega) o por `curp`.
 *
 * La clave primaria es `solicitud_concepto_id` porque el grano de la entrega
 * es el concepto, no la solicitud: una misma solicitud puede aportar varios
 * renglones a esta tabla (garbanzo y avena) y cada uno se entrega aparte.
 */
export type ConceptoEntregaLocal = ConceptoPorEntregar;

/** Metadatos del ultimo paquete descargado (registro unico, id = 1). */
export interface EventoEntregaLocal {
  id: number; // siempre 1
  generado_en: string;
  descargado_en: string;
  tipo_apoyo_id: number;
  tipo_apoyo_nombre: string;
  regional_id: number | null;
  regional_nombre: string | null;
  total: number;
}

class BaseCampo extends Dexie {
  sesion!: Table<SesionLocal, number>;
  beneficiarios!: Table<BeneficiarioLocal, number>;
  catalogos!: Table<EntradaCatalogoLocal, number>;
  capturas!: Table<CapturaLocal, string>;
  conceptos_entrega!: Table<ConceptoEntregaLocal, number>;
  evento_entrega!: Table<EventoEntregaLocal, number>;

  constructor() {
    super('sedea_campo');
    this.version(1).stores({
      sesion: 'id',
      beneficiarios: 'id, regional_id, municipio_id, colonia, seccion, curp, nombre_completo',
      catalogos: '++id, grupo, clave, padre_clave',
      capturas: 'uuid, beneficiario_id, estado, capturado_en'
    });
    // v2: paquete offline del evento de entrega del apoyo. Aditiva: las tablas
    // de la v1 se declaran igual y Dexie conserva sus datos.
    this.version(2).stores({
      sesion: 'id',
      beneficiarios: 'id, regional_id, municipio_id, colonia, seccion, curp, nombre_completo',
      catalogos: '++id, grupo, clave, padre_clave',
      capturas: 'uuid, beneficiario_id, estado, capturado_en',
      conceptos_entrega: 'solicitud_concepto_id, folio, curp, solicitud_id, tipo_apoyo_id',
      evento_entrega: 'id'
    });
  }
}

export const db = new BaseCampo();
