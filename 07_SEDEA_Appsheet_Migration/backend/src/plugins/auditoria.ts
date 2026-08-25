// Escritura de la bitacora auditoria_log. Nunca debe tumbar la peticion:
// si falla el INSERT solo se registra en el log del servidor.
import type { FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';

export type AccionAuditoria =
  | 'login'
  | 'login_fallido'
  | 'sync_padron'
  | 'captura_creada'
  | 'captura_duplicada'
  | 'export_csv'
  | 'export_pdf'
  | 'import_padron'
  // Build 4: administracion de usuarios (nunca incluyen contrasenas).
  | 'usuario_creado'
  | 'usuario_editado'
  | 'usuario_password_reset'
  | 'usuario_activado'
  | 'usuario_desactivado'
  | 'password_cambiado'
  // Operacion destructiva: vaciado de todos los datos capturados.
  | 'reiniciar_datos_prueba';

interface EntradaBitacora {
  usuarioId?: number | null;
  accion: AccionAuditoria;
  entidad?: string | null;
  entidadId?: string | number | null;
  detalle?: Record<string, unknown>;
}

export async function registrarAuditoria(
  peticion: FastifyRequest | null,
  entrada: EntradaBitacora
): Promise<void> {
  try {
    const ip = peticion?.ip ?? null;
    const userAgent = (peticion?.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;
    await pool.query(
      `INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::inet, $7)`,
      [
        entrada.usuarioId ?? null,
        entrada.accion,
        entrada.entidad ?? null,
        entrada.entidadId !== undefined && entrada.entidadId !== null
          ? String(entrada.entidadId)
          : null,
        JSON.stringify(entrada.detalle ?? {}),
        ip,
        userAgent
      ]
    );
  } catch (error) {
    console.error('No se pudo escribir en auditoria_log:', (error as Error).message);
  }
}
