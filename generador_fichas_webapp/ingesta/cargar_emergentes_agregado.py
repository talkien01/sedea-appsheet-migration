"""Carga el AGREGADO por año y programa de los emergentes 2021-2022 que no tienen
padrón folio por folio (seguros catastróficos, emergente pecuario, reactivación del
D.R. 023 y capitalización a usuarios hidroagrícolas).

    python -m ingesta.cargar_emergentes_agregado --dry-run
    python -m ingesta.cargar_emergentes_agregado

Por qué agregado y no folio: se buscó el padrón individual en el Drive de SEDEA
(carpeta «Bases Seguros Catastróficos Benef 2022» y «HISTORICO SEGUROS CATASTROFICOS
DEL 2011-2021 (1).xlsx») y no existe: el histórico es un resumen por esquema y año,
sin CURP ni folio. En vez de inventar un padrón (R1), se carga la cifra agregada y se
marca explícitamente:

  * `apoyo_municipio.granularidad = 'AGREGADO'` y `observaciones` con la advertencia,
    contra el pseudo-municipio ALCANCE ESTATAL (A6: no se reparte entre municipios).
  * `apoyo_municipio.numero_apoyos = NULL`: el origen reporta BENEFICIARIOS DIRECTOS,
    que no son apoyos; rotularlo como apoyos violaría R2. El conteo de beneficiarios
    va a `resumen_estatal.beneficiarios` / `beneficiarios_indir`, que es su columna.
  * una incidencia `FUENTE_FALTANTE` por fila, para que quede visible en /incidencias
    que esa cifra no es auditable folio por folio.
"""
import argparse
import sys

import db
from ingesta import comun
from services import incidencias

MAPEO = "emergentes_agregado.json"

_SQL_APOYO = """
INSERT INTO analitica.apoyo_municipio
  (anio, programa_id, municipio_id, numero_apoyos, apoyo_federal, apoyo_estatal,
   apoyo_municipal, aportacion_productor, total, fuente_archivo, fuente_hoja,
   municipio_usado, fuente_municipio, confianza_municipio, granularidad, observaciones)
VALUES (%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s,%s,'ESTATAL_NO_DESAGREGADO','BAJA','AGREGADO',%s)
ON CONFLICT (anio, programa_id, municipio_id) DO UPDATE SET
  numero_apoyos = NULL,
  apoyo_federal = EXCLUDED.apoyo_federal,
  apoyo_estatal = EXCLUDED.apoyo_estatal,
  apoyo_municipal = EXCLUDED.apoyo_municipal,
  aportacion_productor = EXCLUDED.aportacion_productor,
  total = EXCLUDED.total,
  fuente_archivo = EXCLUDED.fuente_archivo,
  fuente_hoja = EXCLUDED.fuente_hoja,
  municipio_usado = EXCLUDED.municipio_usado,
  granularidad = EXCLUDED.granularidad,
  observaciones = EXCLUDED.observaciones,
  cargado_en = now()
"""

_SQL_RESUMEN = """
INSERT INTO analitica.resumen_estatal
  (anio, programa_id, beneficiarios, beneficiarios_indir, numero_apoyos,
   apoyo_federal, apoyo_estatal, apoyo_municipal, aportacion_productor, total, fuente_archivo)
VALUES (%s,%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s)
ON CONFLICT (anio, programa_id) DO UPDATE SET
  beneficiarios = EXCLUDED.beneficiarios,
  beneficiarios_indir = EXCLUDED.beneficiarios_indir,
  apoyo_federal = EXCLUDED.apoyo_federal,
  apoyo_estatal = EXCLUDED.apoyo_estatal,
  apoyo_municipal = EXCLUDED.apoyo_municipal,
  aportacion_productor = EXCLUDED.aportacion_productor,
  total = EXCLUDED.total,
  fuente_archivo = EXCLUDED.fuente_archivo,
  cargado_en = now()
"""

AVISO = ("AGREGADO SIN PADRÓN FOLIO POR FOLIO: esta cifra proviene de un resumen "
         "estatal, no de un padrón individual. No hay CURP, folio ni desagregación "
         "municipal disponibles para este programa/año en el Drive de SEDEA.")


