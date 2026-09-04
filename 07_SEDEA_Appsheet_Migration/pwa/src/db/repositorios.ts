// Operaciones de lectura/escritura sobre IndexedDB. Toda la UI de campo
// consulta aqui, nunca a la red directamente.
import type {
  RespuestaCatalogos,
  PerfilUsuario,
  Beneficiario,
  PaqueteEventoEntrega
} from '@sedea/shared';
import { apellidoEnRango, compararPorApellido } from '@sedea/shared';
import {
  db,
  type CapturaLocal,
  type ConceptoEntregaLocal,
  type EntregaLocal,
  type EntradaCatalogoLocal,
  type EventoEntregaLocal,
  type SesionLocal
} from './indexeddb';

// --------------------------------------------------------------------------
// Sesion
// --------------------------------------------------------------------------

export async function guardarSesion(token: string, perfil: PerfilUsuario): Promise<SesionLocal> {
  const previa = await db.sesion.get(1);
  const sesion: SesionLocal = {
    id: 1,
    token,
    perfil,
    // El backend firma con 12 h; guardamos la caducidad para operar sin red.
    expiracion: Date.now() + 12 * 60 * 60 * 1000,
    ultima_sincronizacion: previa?.ultima_sincronizacion ?? null
  };
  await db.sesion.put(sesion);
  return sesion;
}

export async function obtenerSesion(): Promise<SesionLocal | undefined> {
  return db.sesion.get(1);
}

export async function sesionVigente(): Promise<SesionLocal | null> {
  const sesion = await db.sesion.get(1);
  if (!sesion) return null;
  if (sesion.expiracion <= Date.now()) return null;
  return sesion;
}

/**
 * Actualiza el perfil guardado sin tocar el token (build 4): tras cambiar la
 * contrasena el token sigue siendo valido y solo cambia debe_cambiar_password.
 */
export async function actualizarPerfilSesion(perfil: PerfilUsuario): Promise<void> {
  const sesion = await db.sesion.get(1);
  if (!sesion) return;
  sesion.perfil = perfil;
  await db.sesion.put(sesion);
}

export async function cerrarSesion(): Promise<void> {
  await db.sesion.clear();
}

export async function marcarSincronizacion(fechaIso: string): Promise<void> {
  const sesion = await db.sesion.get(1);
  if (sesion) {
    sesion.ultima_sincronizacion = fechaIso;
    await db.sesion.put(sesion);
  }
}

// --------------------------------------------------------------------------
// Catalogos
// --------------------------------------------------------------------------

/** Aplana la respuesta del servidor a la tabla local unica de catalogos. */
export async function guardarCatalogos(respuesta: RespuestaCatalogos): Promise<void> {
  const entradas: EntradaCatalogoLocal[] = [];

  for (const r of respuesta.regionales) {
    entradas.push({ grupo: 'regional', clave: r.clave, valor: r.nombre, datos: { id: r.id } });
  }
  for (const m of respuesta.municipios) {
    entradas.push({
      grupo: 'municipio',
      clave: m.clave,
      valor: m.nombre,
      padre_grupo: 'regional',
      padre_clave: String(m.regional_id),
      datos: { id: m.id, regional_id: m.regional_id }
    });
  }
  for (const t of respuesta.tipos_apoyo) {
    entradas.push({
      grupo: 'tipo_apoyo',
      clave: t.clave,
      valor: t.nombre,
      datos: { id: t.id, unidad_medida: t.unidad_medida, descripcion: t.descripcion }
    });
  }
  for (const c of respuesta.catalogos) {
    entradas.push({
      grupo: c.grupo,
      clave: c.clave,
      valor: c.valor,
      padre_grupo: c.padre_grupo,
      padre_clave: c.padre_clave,
      orden: c.orden
    });
  }

  await db.transaction('rw', db.catalogos, async () => {
    await db.catalogos.clear();
    await db.catalogos.bulkAdd(entradas);
  });
}

export async function catalogosPorGrupo(grupo: string): Promise<EntradaCatalogoLocal[]> {
  const filas = await db.catalogos.where('grupo').equals(grupo).toArray();
  return filas.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.valor.localeCompare(b.valor));
}

// --------------------------------------------------------------------------
// Beneficiarios
// --------------------------------------------------------------------------

export async function guardarBeneficiarios(lista: Beneficiario[]): Promise<void> {
  await db.beneficiarios.bulkPut(lista);
}

