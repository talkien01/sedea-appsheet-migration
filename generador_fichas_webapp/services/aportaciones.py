"""Distribución de aportaciones Federal / Estatal / Municipal / Beneficiario (R3).

Los porcentajes son NULL cuando el total es NULL o 0 (nunca división por cero,
nunca 0 % inventado). "Beneficiario" = aportación del productor (A4).
"""
import db
from services import formato
from services.matriz import _where, _normalizar

ETIQUETAS = {
    "federal": "Federal",
    "estatal": "Estatal",
    "municipal": "Municipal",
    "beneficiario": "Beneficiario (productor)",
}


def detalle(filtros):
    w, params = _where(filtros)
    return _normalizar(db.consultar(
        f"SELECT * FROM analitica.vw_matriz_aportaciones{w} ORDER BY anio, municipio, programa",
        params))


def resumen(filtros):
    """Una fila con los 4 componentes, su total y sus porcentajes."""
    w, params = _where(filtros)
    filas = db.consultar(
        "SELECT sum(federal) AS federal, sum(estatal) AS estatal, sum(municipal) AS municipal, "
        "sum(beneficiario) AS beneficiario, sum(total) AS total "
        f"FROM analitica.vw_matriz_historica{w}", params)
    if not filas:
        return {}
    d = _normalizar(filas)[0]
    total = d.get("total")
    for k in ETIQUETAS:
        v = d.get(k)
        d[f"pct_{k}"] = (round(100.0 * v / total, 2)
                         if (v is not None and total not in (None, 0)) else None)
    return d


def descuadres(filtros):
    w, params = _where(filtros)
    cond = " AND cuadra = false" if w else " WHERE cuadra = false"
    return _normalizar(db.consultar(
        f"SELECT * FROM analitica.vw_matriz_aportaciones{w}{cond} ORDER BY anio, municipio", params))


def para_grafica(filtros):
    """Etiquetas y valores para la dona del dashboard; omite los componentes sin dato."""
    r = resumen(filtros)
    etiquetas, valores = [], []
    for clave, etiqueta in ETIQUETAS.items():
        v = r.get(clave)
        if v is None:
            continue  # sin dato no se grafica como 0 (R1)
        etiquetas.append(etiqueta)
        valores.append(v)
    return {"labels": etiquetas, "valores": valores,
            "total": r.get("total"), "sin_dato": [ETIQUETAS[k] for k in ETIQUETAS
                                                  if r.get(k) is None]}


def formatear(fila):
    return {etiqueta: formato.dinero(fila.get(clave)) for clave, etiqueta in ETIQUETAS.items()}
