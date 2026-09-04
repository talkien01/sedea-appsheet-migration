// Padron de beneficiarios (solo lectura). El aislamiento por Direccion
// Regional se aplica SIEMPRE en la capa SQL, nunca en el frontend.
import type { FastifyInstance } from 'fastify';
import type { PerfilUsuario } from '@sedea/shared';
import { esquemaConsultaBeneficiarios, ROLES_CORRECCION } from '@sedea/shared';
import { consultar, consultarUna } from '../db/pool.js';
import { regionalForzada } from '../plugins/rbac.js';
import { errorNoAutorizado, errorNoEncontrado, errorProhibido } from '../plugins/errores.js';
import { registrarAuditoria } from '../plugins/auditoria.js';
import { aplicarCorreccion } from '../servicios/correcciones.js';
import { generarCsv, formatearFecha } from '../servicios/csv.js';
import { ErrorApi } from '../plugins/errores.js';

/**
 * El padron de campo es exclusivo de capturista y admin. El rol editor_datos
 * trabaja en /api/staging y /api/correcciones, nunca aqui (regla del build 2,
 * que el build 3 NO debilita: la excepcion es solo el PATCH de mas abajo).
 */
const ROLES_PADRON = ['capturista', 'auditor', 'admin'];

const SELECT_BASE = `
  SELECT b.id, b.folio, b.curp, b.nombre_completo, b.regional_id, r.nombre AS regional_nombre,
         b.municipio_id, m.nombre AS municipio_nombre, b.colonia, b.seccion, b.localidad,
         b.domicilio, b.telefono, b.tipo_apoyo_id, t.nombre AS tipo_apoyo_nombre,
         b.cantidad_asignada, b.datos_extra, b.actualizado_en,
         (SELECT count(*)::int FROM capturas c WHERE c.beneficiario_id = b.id) AS total_capturas
    FROM beneficiarios b
    LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
    LEFT JOIN municipios m ON m.id = b.municipio_id
    LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
`;

type ConsultaBeneficiarios = ReturnType<typeof esquemaConsultaBeneficiarios.parse>;

/**
 * "Apellido(s)" adivinados en SQL: las ULTIMAS 1 o 2 palabras del nombre
 * completo (no hay campo apellido_paterno/materno separado). v2: cuenta
 * desde el final, no desde el inicio — en Mexico el numero de NOMBRES varia
 * (1 a 3) pero el numero de APELLIDOS es casi siempre 2, asi que contar
 * desde el inicio ("todo despues de la primera palabra") salia desfasado
 * con nombres compuestos como "JUAN CARLOS PEREZ LOPEZ" (tomaba "CARLOS"
 * como apellido). Reglas:
 *   - 3+ palabras: las ultimas DOS = apellido paterno + materno.
 *   - 2 palabras: se asume un solo apellido capturado (la ultima palabra).
 *   - 1 palabra: no hay apellido que adivinar, se usa esa palabra.
 * Sigue sin resolver apellidos compuestos con particula ("DE LA CRUZ") sin
 * un campo estructurado — es la mejor aproximacion disponible.
 *
 * Espejo EXACTO de `apellidoDeNombre`/`primeraLetraApellido` en
 * packages/shared/src/nombres.ts — si se cambia uno, cambiar el otro, para
 * que la pantalla offline y el PDF impreso queden en el mismo orden.
 *
 * `alias` es la tabla de beneficiarios en cada consulta (siempre "b" hoy,
 * mismo alias en las tres consultas que comparten este filtro).
 */
export function expresionApellido(alias = 'b'): string {
  const partes = `string_to_array(regexp_replace(trim(${alias}.nombre_completo), '\\s+', ' ', 'g'), ' ')`;
  const n = `array_length(${partes}, 1)`;
  return `(CASE
      WHEN ${n} >= 3 THEN array_to_string((${partes})[${n} - 1 : ${n}], ' ')
      WHEN ${n} = 2 THEN (${partes})[2]
      ELSE (${partes})[1]
    END)`;
}

/** Primera letra del apellido paterno (mayusculas, sin acentos) para comparar contra A-Z. */
function expresionPrimeraLetraApellido(alias = 'b'): string {
  return `upper(unaccent(left(${expresionApellido(alias)}, 1)))`;
}

/**
 * Traduce el filtro del padron a un WHERE parametrizado.
 *
 * Vive fuera del handler porque TRES endpoints deben coincidir exactamente en
 * "que beneficiarios estoy viendo": el listado, la exportacion a CSV y la
 * impresion de folios en lote. Si cada uno rearmara su WHERE, el CSV o el lote
 * podrian abarcar filas que el usuario no tiene en pantalla — incluidas filas
 * de otra Direccion Regional. El aislamiento por Regional se resuelve aqui,
 * en la capa SQL, y `regionalForzada` gana siempre sobre el `regional_id` que
 * mande el cliente.
 */
