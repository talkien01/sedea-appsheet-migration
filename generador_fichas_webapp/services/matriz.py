"""Consulta de la matriz histórica y de las vistas derivadas.

Modo Postgres: lee las vistas `vw_*`.
Modo CSV (fallback, base apagada): reconstruye lo que puede desde los CSV de
`DATA_DIR`, dejando en None lo que no está (nunca 0).
"""
import db
from services import formato

COLUMNAS_MATRIZ = [
    "anio", "region_id", "region", "municipio_id", "municipio", "municipio_usado",
    "fuente_municipio", "programa_id", "programa", "clasificacion", "origen",
    "numero_apoyos", "beneficiarios_unicos", "federal", "estatal", "municipal",
    "beneficiario", "total", "fuente_archivo", "fuente_hoja",
]
COLUMNAS_DINERO = ("federal", "estatal", "municipal", "beneficiario", "total")


def _where(filtros, alias=""):
    p = f"{alias}." if alias else ""
    cond, params = [], []
    if "anio" in filtros:
        cond.append(f"{p}anio = %s")
        params.append(filtros["anio"])
    if "anio_desde" in filtros:
        cond.append(f"{p}anio >= %s")
        params.append(filtros["anio_desde"])
    if "anio_hasta" in filtros:
        cond.append(f"{p}anio <= %s")
        params.append(filtros["anio_hasta"])
    if "region" in filtros:
        cond.append(f"upper({p}region) = upper(%s)")
        params.append(filtros["region"])
    if "municipio" in filtros:
        cond.append(f"upper({p}municipio) = upper(%s)")
        params.append(filtros["municipio"])
    if "programa" in filtros:
        cond.append(f"upper({p}programa) = upper(%s)")
        params.append(filtros["programa"])
    if "clasificacion" in filtros:
        cond.append(f"{p}clasificacion = %s")
        params.append(filtros["clasificacion"])
    if "origen" in filtros:
        cond.append(f"{p}origen = %s")
        params.append(filtros["origen"])
    return (" WHERE " + " AND ".join(cond) if cond else ""), params


def _normalizar(filas):
    out = []
    for f in filas:
        d = formato.fila_json(f)
        for k in ("anio", "region_id", "municipio_id", "programa_id", "numero_apoyos",
                  "beneficiarios_unicos"):
            if k in d:
                d[k] = formato.numero_json(d[k])
        for k in COLUMNAS_DINERO:
            if k in d:
                d[k] = formato.numero_json(d[k])
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Fallback CSV
# ---------------------------------------------------------------------------
def _matriz_csv(filtros):
    filas = []
    for r in db.leer_csv("05_apoyo_municipio_full.csv"):
        filas.append({
            "anio": formato.numero_json(r.get("anio")),
            "region_id": None,
            "region": r.get("region_nombre"),
            "municipio_id": formato.numero_json(r.get("municipio_id")),
            "municipio": r.get("municipio_nombre"),
            "municipio_usado": r.get("municipio_usado") or r.get("municipio_nombre"),
            "fuente_municipio": r.get("fuente_municipio") or "EXPLICITO",
            "programa_id": formato.numero_json(r.get("programa_id")),
            "programa": r.get("programa_nombre"),
            "clasificacion": r.get("clasificacion") or "NO_CLASIFICADO",
            "origen": "apoyo_municipio",
            "numero_apoyos": formato.numero_json(r.get("numero_apoyos")),
            "beneficiarios_unicos": None,      # sin CURP en CSV: NULL, no igual a apoyos (R2)
            "federal": formato.numero_json(r.get("apoyo_federal")),
            "estatal": formato.numero_json(r.get("apoyo_estatal")),
            "municipal": formato.numero_json(r.get("apoyo_municipal")),
            "beneficiario": formato.numero_json(r.get("aportacion_productor")),
            "total": formato.numero_json(r.get("total")),
            "fuente_archivo": r.get("fuente_archivo"),
            "fuente_hoja": r.get("fuente_hoja"),
        })
    for r in db.leer_csv("14_v_oficial_municipio.csv"):
        filas.append({
            "anio": formato.numero_json(r.get("anio")),
            "region_id": None, "region": None,
            "municipio_id": None,
            "municipio": r.get("municipio_proyecto"),
            "municipio_usado": r.get("municipio_proyecto"),
            "fuente_municipio": "EXPLICITO",
            "programa_id": None,
            "programa": r.get("componente"),
            "clasificacion": "NO_CLASIFICADO",
            "origen": "oficial_2026",
            "numero_apoyos": formato.numero_json(r.get("apoyos")),
            "beneficiarios_unicos": None,
            "federal": None, "municipal": None, "beneficiario": None,
            "estatal": formato.numero_json(r.get("estatal_dictaminado")),
            "total": formato.numero_json(r.get("total_dictaminado")),
            "fuente_archivo": "14_v_oficial_municipio.csv", "fuente_hoja": None,
        })

    def pasa(f):
        if "anio" in filtros and f["anio"] != filtros["anio"]:
            return False
        if "anio_desde" in filtros and (f["anio"] or 0) < filtros["anio_desde"]:
            return False
        if "anio_hasta" in filtros and (f["anio"] or 0) > filtros["anio_hasta"]:
            return False
        for campo in ("region", "municipio", "programa"):
            if campo in filtros and (f.get(campo) or "").upper() != filtros[campo].upper():
                return False
        if "clasificacion" in filtros and f["clasificacion"] != filtros["clasificacion"]:
            return False
        if "origen" in filtros and f["origen"] != filtros["origen"]:
            return False
        return True

    return [f for f in filas if pasa(f)]


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------
def matriz(filtros, con_paginado=True):
    """Devuelve (filas, total). El paginado se aplica solo si viene en filtros."""
    page = filtros.get("page", 1)
    page_size = filtros.get("page_size", 100) if con_paginado else None
    try:
        w, params = _where(filtros)
        total = int(db.escalar(
            f"SELECT count(*)::int FROM analitica.vw_matriz_historica{w}", params, default=0) or 0)
        sql = (f"SELECT {', '.join(COLUMNAS_MATRIZ)} FROM analitica.vw_matriz_historica{w} "
               f"ORDER BY anio, municipio, programa")
        if page_size:
            sql += f" LIMIT {int(page_size)} OFFSET {int((page - 1) * page_size)}"
        return _normalizar(db.consultar(sql, params)), total
    except db.SinDatos:
        filas = _matriz_csv(filtros)
        total = len(filas)
        filas.sort(key=lambda f: (f["anio"] or 0, f["municipio"] or "", f["programa"] or ""))
        if page_size:
            ini = (page - 1) * page_size
            filas = filas[ini:ini + page_size]
        return filas, total


