// Ajuste masivo de kilogramos (solo admin): sube un Excel/CSV con folio +
// cantidad_asignada nueva, previsualiza el efecto antes de tocar nada, y
// aplica todo en una sola transaccion con reautenticacion por contrasena.
// Ver `servicios/ajusteMasivoKg.ts` para el porque (avena/garbanzo no
// manejan monto, solo kg -- topes de Regional/Municipio que el sistema no
// valida en automatico hoy).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorApi } from '../plugins/errores.js';
import { obtenerHash } from '../db/queries/usuarios.js';
import { verificarPassword } from '../servicios/passwords.js';
import {
  parsearArchivoAjuste,
  construirPlanAjuste,
  aplicarAjuste
} from '../servicios/ajusteMasivoKg.js';

const ROLES_AJUSTE = ['admin'];

const esquemaAplicar = z.object({
  motivo: z.string().trim().min(5, 'El motivo debe tener al menos 5 caracteres.').max(500),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
  archivo_nombre: z.string().max(200).optional(),
  items: z
    .array(
      z.object({
        folio: z.string().min(1),
        solicitud_concepto_id: z.number().int().positive(),
        beneficiario_id: z.number().int().positive().nullable(),
        cantidad_actual: z.number().min(0),
        cantidad_nueva: z.number().min(0)
      })
    )
    .min(1, 'No hay filas para aplicar.')
    .max(2000)
});

export default async function rutasAjusteMasivoKg(app: FastifyInstance): Promise<void> {
  const protegida = { preHandler: [app.autenticar, app.requiereRol(...ROLES_AJUSTE)] };

  app.post('/api/admin/ajustes-kg/previsualizar', protegida, async (peticion, respuesta) => {
    let buffer: Buffer | null = null;
    let nombreArchivo = 'archivo';

    if (!peticion.isMultipart()) {
      throw new ErrorApi(
        422,
        'archivo_requerido',
        'Sube el archivo en el campo "archivo" (multipart/form-data).'
      );
    }
    for await (const parte of peticion.parts()) {
      if (parte.type === 'file' && parte.fieldname === 'archivo') {
        if (parte.file.truncated === true) {
          throw new ErrorApi(422, 'archivo_muy_grande', 'El archivo excede el tamaño máximo permitido.');
        }
        buffer = await parte.toBuffer();
        nombreArchivo = parte.filename ?? nombreArchivo;
      }
    }
    if (!buffer) {
      throw new ErrorApi(
        422,
        'archivo_requerido',
        'Sube el archivo en el campo "archivo" (multipart/form-data).'
      );
    }

    const { filas, errores } = await parsearArchivoAjuste(buffer, nombreArchivo);
    if (filas.length === 0 && errores.length > 0) {
      throw new ErrorApi(422, 'archivo_invalido', errores[0]!.mensaje);
    }

    const { items, resumen } = await construirPlanAjuste(filas);
    return respuesta.status(200).send({
      archivo_nombre: nombreArchivo,
      errores_parseo: errores,
      items,
      resumen
    });
  });

  app.post('/api/admin/ajustes-kg/aplicar', protegida, async (peticion, respuesta) => {
    const usuario = peticion.usuario!;
    const analisis = esquemaAplicar.safeParse(peticion.body ?? {});
    if (!analisis.success) {
      throw new ErrorApi(422, 'payload_invalido', analisis.error.issues[0]?.message ?? 'Datos inválidos.');
    }
    const entrada = analisis.data;

    const hash = await obtenerHash(usuario.id);
    if (!hash || !verificarPassword(entrada.password, hash)) {
      throw new ErrorApi(401, 'password_incorrecta', 'Tu contraseña no es correcta.');
    }

    const resultado = await aplicarAjuste(entrada.items, {
      usuarioId: usuario.id,
      motivo: entrada.motivo,
      nombreArchivo: entrada.archivo_nombre ?? 'archivo',
      ip: peticion.ip,
      userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null
    });

    return respuesta.status(200).send({ ok: true, aplicados: resultado.aplicados });
  });
}
