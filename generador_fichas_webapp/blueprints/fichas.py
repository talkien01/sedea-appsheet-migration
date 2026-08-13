"""Generación de fichas .docx: municipal (existente, extendida), regional y estatal."""
import os

from flask import Blueprint, jsonify, request, send_file

import config
import docx_writer
import ficha_engine
import refresh_data
from services import matriz as svc_matriz

bp = Blueprint("fichas", __name__)


def _salida(nombre):
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    return os.path.join(config.OUTPUT_DIR, nombre)


@bp.post("/generar")
def generar():
    municipio = (request.form.get("municipio") or "").strip()
    if not municipio:
        return "Falta seleccionar municipio", 400
    validos = {m.upper() for m in svc_matriz.catalogos()["municipios"]}
    if municipio.upper() not in validos:
        return jsonify({"ok": False,
                        "error": f"El municipio «{municipio}» no existe en el catálogo."}), 400

    data = ficha_engine.generar(municipio)
    nombre = f"Ficha_{municipio.replace(' ', '_')}.docx"
    ruta = _salida(nombre)
    docx_writer.escribir_ficha(data, ruta)
    return send_file(ruta, as_attachment=True, download_name=nombre)


@bp.post("/generar/region")
def generar_region():
    region = (request.form.get("region") or "").strip()
    if not region:
        return jsonify({"ok": False, "error": "Falta seleccionar región."}), 400
    try:
        data = ficha_engine.generar_region(region)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    nombre = f"Ficha_Region_{region.replace(' ', '_')}.docx"
    ruta = _salida(nombre)
    docx_writer.escribir_ficha_region(data, ruta)
    return send_file(ruta, as_attachment=True, download_name=nombre)


@bp.post("/generar/estatal")
def generar_estatal():
    data = ficha_engine.generar_estatal()
    nombre = "Ficha_Estatal.docx"
    ruta = _salida(nombre)
    docx_writer.escribir_ficha_estatal(data, ruta)
    return send_file(ruta, as_attachment=True, download_name=nombre)


@bp.post("/actualizar-datos")
def actualizar_datos():
    return jsonify(refresh_data.refrescar())
