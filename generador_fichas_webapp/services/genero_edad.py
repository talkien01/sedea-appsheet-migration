"""Género y edad derivados de CURP (R6). Fuente: analitica.vw_genero_edad.

`beneficiarios_demografia` está vacía y no tiene dimensión municipio: solo se usa
como fallback estatal si algún día se llena (A16). Nunca sustituye a la CURP.
"""
import db
from services import formato
from services.matriz import _where, _normalizar


def genero_edad(filtros):
    w, params = _where(filtros)
    return _normalizar(db.consultar(
        f"SELECT * FROM analitica.vw_genero_edad{w} "
        "ORDER BY anio, municipio, programa, genero, rango_edad", params))


def resumen_por_genero(filtros):
    """[{genero, personas}] + conteo de CURP inválidas aparte (nunca dentro de un género)."""
    w, params = _where(filtros)
    filas = db.consultar(
        "SELECT genero, sum(personas)::int AS personas, "
        "sum(curps_validas)::int AS curps_validas, sum(curps_invalidas)::int AS curps_invalidas "
        f"FROM analitica.vw_genero_edad{w} GROUP BY genero ORDER BY genero", params)
    return _normalizar(filas)


def resumen_por_rango(filtros):
    w, params = _where(filtros)
    filas = db.consultar(
        "SELECT rango_edad, genero, sum(personas)::int AS personas "
        f"FROM analitica.vw_genero_edad{w} GROUP BY rango_edad, genero "
        "ORDER BY rango_edad, genero", params)
    return _normalizar(filas)


def hay_datos(filtros):
    try:
        w, params = _where(filtros)
        n = db.escalar(f"SELECT count(*)::int FROM analitica.vw_genero_edad{w}", params)
        return n is not None and int(n) > 0
    except db.SinDatos:
        return False


def leyenda_sin_datos(ambito):
    return (f"Sin CURP cargada para {ambito}: no hay base para reportar género ni edad. "
            f"No se muestran ceros ni estimaciones (R1/R6).")


def formatear(filas):
    return [{
        "genero": formato.texto(f.get("genero")),
        "rango_edad": formato.texto(f.get("rango_edad")),
        "personas": formato.entero(f.get("personas")),
        "curps_validas": formato.entero(f.get("curps_validas")),
        "curps_invalidas": formato.entero(f.get("curps_invalidas")),
        "pct_del_grupo": formato.porcentaje(f.get("pct_del_grupo")),
    } for f in filas]
