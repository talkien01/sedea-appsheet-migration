"""Pruebas del validador de CURP (R6): nada se infiere si la CURP no es válida."""
from datetime import date

import pytest

from services import curp

CORTE = date(2026, 12, 31)

# CURP real del padrón de la región Cadereyta (dígito verificador correcto).
CURP_VALIDA = "MARA431115MQTRSL09"
CURP_VALIDA_H = "MEBA730309HQTNRL04"


def test_curp_valida_conocida():
    r = curp.analizar(CURP_VALIDA, CORTE)
    assert r["curp_valida"] is True
    assert r["genero"] == "M"
    assert r["fecha_nacimiento"] == date(1943, 11, 15)
    assert r["entidad_nacimiento"] == "QT"
    assert r["rango_edad"] == "60+"
    assert r["motivo_invalidez"] is None


def test_curp_valida_hombre():
    r = curp.analizar(CURP_VALIDA_H, CORTE)
    assert r["curp_valida"] is True
    assert r["genero"] == "H"


def _assert_sin_derivados(r, motivo):
    assert r["curp_valida"] is False
    assert r["motivo_invalidez"] == motivo
    assert r["genero"] is None
    assert r["fecha_nacimiento"] is None
    assert r["edad_anios"] is None
    assert r["rango_edad"] is None


def test_digito_verificador_incorrecto():
    mala = CURP_VALIDA[:17] + ("0" if CURP_VALIDA[17] != "0" else "1")
    _assert_sin_derivados(curp.analizar(mala, CORTE), "DIGITO_VERIFICADOR")


def test_fecha_imposible():
    # 99-02-31 no existe en el calendario
    mala = "MARA990231MQTRSL01"
    _assert_sin_derivados(curp.analizar(mala, CORTE), "FECHA")


def test_entidad_inexistente():
    mala = "MARA431115MZZRSL09"
    _assert_sin_derivados(curp.analizar(mala, CORTE), "ENTIDAD")


def test_longitud_17():
    _assert_sin_derivados(curp.analizar(CURP_VALIDA[:17], CORTE), "LONGITUD")


def test_curp_nula():
    _assert_sin_derivados(curp.analizar(None, CORTE), "NULA")
    _assert_sin_derivados(curp.analizar("   ", CORTE), "NULA")


def test_formato_invalido():
    _assert_sin_derivados(curp.analizar("1234567890ABCDEFGH", CORTE), "FORMATO")


def test_sexo_invalido_en_posicion_11():
    mala = CURP_VALIDA[:10] + "X" + CURP_VALIDA[11:]
    r = curp.analizar(mala, CORTE)
    assert r["curp_valida"] is False
    assert r["genero"] is None


@pytest.mark.parametrize("edad,esperado", [
    (0, "MENOR_18"), (17, "MENOR_18"), (18, "18-29"), (29, "18-29"),
    (30, "30-44"), (44, "30-44"), (45, "45-59"), (59, "45-59"),
    (60, "60+"), (95, "60+"), (None, None),
])
def test_rangos_de_edad(edad, esperado):
    assert curp.rango_de_edad(edad) == esperado


def test_edad_se_calcula_a_la_fecha_de_corte():
    assert curp.calcular_edad(date(2000, 12, 31), date(2026, 12, 31)) == 26
    assert curp.calcular_edad(date(2001, 1, 1), date(2026, 12, 31)) == 25


def test_hash_no_expone_la_curp():
    h = curp.hash_curp(CURP_VALIDA)
    assert len(h) == 64
    assert CURP_VALIDA not in h
    assert h == curp.hash_curp(CURP_VALIDA.lower())


def test_no_hay_heuristica_por_nombre():
    """R6: el módulo no debe mirar nombres de pila para deducir el género."""
    import inspect
    fuente = inspect.getsource(curp)
    for prohibido in ("nombre_pila", "nombres_hombre", "nombres_mujer", "lista_nombres"):
        assert prohibido not in fuente
    assert "def analizar" in fuente
