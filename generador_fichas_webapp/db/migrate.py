"""Aplicador de migraciones y semillas.

    python -m db.migrate --up      # aplica db/migrations/*.sql (idempotente)
    python -m db.migrate --seed    # aplica db/seeds/*.sql (idempotente)
    python -m db.migrate --estado  # qué hay aplicado

Todas las migraciones son aditivas: nunca hacen DROP de tablas, columnas ni
vistas preexistentes.
"""
import argparse
import glob
import hashlib
import os
import sys

import db

AQUI = os.path.dirname(os.path.abspath(__file__))
MIGRACIONES = os.path.join(AQUI, "migrations")
SEEDS = os.path.join(AQUI, "seeds")

TABLA_CONTROL = """
CREATE SCHEMA IF NOT EXISTS analitica;
CREATE TABLE IF NOT EXISTS analitica.migracion_aplicada (
  archivo     text PRIMARY KEY,
  sha256      char(64) NOT NULL,
  aplicada_en timestamptz NOT NULL DEFAULT now()
);
"""


def _archivos(carpeta):
    return sorted(glob.glob(os.path.join(carpeta, "*.sql")))


def _sha(texto):
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def aplicar(carpeta, etiqueta):
    db.ejecutar_script(TABLA_CONTROL)
    aplicadas = {r["archivo"]: r["sha256"] for r in
                 db.consultar("SELECT archivo, sha256 FROM analitica.migracion_aplicada")}
    total = 0
    for path in _archivos(carpeta):
        nombre = f"{etiqueta}/{os.path.basename(path)}"
        with open(path, encoding="utf-8") as f:
            sql = f.read()
        h = _sha(sql)
        if aplicadas.get(nombre) == h:
            print(f"  = {nombre} (sin cambios)")
            continue
        print(f"  + {nombre} …", end=" ")
        db.ejecutar_script(sql)
        db.ejecutar(
            "INSERT INTO analitica.migracion_aplicada (archivo, sha256) VALUES (%s,%s) "
            "ON CONFLICT (archivo) DO UPDATE SET sha256 = EXCLUDED.sha256, aplicada_en = now()",
            (nombre, h),
        )
        total += 1
        print("ok")
    return total


def estado():
    try:
        filas = db.consultar(
            "SELECT archivo, aplicada_en FROM analitica.migracion_aplicada ORDER BY archivo")
    except db.SinDatos as e:
        print("Sin base de datos:", e)
        return 1
    for f in filas:
        print(f"  {f['archivo']}  {f['aplicada_en']}")
    print(f"({len(filas)} aplicadas)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Migraciones del esquema analitica (aditivas).")
    ap.add_argument("--up", action="store_true", help="aplica db/migrations/*.sql")
    ap.add_argument("--seed", action="store_true", help="aplica db/seeds/*.sql")
    ap.add_argument("--estado", action="store_true", help="lista lo aplicado")
    args = ap.parse_args(argv)

    if not (args.up or args.seed or args.estado):
        ap.print_help()
        return 0

    try:
        if args.up:
            print("Aplicando migraciones:")
            n = aplicar(MIGRACIONES, "migrations")
            print(f"Migraciones nuevas aplicadas: {n}")
        if args.seed:
            print("Aplicando semillas:")
            n = aplicar(SEEDS, "seeds")
            print(f"Semillas nuevas aplicadas: {n}")
        if args.estado:
            return estado()
    except db.SinDatos as e:
        print(f"ERROR: no hay conexión a la base ({e}).", file=sys.stderr)
        print("Arranca el contenedor con: docker start sedea_db", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
