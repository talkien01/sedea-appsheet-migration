"""Genera/actualiza docs/INVENTARIO_FUENTES.md (fase F1).

    python -m ingesta.inventario_fuentes --help
    python -m ingesta.inventario_fuentes
    python -m ingesta.inventario_fuentes --salida docs/INVENTARIO_FUENTES.md

Abre cada archivo fuente real, lee sus hojas y encabezados, consulta el estado de
las tablas destino y reescribe **solo** la sección autogenerada del documento.
Todo lo que esté debajo del marcador de notas manuales se conserva intacto.
"""
import argparse
import datetime
import os
import sys

import openpyxl

import config
import db
from ingesta import comun

SALIDA_POR_DEFECTO = os.path.join(config.BASE_DIR, "docs", "INVENTARIO_FUENTES.md")
MARCA_INICIO = "<!-- AUTOGENERADO:INICIO -->"
MARCA_FIN = "<!-- AUTOGENERADO:FIN -->"

# archivo, destino en analitica, script de carga, estado declarado
FUENTES = [
    ("Resumen Histórico por Municipio.xlsx",
     "apoyo_municipio (años faltantes 2021, 2022)",
     "ingesta/cargar_resumen_historico.py", "solo referencia"),
    ("Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx",
     "contraste de apoyo_municipio 2026 (piloto Cadereyta)",
     "ingesta/cargar_resumen_historico.py --anio 2026", "solo referencia"),
    ("Base Cadereyta Programas sedea.xlsx",
     "beneficiario_curp + programa/programa_alias",
     "ingesta/cargar_curp.py, ingesta/cargar_programas.py", "cargado"),
    ("Regional_Cadereyta_2026_CURP.xlsx",
     "resumen por municipio (NO trae CURP a nivel persona)",
     "ingesta/cargar_curp.py (rechaza el archivo: sin columna CURP)", "solo referencia"),
    ("Regional_Cadereyta_Distribucion_Cadereyta_Colon_Ezequiel.xlsx",
     "contraste de vw_genero_edad",
     "ingesta/cargar_distribucion.py", "solo referencia"),
    ("Regional_Cadereyta_Machote.xlsx",
     "machote de ficha regional",
     "ingesta/inventario_fuentes.py", "solo referencia"),
    ("Datos_referencia_manual_municipios.xlsx",
     "consumo directo por ficha_engine (territorio, productos, precipitación, demografía)",
     "ficha_engine.cargar_manual", "cargado"),
    ("Mapa_disponibilidad_datos_fichas.xlsx",
     "referencia documental",
     "ingesta/inventario_fuentes.py", "solo referencia"),
    ("Ficha_Estatal_Apicultores_2026_AJUSTADA.xlsx",
     "resumen_estatal 2026 (apícolas)",
     "ingesta/cargar_fichas_estatales.py", "solo referencia"),
    ("Ficha_Estatal_Azucar_2026.xlsx",
     "resumen_estatal 2026 (azúcar, versión previa)",
     "ingesta/cargar_fichas_estatales.py", "solo referencia"),
    ("Ficha_Estatal_Azucar_2026_Actualizada.xlsx",
     "resumen_estatal 2026 (azúcar, versión vigente)",
     "ingesta/cargar_fichas_estatales.py", "solo referencia"),
    ("0_indice Drive.docx / 0 Índice Drive.pdf",
     "índice documental del Drive",
     "—", "solo referencia"),
]

CSVS = [
    "00_region.csv", "01_municipio.csv", "02_municipio_alias.csv", "03_programa.csv",
    "04_programa_alias.csv", "05_apoyo_municipio_full.csv", "06_apoyo_metrica.csv",
    "07_resumen_estatal_full.csv", "08_accion_full.csv", "09_beneficiarios_demografia.csv",
    "10_v_ficha_municipio.csv", "11_v_ficha_programa_anio.csv", "12_v_inversion_anual.csv",
    "13_v_oficial_componente.csv", "14_v_oficial_municipio.csv", "15_v_oficial_region.csv",
]
CSVS_ANTES_FALTANTES = {"02_municipio_alias.csv", "04_programa_alias.csv", "06_apoyo_metrica.csv",
                        "08_accion_full.csv", "09_beneficiarios_demografia.csv"}


def _hojas_de(archivo):
    try:
        ruta = comun.ruta_archivo(archivo)
    except FileNotFoundError:
        return None, "archivo no encontrado"
    if not ruta.lower().endswith((".xlsx", ".xlsm")):
        return None, "no es xlsx"
    try:
        wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
        hojas = []
        for ws in wb.worksheets:
            try:
                fila = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
                encabezados = [str(v).strip() for v in fila if v not in (None, "")][:6]
            except StopIteration:
                encabezados = []
            hojas.append((ws.title, encabezados))
        wb.close()
        return hojas, None
    except Exception as e:  # archivo corrupto o formato inesperado: se reporta, no se traga
        return None, f"no se pudo abrir ({type(e).__name__})"