export function construirFiltrosBeneficiarios(
  usuario: PerfilUsuario,
  q: ConsultaBeneficiarios
): { where: string; parametros: unknown[]; regional: number | null } {
  const forzada = regionalForzada(usuario);
  // Si el usuario tiene Regional forzada se ignora cualquier regional_id del cliente.
  const regional = forzada ?? q.regional_id ?? null;

  const condiciones: string[] = [];
  const parametros: unknown[] = [];

  if (regional) {
    parametros.push(regional);
    condiciones.push(`b.regional_id = $${parametros.length}`);
  }
  if (q.municipio_id) {
    parametros.push(q.municipio_id);
    condiciones.push(`b.municipio_id = $${parametros.length}`);
  }
  if (q.colonia) {
    parametros.push(q.colonia);
    condiciones.push(`b.colonia = $${parametros.length}`);
  }
  if (q.seccion) {
    parametros.push(q.seccion);
    condiciones.push(`b.seccion = $${parametros.length}`);
  }
  if (q.since) {
    parametros.push(q.since);
    condiciones.push(`b.actualizado_en > $${parametros.length}::timestamptz`);
  }
  if (q.q && q.q.trim()) {
    parametros.push(`%${q.q.trim()}%`);
    const i = parametros.length;
    // Busqueda insensible a mayusculas y acentos.
    condiciones.push(
      `(unaccent(lower(b.nombre_completo)) LIKE unaccent(lower($${i}))
        OR unaccent(lower(coalesce(b.curp, ''))) LIKE unaccent(lower($${i}))
        OR unaccent(lower(b.folio)) LIKE unaccent(lower($${i})))`
    );
  }
  // Rango de letras de apellido (E62): para lotes de impresion por mesa
  // ("Mesa 1 = A-C"). El apellido es una heuristica (ver expresionApellido);
  // sin campo estructurado, es la mejor aproximacion disponible.
  if (q.apellido_desde) {
    parametros.push(q.apellido_desde);
    condiciones.push(`${expresionPrimeraLetraApellido('b')} >= $${parametros.length}`);
  }
  if (q.apellido_hasta) {
    parametros.push(q.apellido_hasta);
    condiciones.push(`${expresionPrimeraLetraApellido('b')} <= $${parametros.length}`);
  }

  return {
    where: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
    parametros,
    regional
  };
}

