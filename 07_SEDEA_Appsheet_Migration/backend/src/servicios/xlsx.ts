// Generacion de Excel real para los exports que antes eran CSV.
//
// Motivo del cambio (2026-09): un CSV con coma como separador se abre mal en
// Excel configurado en español/México -- el separador de lista regional ahi
// casi siempre es punto y coma, no coma, asi que doble clic mete todo en una
// sola columna y hay que "Importar datos" a mano especificando el
// delimitador. Un .xlsx real no depende de ningun delimitador que Excel
// tenga que adivinar: siempre abre como tabla.
import ExcelJS from 'exceljs';

export interface ColumnaXlsx {
  header: string;
  width?: number;
  /** Formato de celda de Excel, ej. '#,##0.00' o '"$"#,##0.00'. */
  numFmt?: string;
}

/**
 * Arma un libro de una sola hoja a partir de columnas (encabezado, ancho,
 * formato opcional) y filas como arreglos posicionales -- mismo contrato que
 * `generarCsv` en `csv.ts`, para que convertir un export existente sea un
 * cambio minimo (mismas columnas, mismos datos, solo cambia el empaquetado).
 */
export async function generarXlsx(opciones: {
  hoja: string;
  columnas: ColumnaXlsx[];
  filas: unknown[][];
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'SISPACQ';
  libro.created = new Date();
  const hoja = libro.addWorksheet(opciones.hoja);

  hoja.columns = opciones.columnas.map((c) => ({ header: c.header, width: c.width ?? 18 }));

  const filaEncabezado = hoja.getRow(1);
  filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  filaEncabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };
  filaEncabezado.alignment = { vertical: 'middle' };

  for (const fila of opciones.filas) {
    hoja.addRow(fila);
  }

  opciones.columnas.forEach((columna, indice) => {
    if (columna.numFmt) hoja.getColumn(indice + 1).numFmt = columna.numFmt;
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Cabeceras de respuesta comunes para servir el .xlsx generado arriba. */
export const CONTENT_TYPE_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
