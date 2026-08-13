"""Formato de cifras para UI y exportaciones (A12) y parseo de filtros.

Regla transversal: lo que no tiene dato se rinde como «—», nunca como 0 (R1/R4).
"""
import datetime
from decimal import Decimal

VACIO = "—"
CLASIFICACIONES = ("EMERGENTE", "PRODUCTIVIDAD", "NO_CLASIFICADO")
ORIGENES = ("apoyo_municipio", "accion", "oficial_2026")


class FiltroInvalido(ValueError):
    """Parámetro de consulta mal formado: la API responde 400, no 500."""


def a_decimal(v):
    if v is None or v == "":
        return None
    if isinstance(v, Decimal):
        return v
    try:
        return Decimal(str(v))
    except Exception:
        return None


def dinero(v, decimales=0):
    """$1,234,567 en UI. None ⇒ «—» (nunca $0)."""
    d = a_decimal(v)
    if d is None:
        return VACIO
    if decimales:
        return "$" + f"{d:,.{decimales}f}"
    return "$" + f"{d:,.0f}"


def entero(v):
    if v is None or v == "":
        return VACIO
    try:
        return f"{int(float(v)):,}"
    except (TypeError, ValueError):
        return VACIO


def porcentaje(v):
    if v is None or v == "":
        return VACIO
    try:
        return f"{float(v):.1f}%"
    except (TypeError, ValueError):
        return VACIO


def texto(v):
    if v is None or str(v).strip() == "":
        return VACIO
    return str(v)


def numero_json(v):
    """Normaliza a float/int para JSON conservando None (nunca lo vuelve 0)."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    return int(f) if f.is_integer() and abs(f) < 1e15 else f


def fila_json(fila):
    """Convierte una fila de la base a tipos JSON seguros."""
    out = {}
    for k, v in (fila or {}).items():
        if isinstance(v, (datetime.date, datetime.datetime)):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, str) and v in ("t", "f") and k in ("cuadra", "completo", "verificado",
                                                              "resuelta", "curp_valida"):
            out[k] = (v == "t")
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# Parseo de filtros de la API (§7.2)
# ---------------------------------------------------------------------------
def _entero_param(valores, nombre):
    if valores is None or valores == "":
        return None
    try:
        return int(str(valores).strip())
    except ValueError:
        raise FiltroInvalido(f"El parámetro «{nombre}» debe ser un número entero; llegó «{valores}».")


def parsear_filtros(args):
    """args: dict-like (request.args). Devuelve dict de filtros limpios.
    Lanza FiltroInvalido ⇒ la API responde 400."""
    f = {}
    for nombre in ("anio", "anio_desde", "anio_hasta"):
        v = _entero_param(args.get(nombre), nombre)
        if v is not None:
            if v < 1900 or v > 2100:
                raise FiltroInvalido(f"El año «{v}» está fuera de rango.")
            f[nombre] = v
    if f.get("anio_desde") and f.get("anio_hasta") and f["anio_desde"] > f["anio_hasta"]:
        raise FiltroInvalido("anio_desde no puede ser mayor que anio_hasta.")

    for nombre in ("region", "municipio", "programa"):
        v = (args.get(nombre) or "").strip()
        if v:
            f[nombre] = v

    clas = (args.get("clasificacion") or "").strip().upper()
    if clas:
        if clas not in CLASIFICACIONES:
            raise FiltroInvalido(
                f"clasificacion debe ser una de {', '.join(CLASIFICACIONES)}; llegó «{clas}».")
        f["clasificacion"] = clas

    origen = (args.get("origen") or "").strip()
    if origen:
        if origen not in ORIGENES:
            raise FiltroInvalido(f"origen debe ser uno de {', '.join(ORIGENES)}; llegó «{origen}».")
        f["origen"] = origen

    page = _entero_param(args.get("page"), "page")
    page_size = _entero_param(args.get("page_size"), "page_size")
    if page is not None:
        if page < 1:
            raise FiltroInvalido("page debe ser >= 1.")
        f["page"] = page
    if page_size is not None:
        if page_size < 1 or page_size > 5000:
            raise FiltroInvalido("page_size debe estar entre 1 y 5000.")
        f["page_size"] = page_size
    return f


def bool_param(valor, nombre="parametro"):
    if valor is None or valor == "":
        return None
    v = str(valor).strip().lower()
    if v in ("1", "true", "si", "sí", "yes", "t"):
        return True
    if v in ("0", "false", "no", "n", "f"):
        return False
    raise FiltroInvalido(f"«{nombre}» debe ser true o false; llegó «{valor}».")
