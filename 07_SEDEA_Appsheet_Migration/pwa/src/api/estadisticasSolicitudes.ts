import { peticion } from './cliente';

export interface ResumenSolicitudesDashboard {
  regional_id: number | null;
  total_solicitudes: number;
  ingresadas_hoy: number;
  sin_dictamen: number;
  dictaminadas: number;
  autorizadas: number;
  pendientes_autorizacion: number;
  capturadas_central: number;
  por_municipio: Array<{
    municipio_id: number;
    municipio: string;
    total: number;
    hoy: number;
    sin_dictamen: number;
    dictaminadas: number;
    autorizadas: number;
  }>;
  por_capturista_hoy: Array<{
    usuario_id: number;
    usuario: string;
    nombre_completo: string;
    solicitudes: number;
  }>;
}

export async function obtenerResumenSolicitudes(
  regionalId?: string | number | null
): Promise<ResumenSolicitudesDashboard> {
  const parametros = new URLSearchParams();
  if (regionalId !== null && regionalId !== undefined && String(regionalId) !== '') {
    parametros.set('regional_id', String(regionalId));
  }
  const sufijo = parametros.toString() ? `?${parametros.toString()}` : '';
  return peticion<ResumenSolicitudesDashboard>(`/estadisticas/solicitudes${sufijo}`);
}
