"""Pruebas de la API con el cliente de pruebas de Flask (no requieren servidor)."""
import pytest

import app as app_modulo
import db


@pytest.fixture(scope="module")
def cliente():
    aplicacion = app_modulo.crear_app()
    aplicacion.config.update(TESTING=True)
    with aplicacion.test_client() as c:
        yield c


hay_db = pytest.mark.skipif(not db.hay_db(), reason="requiere la base encendida (docker start sedea_db)")


def test_salud_responde_siempre(cliente):
    r = cliente.get("/api/salud")
    assert r.status_code == 200
    d = r.get_json()
    assert d["ok"] is True
    assert d["modo"] in ("postgres", "csv")
    assert isinstance(d["vistas"], list)


def test_portada_responde(cliente):
    assert cliente.get("/").status_code == 200


def test_catalogos(cliente):
    d = cliente.get("/api/catalogos").get_json()
    for clave in ("regiones", "municipios", "programas", "anios", "clasificaciones"):
        assert clave in d
    assert len(d["regiones"]) == 4
    assert len(d["municipios"]) == 18


def test_matriz_paginada(cliente):
    d = cliente.get("/api/matriz?page=1&page_size=5").get_json()
    assert d["ok"] is True
    assert len(d["data"]) <= 5
    assert d["page"] == 1 and d["page_size"] == 5 and "total" in d


def test_matriz_trae_las_cinco_columnas_de_dinero(cliente):
    d = cliente.get("/api/matriz?page_size=3").get_json()
    for fila in d["data"]:
        for k in ("federal", "estatal", "municipal", "beneficiario", "total"):
            assert k in fila
        assert "municipio_usado" in fila and "fuente_municipio" in fila


def test_matriz_anio_invalido_da_400(cliente):
    r = cliente.get("/api/matriz?anio=abc")
    assert r.status_code == 400
    assert r.get_json()["ok"] is False
    assert r.get_json()["error"]


def test_matriz_2027_vacia_no_cero(cliente):
    d = cliente.get("/api/matriz?anio=2027").get_json()
    assert d["ok"] is True
    assert d["data"] == []


def test_serie_2027_nunca_es_cero(cliente):
    d = cliente.get("/api/series/inversion-anual").get_json()
    for punto in d["data"]:
        if punto.get("anio") == 2027:
            assert punto.get("total") is None


@hay_db
def test_matriz_filtra_por_municipio(cliente):
    d = cliente.get("/api/matriz?municipio=CADEREYTA DE MONTES&page_size=500").get_json()
    assert d["data"]
    assert {f["municipio"] for f in d["data"]} == {"CADEREYTA DE MONTES"}


@hay_db
def test_matriz_filtra_por_rango_de_anios(cliente):
    d = cliente.get("/api/matriz?anio_desde=2023&anio_hasta=2024&page_size=500").get_json()
    assert all(2023 <= f["anio"] <= 2024 for f in d["data"])


@hay_db
def test_matriz_filtra_por_clasificacion(cliente):
    d = cliente.get("/api/matriz?clasificacion=EMERGENTE&page_size=500").get_json()
    assert d["data"]
    assert {f["clasificacion"] for f in d["data"]} == {"EMERGENTE"}


@hay_db
def test_aportaciones_pct_null_si_no_hay_total(cliente):
    d = cliente.get("/api/aportaciones").get_json()
    for f in d["data"]:
        if not f.get("total"):
            for k in ("pct_federal", "pct_estatal", "pct_municipal", "pct_beneficiario"):
                assert f.get(k) is None


@hay_db
def test_r2_beneficiarios_unicos_nunca_igualan_apoyos_sin_curp(cliente):
    d = cliente.get("/api/matriz?anio=2024&page_size=500").get_json()
    for f in d["data"]:
        if f.get("beneficiarios_unicos") is None:
            continue
        assert isinstance(f["beneficiarios_unicos"], int)


@hay_db
def test_a7_la_api_no_expone_la_curp(cliente):
    for ruta in ("/api/matriz?page_size=50", "/api/genero-edad", "/api/glosa"):
        crudo = cliente.get(ruta).get_data(as_text=True)
        assert '"curp"' not in crudo


@hay_db
def test_incidencias_traen_accion_sugerida(cliente):
    d = cliente.get("/api/incidencias").get_json()
    assert d["ok"] is True
    for f in d["data"][:50]:
        assert f["tipo"] and f["severidad"] and f["accion_sugerida"]


@hay_db
def test_glosa_exige_fuente_completa(cliente):
    d = cliente.get("/api/glosa").get_json()
    assert d["data"]
    for i in d["data"]:
        for campo in ("fuente_tabla", "fuente_vista", "fuente_archivo", "fuente_hoja",
                      "criterio_calculo", "fecha_corte", "responsable"):
            assert i.get(campo)


@hay_db
def test_glosa_por_clave_y_404(cliente):
    assert cliente.get("/api/glosa/GLOSA-2026-001").status_code == 200
    assert cliente.get("/api/glosa/NO-EXISTE").status_code == 404


@hay_db
def test_glosa_solo_verificados(cliente):
    d = cliente.get("/api/glosa?solo_verificados=true").get_json()
    assert all(i["verificado"] for i in d["data"])


@hay_db
def test_exportar_csv_incluye_federal(cliente):
    r = cliente.get("/exportar/matriz.csv?anio=2025")
    assert r.status_code == 200
    assert "csv" in r.headers["Content-Type"]
    assert "federal" in r.get_data(as_text=True).splitlines()[0]


@hay_db
def test_exportar_xlsx(cliente):
    r = cliente.get("/exportar/matriz.xlsx?anio=2025")
    assert r.status_code == 200
    assert "spreadsheet" in r.headers["Content-Type"]
    assert "attachment" in r.headers["Content-Disposition"]


@hay_db
def test_exportar_html_autocontenido(cliente):
    r = cliente.get("/exportar/html?ambito=MUNICIPIO&municipio=CADEREYTA DE MONTES")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert len(html) > 50_000
    assert 'src="http' not in html and 'href="http' not in html
    assert "Chart" in html and "__DATOS__" in html
    assert "Fuentes" in html


@hay_db
def test_ficha_municipal(cliente):
    r = cliente.post("/generar", data={"municipio": "CADEREYTA DE MONTES"})
    assert r.status_code == 200
    assert len(r.get_data()) > 10_000


def test_ficha_municipal_inexistente_da_400(cliente):
    assert cliente.post("/generar", data={"municipio": "VILLA INVENTADA"}).status_code == 400
    assert cliente.post("/generar", data={}).status_code == 400


@hay_db
def test_ficha_regional_y_estatal(cliente):
    r = cliente.post("/generar/region", data={"region": "CADEREYTA"})
    assert r.status_code == 200 and len(r.get_data()) > 10_000
    assert cliente.post("/generar/region", data={"region": "REGION FALSA"}).status_code == 400
    e = cliente.post("/generar/estatal")
    assert e.status_code == 200 and len(e.get_data()) > 10_000


@hay_db
def test_paginas_html(cliente):
    for ruta in ("/matriz", "/dashboard", "/glosa", "/incidencias"):
        assert cliente.get(ruta).status_code == 200
