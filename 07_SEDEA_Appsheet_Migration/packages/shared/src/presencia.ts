// Monitor de presencia: quien esta conectado y en que pantalla.
// Backend y PWA comparten estas definiciones para validar igual de los dos lados.
import { z } from 'zod';

/**
 * Minutos desde el ultimo latido dentro de los cuales se considera que el
 * usuario sigue EN LINEA. Es el unico criterio de "activo" del monitor y se
 * define aqui para que backend y PWA no puedan discrepar.
 *
 * Se eligio 3 porque la PWA late cada 60 s: da margen a que se pierdan dos
 * latidos seguidos (red intermitente en campo) sin marcar al usuario como
 * desconectado.
 */
export const MINUTOS_PRESENCIA_ACTIVA = 3;

/** Cuerpo del latido que manda la PWA en cada cambio de ruta y cada 60 s. */
export const esquemaLatidoPresencia = z
  .object({
    ruta: z.string().trim().min(1, 'Falta la ruta.').max(300),
    etiqueta_pantalla: z.string().trim().max(120).optional().nullable()
  })
  .strict();

export type LatidoPresencia = z.infer<typeof esquemaLatidoPresencia>;

/** Un usuario tal como lo pinta el monitor. */
export interface PresenciaUsuario {
  usuario_id: number;
  usuario: string;
  nombre_completo: string;
  rol: string;
  regional_id: number | null;
  regional: string | null;
  ruta: string;
  etiqueta_pantalla: string | null;
  ip: string | null;
  visto_en: string;
  /** Segundos transcurridos desde el ultimo latido (lo calcula Postgres). */
  segundos_desde_visto: number;
  /** true si `visto_en` cae dentro de MINUTOS_PRESENCIA_ACTIVA. */
  activo: boolean;
}

export interface RespuestaPresencia {
  generado_en: string;
  umbral_minutos: number;
  /** Latido dentro del umbral: el usuario esta en la app ahora mismo. */
  activos: PresenciaUsuario[];
  /** Estuvieron conectados pero su ultimo latido ya quedo fuera del umbral. */
  inactivos: PresenciaUsuario[];
}
