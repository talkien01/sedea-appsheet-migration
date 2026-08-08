// Catalogos para la sincronizacion inicial de la PWA.
import type { FastifyInstance } from 'fastify';
import { consultar } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import { errorNoAutorizado } from '../plugins/errores.js';

export default async function rutasCatalogos(app: FastifyInstance): Promise<void> {
  app.get('/api/catalogos', { preHandler: [app.autenticar] }, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();

    // El backend decide el alcance; el cliente no puede ampliarlo.
    const regional = regionalForzada(usuario);

    const regionales = await consultar(
      regional
        ? 'SELECT id, clave, nombre, activo FROM direcciones_regionales WHERE id = $1 ORDER BY clave'
        : 'SELECT id, clave, nombre, activo FROM direcciones_regionales ORDER BY clave',
      regional ? [regional] : []
    );

    const municipios = await consultar(
      regional
        ? 'SELECT id, clave, nombre, regional_id, activo FROM municipios WHERE regional_id = $1 ORDER BY nombre'
        : 'SELECT id, clave, nombre, regional_id, activo FROM municipios ORDER BY nombre',
      regional ? [regional] : []
    );

    const tipos_apoyo = await consultar(
      'SELECT id, clave, nombre, categoria, unidad_medida, activo FROM tipos_apoyo WHERE activo ORDER BY nombre'
    );

    // Colonias y secciones se recortan a los municipios visibles del usuario.
    const catalogos = regional
      ? await consultar(
          `SELECT c.id, c.grupo, c.clave, c.valor, c.padre_grupo, c.padre_clave, c.orden, c.activo
             FROM catalogos c
            WHERE c.activo
              AND (
                c.grupo NOT IN ('colonia', 'seccion')
                OR (c.grupo = 'colonia' AND c.padre_clave IN (SELECT clave FROM municipios WHERE regional_id = $1))
                OR (c.grupo = 'seccion' AND c.padre_clave IN (
                      SELECT clave FROM catalogos
                       WHERE grupo = 'colonia'
                         AND padre_clave IN (SELECT clave FROM municipios WHERE regional_id = $1)))
              )
            ORDER BY c.grupo, c.orden, c.valor`,
          [regional]
        )
      : await consultar(
          `SELECT id, grupo, clave, valor, padre_grupo, padre_clave, orden, activo
             FROM catalogos WHERE activo ORDER BY grupo, orden, valor`
        );

    return respuesta.status(200).send({ regionales, municipios, tipos_apoyo, catalogos });
  });
}
