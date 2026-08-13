"""API JSON de solo lectura (§7.7).

Contrato: {"ok":true,"filtros":{…},"total":N,"data":[…]}
Errores: 400 con {"ok":false,"error":"…"}; 404 si no existe; nunca 500 con traza.
Privacidad: jamás sale la CURP completa, solo `curp_hash` (A7).
"""
from flask import Blueprint, jsonify, request

import config
import db
from services import aportaciones as svc_aport
from services import formato, genero_edad, glosa, incidencias, matriz

bp = Blueprint("api", __name__, url_prefix="/api")

CLAVES_PROHIBIDAS = ("curp",)


def _limpiar(filas):
    """Quita cualquier campo con CURP literal antes de responder (A7)."""
    limpias = []
    for f in filas:
        limpias.append({k: v for k, v in f.items() if k not in CLAVES_PROHIBIDAS})
    return limpias


def ok(data, filtros=None, total=None, **extra):
    cuerpo = {"ok": True, "filtros": filtros or {}, "total": total if total is not None else len(data),
              "data": _limpiar(data)}
    cuerpo.update(extra)
    return jsonify(cuerpo)


def error(mensaje, codigo=400):
    return jsonify({"ok": False, "error": mensaje, "data": [], "total": 0}), codigo


@bp.errorhandler(Exception)
def _sin_traza(e):  # nunca se devuelve un stack trace al cliente
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return error(e.description, e.code)
    return error(f"Error interno procesando la petición: {type(e).__name__}", 500)


@bp.get("/salud")
def salud():
    diag = db.diagnostico()
    return jsonify({
        "ok": True,
        "db": diag["db"],
        "modo": diag["modo"],
        "transporte": diag["transporte"],
        "data_dir": diag["data_dir"],
        "vistas": db.vistas_disponibles(),
        "fecha_corte": config.FECHA_CORTE,
        "version": config.VERSION,
    })


@bp.get("/catalogos")
def catalogos():
    c = matriz.catalogos()
    return jsonify({"ok": True, "filtros": {}, "total": len(c["municipios"]), "data": c, **c})


@bp.get("/matriz")
def api_matriz():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    filas, total = matriz.matriz(filtros)
    return ok(filas, filtros, total,
              page=filtros.get("page", 1), page_size=filtros.get("page_size", 100))


@bp.get("/emer-prod")
def api_emer_prod():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    try:
        return ok(matriz.emer_prod(filtros), filtros)
    except db.SinDatos as e:
        return error(f"Vista no disponible en modo CSV: {e}", 503)


@bp.get("/aportaciones")
def api_aportaciones():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    try:
        return ok(svc_aport.detalle(filtros), filtros)
    except db.SinDatos as e:
        return error(f"Vista no disponible en modo CSV: {e}", 503)


@bp.get("/aportaciones/resumen")
def api_aportaciones_resumen():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    try:
        return ok([svc_aport.resumen(filtros)], filtros, grafica=svc_aport.para_grafica(filtros))
    except db.SinDatos as e:
        return error(f"Vista no disponible en modo CSV: {e}", 503)


@bp.get("/genero-edad")
def api_genero_edad():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    try:
        return ok(genero_edad.genero_edad(filtros), filtros,
                  resumen=genero_edad.resumen_por_genero(filtros))
    except db.SinDatos as e:
        return error(f"Vista no disponible en modo CSV: {e}", 503)


@bp.get("/incidencias")
def api_incidencias():
    try:
        resuelta = formato.bool_param(request.args.get("resuelta"), "resuelta")
    except formato.FiltroInvalido as e:
        return error(str(e))
    filtros = {k: v for k, v in request.args.items() if v}
    try:
        filas = incidencias.listar(tipo=request.args.get("tipo"),
                                   severidad=request.args.get("severidad"),
                                   resuelta=resuelta,
                                   municipio=request.args.get("municipio"),
                                   anio=request.args.get("anio"))
        return ok([formato.fila_json(f) for f in filas], filtros,
                  por_severidad=[formato.fila_json(f) for f in incidencias.conteo_por_severidad()],
                  por_tipo=[formato.fila_json(f) for f in incidencias.conteo_por_tipo()])
    except db.SinDatos as e:
        return error(f"Incidencias no disponibles en modo CSV: {e}", 503)
    except ValueError as e:
        return error(str(e))


@bp.get("/glosa")
def api_glosa():
    try:
        solo = formato.bool_param(request.args.get("solo_verificados"), "solo_verificados")
    except formato.FiltroInvalido as e:
        return error(str(e))
    filtros = {k: v for k, v in request.args.items() if v}
    try:
        filas = glosa.listar(anio=request.args.get("anio"), tema=request.args.get("tema"),
                             ambito=request.args.get("ambito"), solo_verificados=solo)
        return ok(filas, filtros)
    except db.SinDatos as e:
        return error(f"Glosa no disponible en modo CSV: {e}", 503)
    except ValueError as e:
        return error(str(e))


@bp.get("/glosa/<clave>")
def api_glosa_clave(clave):
    try:
        insumo = glosa.obtener(clave)
    except db.SinDatos as e:
        return error(f"Glosa no disponible en modo CSV: {e}", 503)
    if not insumo:
        return error(f"No existe el insumo de Glosa «{clave}».", 404)
    return ok([insumo], {"clave": clave}, 1)


@bp.get("/series/inversion-anual")
def api_serie_anual():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    return ok(matriz.serie_inversion_anual(filtros), filtros)


@bp.get("/resumen")
def api_resumen():
    """KPIs del dashboard: totales + municipios + incidencias abiertas."""
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    tot = matriz.totales(filtros)
    tot["incidencias_abiertas"] = incidencias.total_abiertas()
    return ok([tot], filtros, 1)


@bp.get("/top-municipios")
def api_top_municipios():
    try:
        filtros = formato.parsear_filtros(request.args)
    except formato.FiltroInvalido as e:
        return error(str(e))
    filas, _ = matriz.matriz(dict(filtros, page_size=5000, page=1), con_paginado=False)
    acc = {}
    for f in filas:
        if not f.get("municipio") or f.get("total") is None:
            continue
        acc[f["municipio"]] = acc.get(f["municipio"], 0) + f["total"]
    top = sorted(acc.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return ok([{"municipio": m, "total": t} for m, t in top], filtros)
