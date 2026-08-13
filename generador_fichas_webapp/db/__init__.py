"""Capa de acceso a datos.

Tres transportes, en orden de preferencia, resueltos en caliente:

1. ``psycopg``   — conexión TCP directa usando ``DATABASE_URL``.
2. ``docker``    — ``docker exec <contenedor> psql`` contra el contenedor
   existente (no necesita password ni puerto publicado).
3. ``csv``       — fallback de solo lectura sobre los CSV de ``DATA_DIR``.

La app **nunca** revienta si la base está apagada: cae a CSV y ``/api/salud``
reporta ``db:false``, ``modo:"csv"``.

Este paquete reemplaza al ``db.py`` que planteaba el SPEC: en Python un paquete
``db/`` y un módulo ``db.py`` no pueden convivir, y ``python -m db.migrate``
exige el paquete. ``import db`` sigue dando exactamente la misma API.
"""
import csv as _csv
import io
import json
import os
import subprocess
import threading
import time

import config

_lock = threading.Lock()
_estado = {"transporte": None, "chequeado_en": 0.0, "error": None}
_TTL = 10.0  # segundos que se cachea el diagnóstico de transporte


class SinDatos(Exception):
    """No hay ningún transporte disponible para responder la consulta."""


# --------------------------------------------------------------------------
# Detección de transporte
# --------------------------------------------------------------------------
def _probar_psycopg():
    try:
        import psycopg
    except ImportError:
        return False
    try:
        with psycopg.connect(config.DATABASE_URL, connect_timeout=3) as cx:
            with cx.cursor() as cur:
                cur.execute("select 1")
                cur.fetchone()
        return True
    except Exception:
        return False


def _probar_docker():
    try:
        proc = subprocess.run(
            ["docker", "exec", "-i", config.DOCKER_CONTAINER, "psql", "-U", config.DB_USER,
             "-d", config.DB_NAME, "-At", "-c", "select 1"],
            capture_output=True, timeout=20,
        )
        return proc.returncode == 0 and proc.stdout.strip().startswith(b"1")
    except Exception:
        return False


def transporte(forzar=False):
    """Devuelve 'psycopg' | 'docker' | 'csv'."""
    modo = (config.MODO_DATOS or "auto").lower()
    if modo == "csv":
        return "csv"
    ahora = time.time()
    with _lock:
        if not forzar and _estado["transporte"] and ahora - _estado["chequeado_en"] < _TTL:
            return _estado["transporte"]
        elegido = "csv"
        if _probar_psycopg():
            elegido = "psycopg"
        elif _probar_docker():
            elegido = "docker"
        if modo == "postgres" and elegido == "csv":
            elegido = "csv"  # ni con modo forzado se inventa una conexión
        _estado.update({"transporte": elegido, "chequeado_en": ahora})
        return elegido


def hay_db():
    return transporte() in ("psycopg", "docker")


def modo_datos():
    return "postgres" if hay_db() else "csv"


# --------------------------------------------------------------------------
# Consultas
# --------------------------------------------------------------------------
def _q_psycopg(sql, params):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(config.DATABASE_URL, connect_timeout=5) as cx:
        with cx.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params or None)
            if cur.description is None:
                return []
            return [dict(r) for r in cur.fetchall()]


def _sql_literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def _q_docker(sql, params):
    """psql no acepta parámetros por protocolo desde la CLI: se interpolan con
    escape SQL estricto. Solo se usa con parámetros generados por la app."""
    if params:
        sql = sql.replace("%s", "{}").format(*[_sql_literal(p) for p in params])
    envoltura = (
        "COPY (" + sql.strip().rstrip(";") + ") TO STDOUT WITH (FORMAT csv, HEADER true)"
    )
    proc = subprocess.run(
        ["docker", "exec", "-i", config.DOCKER_CONTAINER, "psql", "-U", config.DB_USER,
         "-d", config.DB_NAME, "-v", "ON_ERROR_STOP=1", "-c", envoltura],
        capture_output=True, timeout=120,
    )
    if proc.returncode != 0:
        raise SinDatos(proc.stderr.decode("utf-8", "replace")[:400])
    texto = proc.stdout.decode("utf-8", "replace")
    filas = list(_csv.DictReader(io.StringIO(texto)))
    return [{k: (None if v == "" else v) for k, v in f.items()} for f in filas]


