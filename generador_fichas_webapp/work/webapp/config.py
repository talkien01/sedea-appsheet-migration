import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Carpeta donde viven los CSV exportados de Postgres (analitica_export).
# Por default asume que está junto a esta app; cámbialo si vive en otro lado.
DATA_DIR = os.environ.get("ANALITICA_DATA_DIR", os.path.join(BASE_DIR, "analitica_export"))

# Plantilla de datos manuales (territorio, productos, precipitación, demografía)
MANUAL_XLSX = os.environ.get("MANUAL_XLSX_PATH", os.path.join(BASE_DIR, "Datos_referencia_manual_municipios.xlsx"))

# Carpeta donde se guardan las fichas generadas (se crea sola si no existe)
OUTPUT_DIR = os.path.join(BASE_DIR, "fichas_generadas")

# Nombre del contenedor Docker de la base de datos (para el botón "Actualizar datos")
DOCKER_CONTAINER = os.environ.get("SEDEA_DOCKER_CONTAINER", "sedea_db")
DB_USER = os.environ.get("SEDEA_DB_USER", "sedea_admin")
DB_NAME = os.environ.get("SEDEA_DB_NAME", "sedea")
