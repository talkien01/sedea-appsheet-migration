// Contrato compartido del modulo de Solicitud de Apoyo en ventanilla (build 6).
// Backend y PWA validan exactamente lo mismo con estos esquemas Zod.
//
// Todos los objetos son `.strict()`: cualquier clave fuera del esquema (folio,
// id, regional_id, recibida_en, capturado_por...) falla la validacion y la ruta
// la traduce al codigo `campo_no_editable`. El folio SIEMPRE lo genera el
// backend (D41).
import { z } from 'zod';

/** Los 3 tipos de persona del formulario oficial. */
export const TIPOS_PERSONA = ['fisica', 'moral', 'grupo'] as const;
export type TipoPersona = (typeof TIPOS_PERSONA)[number];

export const ETIQUETAS_TIPO_PERSONA: Record<TipoPersona, string> = {
  fisica: 'Persona física',
  moral: 'Persona moral sin fines de lucro',
  grupo: 'Grupo de productores'
};

/** Etiqueta del campo "nombre" segun el tipo de persona (12.8.2, paso 2). */
export const ETIQUETAS_NOMBRE_SOLICITANTE: Record<TipoPersona, string> = {
  fisica: 'Nombre del solicitante',
  moral: 'Nombre del representante legal',
  grupo: 'Nombre del representante del grupo'
};

export const TIPOS_ASENTAMIENTO = [
  'colonia',
  'fraccionamiento',
  'ejido',
  'pueblo',
  'rancho'
] as const;

export const TIPOS_VIALIDAD = [
  'avenida',
  'boulevard',
  'calzada',
  'calle',
  'privada',
  'otra'
] as const;

export const TIPOS_PRODUCCION_GANADERA = ['intensiva', 'traspatio', 'extensiva'] as const;

/** Roles con acceso al modulo de ventanilla (D34). */
export const ROLES_VENTANILLA = ['ventanilla', 'admin'] as const;

/** Patron oficial de la CURP: 18 caracteres. */
export const PATRON_CURP = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

/** Patron minimo de correo electronico. */
export const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Longitud maxima del texto de un requisito agregado a mano. */
export const MAX_REQUISITO = 300;

// ---------------------------------------------------------------------------
// Normalizacion (misma que usa el importador, 8.5.1)
// ---------------------------------------------------------------------------

