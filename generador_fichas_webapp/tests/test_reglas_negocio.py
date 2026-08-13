"""Pruebas de las reglas críticas R1–R8 sobre el código y sobre los datos."""
import os
import re

import pytest

import config
from services import formato

RAIZ = config.BASE_DIR


# --- R1: nada se imputa -----------------------------------------------------
def test_r1_sin_imputacion_en_services_e_ingesta():
    prohibidos = [
        (r"\bfillna\b", "fillna"),
        (r"or 0\b", "'or 0' sobre un monto"),
        (r"\.get\([^)]*,\s*0\)", "default 0 en un .get"),
        (r"coalesce\([^)]*,\s*0\)\s+AS\s+(federal|estatal|municipal|beneficiario|total)", "coalesce a 0 en un monto"),
    ]
    ofensas = []
    for carpeta in ("services", "ingesta"):
        base = os.path.join(RAIZ, carpeta)
        for archivo in os.listdir(base):
            if not archivo.endswith(".py"):
                continue
            ruta = os.path.join(base, archivo)
            with open(ruta, encoding="utf-8") as f:
                for n, linea in enumerate(f, 1):
                    if linea.lstrip().startswith("#"):
                        continue
                    for patron, desc in prohibidos:
                        if re.search(patron, linea):
                            ofensas.append(f"{carpeta}/{archivo}:{n} {desc}: {linea.strip()}")
    assert not ofensas, "Imputación de datos detectada:\n" + "\n".join(ofensas)


def test_r1_vacio_se_rinde_como_guion():
    assert formato.dinero(None) == "—"
    assert formato.entero(None) == "—"
    assert formato.porcentaje(None) == "—"
    assert formato.texto(None) == "—"
    assert formato.dinero(0) == "$0"          # un cero real sí se muestra


def test_r1_a_numero_no_inventa_ceros():
    from ingesta import comun
    assert comun.a_numero("") is None
    assert comun.a_numero(None) is None
    assert comun.a_numero("N/D") is None
    assert comun.a_numero("—") is None
    assert comun.a_numero("1,234.50") == 1234.5


# --- R3: cinco columnas de dinero ------------------------------------------
def test_r3_matriz_expone_las_cinco_columnas():
    from services.matriz import COLUMNAS_MATRIZ
    for c in ("federal", "estatal", "municipal", "beneficiario", "total"):
        assert c in COLUMNAS_MATRIZ


def test_r3_ficha_docx_incluye_federal():
    with open(os.path.join(RAIZ, "docx_writer.py"), encoding="utf-8") as f:
        fuente = f.read()
    assert '"Federal"' in fuente
    assert "apoyo_federal" in fuente


# --- R4: 2027 vacío, no cero ------------------------------------------------
def test_r4_filtro_2027_es_valido():
    f = formato.parsear_filtros({"anio": "2027"})
    assert f["anio"] == 2027


def test_r4_anio_invalido_es_error_de_usuario():
    with pytest.raises(formato.FiltroInvalido):
        formato.parsear_filtros({"anio": "abc"})


# --- R5: trazabilidad de municipio -----------------------------------------
def test_r5_seis_valores_de_fuente_municipio():
    with open(os.path.join(RAIZ, "docs", "CRITERIOS.md"), encoding="utf-8") as f:
        criterios = f.read()
    for v in ("EXPLICITO", "ALIAS", "CURP", "DISTRIBUCION",
              "ESTATAL_NO_DESAGREGADO", "DESCONOCIDO"):
        assert v in criterios


def test_r5_resolver_municipio_no_adivina():
    from ingesta import comun
    por_nombre = {"CADEREYTA DE MONTES": 3}
    alias = {"CADEREYTA": 3}
    pseudo = set()
    assert comun.resolver_municipio("Cadereyta de Montes", por_nombre, alias, pseudo)[:2] == (3, "EXPLICITO")
    assert comun.resolver_municipio("CADEREYTA", por_nombre, alias, pseudo)[:2] == (3, "ALIAS")
    assert comun.resolver_municipio("Villa Inventada", por_nombre, alias, pseudo)[:2] == (None, "DESCONOCIDO")


# --- R7: insumo de Glosa sin fuente no existe -------------------------------
def test_r7_glosa_rechaza_insumo_incompleto():
    from services import glosa
    with pytest.raises(ValueError):
        glosa.guardar({"clave": "GLOSA-TEST-999", "tema": "x", "pregunta": "y",
                       "indicador": "z", "unidad": "MXN", "anio": 2026, "ambito": "ESTATAL"})


# --- R8: incidencias con acción sugerida ------------------------------------
def test_r8_incidencia_exige_accion_sugerida():
    from services import incidencias
    with pytest.raises(ValueError):
        incidencias.registrar("CURP_INVALIDA", "ADVERTENCIA", "tabla", "desc", "")
    with pytest.raises(ValueError):
        incidencias.registrar("TIPO_INEXISTENTE", "ADVERTENCIA", "tabla", "d", "a")
    with pytest.raises(ValueError):
        incidencias.registrar("CURP_INVALIDA", "SEVERIDAD_RARA", "tabla", "d", "a")


# --- Configuración y defectos corregidos ------------------------------------
def test_refresh_data_tiene_16_csvs():
    import refresh_data
    assert len(refresh_data.QUERIES) == 16


def test_data_dir_apunta_a_una_carpeta_con_csvs():
    assert os.path.isdir(config.DATA_DIR)
    assert any(f.endswith(".csv") for f in os.listdir(config.DATA_DIR))


def test_chartjs_esta_vendorizado():
    ruta = os.path.join(RAIZ, "static", "vendor", "chart.umd.min.js")
    assert os.path.exists(ruta)
    assert os.path.getsize(ruta) > 50_000


def test_mapeos_de_ingesta_traen_encabezados_reales():
    """A1: los mapeos se llenaron con los encabezados verdaderos de los .xlsx."""
    from ingesta import comun
    mapeo = comun.cargar_mapeo("curp_base_cadereyta.json")
    assert mapeo["columnas"]["curp"] == ["CURP"]
    assert "MONTO TOTAL DICTAMINADO" in mapeo["columnas"]["monto_total"]
    assert "MUNICIPIO PROYECTO" in mapeo["columnas"]["municipio"]
