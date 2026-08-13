import os
from flask import Flask, render_template, request, send_file, jsonify

import config
import ficha_engine
import docx_writer
import refresh_data

app = Flask(__name__)

@app.route("/")
def index():
    municipios = ficha_engine.cargar_municipios()
    datos_ok = os.path.exists(config.DATA_DIR) and len(os.listdir(config.DATA_DIR)) > 0 if os.path.exists(config.DATA_DIR) else False
    manual_ok = os.path.exists(config.MANUAL_XLSX)
    return render_template("index.html", municipios=sorted(municipios), datos_ok=datos_ok, manual_ok=manual_ok)

@app.route("/generar", methods=["POST"])
def generar():
    municipio = request.form.get("municipio")
    if not municipio:
        return "Falta seleccionar municipio", 400

    data = ficha_engine.generar(municipio)
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    fname = f"Ficha_{municipio.replace(' ', '_')}.docx"
    out_path = os.path.join(config.OUTPUT_DIR, fname)
    docx_writer.escribir_ficha(data, out_path)

    return send_file(out_path, as_attachment=True, download_name=fname)

@app.route("/actualizar-datos", methods=["POST"])
def actualizar_datos():
    resultados = refresh_data.refrescar()
    return jsonify(resultados)

if __name__ == "__main__":
    print(f"Datos esperados en: {config.DATA_DIR}")
    print(f"Plantilla manual esperada en: {config.MANUAL_XLSX}")
    print("Abre http://localhost:5000 en tu navegador")
    app.run(debug=True, port=5000)