def consultar(sql, params=None):
    """Ejecuta un SELECT y devuelve lista de dicts. Lanza SinDatos si no hay DB."""
    t = transporte()
    if t == "psycopg":
        try:
            return _q_psycopg(sql, params)
        except Exception as e:  # la conexión se cayó a medio vuelo
            transporte(forzar=True)
            if transporte() == "docker":
                return _q_docker(sql, params)
            raise SinDatos(str(e)[:400])
    if t == "docker":
        return _q_docker(sql, params)
    raise SinDatos("Base de datos no disponible; la app está en modo CSV.")


def ejecutar(sql, params=None):
    """Ejecuta una sentencia que no devuelve filas (DDL/DML)."""
    t = transporte()
    if t == "psycopg":
        import psycopg
        with psycopg.connect(config.DATABASE_URL, connect_timeout=10) as cx:
            with cx.cursor() as cur:
                cur.execute(sql, params or None)
            cx.commit()
        return True
    if t == "docker":
        if params:
            sql = sql.replace("%s", "{}").format(*[_sql_literal(p) for p in params])
        proc = subprocess.run(
            ["docker", "exec", "-i", config.DOCKER_CONTAINER, "psql", "-U", config.DB_USER,
             "-d", config.DB_NAME, "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, timeout=300,
        )
        if proc.returncode != 0:
            raise SinDatos(proc.stderr.decode("utf-8", "replace")[:600])
        return True
    raise SinDatos("Base de datos no disponible: no se puede escribir.")


def ejecutar_muchos(sql, filas, tam_lote=200):
    """Ejecuta la misma sentencia parametrizada para muchas filas, en lotes y en
    una sola conexión. Devuelve el número de filas enviadas."""
    filas = list(filas)
    if not filas:
        return 0
    t = transporte()
    if t == "psycopg":
        import psycopg
        with psycopg.connect(config.DATABASE_URL, connect_timeout=10) as cx:
            with cx.cursor() as cur:
                cur.executemany(sql, filas)
            cx.commit()
        return len(filas)
    if t == "docker":
        for i in range(0, len(filas), tam_lote):
            lote = filas[i:i + tam_lote]
            script = "\n".join(
                sql.replace("%s", "{}").format(*[_sql_literal(v) for v in f]).rstrip().rstrip(";") + ";"
                for f in lote)
            ejecutar_script(script)
        return len(filas)
    raise SinDatos("Base de datos no disponible: no se puede escribir.")


def ejecutar_script(sql):
    """Ejecuta un script completo (varias sentencias) de forma transaccional."""
    t = transporte()
    if t == "psycopg":
        import psycopg
        with psycopg.connect(config.DATABASE_URL, connect_timeout=10) as cx:
            with cx.cursor() as cur:
                cur.execute(sql)
            cx.commit()
        return True
    if t == "docker":
        proc = subprocess.run(
            ["docker", "exec", "-i", config.DOCKER_CONTAINER, "psql", "-U", config.DB_USER,
             "-d", config.DB_NAME, "-v", "ON_ERROR_STOP=1", "-1", "-f", "-"],
            input=sql.encode("utf-8"), capture_output=True, timeout=600,
        )
        if proc.returncode != 0:
            raise SinDatos(proc.stderr.decode("utf-8", "replace")[:1500])
        return True
    raise SinDatos("Base de datos no disponible: no se pueden aplicar migraciones.")


def escalar(sql, params=None, default=None):
    filas = consultar(sql, params)
    if not filas:
        return default
    return list(filas[0].values())[0]


# --------------------------------------------------------------------------
# Fallback CSV
# --------------------------------------------------------------------------
def leer_csv(nombre):
    path = os.path.join(config.DATA_DIR, nombre)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return list(_csv.DictReader(f))


def vistas_disponibles():
    """Lista de vistas del esquema analitica (vacía si no hay DB)."""
    try:
        filas = consultar(
            "select table_name from information_schema.views "
            "where table_schema='analitica' order by table_name"
        )
        return [f["table_name"] for f in filas]
    except SinDatos:
        return []


def diagnostico():
    t = transporte(forzar=True)
    return {
        "transporte": t,
        "modo": "postgres" if t in ("psycopg", "docker") else "csv",
        "db": t in ("psycopg", "docker"),
        "data_dir": config.DATA_DIR,
    }


def json_seguro(obj):
    return json.dumps(obj, ensure_ascii=False, default=str)