def totales(filtros):
    """Suma de las 5 columnas de dinero + apoyos (R3). None se conserva."""
    try:
        w, params = _where(filtros)
        filas = db.consultar(
            "SELECT sum(numero_apoyos)::bigint AS numero_apoyos, sum(federal) AS federal, "
            "sum(estatal) AS estatal, sum(municipal) AS municipal, "
            "sum(beneficiario) AS beneficiario, sum(total) AS total, "
            "count(DISTINCT municipio_id)::int AS municipios "
            f"FROM analitica.vw_matriz_historica{w}", params)
        return _normalizar(filas)[0] if filas else {}
    except db.SinDatos:
        filas = _matriz_csv(filtros)
        def s(campo):
            vals = [f[campo] for f in filas if f[campo] is not None]
            return sum(vals) if vals else None
        return {"numero_apoyos": s("numero_apoyos"), "federal": s("federal"),
                "estatal": s("estatal"), "municipal": s("municipal"),
                "beneficiario": s("beneficiario"), "total": s("total"),
                "municipios": len({f["municipio"] for f in filas if f["municipio"]}) or None}


def emer_prod(filtros):
    w, params = _where(filtros)
    return _normalizar(db.consultar(
        f"SELECT * FROM analitica.vw_matriz_emer_prod{w} ORDER BY anio, municipio, clasificacion",
        params))


def aportaciones(filtros):
    w, params = _where(filtros)
    return _normalizar(db.consultar(
        f"SELECT * FROM analitica.vw_matriz_aportaciones{w} ORDER BY anio, municipio, programa",
        params))


def serie_inversion_anual(filtros):
    """Serie por año con las 5 columnas de dinero. Los años sin datos NO se
    rellenan con ceros: simplemente no aparecen (R4)."""
    try:
        w, params = _where(filtros)
        return _normalizar(db.consultar(
            "SELECT anio, sum(federal) AS federal, sum(estatal) AS estatal, "
            "sum(municipal) AS municipal, sum(beneficiario) AS beneficiario, "
            "sum(total) AS total, sum(numero_apoyos)::bigint AS numero_apoyos "
            f"FROM analitica.vw_matriz_historica{w} GROUP BY anio ORDER BY anio", params))
    except db.SinDatos:
        acc = {}
        for f in _matriz_csv(filtros):
            a = acc.setdefault(f["anio"], {"anio": f["anio"], "federal": None, "estatal": None,
                                           "municipal": None, "beneficiario": None,
                                           "total": None, "numero_apoyos": None})
            for k in ("federal", "estatal", "municipal", "beneficiario", "total", "numero_apoyos"):
                if f[k] is not None:
                    a[k] = (a[k] or 0) + f[k]
        return [acc[k] for k in sorted(acc)]


def catalogos():
    """Regiones, municipios (los 18 reales), programas, años y clasificaciones."""
    try:
        regiones = [r["nombre"] for r in db.consultar(
            "SELECT nombre FROM analitica.region ORDER BY nombre")]
        municipios = [r["nombre"] for r in db.consultar(
            "SELECT nombre FROM analitica.municipio WHERE region_id IS NOT NULL ORDER BY nombre")]
        programas = [r["nombre"] for r in db.consultar(
            "SELECT DISTINCT programa AS nombre FROM analitica.vw_matriz_historica "
            "WHERE programa IS NOT NULL ORDER BY 1")]
        anios = [int(r["anio"]) for r in db.consultar(
            "SELECT DISTINCT anio FROM analitica.vw_matriz_historica ORDER BY anio")]
    except db.SinDatos:
        regiones = sorted({r["nombre"] for r in db.leer_csv("00_region.csv")})
        municipios = sorted({r["nombre"] for r in db.leer_csv("01_municipio.csv") if r.get("region_id")})
        programas = sorted({r["programa_nombre"] for r in db.leer_csv("05_apoyo_municipio_full.csv")
                            if r.get("programa_nombre")})
        anios = sorted({int(r["anio"]) for r in db.leer_csv("05_apoyo_municipio_full.csv")
                        if r.get("anio")})
    return {"regiones": regiones, "municipios": municipios, "programas": programas,
            "anios": anios, "clasificaciones": list(formato.CLASIFICACIONES)}


def municipios_de_region(region):
    try:
        return [r["nombre"] for r in db.consultar(
            "SELECT m.nombre FROM analitica.municipio m JOIN analitica.region r USING (region_id) "
            "WHERE upper(r.nombre) = upper(%s) ORDER BY m.nombre", (region,))]
    except db.SinDatos:
        regiones = {r["region_id"]: r["nombre"] for r in db.leer_csv("00_region.csv")}
        return sorted(m["nombre"] for m in db.leer_csv("01_municipio.csv")
                      if regiones.get(m.get("region_id"), "").upper() == region.upper())
