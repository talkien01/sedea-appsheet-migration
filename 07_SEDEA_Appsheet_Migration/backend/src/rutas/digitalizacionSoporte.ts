// Digitalizacion V1 / Fase 3: endpoints de apoyo para la pantalla PWA.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';

const error400 = (codigo: string, mensaje: string) => new ErrorApi(400, codigo, mensaje);
const error403 = (codigo: string, mensaje: string) => new ErrorApi(403, codigo, mensaje);
const error422 = (codigo: string, mensaje: string) => new ErrorApi(422, codigo, mensaje);

function usuarioActual(peticion: FastifyRequest) {
  if (!peticion.usuario) throw errorNoAutorizado();
  return peticion.usuario;
}

function idOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw error400('filtro_invalido', `${campo} debe ser un identificador válido.`);
  }
  return numero;
}

function texto(valor: unknown): string {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function regionalPermitida(peticion: FastifyRequest, solicitada: number | null): number | null {
  const forzada = regionalForzada(usuarioActual(peticion));
  if (forzada !== null && solicitada !== null && solicitada !== forzada) {
    throw error403('fuera_de_alcance', 'La Regional solicitada está fuera de tu alcance.');
  }
  return forzada ?? solicitada;
}

export default async function rutasDigitalizacionSoporte(app: FastifyInstance): Promise<void> {
  const protegida = {
    preHandler: [
      app.autenticar,
      app.requiereRol('ventanilla', 'capturista', 'editor_datos', 'admin')
    ]
  };

  app.get('/api/digitalizacion/catalogos', protegida, async (peticion, respuesta) => {
    const usuario = usuarioActual(peticion);
    const regionalId = regionalForzada(usuario);

    const [regionales, municipios] = await Promise.all([
      regionalId === null
        ? pool.query<{ id: string; clave: string; nombre: string }>(
            `SELECT id::text, clave, nombre
               FROM direcciones_regionales
              WHERE activo
              ORDER BY nombre`
          )
        : pool.query<{ id: string; clave: string; nombre: string }>(
            `SELECT id::text, clave, nombre
               FROM direcciones_regionales
              WHERE activo AND id = $1
              ORDER BY nombre`,
            [regionalId]
          ),
      regionalId === null
        ? pool.query<{ id: string; clave: string; nombre: string; regional_id: string }>(
            `SELECT id::text, clave, nombre, regional_id::text
               FROM municipios
              WHERE activo
              ORDER BY nombre`
          )
        : pool.query<{ id: string; clave: string; nombre: string; regional_id: string }>(
            `SELECT id::text, clave, nombre, regional_id::text
               FROM municipios
              WHERE activo AND regional_id = $1
              ORDER BY nombre`,
            [regionalId]
          )
    ]);

    return respuesta.status(200).send({
      regionales: regionales.rows,
      municipios: municipios.rows,
      regional_forzada_id: regionalId
    });
  });

  // Resuelve una seleccion rapida (10/20/30/50/100/200) o todas las
  // solicitudes filtradas que AUN NO ESTAN en otro lote activo. Esto permite
  // trabajar "las siguientes 50" sin repetir las 50 del lote anterior.
  app.get('/api/digitalizacion/seleccion', protegida, async (peticion, respuesta) => {
    const query = (peticion.query ?? {}) as Record<string, unknown>;
    const regionalSolicitada = idOpcional(query.regional_id, 'regional_id');
    const municipioId = idOpcional(query.municipio_id, 'municipio_id');
    const regionalId = regionalPermitida(peticion, regionalSolicitada);
    const busqueda = texto(query.q);
    const cantidadTexto = texto(query.cantidad) || '50';

    let limite: number | null = null;
    if (cantidadTexto !== 'todas') {
      const n = Number(cantidadTexto);
      if (![10, 20, 30, 50, 100, 200].includes(n)) {
        throw error400('cantidad_invalida', 'La cantidad debe ser 10, 20, 30, 50, 100, 200 o todas.');
      }
      limite = n;
    }

    if (municipioId !== null) {
      const valoresMunicipio: unknown[] = [municipioId];
      let extra = '';
      if (regionalId !== null) {
        valoresMunicipio.push(regionalId);
        extra = ' AND regional_id = $2';
      }
      const municipio = await pool.query(
        `SELECT 1 FROM municipios WHERE id = $1 AND activo${extra}`,
        valoresMunicipio
      );
      if (municipio.rows.length === 0) {
        throw error403('fuera_de_alcance', 'El municipio está fuera de tu alcance.');
      }
    }

    const condiciones: string[] = [
      `NOT EXISTS (
         SELECT 1
           FROM digitalizacion_lote_solicitudes dls
           JOIN digitalizacion_lotes dl ON dl.id = dls.lote_id
          WHERE dls.solicitud_id = s.id
            AND dl.estado <> 'cancelado'
       )`
    ];
    const valores: unknown[] = [];
    const agregar = (valor: unknown) => {
      valores.push(valor);
      return `$${valores.length}`;
    };

    if (regionalId !== null) condiciones.push(`m.regional_id = ${agregar(regionalId)}`);
    if (municipioId !== null) condiciones.push(`s.ubi_municipio_id = ${agregar(municipioId)}`);
    if (busqueda) {
      const p = agregar(`%${busqueda}%`);
      condiciones.push(`(
        unaccent(s.folio) ILIKE unaccent(${p}) OR
        unaccent(s.nombre_solicitante) ILIKE unaccent(${p}) OR
        unaccent(COALESCE(s.curp, '')) ILIKE unaccent(${p})
      )`);
    }

    const where = condiciones.join(' AND ');
    const conteo = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM solicitudes s
         JOIN municipios m ON m.id = s.ubi_municipio_id
        WHERE ${where}`,
      valores
    );
    const total = Number(conteo.rows[0]?.total ?? 0);
    if (limite === null && total > 2000) {
      throw error422(
        'seleccion_demasiado_grande',
        'Hay más de 2000 solicitudes filtradas sin lote. Refina Regional, Municipio o búsqueda antes de seleccionar todas.'
      );
    }

    const limiteReal = limite ?? Math.max(total, 1);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT s.id::text AS id
         FROM solicitudes s
         JOIN municipios m ON m.id = s.ubi_municipio_id
        WHERE ${where}
        ORDER BY s.recibida_en ASC, s.id ASC
        LIMIT $${valores.length + 1}`,
      [...valores, limiteReal]
    );

    return respuesta.status(200).send({
      solicitud_ids: rows.map((fila) => Number(fila.id)),
      seleccionadas: rows.length,
      total_filtradas: total,
      cantidad: cantidadTexto
    });
  });
}