/** Normaliza un texto: sin acentos, mayusculas, espacios colapsados. */
export function normalizarEtiqueta(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Siglas de 3 letras de un municipio cuando `siglas_folio` esta vacio (12.5):
 * sin acentos, mayusculas, solo A-Z, primeros 3 caracteres, relleno con X.
 */
export function siglasDesdeNombre(nombre: string): string {
  const limpio = normalizarEtiqueta(nombre).replace(/[^A-Z]/g, '');
  return limpio.slice(0, 3).padEnd(3, 'X');
}

// ---------------------------------------------------------------------------
// Esquemas Zod del alta (E42)
// ---------------------------------------------------------------------------

const texto = (max: number) => z.string().max(max).nullable().optional();
const entero = z.number().int().nullable().optional();
const decimal = z.number().nullable().optional();
const idOpcional = z.number().int().positive().nullable().optional();

export const esquemaDomicilioSolicitud = z
  .object({
    municipio_id: idOpcional,
    localidad: texto(200),
    delegacion: texto(200),
    cp: texto(10),
    tipo_asentamiento: z.enum(TIPOS_ASENTAMIENTO).nullable().optional(),
    asentamiento: texto(200),
    tipo_vialidad: z.enum(TIPOS_VIALIDAD).nullable().optional(),
    vialidad: texto(200)
  })
  .strict();

export const esquemaActividadSolicitud = z
  .object({
    agricola: z.boolean().optional().default(false),
    agr_superficie_total_ha: decimal,
    agr_superficie_siembra_ha: decimal,
    agr_temporal_ha: decimal,
    agr_riego_ha: decimal,
    agr_cultivo_principal: texto(200),

    ganadera: z.boolean().optional().default(false),
    gan_tipo_ganado: texto(200),
    gan_num_cabezas: entero,
    gan_superficie_agostadero_ha: decimal,
    gan_produccion: z.enum(TIPOS_PRODUCCION_GANADERA).nullable().optional(),

    acuicola: z.boolean().optional().default(false),
    acu_especies: texto(300),

    pesca: z.boolean().optional().default(false),
    pes_especies: texto(300)
  })
  .strict();

export const esquemaUbicacionApoyo = z
  .object({
    municipio_id: z.number().int().positive(),
    localidad: texto(200),
    ejido: texto(200),
    // Texto libre a proposito (D42): sin navigator.geolocation.
    coordenadas: texto(120)
  })
  .strict();

export const esquemaApoyoSolicitud = z
  .object({
    descripcion_proyecto: texto(4000),
    ben_hombres_total: z.number().int().min(0).optional().default(0),
    ben_hombres_discapacidad: z.number().int().min(0).optional().default(0),
    ben_hombres_lengua_indigena: z.number().int().min(0).optional().default(0),
    ben_mujeres_total: z.number().int().min(0).optional().default(0),
    ben_mujeres_discapacidad: z.number().int().min(0).optional().default(0),
    ben_mujeres_lengua_indigena: z.number().int().min(0).optional().default(0),
    ubicacion: esquemaUbicacionApoyo
  })
  .strict();

export const esquemaConceptoSolicitud = z
  .object({
    tipo_apoyo_id: z.number().int().positive(),
    descripcion: texto(500),
    cantidad: z.number(),
    unidad_medida: texto(60),
    monto_estatal: z.number().optional().default(0),
    monto_productor: z.number().optional().default(0),
    // Editable: el papel permite aportaciones de terceros (Assumption 48).
    monto_total: z.number().nullable().optional()
  })
  .strict();

export const esquemaDocumentoSolicitud = z
  .object({
    documento_requerido_id: z.number().int().positive().nullable().optional(),
    requisito: z.string().min(1).max(MAX_REQUISITO),
    recibido: z.boolean().optional().default(false),
    observaciones: texto(MAX_REQUISITO)
  })
  .strict();

export const esquemaCrearSolicitud = z
  .object({
    programa_id: z.number().int().positive(),
    subprograma_id: idOpcional,
    componente_id: z.number().int().positive(),
    proyecto_id: z.number().int().positive(),
    ventanilla_id: z.number().int().positive(),
    modalidad_id: z.number().int().positive().nullable().optional(),

    tipo_persona: z.enum(TIPOS_PERSONA),
    nombre_solicitante: z.string(),
    sexo: z.enum(['H', 'M']).nullable().optional(),
    fecha_nacimiento: texto(10),
    correo: texto(200),
    telefono: texto(40),
    curp: texto(30),
    razon_social: texto(300),
    num_integrantes: entero,

    domicilio: esquemaDomicilioSolicitud.optional(),
    actividad: esquemaActividadSolicitud.optional(),
    apoyo: esquemaApoyoSolicitud,
    conceptos: z.array(esquemaConceptoSolicitud),
    documentos: z.array(esquemaDocumentoSolicitud).optional(),

    observaciones: texto(4000),
    declaracion_aceptada: z.boolean()
  })
  .strict();

export type EntradaCrearSolicitud = z.infer<typeof esquemaCrearSolicitud>;

/** Cuerpo de E41: calculo dinamico del checklist de documentos. */
export const esquemaDocumentosRequeridos = z
  .object({
    componente_id: z.number().int().positive(),
    tipo_persona: z.enum(TIPOS_PERSONA),
    proyecto_id: z.number().int().positive().nullable().optional(),
    // Tolerado por S14.6 para que el cliente pueda reenviar el body completo; no se usa en el calculo.
    modalidad_id: z.number().int().positive().nullable().optional(),
    tipos_apoyo_ids: z.array(z.number().int().positive()).optional().default([])
  })
  .strict();

/**
 * Cuerpo del aviso en vivo de CURP duplicada. `tipos_apoyo_ids` es OPCIONAL:
 * vacio u omitido devuelve TODOS los conceptos que esa CURP ya tiene
 * solicitados (se dispara en cuanto la CURP queda completa, antes incluso de
 * que se elija un concepto en la tabla); con la lista puesta, filtra solo a
 * esos ids (uso interno del formulario para cruzar contra las filas
 * elegidas). Es solo lectura; el bloqueo real vive en E42 (codigo
 * `curp_concepto_duplicado`).
 */
export const esquemaVerificarCurpConcepto = z
  .object({
    curp: z.string().min(1).max(18),
    tipos_apoyo_ids: z.array(z.number().int().positive()).optional().default([])
  })
  .strict();

/** Un concepto que ya tiene solicitud previa con la misma CURP. */
export interface ConflictoCurpConcepto {
  tipo_apoyo_id: number;
  tipo_apoyo: string | null;
  solicitud_id: number;
  folio: string;
  recibida_en: string;
}

/** Cuerpo de E45: actualizacion de una fila del checklist. */
export const esquemaActualizarDocumento = z
  .object({
    recibido: z.boolean().optional(),
    observaciones: z.string().max(MAX_REQUISITO).nullable().optional()
  })
  .strict();

/** Cuerpo de E48: reemplazo completo del alcance de un usuario de ventanilla. */
export const esquemaAlcanceUsuario = z
  .object({
    municipios: z.union([z.literal('todos'), z.array(z.number().int().positive())]),
    componentes: z.union([z.literal('todos'), z.array(z.number().int().positive())])
  })
  .strict();

// ---------------------------------------------------------------------------
// Tipos de respuesta
// ---------------------------------------------------------------------------

export interface OpcionCatalogoVentanilla {
  id: number;
  clave: string;
  nombre: string;
}

export interface ModalidadVentanilla extends OpcionCatalogoVentanilla {
  componente_id: number;
}

export interface ProyectoVentanilla extends OpcionCatalogoVentanilla {
  prefijo_folio: string;
  componente_id: number | null;
  modalidad_id: number | null;
}

export interface VentanillaOpcion extends OpcionCatalogoVentanilla {
  regional_id: number;
  clave_folio: string;
  es_central: boolean;
}

export interface MunicipioVentanilla {
  id: number;
  nombre: string;
  regional_id: number;
  siglas_folio: string | null;
}

export interface AlcanceUsuario {
  municipios: 'todos' | number[];
  componentes: 'todos' | number[];
  ventanillas_permitidas: number[];
}

export interface CatalogosVentanilla {
  programas: OpcionCatalogoVentanilla[];
  subprogramas: (OpcionCatalogoVentanilla & { programa_id: number })[];
  componentes: OpcionCatalogoVentanilla[];
  modalidades: ModalidadVentanilla[];
  proyectos: ProyectoVentanilla[];
  ventanillas: VentanillaOpcion[];
  municipios: MunicipioVentanilla[];
  /**
   * Municipios para la CAPTURA de Nueva Solicitud: domicilio del solicitante
   * (§2.2) y ubicacion del predio o proyecto (§4.1). La captura no esta sujeta
   * al alcance granular (`usuario_municipios`): son todos los municipios de la
   * Regional del usuario. El alcance granular sigue recortando `municipios`,
   * que alimenta los filtros y las vistas de consulta.
   */
  municipios_captura: MunicipioVentanilla[];
  /**
   * `escalones_cantidad` viene de `reglas_cantidad_maxima_escalon` y va vacio
   * en los conceptos sin regla de cantidad maxima. La UI lo usa solo para
   * sugerir la cantidad y avisar cuando la superficie no alcanza; el tope real
   * lo impone el backend (E42 y E58).
   */
  tipos_apoyo: {
    id: number;
    clave: string;
    nombre: string;
    unidad_medida: string | null;
    /**
     * Descripcion homologada del concepto (migracion 024). La tabla de
     * conceptos la muestra en modo lectura: ventanilla no la redacta, para
     * que sea identica en todas las solicitudes del mismo concepto.
     */
    descripcion?: string | null;
    /**
     * Proyecto dueño del concepto (migracion 026). `null` = concepto sin
     * proyecto definido: se ofrece en cualquier solicitud, sin restriccion
     * (mismo criterio "sin regla = sin restriccion" de `escalones_cantidad`).
     * Con valor, el concepto SOLO pertenece a ese proyecto: el selector del
     * Paso 5 lo oculta cuando la solicitud es de otro proyecto y el alta lo
     * rechaza con 422 `concepto_proyecto_no_coincide`.
     */
    proyecto_id?: number | null;
    escalones_cantidad?: EscalonCantidadMaxima[] | null;
  }[];
  tipos_persona: { clave: TipoPersona; nombre: string }[];
  alcance: AlcanceUsuario;
}

export interface DocumentoRequeridoCalculado {
  documento_requerido_id: number | null;
  requisito: string;
  origen: 'regla' | 'manual';
}

export interface FilaSolicitud {
  id: number;
  folio: string;
  recibida_en: string;
  nombre_solicitante: string;
  tipo_persona: TipoPersona;
  componente: string;
  proyecto: string;
  ventanilla: string;
  municipio: string | null;
  capturado_por_nombre: string | null;
  conceptos: number;
  monto_total: number;
  documentos_recibidos: string;
}

export interface PaginaSolicitudes {
  data: FilaSolicitud[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface DocumentoSolicitud {
  id: number;
  documento_requerido_id: number | null;
  requisito: string;
  recibido: boolean;
  archivo_url: string | null;
  archivo_nombre: string | null;
  observaciones: string | null;
}

export interface ConceptoSolicitud {
  id: number;
  orden: number;
  tipo_apoyo_id: number;
  tipo_apoyo: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad_medida: string | null;
  monto_estatal: number;
  monto_productor: number;
  monto_total: number;
  beneficiario_id: number | null;
}

export interface DetalleSolicitudApi {
  solicitud: Record<string, unknown>;
  conceptos: ConceptoSolicitud[];
  documentos: DocumentoSolicitud[];
  beneficiarios: { id: number; folio: string; tipo_apoyo: string | null; municipio: string | null }[];
}

export interface RespuestaAltaSolicitud {
  ok: true;
  solicitud: {
    id: number;
    folio: string;
    recibida_en: string;
    componente: string;
    proyecto: string;
    ventanilla: string;
    regional_id: number;
    tipo_persona: TipoPersona;
    nombre_solicitante: string;
  };
  conceptos: { id: number; orden: number; tipo_apoyo_id: number; beneficiario_id: number }[];
  beneficiarios_creados: { id: number; folio: string }[];
  documentos: DocumentoSolicitud[];
}

// ---------------------------------------------------------------------------
// Funciones puras de encadenamiento (Build 8, 14.7)
// ---------------------------------------------------------------------------

/**
 * Filtra las modalidades activas de un componente dado.
 * R14-1: si hay modalidades pero modalidadId es null, devuelve [] (requiere seleccion).
 */
export function modalidadesDeComponente(
  modalidades: ModalidadVentanilla[],
  componenteId: number | null
): ModalidadVentanilla[] {
  if (!componenteId) return [];
  return modalidades.filter((m) => m.componente_id === componenteId);
}

/**
 * Filtra los proyectos aplicables segun componente y modalidad.
 * Regla R14-1:
 *   - Si hay modalidades para el componente pero modalidadId es null -> devuelve []
 *   - Si base queda vacia tras filtrar por componente -> devuelve TODOS los proyectos
 *     (garantiza no regresion para TR/CAA/DIN con PEO).
 */
export function proyectosAplicables(
  proyectos: ProyectoVentanilla[],
  modalidades: ModalidadVentanilla[],
  componenteId: number | null,
  modalidadId: number | null
): ProyectoVentanilla[] {
  const modsDelComponente = modalidadesDeComponente(modalidades, componenteId);
  // Si el componente tiene modalidades pero no se ha seleccionado ninguna -> vacio.
  if (modsDelComponente.length > 0 && modalidadId === null) {
    return [];
  }
  const base = proyectos.filter(
    (p) =>
      p.componente_id === componenteId &&
      (modalidadId === null || p.modalidad_id === modalidadId)
  );
  // Fallback: si base queda vacia, devuelve todos los proyectos (no regresion).
  if (base.length === 0) {
    return proyectos;
  }
  return base;
}

// --------------------------------------------------------------------------
// Cantidad maxima por superficie: ESCALONES FIJOS
// (tabla `reglas_cantidad_maxima_escalon`).
//
// El documento oficial no define una recta sino rangos de superficie: dentro
// de cada rango se entrega SIEMPRE la misma cantidad fija, sin interpolar.
// Esta funcion es la unica implementacion del calculo y la comparten el
// backend (validacion en E42 y E58) y la PWA (autocompletado del campo
// Cantidad en la tabla de conceptos).
// --------------------------------------------------------------------------

export interface EscalonCantidadMaxima {
  /** Limite inferior: inclusivo en el primer escalon, exclusivo en los demas. */
  superficie_desde: number;
  /** Limite superior, inclusivo. El mayor de todos es el techo del concepto. */
  superficie_hasta: number;
  /** Cantidad fija que corresponde al rango. */
  cantidad: number;
}

export type ResultadoCantidadEscalon =
  /** El concepto no tiene escalones dados de alta: sin restriccion. */
  | { tipo: 'sin_regla' }
  /** Hay escalones pero no hay superficie capturada: nada contra que calcular. */
  | { tipo: 'sin_superficie'; minimo: number }
  /** La superficie no alcanza el primer escalon: el concepto NO es elegible. */
  | { tipo: 'no_elegible'; minimo: number }
  /** Cantidad fija del escalon. `topado` = la superficie excede el techo. */
  | { tipo: 'fijo'; cantidad: number; topado: boolean };

/**
 * Resuelve el escalon que corresponde a una superficie.
 *
 * Se elige el escalon con el `superficie_hasta` mas chico que alcance a cubrir
 * la superficie. Asi los limites del documento ("<= 0.5", "> 0.5 y <= 1", ...)
 * quedan sin ambiguedad: 0.5 ha cae en el primer escalon y 0.51 en el segundo.
 * Por encima del ultimo escalon la cantidad NO sigue creciendo: se topa en el
 * ultimo (2 ha es un techo real, 5 ha recibe lo mismo que 2 ha).
 */
export function cantidadPorEscalon(
  escalones: EscalonCantidadMaxima[] | null | undefined,
  superficieHa: number | null | undefined
): ResultadoCantidadEscalon {
  const validos = (escalones ?? [])
    .map((e) => ({
      superficie_desde: Number(e.superficie_desde),
      superficie_hasta: Number(e.superficie_hasta),
      cantidad: Number(e.cantidad)
    }))
    .filter(
      (e) =>
        Number.isFinite(e.superficie_desde) &&
        Number.isFinite(e.superficie_hasta) &&
        Number.isFinite(e.cantidad) &&
        e.superficie_hasta > 0 &&
        e.cantidad > 0
    )
    .sort((a, b) => a.superficie_hasta - b.superficie_hasta);

  if (validos.length === 0) return { tipo: 'sin_regla' };

  const minimo = validos[0].superficie_desde;
  const superficie = Number(superficieHa);
  if (!Number.isFinite(superficie) || superficie <= 0) return { tipo: 'sin_superficie', minimo };
  if (superficie < minimo) return { tipo: 'no_elegible', minimo };

  const escalon = validos.find((e) => superficie <= e.superficie_hasta);
  if (escalon) return { tipo: 'fijo', cantidad: escalon.cantidad, topado: false };
  // Por encima del techo: se queda en el ultimo escalon.
  return { tipo: 'fijo', cantidad: validos[validos.length - 1].cantidad, topado: true };
}
