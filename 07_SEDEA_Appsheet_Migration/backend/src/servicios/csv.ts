// Generacion de CSV con BOM UTF-8 para que Excel en Windows lo abra bien.

const BOM = '﻿';

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
