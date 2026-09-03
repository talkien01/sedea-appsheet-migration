// Lectura de QR en PDFs multipagina provenientes de un escaner documental.
//
// Se apoya exclusivamente en utilidades del contenedor:
//   - pdfinfo / pdftoppm (poppler-utils): valida y rasteriza el PDF.
//   - zbarimg (zbar): detecta los QR de cada pagina rasterizada.
//
// No se usa OCR: el QR contiene directamente el folio de la solicitud.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface PaginaQrLeida {
  pagina: number;
  qrs: string[];
}

export interface ResultadoLecturaPdfQr {
  paginas: number;
  resultados: PaginaQrLeida[];
}

interface ResultadoComando {
  codigo: number | null;
  stdout: string;
  stderr: string;
}

function ejecutar(
  comando: string,
  argumentos: string[],
  timeoutMs: number
): Promise<ResultadoComando> {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const LIMITE_SALIDA = 4 * 1024 * 1024;

    proceso.stdout.on('data', (dato: Buffer) => {
      if (stdout.length < LIMITE_SALIDA) stdout += dato.toString('utf8');
    });
    proceso.stderr.on('data', (dato: Buffer) => {
      if (stderr.length < LIMITE_SALIDA) stderr += dato.toString('utf8');
    });

    let vencido = false;
    const temporizador = setTimeout(() => {
      vencido = true;
      proceso.kill('SIGKILL');
    }, timeoutMs);

    proceso.on('error', (error) => {
      clearTimeout(temporizador);
      reject(error);
    });
    proceso.on('close', (codigo) => {
      clearTimeout(temporizador);
      if (vencido) {
        reject(new Error(`${comando} excedio el tiempo maximo de procesamiento.`));
        return;
      }
      resolve({ codigo, stdout, stderr });
    });
  });
}

function numeroDePagina(nombre: string): number | null {
  const coincidencia = nombre.match(/-(\d+)\.(?:jpg|jpeg)$/i);
  if (!coincidencia) return null;
  const numero = Number(coincidencia[1]);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Rasteriza el PDF a 150 dpi y devuelve los textos QR encontrados por pagina.
 * El limite de paginas evita que un PDF accidentalmente enorme bloquee el VPS.
 */
export async function leerQrDePdf(
  rutaPdf: string,
  maxPaginas = 300
): Promise<ResultadoLecturaPdfQr> {
  const informacion = await ejecutar('pdfinfo', [rutaPdf], 20_000).catch((error) => {
    throw new Error(`No se pudo ejecutar pdfinfo: ${(error as Error).message}`);
  });
  if (informacion.codigo !== 0) {
    throw new Error(`El archivo no es un PDF valido: ${informacion.stderr.trim() || 'pdfinfo fallo'}`);
  }

  const coincidenciaPaginas = informacion.stdout.match(/^Pages:\s+(\d+)\s*$/im);
  const paginas = Number(coincidenciaPaginas?.[1] ?? 0);
  if (!Number.isInteger(paginas) || paginas <= 0) {
    throw new Error('No fue posible determinar el numero de paginas del PDF.');
  }
  if (paginas > maxPaginas) {
    throw new Error(`El PDF tiene ${paginas} paginas; el maximo por lote es ${maxPaginas}.`);
  }

  const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'sispacq-recibos-'));
  try {
    const prefijo = path.join(temporal, 'pagina');
    const raster = await ejecutar(
      'pdftoppm',
      ['-jpeg', '-r', '150', '-jpegopt', 'quality=78', rutaPdf, prefijo],
      Math.max(60_000, paginas * 4_000)
    ).catch((error) => {
      throw new Error(`No se pudo rasterizar el PDF: ${(error as Error).message}`);
    });
    if (raster.codigo !== 0) {
      throw new Error(`No se pudo rasterizar el PDF: ${raster.stderr.trim() || 'pdftoppm fallo'}`);
    }

    const archivos = await fs.readdir(temporal);
    const porPagina = new Map<number, string>();
    for (const archivo of archivos) {
      const numero = numeroDePagina(archivo);
      if (numero !== null) porPagina.set(numero, path.join(temporal, archivo));
    }

    const resultados: PaginaQrLeida[] = [];
    for (let pagina = 1; pagina <= paginas; pagina++) {
      const archivo = porPagina.get(pagina);
      if (!archivo) {
        resultados.push({ pagina, qrs: [] });
        continue;
      }

      // zbarimg devuelve codigo distinto de cero cuando no encuentra simbolos;
      // eso NO es un error del lote: esa pagina queda pendiente para captura manual.
      const lectura = await ejecutar('zbarimg', ['--quiet', '--raw', archivo], 20_000).catch(
        () => ({ codigo: 1, stdout: '', stderr: '' })
      );
      const qrs = Array.from(
        new Set(
          lectura.stdout
            .split(/\r?\n/)
            .map((linea) => linea.trim())
            .filter(Boolean)
        )
      );
      resultados.push({ pagina, qrs });
    }

    return { paginas, resultados };
  } finally {
    await fs.rm(temporal, { recursive: true, force: true }).catch(() => undefined);
  }
}
