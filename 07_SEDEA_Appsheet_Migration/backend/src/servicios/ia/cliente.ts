// Driver de visión del pre-dictamen (SPEC 19.5.2).
//
//   PREDICTAMEN_DRIVER=simulado  (default)  -> no toca la red. Determinista por
//     documento a partir de archivo_nombre / archivo_hash. Es el driver que usan
//     el desarrollo, los tests y el Evaluator: no gasta API real (A19-11).
//   PREDICTAMEN_DRIVER=anthropic            -> llamada real con @anthropic-ai/sdk.
//     Si falta ANTHROPIC_API_KEY el arranque NO falla (el modulo es opcional):
//     la ruta E55 responde 503 ia_no_configurada.
import { config } from '../../config.js';
import { SYSTEM_PREDICTAMEN, bloquesDeDocumento, type ContextoDocumento } from '../predictamen.prompt.js';

/** Veredicto crudo del modelo sobre UN archivo, antes de normalizar. */
export interface VeredictoIa {
  presente: boolean;
  legible: boolean;
  curp_coincide: boolean | null;
  curp_leida: string | null;
  observacion: string;
}

export interface EntradaDocumentoIa {
  /** Contenido del archivo leido de disco. */
  contenido: Buffer;
  /** Media type deducido de la extension de archivo_url. */
  mediaType: string;
  /** Nombre original del adjunto (lo usa el driver simulado). */
  archivoNombre: string | null;
  archivoHash: string | null;
  contexto: ContextoDocumento;
}

export interface DriverIa {
  /** Etiqueta que se guarda en predictamenes_ia.modelo_usado. */
  readonly modelo: string;
  /** true si el driver puede operar (p. ej. hay API key). */
  disponible(): boolean;
  evaluarDocumento(entrada: EntradaDocumentoIa): Promise<VeredictoIa>;
}

// ---------------------------------------------------------------------------
// Utilidades de normalizacion de la salida del modelo (SPEC 19.5.4)
// ---------------------------------------------------------------------------

/**
 * Extrae el primer objeto JSON de un texto, tolerando fences ```json.
 * Devuelve null si no hay ninguno parseable.
 */
export function extraerJson(texto: string): Record<string, unknown> | null {
  const sinFences = texto.replace(/```(?:json)?/gi, '').trim();
  const inicio = sinFences.indexOf('{');
  if (inicio === -1) return null;
  // Busca el cierre balanceado del primer objeto.
  let profundidad = 0;
  for (let i = inicio; i < sinFences.length; i++) {
    if (sinFences[i] === '{') profundidad++;
    else if (sinFences[i] === '}') {
      profundidad--;
      if (profundidad === 0) {
        try {
          const valor = JSON.parse(sinFences.slice(inicio, i + 1));
          return valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driver simulado
// ---------------------------------------------------------------------------

/** Quita acentos y pasa a mayusculas para buscar CURP / IDENTIFICACION. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

class DriverSimulado implements DriverIa {
  readonly modelo = 'simulado-v1';

  disponible(): boolean {
    return true;
  }

  async evaluarDocumento(entrada: EntradaDocumentoIa): Promise<VeredictoIa> {
    const semilla = entrada.archivoNombre ?? entrada.archivoHash ?? '';
    const semillaAlta = semilla.toUpperCase();

    const ilegible = semillaAlta.includes('NEG');
    const requisito = normalizar(entrada.contexto.requisito);
    const muestraCurp = requisito.includes('CURP') || requisito.includes('IDENTIFICACION');

    let curpCoincide: boolean | null = null;
    let curpLeida: string | null = null;
    if (muestraCurp) {
      if (semillaAlta.includes('CURPMAL')) {
        curpCoincide = false;
        curpLeida = 'XXXX000000HXXXXX00';
      } else {
        curpCoincide = true;
        curpLeida = entrada.contexto.curpCapturada;
      }
    }

    return {
      presente: !ilegible,
      legible: !ilegible,
      curp_coincide: curpCoincide,
      curp_leida: curpLeida,
      observacion: ilegible ? 'Documento ilegible (simulado).' : 'Documento legible (simulado).'
    };
  }
}

// ---------------------------------------------------------------------------
// Driver anthropic (visión real)
// ---------------------------------------------------------------------------

/** Timeout por documento (SPEC 19.5.3). En el SDK de TS el timeout va en ms. */
const TIMEOUT_MS = 60_000;

class DriverAnthropic implements DriverIa {
  readonly modelo = config.anthropicModelo;
  private cliente: unknown = null;

  disponible(): boolean {
    return config.anthropicApiKey.trim().length > 0;
  }

  /** Carga perezosa: nada de esto ocurre al arrancar el servidor. */
  private async obtenerCliente(): Promise<any> {
    if (this.cliente) return this.cliente;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.cliente = new Anthropic({ apiKey: config.anthropicApiKey });
    return this.cliente;
  }

  async evaluarDocumento(entrada: EntradaDocumentoIa): Promise<VeredictoIa> {
    const cliente = await this.obtenerCliente();
    const contenido = bloquesDeDocumento(
      entrada.contenido.toString('base64'),
      entrada.mediaType,
      entrada.contexto
    );

    const respuesta = await cliente.messages.create(
      {
        model: config.anthropicModelo,
        max_tokens: 600,
        temperature: 0,
        system: SYSTEM_PREDICTAMEN,
        messages: [{ role: 'user', content: contenido }]
      },
      { timeout: TIMEOUT_MS }
    );

    const texto = (respuesta.content ?? [])
      .filter((bloque: { type: string }) => bloque.type === 'text')
      .map((bloque: { text: string }) => bloque.text)
      .join('\n');

    const json = extraerJson(texto);
    if (!json) throw new Error('La IA no devolvió un JSON válido.');
    return json as unknown as VeredictoIa;
  }
}

let driverActual: DriverIa | null = null;

/** Driver vigente segun PREDICTAMEN_DRIVER. Se memoiza por proceso. */
export function driverIa(): DriverIa {
  if (!driverActual) {
    driverActual =
      config.predictamenDriver === 'anthropic' ? new DriverAnthropic() : new DriverSimulado();
  }
  return driverActual;
}
