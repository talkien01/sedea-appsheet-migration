// Endpoints de estadisticas del dashboard (E30-E33). Solo lectura.
// No existen tablas de metricas precalculadas: todo sale de agregaciones SQL
// sobre las tablas vivas (Assumption 38).
import type { FastifyInstance } from 'fastify';
import { ROLES_ESTADISTICAS } from '@sedea/shared';
import { ErrorApi } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import {
  apoyos,
  avance,
  cobertura,
  estadoStaging,
  type FiltrosEstadisticas
} from '../db/queries/estadisticas.js';
import { resumenSolicitudesDashboard } from '../db/queries/solicitudes-dashboard.js';

/** 422 con el codigo que fija el contrato para parametros mal formados. */
function errorParametro(mensaje: string): ErrorApi {
  return new ErrorApi(422, 'parametro_invalido', mensaje);
}

/** Valida una fecha YYYY-MM-DD; devuelve null si no se envio. */
function leerFecha(valor: unknown, nombre: string): string | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const texto = String(valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(Date.parse(texto))) {
    throw errorParametro(`El parámetro ${nombre} debe tener el formato AAAA-MM-DD.`);
  }
  return texto;
}

/** Suma dias a una fecha ISO y devuelve YYYY-MM-DD. */
function desplazarDias(base: Date, dias: number): string {
  const fecha = new Date(base.getTime());
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** True cuando un rol simple o multi-rol contiene al menos un rol de gestion. */
function puedeVerEstadisticas(rol: string | null | undefined): boolean {
  const rolesUsuario = String(rol ?? '').split('+').filter(Boolean);
  return (ROLES_ESTADISTICAS as readonly string[]).some((r) => rolesUsuario.includes(r));
}

export default async function rutasEstadisticas(app: FastifyInstance): Promise<void> {
  /**
   * Guarda de acceso propia: el mensaje de 403 lo fija el contrato del SPEC.
   * Soporta multi-rol (ej. auditor+ventanilla) igual que el resto del RBAC.
   */
  const soloGestion = {
    preHandler: [
      app.autenticar,
      async (peticion: any) => {
        if (!puedeVerEstadisticas(peticion.usuario?.rol)) {
          throw new ErrorApi(
            403,
            'rol_no_autorizado',
            'No tienes permiso para ver las estadísticas.'
          );
        }
      }
    ]
  };

  /**
   * Filtros comunes. Un usuario de gestion con Regional asignada queda anclado
   * a ella y el `regional_id` del query se ignora (aislamiento por Regional).
   */
  function leerFiltros(peticion: any): FiltrosEstadisticas {
    const q = (peticion.query ?? {}) as Record<string, string>;
    const forzada = regionalForzada(peticion.usuario);
    const pedida = q.regional_id ? Number(q.regional_id) : null;
    return {
      regional_id: forzada ?? (pedida && Number.isFinite(pedida) ? pedida : null),
      municipio_id: q.municipio_id && Number.isFinite(Number(q.municipio_id))
        ? Number(q.municipio_id)
        : null,
      desde: leerFecha(q.desde, 'desde'),
      hasta: leerFecha(q.hasta, 'hasta')
    };
  }

  // E30 - Cobertura de captura (global, por Regional y por municipio).
  app.get('/api/estadisticas/cobertura', soloGestion, async (peticion, respuesta) => {
    return respuesta.status(200).send(await cobertura(leerFiltros(peticion)));
  });

  // E31 - Distribucion de capturas por concepto de apoyo (top N + "Otros").
  app.get('/api/estadisticas/apoyos', soloGestion, async (peticion, respuesta) => {
    const q = (peticion.query ?? {}) as Record<string, string>;
    const pedido = q.limite ? Number(q.limite) : 15;
    if (q.limite && (!Number.isFinite(pedido) || pedido < 1)) {
      throw errorParametro('El parámetro limite debe ser un número mayor que cero.');
    }
    const limite = Math.min(50, Math.max(1, Math.trunc(pedido) || 15));
    return respuesta.status(200).send(await apoyos(leerFiltros(peticion), limite));
  });

  // E32 - Avance en el tiempo, con relleno de periodos vacios.
  app.get('/api/estadisticas/avance', soloGestion, async (peticion, respuesta) => {
    const q = (peticion.query ?? {}) as Record<string, string>;
    const agrupacion = (q.agrupacion ?? 'dia').trim() || 'dia';
    if (agrupacion !== 'dia' && agrupacion !== 'semana') {
      throw errorParametro('El parámetro agrupacion solo admite "dia" o "semana".');
    }

    const filtros = leerFiltros(peticion);
    // Defaults: 30 dias o 12 semanas hacia atras desde hoy.
    const hoy = new Date();
    const hasta = filtros.hasta ?? hoy.toISOString().slice(0, 10);
    const desde =
      filtros.desde ??
      desplazarDias(new Date(`${hasta}T00:00:00Z`), agrupacion === 'semana' ? -7 * 11 : -29);

    if (desde > hasta) {
      throw errorParametro('El parámetro desde no puede ser posterior a hasta.');
    }

    return respuesta.status(200).send(await avance(filtros, agrupacion, desde, hasta));
  });

  // E33 - Estado del staging (reutiliza las mismas queries que E16).
  app.get('/api/estadisticas/staging', soloGestion, async (peticion, respuesta) => {
    return respuesta.status(200).send(await estadoStaging(regionalForzada(peticion.usuario!)));
  });

  // Resumen operativo de solicitudes. El conteo territorial se hace por el
  // municipio del predio; una captura excepcional en SEDEA Central conserva la
  // Regional responsable del predio y no crea una quinta Regional.
  app.get('/api/estadisticas/solicitudes', soloGestion, async (peticion, respuesta) => {
    const filtros = leerFiltros(peticion);
    return respuesta.status(200).send(await resumenSolicitudesDashboard(filtros.regional_id));
  });
}
