"""Exportadores: CSV, XLSX y HTML autocontenido (§7.8)."""
import datetime

from flask import Blueprint, Response, jsonify, request

import config
from services import aportaciones as svc_aport
from services import formato, glosa, html_export, matriz, xlsx_export

bp = Blueprint("export", __name__, url_prefix="/exportar")


def _error(mensaje, codigo=400):
    return jsonify({"ok": False, "error": mensaje}), codigo


@bp.get("/matriz.csv")
def matriz_csv():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return _error(str(e))
    filas, _ = matriz.matriz(dict(filtros, page_size=100000, page=1), con_paginado=False)
    cuerpo = xlsx_export.csv_filas(matriz.COLUMNAS_MATRIZ, filas)
    hoy = datetime.date.today().strftime("%Y%m%d")
    return Response(cuerpo, mimetype="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="SEDEA_matriz_{hoy}.csv"'})


@bp.get("/matriz.xlsx")
def matriz_xlsx():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return _error(str(e))
    filas, _ = matriz.matriz(dict(filtros, page_size=100000, page=1), con_paginado=False)
    contenido = xlsx_export.matriz_xlsx(filas)
    hoy = datetime.date.today().strftime("%Y%m%d")
    return Response(
        contenido,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="SEDEA_matriz_{hoy}.xlsx"'})


@bp.get("/glosa.xlsx")
def glosa_xlsx():
    try:
        solo = formato.bool_param(request.args.get("solo_verificados"), "solo_verificados")
        insumos = glosa.listar(anio=request.args.get("anio"), tema=request.args.get("tema"),
                               ambito=request.args.get("ambito"), solo_verificados=solo)
    except formato.FiltroInvalido as e:
        return _error(str(e))
    contenido = xlsx_export.glosa_xlsx(insumos)
    hoy = datetime.date.today().strftime("%Y%m%d")
    return Response(
        contenido,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="SEDEA_Glosa_{hoy}.xlsx"'})


@bp.get("/html")
def exportar_html():
    """HTML de un solo archivo, sin CDN y sin red."""
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return _error(str(e))
    ambito = (request.args.get("ambito") or "ESTATAL").upper()
    if ambito not in ("ESTATAL", "REGION", "MUNICIPIO"):
        return _error("ambito debe ser ESTATAL, REGION o MUNICIPIO.")

    filas, total = matriz.matriz(dict(filtros, page_size=100000, page=1), con_paginado=False)
    tot = matriz.totales(filtros)
    try:
        grafica_aport = svc_aport.para_grafica(filtros)
    except Exception:
        grafica_aport = {"labels": [], "valores": [], "total": None, "sin_dato": []}

    clave = filtros.get("municipio") or filtros.get("region") or "ESTATAL"
    fuentes = sorted({f.get("fuente_archivo") for f in filas if f.get("fuente_archivo")})
    fuentes = fuentes or ["analitica (Postgres)"]
    fuentes = [f"{f}" for f in fuentes] + [
        "Vistas: analitica.vw_matriz_historica, vw_matriz_aportaciones",
        f"Fecha de corte: {config.FECHA_CORTE}",
    ]
    avisos = []
    if grafica_aport.get("sin_dato"):
        avisos.append("Sin desglose de " + ", ".join(grafica_aport["sin_dato"]) +
                      " en parte del periodo: esas celdas van vacías, no en cero.")
    if not filas:
        avisos.append("Sin datos para los filtros seleccionados.")

    datos = {
        "filas": filas,
        "serie_anual": matriz.serie_inversion_anual(filtros),
        "aportaciones": grafica_aport,
        "catalogos": matriz.catalogos(),
        "filtros": filtros,
    }
    kpis = [
        ("Inversión total", formato.dinero(tot.get("total"))),
        ("Apoyos (folios)", formato.entero(tot.get("numero_apoyos"))),
        ("Municipios", formato.entero(tot.get("municipios"))),
        ("Filas de detalle", formato.entero(total)),
    ]
    html = html_export.construir(
        datos,
        titulo=f"SEDEA — Apoyos históricos ({ambito.title()}: {clave})",
        subtitulo="Secretaría de Desarrollo Agropecuario del Estado de Querétaro — "
                  "archivo autocontenido, se abre sin internet.",
        fuentes=fuentes, kpis=kpis, avisos=avisos)
    nombre = html_export.nombre_archivo(ambito, clave)
    return Response(html, mimetype="text/html; charset=utf-8",
                    headers={"Content-Disposition": f'inline; filename="{nombre}"'})