export default async function rutasBeneficiarios(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/beneficiarios',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_PADRON)] },
    async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();

    const q = esquemaConsultaBeneficiarios.parse(peticion.query ?? {});
    const { where, parametros, regional } = construirFiltrosBeneficiarios(usuario, q);

    const totalFila = await consultarUna<{ total: number }>(
      `SELECT count(*)::int AS total FROM beneficiarios b ${where}`,
      parametros
    );
    const total = totalFila?.total ?? 0;

    const desplazamiento = (q.page - 1) * q.page_size;
    const filas = await consultar(
      `${SELECT_BASE} ${where}
       ORDER BY ${expresionApellido('b')}, b.nombre_completo, b.id
       LIMIT ${q.page_size} OFFSET ${desplazamiento}`,
      parametros
    );

    // La primera pagina de una descarga se considera inicio de sincronizacion.
    if (q.page === 1) {
      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'sync_padron',
        entidad: 'beneficiario',
        detalle: { total, regional_id: regional, since: q.since ?? null }
      });
    }

    return respuesta.status(200).send({
      data: filas,
      page: q.page,
      page_size: q.page_size,
      total,
      has_more: desplazamiento + filas.length < total
    });
  }
  );

  // ---------------------------------------------------------------------
  // Exportacion a CSV del filtro ACTUAL del padron (mismo criterio que
  // /api/auditoria/export.csv). No exporta el padron completo: reusa
  // `construirFiltrosBeneficiarios`, asi que Regional, municipio, colonia,
  // seccion y busqueda libre aplican igual que en pantalla, y la Regional
  // forzada del actor sigue siendo inviolable.
  //
  // El escape de celdas (incluida la mitigacion de CSV injection) es el de
  // `generarCsv`; aqui no se arma texto CSV a mano.
  // ---------------------------------------------------------------------
  const COLUMNAS_EXPORT = [
    'folio',
    'nombre_completo',
    'curp',
    'regional',
    'municipio',
    'colonia',
    'seccion',
    'localidad',
    'domicilio',
    'telefono',
    'concepto_apoyo',
    'cantidad_asignada',
    'total_capturas',
    'fecha_captura'
  ];

  app.get(
    '/api/beneficiarios/export.csv',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_PADRON)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const q = esquemaConsultaBeneficiarios.parse(peticion.query ?? {});
      const { where, parametros, regional } = construirFiltrosBeneficiarios(usuario, q);

      // `fecha_captura` no es columna de `beneficiarios`: es la captura de
      // campo mas reciente. Se resuelve aparte para no cambiar SELECT_BASE,
      // que alimenta la sincronizacion offline de la PWA.
      const filas = await consultar<any>(
        `SELECT b.folio, b.nombre_completo, b.curp, r.nombre AS regional_nombre,
                m.nombre AS municipio_nombre, b.colonia, b.seccion, b.localidad,
                b.domicilio, b.telefono, t.nombre AS tipo_apoyo_nombre,
                b.cantidad_asignada,
                (SELECT count(*)::int FROM capturas c WHERE c.beneficiario_id = b.id)
                  AS total_capturas,
                (SELECT max(c.capturado_en) FROM capturas c WHERE c.beneficiario_id = b.id)
                  AS ultima_captura_en
           FROM beneficiarios b
           LEFT JOIN direcciones_regionales r ON r.id = b.regional_id
           LEFT JOIN municipios m ON m.id = b.municipio_id
           LEFT JOIN tipos_apoyo t ON t.id = b.tipo_apoyo_id
           ${where}
          ORDER BY ${expresionApellido('b')}, b.nombre_completo, b.id
          LIMIT 50000`,
        parametros
      );

      const csv = generarCsv(
        COLUMNAS_EXPORT,
        filas.map((f) => [
          f.folio,
          f.nombre_completo,
          f.curp ?? '',
          f.regional_nombre ?? '',
          f.municipio_nombre ?? '',
          f.colonia ?? '',
          f.seccion ?? '',
          f.localidad ?? '',
          f.domicilio ?? '',
          f.telefono ?? '',
          f.tipo_apoyo_nombre ?? '',
          f.cantidad_asignada ?? '',
          f.total_capturas,
          formatearFecha(f.ultima_captura_en)
        ])
      );

      await registrarAuditoria(peticion, {
        usuarioId: usuario.id,
        accion: 'export_csv',
        entidad: 'beneficiario',
        detalle: { filas: filas.length, regional_id: regional, filtros: q }
      });

      const nombre = `beneficiarios_sedea_${new Date().toISOString().slice(0, 10)}.csv`;
      return respuesta
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${nombre}"`)
        .status(200)
        .send(csv);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/beneficiarios/:id',
    { preHandler: [app.autenticar, app.requiereRol(...ROLES_PADRON)] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('Beneficiario no encontrado.');

      const fila = await consultarUna<any>(`${SELECT_BASE} WHERE b.id = $1`, [id]);
      if (!fila) throw errorNoEncontrado('Beneficiario no encontrado.');

      const forzada = regionalForzada(usuario);
      if (forzada !== null && fila.regional_id !== forzada) {
        throw errorProhibido('El beneficiario pertenece a otra Direccion Regional.');
      }

      return respuesta.status(200).send(fila);
    }
  );

  /**
   * E26 - Edicion correctiva de datos de contacto y ubicacion.
   *
   * Unica excepcion a la regla anterior: aqui SI entran editor_datos y admin,
   * y quedan fuera capturista y auditor. La lista blanca (colonia, domicilio,
   * telefono, seccion, municipio_id) es estricta: CURP y folio nunca se
   * editan porque son la identidad legal del expediente.
   *
   * No existe POST ni DELETE de beneficiarios: todo beneficiario nace de una
   * importacion de padron oficial revisada en staging (decision D11).
   */
  app.patch<{ Params: { id: string } }>(
    '/api/beneficiarios/:id',
    { preHandler: [app.autenticar] },
    async (peticion, respuesta) => {
      const usuario = peticion.usuario;
      if (!usuario) throw errorNoAutorizado();

      if (!(ROLES_CORRECCION as readonly string[]).includes(usuario.rol)) {
        throw new ErrorApi(
          403,
          'rol_no_autorizado',
          'Tu rol no puede editar datos de beneficiarios.'
        );
      }

      const id = Number(peticion.params.id);
      if (!Number.isInteger(id) || id <= 0) throw errorNoEncontrado('El beneficiario no existe.');

      const { beneficiario, cambios } = await aplicarCorreccion(
        { id: usuario.id, rol: usuario.rol, regional_id: usuario.regional_id ?? null },
        id,
        peticion.body ?? {},
        {
          ip: peticion.ip,
          userAgent: (peticion.headers['user-agent'] as string | undefined)?.slice(0, 300)
        }
      );

      return respuesta.status(200).send({ ok: true, beneficiario, cambios });
    }
  );
}
