import os
from datetime import date

try:  # opcional: si hay .env, se carga; si no, se usan defaults
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:  # pragma: no cover - dotenv es opcional
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolver_data_dir():
    """A14: primero ./analitica_export; si no existe o está vacío de CSVs,
    ../analitica_export (raíz del monorepo). El elegido se reporta en /api/salud."""
    forzado = os.environ.get("ANALITICA_DATA_DIR")
    if forzado:
        return os.path.abspath(forzado)
    candidatos = [
        os.path.join(BASE_DIR, "analitica_export"),
        os.path.abspath(os.path.join(BASE_DIR, "..", "analitica_export")),
    ]
    for c in candidatos:
        if os.path.isdir(c) and any(f.lower().endswith(".csv") for f in os.listdir(c)):
            return c
    return candidatos[0]


DATA_DIR = _resolver_data_dir()

# Plantilla de datos manuales (territorio, productos, precipitación, demografía)
MANUAL_XLSX = os.environ.get("MANUAL_XLSX_PATH", os.path.join(BASE_DIR, "Datos_referencia_manual_municipios.xlsx"))

# Carpeta donde se guardan las fichas generadas (se crea sola si no existe)
OUTPUT_DIR = os.path.join(BASE_DIR, "fichas_generadas")

# Nombre del contenedor Docker de la base de datos (para el botón "Actualizar datos")
DOCKER_CONTAINER = os.environ.get("SEDEA_DOCKER_CONTAINER", "sedea_db")
DB_USER = os.environ.get("SEDEA_DB_USER", "sedea_admin")
DB_NAME = os.environ.get("SEDEA_DB_NAME", "sedea")

# --- Extensión 2026: acceso directo a Postgres, fecha de corte y rango de años ---
DATABASE_URL = os.environ.get(
    "DATABASE_URL", f"postgresql://{DB_USER}@127.0.0.1:5433/{DB_NAME}"
)
MODO_DATOS = os.environ.get("MODO_DATOS", "auto")  # auto | postgres | csv
FECHA_CORTE = os.environ.get("FECHA_CORTE", "2026-12-31")
ANIO_MIN = int(os.environ.get("ANIO_MIN", "2009"))
ANIO_MAX = int(os.environ.get("ANIO_MAX", "2027"))
PUERTO = int(os.environ.get("PUERTO", "5000"))
VERSION = "2.0.0"


def fecha_corte_date():
    return date.fromisoformat(FECHA_CORTE)
