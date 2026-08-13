"""Páginas HTML: matriz, dashboard, glosa e incidencias."""
from flask import Blueprint, render_template, request

import config
import db
from services import formato, glosa as svc_glosa, incidencias as svc_inc, matriz as svc_matriz

bp = Blueprint("paginas", __name__)


@bp.get("/matriz")
def matriz():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return render_template("matriz.html", error=str(e), filas=[], total=0,
                               catalogos=svc_matriz.catalogos(), filtros={},
                               totales={}, page=1, page_size=100), 400
    filtros.setdefault("page", 1)
    filtros.setdefault("page_size", 100)
    filas, total = svc_matriz.matriz(filtros)
    return render_template("matriz.html", filas=filas, total=total,
                           totales=svc_matriz.totales(filtros),
                           catalogos=svc_matriz.catalogos(), filtros=filtros,
                           page=filtros["page"], page_size=filtros["page_size"], error=None)


@bp.get("/dashboard")
def dashboard():
    return render_template("dashboard.html", catalogos=svc_matriz.catalogos(),
                           fecha_corte=config.FECHA_CORTE)


@bp.get("/glosa")
def glosa():
    solo = request.args.get("solo_verificados") in ("1", "true", "on")
    try:
        insumos = svc_glosa.listar(anio=request.args.get("anio"), tema=request.args.get("tema"),
                                   ambito=request.args.get("ambito"), solo_verificados=solo)
        error = None
    except db.SinDatos as e:
        insumos, error = [], f"Sin conexión a la base: {e}"
    temas = sorted({i["tema"] for i in insumos}) if insumos else []
    return render_template("glosa.html", insumos=insumos, temas=temas, error=error,
                           filtros=request.args, fecha_corte=config.FECHA_CORTE)


@bp.get("/incidencias")
def incidencias():
    try:
        resuelta = formato.bool_param(request.args.get("resuelta"), "resuelta")
    except formato.FiltroInvalido as e:
        return render_template("incidencias.html", error=str(e), filas=[],
                               por_severidad=[], por_tipo=[], filtros={}), 400
    try:
        filas = svc_inc.listar(tipo=request.args.get("tipo"),
                               severidad=request.args.get("severidad"),
                               resuelta=resuelta,
                               municipio=request.args.get("municipio"),
                               anio=request.args.get("anio"))
        por_severidad = svc_inc.conteo_por_severidad()
        por_tipo = svc_inc.conteo_por_tipo()
        error = None
    except db.SinDatos as e:
        filas, por_severidad, por_tipo = [], [], []
        error = f"Sin conexión a la base: {e}"
    return render_template("incidencias.html", filas=filas, por_severidad=por_severidad,
                           por_tipo=por_tipo, filtros=request.args, error=error)