def _conteos_tablas():
    tablas = ["region", "municipio", "municipio_alias", "programa", "programa_alias",
              "apoyo_municipio", "apoyo_metrica", "resumen_estatal", "accion",
              "beneficiarios_demografia", "beneficiario_curp", "incidencia_carga", "glosa_insumo"]
    out = {}
    for t in tablas:
        try:
            out[t] = db.contar(f"SELECT count(*)::int FROM analitica.{t}")
        except db.SinDatos:
            out[t] = None
    return out


def construir(ahora=None):
    ahora = ahora or datetime.datetime.now()
    L = []
    A = L.append
    A(MARCA_INICIO)
    A(f"_Generado por `python -m ingesta.inventario_fuentes` el "
      f"{ahora.strftime('%Y-%m-%d %H:%M')}._")
    A("")
    A("## 1. Archivos fuente")
    A("")
    A("| # | Archivo | Hojas (encabezados detectados) | Destino en `analitica` | Script de carga | Estado |")
    A("|---|---|---|---|---|---|")
    for i, (archivo, destino, script, estado) in enumerate(FUENTES, 1):
        primero = archivo.split(" / ")[0]
        hojas, error = _hojas_de(primero)
        if hojas:
            desc = "<br>".join(
                f"**{t}**: {', '.join(h) if h else '(sin encabezados en la fila 1)'}"
                for t, h in hojas)
        else:
            desc = error or "—"
        A(f"| {i} | `{archivo}` | {desc} | {destino} | `{script}` | {estado} |")
    A("")
    A("## 2. CSV de respaldo (`DATA_DIR`)")
    A("")
    A(f"Carpeta en uso: `{config.DATA_DIR}`")
    A("")
    A("| CSV | Presente en disco | ¿Lo refresca `refresh_data.py`? | Nota |")
    A("|---|---|---|---|")
    import refresh_data
    refrescables = set(refresh_data.QUERIES)
    for nombre in CSVS:
        ruta = os.path.join(config.DATA_DIR, nombre)
        presente = "sí" if os.path.exists(ruta) else "**no**"
        refresca = "sí" if nombre in refrescables else "**NO**"
        nota = ""
        if nombre in CSVS_ANTES_FALTANTES:
            nota = "Antes faltaba en `QUERIES` (11 de 16); ya está incluido."
        if nombre == "09_beneficiarios_demografia.csv":
            nota += (" La tabla origen `analitica.beneficiarios_demografia` está **vacía "
                     "(0 filas)** y no tiene dimensión municipio: no sirve para género/edad. "
                     "La fuente primaria es `analitica.beneficiario_curp`.")
        A(f"| `{nombre}` | {presente} | {refresca} | {nota.strip()} |")
    A("")
    A("## 3. Estado de las tablas destino")
    A("")
    A("| Tabla | Filas |")
    A("|---|---|")
    for t, n in _conteos_tablas().items():
        A(f"| `analitica.{t}` | {'sin conexión' if n is None else n} |")
    A("")
    A("## 4. Huecos conocidos")
    A("")
    A("- `apoyo_municipio` cubre 2023–2025; **2022 no existe en ningún origen** "
      "(incidencia `ANIO_SIN_DATOS`). 2021 solo está en `accion`.")
    A("- 2026 vive en las vistas `v_oficial_*` (dictaminado); trae estatal y total, "
      "no federal/municipal/beneficiario.")
    A("- 2027 va **vacío por definición** (R4): no es un hueco, es la regla.")
    A("- `Resumen Histórico por Municipio.xlsx` es la plantilla en blanco: no tiene datos que cargar.")
    A("- `Regional_Cadereyta_2026_CURP.xlsx` **no** contiene CURP por persona pese a su nombre; "
      "el padrón con CURP real es `Base Cadereyta Programas sedea.xlsx`.")
    A(MARCA_FIN)
    return "\n".join(L)


def escribir(salida, contenido):
    encabezado = ("# INVENTARIO_FUENTES.md — Inventario de fuentes de datos\n\n"
                  "> Fase F1 del SPEC. La sección autogenerada se reescribe con "
                  "`python -m ingesta.inventario_fuentes`; las notas manuales del final "
                  "**no se tocan**.\n\n")
    previo = ""
    if os.path.exists(salida):
        with open(salida, encoding="utf-8") as f:
            previo = f.read()
    notas = ""
    if MARCA_FIN in previo:
        notas = previo.split(MARCA_FIN, 1)[1]
    else:
        notas = ("\n\n## Notas manuales\n\n"
                 "_(Esta sección la edita el equipo a mano; el script nunca la sobreescribe.)_\n")
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        f.write(encabezado + contenido + notas)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Genera docs/INVENTARIO_FUENTES.md desde los archivos reales.")
    ap.add_argument("--salida", default=SALIDA_POR_DEFECTO)
    ap.add_argument("--dry-run", action="store_true", help="imprime en pantalla, no escribe")
    args = ap.parse_args(argv)

    contenido = construir()
    if args.dry_run:
        print(contenido)
        return 0
    escribir(args.salida, contenido)
    print(f"Inventario actualizado: {args.salida}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