def cargar(dry_run=False):
    mapeo = comun.cargar_mapeo(MAPEO)
    por_nombre, alias, pseudo = comun.catalogo_municipios(db)
    prog_nombre, prog_alias = comun.catalogo_programas(db)

    muni_id, fuente_muni, _ = comun.resolver_municipio(
        mapeo["municipio_agregado"], por_nombre, alias, pseudo)
    if muni_id is None or fuente_muni != "ESTATAL_NO_DESAGREGADO":
        raise SystemExit(f"ERROR: «{mapeo['municipio_agregado']}» no es un pseudo-municipio "
                         "del catálogo; no se puede cargar el agregado sin inventar territorio.")

    archivo, hoja = mapeo["fuente_archivo"], mapeo["fuente_hoja"]
    print(f"Archivo : {archivo}  (Drive id {mapeo['fuente_drive_id']})")
    print(f"Hoja    : {hoja}")
    print(f"Destino territorial: {mapeo['municipio_agregado']} "
          f"(municipio_id={muni_id}, fuente_municipio={fuente_muni})")
    print(f"Búsqueda de padrón individual: {mapeo['busqueda_padron']}")

    c = comun.Contadores()
    filas_apoyo, filas_resumen, avisos = [], [], []
    for f in mapeo["filas"]:
        c.leidas += 1
        prog_id = comun.resolver_programa(f["programa"], prog_nombre, prog_alias)
        if prog_id is None:
            print(f"OMITIDA: el programa «{f['programa']}» no está en el catálogo.", file=sys.stderr)
            c.omitidas += 1
            continue
        obs = (f"{AVISO} Origen: «{f['renglon_origen']}». "
               f"Beneficiarios directos reportados: {f['beneficiarios_directos']}; "
               f"indirectos: {f['beneficiarios_indirectos']} "
               "(son beneficiarios, NO apoyos: numero_apoyos queda vacío, R2). "
               f"{f['nota']}")
        filas_apoyo.append((f["anio"], prog_id, muni_id, f["apoyo_federal"], f["apoyo_estatal"],
                            f["apoyo_municipal"], f["aportacion_productor"], f["total"],
                            archivo, hoja, mapeo["municipio_agregado"], obs))
        filas_resumen.append((f["anio"], prog_id, f["beneficiarios_directos"],
                              f["beneficiarios_indirectos"], f["apoyo_federal"], f["apoyo_estatal"],
                              f["apoyo_municipal"], f["aportacion_productor"], f["total"], archivo))
        avisos.append((f, prog_id))

        partes = (f["apoyo_federal"] + f["apoyo_estatal"] + f["apoyo_municipal"]
                  + f["aportacion_productor"])
        print(f"  {f['anio']}  {f['programa'][:52]:<52} total=${f['total']:>14,.2f}"
              f"  partes=${partes:>14,.2f}")

    if dry_run:
        c.omitidas += len(filas_apoyo)
        c.imprimir(dry_run)
        return 0

    antes = db.contar("SELECT count(*)::int FROM analitica.apoyo_municipio")
    db.ejecutar_muchos(_SQL_APOYO, filas_apoyo)
    c.insertadas = db.contar("SELECT count(*)::int FROM analitica.apoyo_municipio") - antes
    c.actualizadas = len(filas_apoyo) - c.insertadas
    db.ejecutar_muchos(_SQL_RESUMEN, filas_resumen)

    for f, prog_id in avisos:
        incidencias.registrar(
            "FUENTE_FALTANTE", "ADVERTENCIA", "apoyo_municipio",
            descripcion=(f"{f['anio']} · {f['programa']}: la cifra está cargada solo como "
                         f"agregado estatal (${f['total']:,.2f}). No existe padrón folio por "
                         "folio en el Drive de SEDEA, por lo que no puede desagregarse por "
                         "municipio ni derivarse género/edad por CURP."),
            accion_sugerida=("Solicitar a la Dirección Regional / a la aseguradora el padrón "
                             "individual de indemnizaciones. Mientras no exista, esta cifra se "
                             "reporta como estatal no desagregada y no debe repartirse entre "
                             "municipios."),
            anio=f["anio"], programa_id=prog_id, municipio_id=muni_id,
            valor_origen=f["renglon_origen"], fuente_archivo=archivo, fuente_hoja=hoja)
        c.incidencias += 1

    c.imprimir(dry_run)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Carga el agregado de emergentes 2021-2022 sin padrón individual.")
    ap.add_argument("--dry-run", action="store_true", help="no escribe nada en la base")
    args = ap.parse_args(argv)
    try:
        return cargar(dry_run=args.dry_run)
    except db.SinDatos as e:
        print(f"ERROR: no hay conexión a la base ({e}).", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
