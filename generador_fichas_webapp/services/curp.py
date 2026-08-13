"""Validador de CURP y derivación de género, fecha de nacimiento y rango de edad.

Determinista y sin heurísticas: si la CURP no pasa la validación completa, los
derivados quedan en None y se reporta el motivo (R6). Aquí NO se mira el nombre
de la persona para nada — el género sale exclusivamente de la posición 11 de la
CURP, que es el sexo registrado ante RENAPO.
"""
import hashlib
import re
from datetime import date

RANGOS = ("MENOR_18", "18-29", "30-44", "45-59", "60+")

MOTIVOS = ("FORMATO", "DIGITO_VERIFICADOR", "FECHA", "ENTIDAD", "LONGITUD", "NULA")

ENTIDADES = {
    "AS", "BC", "BS", "CC", "CL", "CM", "CS", "CH", "DF", "DG", "GT", "GR", "HG",
    "JC", "MC", "MN", "MS", "NT", "NL", "OC", "PL", "QT", "QR", "SP", "SL", "SR",
    "TC", "TS", "TL", "VZ", "YN", "ZS", "NE",
}

_ALFABETO = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"
_RE_CURP = re.compile(r"^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[0-9A-Z]\d$")


def normalizar(curp):
    if curp is None:
        return None
    s = str(curp).strip().upper().replace(" ", "")
    return s or None


def hash_curp(curp):
    """SHA-256 de la CURP en mayúsculas. Es lo único que sale por API (A7)."""
    base = normalizar(curp) or ""
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def digito_verificador(curp17):
    """Algoritmo RENAPO estándar sobre los primeros 17 caracteres."""
    suma = 0
    for i, ch in enumerate(curp17[:17]):
        pos = _ALFABETO.find(ch)
        if pos < 0:
            return None
        suma += pos * (18 - i)
    d = 10 - (suma % 10)
    return 0 if d == 10 else d


def _fecha_desde_curp(curp):
    aa, mm, dd = curp[4:6], curp[6:8], curp[8:10]
    # Siglo: la posición 17 (índice 16) es dígito para 1900s y letra para 2000s.
    siglo = 1900 if curp[16].isdigit() else 2000
    try:
        return date(siglo + int(aa), int(mm), int(dd))
    except ValueError:
        return None


def calcular_edad(fecha_nac, fecha_corte):
    if not fecha_nac or not fecha_corte:
        return None
    edad = fecha_corte.year - fecha_nac.year
    if (fecha_corte.month, fecha_corte.day) < (fecha_nac.month, fecha_nac.day):
        edad -= 1
    return edad


def rango_de_edad(edad):
    if edad is None:
        return None
    if edad < 18:
        return "MENOR_18"
    if edad <= 29:
        return "18-29"
    if edad <= 44:
        return "30-44"
    if edad <= 59:
        return "45-59"
    return "60+"


def analizar(curp, fecha_corte=None):
    """Devuelve un dict con el resultado completo del análisis de una CURP.

    Claves: curp, curp_hash, curp_valida, motivo_invalidez, genero,
    fecha_nacimiento, edad_anios, rango_edad, entidad_nacimiento.
    Si curp_valida es False, los cuatro derivados son None (R6).
    """
    c = normalizar(curp)
    resultado = {
        "curp": c,
        "curp_hash": hash_curp(c) if c else None,
        "curp_valida": False,
        "motivo_invalidez": None,
        "genero": None,
        "fecha_nacimiento": None,
        "edad_anios": None,
        "rango_edad": None,
        "entidad_nacimiento": None,
    }
    if not c:
        resultado["motivo_invalidez"] = "NULA"
        return resultado
    if len(c) != 18:
        resultado["motivo_invalidez"] = "LONGITUD"
        return resultado
    if not _RE_CURP.match(c):
        resultado["motivo_invalidez"] = "FORMATO"
        return resultado

    entidad = c[11:13]
    fecha_nac = _fecha_desde_curp(c)
    if fecha_nac is None:
        resultado["motivo_invalidez"] = "FECHA"
        return resultado
    if entidad not in ENTIDADES:
        resultado["entidad_nacimiento"] = entidad
        resultado["motivo_invalidez"] = "ENTIDAD"
        return resultado
    dv = digito_verificador(c)
    if dv is None or str(dv) != c[17]:
        resultado["entidad_nacimiento"] = entidad
        resultado["motivo_invalidez"] = "DIGITO_VERIFICADOR"
        return resultado

    corte = fecha_corte or date.today()
    edad = calcular_edad(fecha_nac, corte)
    resultado.update({
        "curp_valida": True,
        "genero": c[10],                 # posición 11: sexo registrado (H/M)
        "fecha_nacimiento": fecha_nac,
        "edad_anios": edad,
        "rango_edad": rango_de_edad(edad),
        "entidad_nacimiento": entidad,
    })
    return resultado


def es_valida(curp):
    return analizar(curp)["curp_valida"]
