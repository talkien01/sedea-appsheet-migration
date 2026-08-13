"""Utilidades compartidas por los scripts de ingesta.

Principios (SPEC §6.7 y A1):
- El mapeo de columnas vive en ``ingesta/mapeos/*.json`` y se resuelve por
  encabezado normalizado con sinónimos. **Nunca** por índice de columna.
- Todo script es idempotente, soporta ``--dry-run`` e imprime
  leidas/insertadas/actualizadas/omitidas/incidencias.
- Ningún valor que no esté en el origen se inventa (R1).
"""
import json
import os
import unicodedata

import config

AQUI = os.path.dirname(os.path.abspath(__file__))
MAPEOS = os.path.join(AQUI, "mapeos")


def cargar_mapeo(nombre):
    with open(os.path.join(MAPEOS, nombre), encoding="utf-8") as f:
        return json.load(f)


def normalizar(texto):
    """Mayúsculas, sin acentos, sin puntuación de adorno ni espacios dobles."""
    if texto is None:
        return ""
    s = str(texto).strip().upper()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace(".", " ").replace("_", " ").replace("-", " ")
    return " ".join(s.split())


def indexar_encabezados(fila_encabezados):
    """{encabezado_normalizado: índice} a partir de la fila real del xlsx."""
    idx = {}
    for i, h in enumerate(fila_encabezados):
        n = normalizar(h)
        if n and n not in idx:
            idx[n] = i
    return idx


def resolver_columna(indice, sinonimos):
    """Devuelve el índice de la primera variante que exista, o None."""
    for s in sinonimos:
        i = indice.get(normalizar(s))
        if i is not None:
            return i
    return None


def resolver_mapeo(indice, columnas):
    """{campo: índice|None} + lista de campos no resueltos."""
    resuelto, faltantes = {}, []
    for campo, sinonimos in columnas.items():
        i = resolver_columna(indice, sinonimos)
        resuelto[campo] = i
        if i is None:
            faltantes.append(campo)
    return resuelto, faltantes


def no_mapeadas(indice, resuelto):
    usados = {i for i in resuelto.values() if i is not None}
    return [h for h, i in indice.items() if i not in usados]


def a_numero(valor):
    """Convierte a float sin inventar: vacío o basura ⇒ None (nunca 0)."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    s = str(valor).strip().replace("$", "").replace(",", "").replace(" ", "")
    if s in ("", "-", "—", "N/D", "ND", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def a_entero(valor):
    n = a_numero(valor)
    return None if n is None else int(round(n))


class Contadores:
    """Las 5 métricas que todo script de ingesta debe imprimir."""

    def __init__(self):
        self.leidas = 0
        self.insertadas = 0
        self.actualizadas = 0
        self.omitidas = 0
        self.incidencias = 0

    def imprimir(self, dry_run=False):
        marca = " (dry-run: no se escribió nada)" if dry_run else ""
        print(f"leidas={self.leidas} insertadas={self.insertadas} "
              f"actualizadas={self.actualizadas} omitidas={self.omitidas} "
              f"incidencias={self.incidencias}{marca}")


def ruta_archivo(nombre):
    """Resuelve la ruta del archivo fuente relativo a la carpeta del proyecto."""
    if os.path.isabs(nombre) and os.path.exists(nombre):
        return nombre
    cand = os.path.join(config.BASE_DIR, nombre)
    if os.path.exists(cand):
        return cand
    if os.path.exists(nombre):
        return os.path.abspath(nombre)
    raise FileNotFoundError(f"No se encontró el archivo fuente: {nombre}")


# ---------------------------------------------------------------------------
# Resolución de catálogos (municipio / programa) con trazabilidad (R5)
# ---------------------------------------------------------------------------
def catalogo_municipios(db):
    filas = db.consultar("SELECT municipio_id, nombre, region_id FROM analitica.municipio")
    por_nombre = {normalizar(f["nombre"]): int(f["municipio_id"]) for f in filas}
    pseudo = {normalizar(f["nombre"]) for f in filas if not f["region_id"]}
    alias = {normalizar(f["alias"]): int(f["municipio_id"])
             for f in db.consultar("SELECT alias, municipio_id FROM analitica.municipio_alias")}
    return por_nombre, alias, pseudo


def resolver_municipio(literal, por_nombre, alias, pseudo):
    """Devuelve (municipio_id, fuente_municipio, confianza) sin adivinar."""
    n = normalizar(literal)
    if not n:
        return None, "DESCONOCIDO", "BAJA"
    if n in pseudo:
        return por_nombre[n], "ESTATAL_NO_DESAGREGADO", "BAJA"
    if n in por_nombre:
        return por_nombre[n], "EXPLICITO", "ALTA"
    if n in alias:
        return alias[n], "ALIAS", "ALTA"
    return None, "DESCONOCIDO", "BAJA"


def catalogo_programas(db):
    por_nombre = {normalizar(f["nombre"]): int(f["programa_id"])
                  for f in db.consultar("SELECT programa_id, nombre FROM analitica.programa")}
    alias = {normalizar(f["alias"]): int(f["programa_id"])
             for f in db.consultar("SELECT alias, programa_id FROM analitica.programa_alias")}
    return por_nombre, alias


def resolver_programa(literal, por_nombre, alias):
    n = normalizar(literal)
    if not n:
        return None
    return por_nombre.get(n) or alias.get(n)
