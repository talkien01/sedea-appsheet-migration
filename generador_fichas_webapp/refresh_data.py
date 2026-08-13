"""
Refresca los CSV en DATA_DIR corriendo COPY ... TO STDOUT contra el contenedor
Docker de la base, sin tener que pasar por /tmp dentro del contenedor.
Requiere que 'docker' esté en el PATH de quien corre esta app (normalmente sí,
porque es la misma máquina donde ya usan `docker exec ... psql`).
"""
import subprocess, os
from config import DATA_DIR, DOCKER_CONTAINER, DB_USER, DB_NAME

QUERIES = {
    "00_region.csv": "SELECT * FROM analitica.region ORDER BY region_id",
    "01_municipio.csv": "SELECT * FROM analitica.municipio ORDER BY region_id, municipio_id",
    "02_municipio_alias.csv": "SELECT * FROM analitica.municipio_alias ORDER BY municipio_id, alias",
    "03_programa.csv": "SELECT * FROM analitica.programa ORDER BY programa_id",
    "04_programa_alias.csv": "SELECT * FROM analitica.programa_alias ORDER BY programa_id, alias",
    "05_apoyo_municipio_full.csv": """
        SELECT am.*, p.nombre AS programa_nombre, p.categoria, m.nombre AS municipio_nombre, r.nombre AS region_nombre
        FROM analitica.apoyo_municipio am
        JOIN analitica.programa p USING (programa_id)
        JOIN analitica.municipio m USING (municipio_id)
        JOIN analitica.region r USING (region_id)
        ORDER BY r.nombre, m.nombre, am.anio, p.nombre
    """,
    "06_apoyo_metrica.csv": "SELECT * FROM analitica.apoyo_metrica ORDER BY apoyo_id, metrica",
    "07_resumen_estatal_full.csv": """
        SELECT re.*, p.nombre AS programa_nombre, p.categoria
        FROM analitica.resumen_estatal re
        JOIN analitica.programa p USING (programa_id)
        ORDER BY re.anio, p.nombre
    """,
    "08_accion_full.csv": """
        SELECT a.*, p.nombre AS programa_nombre, m.nombre AS municipio_nombre
        FROM analitica.accion a
        JOIN analitica.programa p USING (programa_id)
        JOIN analitica.municipio m USING (municipio_id)
        ORDER BY a.anio, m.nombre
    """,
    "09_beneficiarios_demografia.csv": """
        SELECT bd.*, p.nombre AS programa_nombre
        FROM analitica.beneficiarios_demografia bd
        JOIN analitica.programa p USING (programa_id)
        ORDER BY bd.anio, p.nombre
    """,
    "10_v_ficha_municipio.csv": "SELECT * FROM analitica.v_ficha_municipio ORDER BY anio, municipio, programa",
    "11_v_ficha_programa_anio.csv": "SELECT * FROM analitica.v_ficha_programa_anio ORDER BY anio, programa",
    "12_v_inversion_anual.csv": "SELECT * FROM analitica.v_inversion_anual ORDER BY anio",
    "13_v_oficial_componente.csv": "SELECT * FROM analitica.v_oficial_componente ORDER BY anio, componente",
    "14_v_oficial_municipio.csv": "SELECT * FROM analitica.v_oficial_municipio ORDER BY anio, municipio_proyecto, componente",
    "15_v_oficial_region.csv": "SELECT * FROM analitica.v_oficial_region ORDER BY anio, regional, componente",
}

assert len(QUERIES) == 16, f"Se esperaban los 16 CSV de exportar_analitica.sql, hay {len(QUERIES)}"

def refrescar():
    os.makedirs(DATA_DIR, exist_ok=True)
    resultados = {}
    for fname, query in QUERIES.items():
        sql = f"COPY ({query.strip()}) TO STDOUT WITH CSV HEADER"
        cmd = ["docker", "exec", "-i", DOCKER_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-c", sql]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60)
            if proc.returncode != 0:
                resultados[fname] = f"ERROR: {proc.stderr.decode(errors='replace')[:300]}"
                continue
            with open(os.path.join(DATA_DIR, fname), "wb") as f:
                f.write(proc.stdout)
            resultados[fname] = f"OK ({len(proc.stdout.splitlines())} líneas)"
        except FileNotFoundError:
            resultados[fname] = "ERROR: comando 'docker' no encontrado en esta máquina."
        except subprocess.TimeoutExpired:
            resultados[fname] = "ERROR: tiempo de espera agotado."
    return resultados

if __name__ == "__main__":
    for k, v in refrescar().items():
        print(k, "->", v)
