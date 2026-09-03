import { peticion } from './cliente';

export interface MunicipioConciliacion {
  id: number;
  nombre: string;
  regional_id: number;
}

export interface TipoApoyoConciliacion {
  id: number;
  clave: string;
  nombre: string;
}

export interface CatalogosConciliacion {
  municipios: MunicipioConciliacion[];
  tipos_apoyo: TipoApoyoConciliacion[];
}

export type EstadoPaginaConciliacion =
  | 'conciliada'
  | 'sin_qr'
  | 'varios_qr'
  | 'folio_no_encontrado'
  | 'municipio_distinto'
  | 'sin_concepto_lote'
  | 'duplicada'
  | 'pendiente_manual'
  | 'error';

export interface ResumenLoteConciliacion {
  id: number;
  municipio_id: number;
  municipio_nombre: string;
  regional_id: number;
  regional_nombre: string;
  camion: string;
  tipo_apoyo_id: number | null;
  tipo_apoyo_nombre: string | null;
  estado: 'abierto' | 'cerrado';
  pdf_url: string | null;
  pdf_hash: string | null;
  pdf_bytes: number | null;
  paginas_pdf: number | null;
  paginas_procesadas: number;
  pendientes: number;
  duplicados: number;
  recibos: number;
  kg_total: number;
  costales_total: number;
  creado_por: number;
  creado_por_nombre: string | null;
  creado_en: string;
  actualizado_en: string;
  cerrado_en: string | null;
}

export interface ReciboConciliado {
  id: number;
  pagina: number;
  folio: string;
  solicitud_id: number;
  origen: 'qr' | 'manual';
  beneficiario: string;
  apoyos: string;
  kg: number;
  costales: number;
  creado_en: string;
}

export interface PaginaPendienteConciliacion {
  id: number;
  pagina: number;
  estado: EstadoPaginaConciliacion;
  qr_text: string | null;
  folio_detectado: string | null;
  mensaje: string | null;
  actualizado_en: string;
}

export interface DetalleLoteConciliacion {
  lote: ResumenLoteConciliacion;
  recibos: ReciboConciliado[];
  pendientes: PaginaPendienteConciliacion[];
  procesamiento?: {
    paginas: number;
    conciliadas: number;
    pendientes: number;
  };
}

export const apiConciliacion = {
  catalogos(): Promise<CatalogosConciliacion> {
    return peticion<CatalogosConciliacion>('/conciliacion/catalogos');
  },

  lotes(): Promise<{ data: ResumenLoteConciliacion[] }> {
    return peticion<{ data: ResumenLoteConciliacion[] }>('/conciliacion/lotes');
  },

  crearLote(cuerpo: {
    municipio_id: number;
    camion: string;
    tipo_apoyo_id: number | null;
  }): Promise<DetalleLoteConciliacion> {
    return peticion<DetalleLoteConciliacion>('/conciliacion/lotes', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
  },

  detalle(id: number): Promise<DetalleLoteConciliacion> {
    return peticion<DetalleLoteConciliacion>(`/conciliacion/lotes/${id}`);
  },

  subirPdf(id: number, archivo: File): Promise<DetalleLoteConciliacion> {
    const formulario = new FormData();
    formulario.append('pdf', archivo);
    return peticion<DetalleLoteConciliacion>(`/conciliacion/lotes/${id}/pdf`, {
      method: 'POST',
      body: formulario
    });
  },

  corregirPagina(id: number, pagina: number, folio: string): Promise<DetalleLoteConciliacion> {
    return peticion<DetalleLoteConciliacion>(
      `/conciliacion/lotes/${id}/paginas/${pagina}/manual`,
      {
        method: 'POST',
        body: JSON.stringify({ folio })
      }
    );
  },

  retirarRecibo(id: number, reciboId: number): Promise<DetalleLoteConciliacion> {
    return peticion<DetalleLoteConciliacion>(`/conciliacion/lotes/${id}/recibos/${reciboId}`, {
      method: 'DELETE'
    });
  },

  cerrarLote(id: number): Promise<DetalleLoteConciliacion> {
    return peticion<DetalleLoteConciliacion>(`/conciliacion/lotes/${id}/cerrar`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  }
};
