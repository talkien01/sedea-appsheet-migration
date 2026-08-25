// Generacion y lectura de CSV con BOM UTF-8 para que Excel en Windows lo abra
// bien (y para que un archivo guardado desde Excel se pueda volver a leer).

const BOM = '\uFEFF';

function escapar(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * Construye el CSV completo.
 * @param columnas nombres de las columnas (primera linea del archivo)
 * @param filas arreglo de arreglos en el mismo orden que las columnas
 */
export function generarCsv(columnas: string[], filas: unknown[][]): string {
  const lineas = [columnas.map(escapar).join(',')];
  for (const fila of filas) {
    lineas.push(fila.map(escapar).join(','));
  }
  return BOM + lineas.join('\r\n') + '\r\n';
}

/**
 * Lee un CSV a matriz de celdas. Acepta el BOM que escribe Excel, comillas
 * dobles con escape `""`, saltos de linea dentro de campos entrecomillados y
 * finales de linea CRLF o LF. Las lineas totalmente vacias se descartan.
 *
 * Deliberadamente sin dependencias: el unico CSV que entra al sistema es la
 * plantilla que el propio backend genera, con seis columnas de texto plano.
 */
export function parsearCsv(texto: string): string[][] {
  const fuente = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;

  for (let i = 0; i < fuente.length; i++) {
    const caracter = fuente[i];

    if (entreComillas) {
      if (caracter === '"') {
        if (fuente[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === ',') {
      fila.push(celda);
      celda = '';
    } else if (caracter === '\n' || caracter === '\r') {
      // CRLF cuenta como un solo fin de linea.
      if (caracter === '\r' && fuente[i + 1] === '\n') i++;
      fila.push(celda);
      celda = '';
      filas.push(fila);
      fila = [];
    } else {
      celda += caracter;
    }
  }

  if (celda.length > 0 || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  return filas.filter((f) => f.some((c) => c.trim().length > 0));
}

/** Fecha en formato es-MX para exportaciones (DD/MM/AAAA HH:mm). */
export function formatearFecha(valor: string | Date | null | undefined): string {
  if (!valor) return '';
  const fecha = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(fecha.getTime())) return '';
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const aaaa = fecha.getFullYear();
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${aaaa} ${hh}:${mi}`;
}
