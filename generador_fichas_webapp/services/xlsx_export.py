"""Exportaciones a XLSX (XlsxWriter). Las celdas sin dato quedan **vacías**,
nunca en 0 (R1/R4). Los montos se escriben con 2 decimales (A12)."""
import io

import xlsxwriter

from services import formato


def _escribir_hoja(wb, nombre, columnas, filas, formatos):
    ws = wb.add_worksheet(nombre[:31])
    for c, titulo in enumerate(columnas):
        ws.write(0, c, titulo, formatos["encabezado"])
        ws.set_column(c, c, max(12, min(42, len(str(titulo)) + 4)))
    for r, fila in enumerate(filas, start=1):
        for c, col in enumerate(columnas):
            valor = fila.get(col) if isinstance(fila, dict) else fila[c]
            if valor is None or valor == "":
                ws.write_blank(r, c, None)          # vacío ≠ cero
            elif isinstance(valor, bool):
                ws.write_boolean(r, c, valor)
            elif isinstance(valor, (int, float)):
                fmt = formatos["dinero"] if col in formatos["columnas_dinero"] else formatos["numero"]
                ws.write_number(r, c, valor, fmt)
            else:
                ws.write_string(r, c, str(valor))
    ws.freeze_panes(1, 0)
    return ws


def libro(hojas):
    """hojas: [(nombre, columnas, filas, columnas_dinero)] → bytes de un .xlsx."""
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    base = {
        "encabezado": wb.add_format({"bold": True, "bg_color": "#366092", "font_color": "white",
                                     "border": 1}),
        "numero": wb.add_format({"num_format": "#,##0"}),
        "dinero": wb.add_format({"num_format": "$#,##0.00"}),
    }
    for nombre, columnas, filas, columnas_dinero in hojas:
        base["columnas_dinero"] = set(columnas_dinero or ())
        _escribir_hoja(wb, nombre, columnas, filas, base)
    wb.close()
    return buf.getvalue()


def matriz_xlsx(filas, columnas=None):
    from services.matriz import COLUMNAS_MATRIZ, COLUMNAS_DINERO
    columnas = columnas or COLUMNAS_MATRIZ
    return libro([("Matriz", columnas, filas, COLUMNAS_DINERO)])


def glosa_xlsx(insumos):
    """Paquete de Glosa: hoja Insumos + hoja Fuentes (R7)."""
    col_insumos = ["clave", "tema", "pregunta", "indicador", "valor_numerico", "valor_texto",
                   "unidad", "anio", "ambito", "municipio", "region", "verificado"]
    col_fuentes = ["clave", "fuente_tabla", "fuente_vista", "fuente_archivo", "fuente_hoja",
                   "criterio_calculo", "fecha_corte", "responsable", "verificado_por",
                   "verificado_en", "completo"]
    return libro([
        ("Insumos", col_insumos, insumos, ()),
        ("Fuentes", col_fuentes, insumos, ()),
    ])


def csv_filas(columnas, filas):
    """CSV en texto. None ⇒ celda vacía, jamás 0."""
    import csv
    salida = io.StringIO()
    w = csv.writer(salida, lineterminator="\n")
    w.writerow(columnas)
    for f in filas:
        w.writerow(["" if f.get(c) is None else f.get(c) for c in columnas])
    return salida.getvalue()


def formatear_para_pantalla(filas, columnas_dinero):
    out = []
    for f in filas:
        d = {}
        for k, v in f.items():
            d[k] = formato.dinero(v) if k in columnas_dinero else formato.texto(v)
        out.append(d)
    return out
