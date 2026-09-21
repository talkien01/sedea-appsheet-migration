// Reclasificar el concepto de una solicitud (solo admin): ver
// servicios/reclasificacion.ts. Mismo candado que "Anular solicitud": motivo +
// reautenticacion por contrasena, bloqueado si ya hay entrega o conciliacion.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorApi } from '../plugins/errores.js';
import { obtenerHash } from '../db/queries/usuarios.js';
import { verificarPassword } from '../servicios/passwords.js';
import {
  previsualizarReclasificacion,
  reclasificarSolicitud
} from '../servicios/reclasificacion.js';

const esquemaPrevisualizar = z.object({
  tipo_apoyo_id: z.number().int().positive()
});

const esquemaReclasificar = z.object({
  tipo_apoyo_id: z.number().int().positive(),
  motivo: z.string().trim().min(5, 'El motivo debe tener al menos 5 caracteres.').max(400),
  password: z.string().min(1, 'Ingresa tu contraseña.')
});

export default async function rutasReclasificacion(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, app.requiereRol('admin')] };

  const leerId = (params: unknown): number => {
    const id = Number((params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(404, 'no_encontrado', 'La solicitud no existe.');
    }
    return id;
  };

  app.post('/api/admin/solicitudes/:id/reclasificar/previsualizar', protegida, async (peticion, respuesta) => {
    const id = leerId(peticion.params);
    const analisis = esquemaPrevisualizar.safeParse(peticion.body ?? {});
    if (!analisis.success) throw new ErrorApi(422, 'payload_invalido', 'Datos inválidos.');
    const plan = await previsualizarReclasificacion(id, analisis.data.tipo_apoyo_id);
    return respuesta.status(200).send({ plan });
  });

  app.post('/api/admin/solicitudes/:id/reclasificar', protegida, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const id = leerId(peticion.params);
    const analisis = esquemaReclasificar.safeParse(peticion.body ?? {});
    if (!analisis.success) {
      throw new ErrorApi(422, 'payload_invalido', analisis.error.issues[0]?.message ?? 'Datos inválidos.');
    }
    const entrada = analisis.data;

    const hash = await obtenerHash(usuario.id);
    if (!hash || !verificarPassword(entrada.password, hash)) {
      throw new ErrorApi(401, 'password_incorrecta', 'Tu contraseña no es correcta.');
    }

    const resultado = await reclasificarSolicitud(id, entrada.tipo_apoyo_id, {
      usuarioId: usuario.id,
      motivo: entrada.motivo,
      ip: peticion.ip,
      userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
    });

    return respuesta.status(200).send({ ok: true, ...resultado });
  });
}
