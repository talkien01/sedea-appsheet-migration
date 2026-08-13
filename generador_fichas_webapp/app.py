"""Aplicación Flask del Sistema Histórico de Apoyos SEDEA.

Se conserva el comportamiento original (`GET /`, `POST /generar`,
`POST /actualizar-datos`) y se agregan matriz, dashboard, glosa, incidencias,
API JSON y exportadores mediante blueprints.

Dev:   python app.py
Nube:  gunicorn -w 3 -b 0.0.0.0:5000 "app:crear_app()"
"""
import os

from flask import Flask, render_template

import config
import db
import ficha_engine
from blueprints.api import bp as bp_api
from blueprints.dashboard import bp as bp_paginas
from blueprints.export import bp as bp_export
from blueprints.fichas import bp as bp_fichas
from services import incidencias as svc_inc
from services import matriz as svc_matriz


def crear_app():
    app = Flask(__name__)

    @app.get("/")
    def index():
        municipios = ficha_engine.cargar_municipios()
        if not municipios:
            municipios = svc_matriz.catalogos()["municipios"]
        datos_ok = (os.path.isdir(config.DATA_DIR)
                    and any(f.endswith(".csv") for f in os.listdir(config.DATA_DIR)))
        manual_ok = os.path.exists(config.MANUAL_XLSX)
        try:
            regiones = svc_matriz.catalogos()["regiones"]
        except Exception:
            regiones = []
        return render_template("index.html", municipios=sorted(municipios), regiones=regiones,
                               datos_ok=datos_ok, manual_ok=manual_ok,
                               modo=db.modo_datos(),
                               incidencias_abiertas=svc_inc.total_abiertas())

    app.register_blueprint(bp_fichas)
    app.register_blueprint(bp_paginas)
    app.register_blueprint(bp_api)
    app.register_blueprint(bp_export)
    return app


app = crear_app()


if __name__ == "__main__":
    print(f"Datos CSV (fallback) en: {config.DATA_DIR}")
    print(f"Plantilla manual: {config.MANUAL_XLSX}")
    print(f"Modo de datos: {db.modo_datos()}")
    print(f"Abre http://localhost:{config.PUERTO} en tu navegador")
    app.run(debug=True, port=config.PUERTO)
