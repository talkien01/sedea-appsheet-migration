// Base de datos local (IndexedDB via Dexie). Es la fuente de verdad offline.
import Dexie, { type Table } from 'dexie';
import type { Beneficiario, PerfilUsuario } from '@sedea/shared';

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

class BaseCampo extends Dexie {
  sesion!: Table<SesionLocal, number>;
  beneficiarios!: Table<BeneficiarioLocal, number>;
  catalogos!: Table<EntradaCatalogoLocal, number>;
  capturas!: Table<CapturaLocal, string>;

  constructor() {
    super('sedea_campo');
    this.version(1).stores({
      sesion: 'id',
      beneficiarios: 'id, regional_id, municipio_id, colonia, seccion, curp, nombre_completo',
      catalogos: '++id, grupo, clave, padre_clave',
      capturas: 'uuid, beneficiario_id, estado, capturado_en'
    });
  }
}

export const db = new BaseCampo();