/**
 * Vacia el padron local. Se llama UNA SOLA VEZ, al arrancar una sincronizacion
 * completa, antes de la primera pagina -- nunca dentro del ciclo de paginas.
 *
 * Bug real detectado en produccion: `guardarBeneficiarios()` solo hace
 * `bulkPut` (agrega/actualiza), nunca borra. Si el servidor se vacia (ej.
 * "Reiniciar datos de prueba"), sincronizar traia "0 beneficiarios
 * descargados" pero el padron local viejo se quedaba intacto para siempre --
 * a diferencia de `guardarCatalogos()`, que si limpia antes de guardar.
 */
export async function limpiarBeneficiariosLocal(): Promise<void> {
  await db.beneficiarios.clear();
}

export async function contarBeneficiarios(): Promise<number> {
  return db.beneficiarios.count();
}

export async function obtenerBeneficiario(id: number): Promise<Beneficiario | undefined> {
  return db.beneficiarios.get(id);
}

/** Quita acentos y pasa a minusculas para busquedas tolerantes. */
export function normalizarTexto(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export interface FiltrosBeneficiarios {
  texto?: string;
  regional_id?: number | null;
  municipio_id?: number | null;
  colonia?: string | null;
  seccion?: string | null;
  estado?: 'todos' | 'pendientes' | 'capturados';
  /** Rango de letras de apellido (E62), para armar lotes de impresion por mesa. */
  apellido_desde?: string | null;
  apellido_hasta?: string | null;
}

/** Busca en IndexedDB aplicando todos los filtros de la pantalla. */
export async function buscarBeneficiarios(
  filtros: FiltrosBeneficiarios
): Promise<Array<Beneficiario & { capturado: boolean }>> {
  const todos = await db.beneficiarios.toArray();
  const capturas = await db.capturas.toArray();
  const conCaptura = new Set(capturas.map((c) => c.beneficiario_id));

  const texto = filtros.texto ? normalizarTexto(filtros.texto) : '';

  return todos
    .filter((b) => {
      if (filtros.regional_id && b.regional_id !== filtros.regional_id) return false;
      if (filtros.municipio_id && b.municipio_id !== filtros.municipio_id) return false;
      if (filtros.colonia && b.colonia !== filtros.colonia) return false;
      if (filtros.seccion && b.seccion !== filtros.seccion) return false;
      if (texto) {
        const objetivo = normalizarTexto(
          `${b.nombre_completo} ${b.curp ?? ''} ${b.folio}`
        );
        if (!objetivo.includes(texto)) return false;
      }
      if (!apellidoEnRango(b.nombre_completo, filtros.apellido_desde, filtros.apellido_hasta)) {
        return false;
      }
      const capturado = conCaptura.has(b.id) || (b.total_capturas ?? 0) > 0;
      if (filtros.estado === 'pendientes' && capturado) return false;
      if (filtros.estado === 'capturados' && !capturado) return false;
      return true;
    })
    .map((b) => ({
      ...b,
      capturado: conCaptura.has(b.id) || (b.total_capturas ?? 0) > 0
    }))
    // Mismo orden que el backend (E62): por apellido, para que "pagina N"
    // en pantalla sea el mismo grupo de gente que "lote N" en el PDF.
    .sort((a, b) => compararPorApellido(a.nombre_completo, b.nombre_completo));
}

// --------------------------------------------------------------------------
// Capturas locales
// --------------------------------------------------------------------------

export async function guardarCapturaLocal(captura: CapturaLocal): Promise<void> {
  await db.capturas.put(captura);
}

export async function capturasDeBeneficiario(beneficiarioId: number): Promise<CapturaLocal[]> {
  const filas = await db.capturas.where('beneficiario_id').equals(beneficiarioId).toArray();
  return filas.sort((a, b) => b.capturado_en.localeCompare(a.capturado_en));
}

export async function contarPendientes(): Promise<number> {
  return db.capturas.where('estado').anyOf('pendiente', 'sincronizando', 'error').count();
}

export async function capturasPendientes(): Promise<CapturaLocal[]> {
  const filas = await db.capturas.where('estado').anyOf('pendiente', 'error').toArray();
  return filas.sort((a, b) => a.capturado_en.localeCompare(b.capturado_en));
}

// --------------------------------------------------------------------------
// Paquete offline del evento de entrega del apoyo
// --------------------------------------------------------------------------

/**
 * Reemplaza por completo el paquete local con el que acaba de bajar del
 * servidor. Se borra antes de escribir a proposito: los conceptos que ya se
 * entregaron dejan de venir en el paquete y no deben quedar como fantasmas.
 */
export async function guardarPaqueteEntrega(paquete: PaqueteEventoEntrega): Promise<void> {
  const meta: EventoEntregaLocal = {
    id: 1,
    generado_en: paquete.generado_en,
    descargado_en: new Date().toISOString(),
    tipo_apoyo_id: paquete.filtro.tipo_apoyo_id,
    tipo_apoyo_nombre: paquete.filtro.tipo_apoyo_nombre,
    regional_id: paquete.filtro.regional_id,
    regional_nombre: paquete.filtro.regional_nombre,
    total: paquete.total
  };
  await db.transaction('rw', db.conceptos_entrega, db.evento_entrega, async () => {
    await db.conceptos_entrega.clear();
    await db.conceptos_entrega.bulkPut(paquete.conceptos);
    await db.evento_entrega.put(meta);
  });
}

export async function eventoEntregaLocal(): Promise<EventoEntregaLocal | undefined> {
  return db.evento_entrega.get(1);
}

export async function contarConceptosEntrega(): Promise<number> {
  return db.conceptos_entrega.count();
}

/** Busqueda por folio exacto: es lo que devolvera el QR en la Parte 2. */
export async function conceptosPorFolio(folio: string): Promise<ConceptoEntregaLocal[]> {
  const filas = await db.conceptos_entrega.where('folio').equals(folio.trim()).toArray();
  return filas.sort((a, b) => a.solicitud_concepto_id - b.solicitud_concepto_id);
}

/** Busqueda tolerante por nombre, folio o CURP para el fallback manual. */
export async function buscarConceptosEntrega(texto: string): Promise<ConceptoEntregaLocal[]> {
  const todos = await db.conceptos_entrega.toArray();
  const aguja = normalizarTexto(texto);
  if (!aguja) return todos;
  return todos.filter((c) =>
    normalizarTexto(`${c.beneficiario_nombre} ${c.folio} ${c.curp ?? ''}`).includes(aguja)
  );
}

// --------------------------------------------------------------------------
// Entregas registradas en campo (cola offline, Parte 2)
// --------------------------------------------------------------------------

/**
 * `solicitud_concepto_id` de los conceptos que YA se entregaron desde este
 * dispositivo, hayan subido o no. Es lo que impide ofrecer dos veces el mismo
 * concepto al re-escanear el folio (el servidor responderia 409).
 */
export async function conceptosYaEntregadosLocal(): Promise<Set<number>> {
  const filas = await db.entregas.toArray();
  return new Set(filas.map((e) => e.solicitud_concepto_id));
}

/**
 * Avance del evento: cuantos conceptos del paquete descargado ya tienen
 * entrega registrada en este dispositivo. Solo cuenta los que pertenecen al
 * paquete actual, para que el contador "X de Y" no arrastre eventos viejos.
 */
export async function contarEntregasDelEvento(): Promise<number> {
  const entregados = await conceptosYaEntregadosLocal();
  if (entregados.size === 0) return 0;
  const conceptos = await db.conceptos_entrega.toArray();
  return conceptos.filter((c) => entregados.has(c.solicitud_concepto_id)).length;
}

export async function entregasPendientes(): Promise<EntregaLocal[]> {
  const filas = await db.entregas.where('estado').anyOf('pendiente', 'error').toArray();
  return filas.sort((a, b) => a.entregado_en.localeCompare(b.entregado_en));
}

/** Entregas que aun no llegaron al servidor (para el aviso de "faltan por subir"). */
export async function contarEntregasPendientes(): Promise<number> {
  return db.entregas.where('estado').anyOf('pendiente', 'sincronizando', 'error').count();
}

export async function limpiarPaqueteEntrega(): Promise<void> {
  await db.transaction('rw', db.conceptos_entrega, db.evento_entrega, async () => {
    await db.conceptos_entrega.clear();
    await db.evento_entrega.clear();
  });
}

export async function limpiarBaseLocal(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.beneficiarios,
      db.catalogos,
      db.capturas,
      db.sesion,
      db.conceptos_entrega,
      db.evento_entrega,
      db.entregas
    ],
    async () => {
      await db.beneficiarios.clear();
      await db.catalogos.clear();
      await db.capturas.clear();
      await db.sesion.clear();
      await db.conceptos_entrega.clear();
      await db.evento_entrega.clear();
      await db.entregas.clear();
    }
  );
}
