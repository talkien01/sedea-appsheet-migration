"""Clasificación Emergentes / Productividad por reglas versionadas.

    python -m services.clasificacion --aplicar     # clasifica programas + backfill trazabilidad
    python -m services.clasificacion --listar      # muestra las reglas vigentes
    python -m services.clasificacion --dry-run     # no escribe nada

La clasificación NO se edita a mano fila por fila: se cambian las reglas de
analitica.programa_clasificacion_regla y se vuelve a correr. El catch-all deja
incidencia PROGRAMA_CLASIFICADO_POR_DEFECTO para revisión humana.
"""
import argparse
import sys

import db
from services import incidencias

PSEUDO_MUNICIPIOS = ("TODO EL ESTADO", "ALCANCE ESTATAL", "JALPAN REGIÓN",
                     "SAN JUAN DEL RÍO (REGIÓN)", "QUERÉTARO (REGIÓN)", "CADEREYTA REGIÓN")


def reglas():
    return db.consultar(
        "SELECT regla_id, orden, patron, clasificacion, criterio, fuente "
        "FROM analitica.programa_clasificacion_regla ORDER BY orden")


def clasificar_programas(dry_run=False):
    """Aplica las reglas en orden ascendente: la primera que casa gana.
    Todo el trabajo se hace en SQL (una sentencia por regla), de modo que
    reclasificar 674 programas cuesta 7 consultas y no 4,000."""
    rs = reglas()
    if not rs:
        raise SystemExit("No hay reglas cargadas. Corre: python -m db.migrate --seed")

    if dry_run:
        resumen = {"EMERGENTE": 0, "PRODUCTIVIDAD": 0, "por_defecto": 0}
        ya = "false"
        for r in rs:
            n = int(db.escalar(
                f"SELECT count(*)::int FROM analitica.programa WHERE NOT ({ya}) AND nombre ~* %s",
                (r["patron"],), default=0) or 0)
            resumen[r["clasificacion"]] += n
            if r["patron"] == ".*":
                resumen["por_defecto"] += n
            ya = f"({ya}) OR nombre ~* " + db._sql_literal(r["patron"])
        return resumen

    # Reset auditable: se vuelve a decidir todo desde las reglas vigentes.
    db.ejecutar("UPDATE analitica.programa SET clasificacion='NO_CLASIFICADO', "
                "clasificacion_criterio=NULL, clasificacion_fuente=NULL, clasificado_en=NULL")
    resumen = {"EMERGENTE": 0, "PRODUCTIVIDAD": 0, "por_defecto": 0}
    for r in rs:
        criterio = f"Regla {r['orden']} ({r['patron']}): {r['criterio']}"
        db.ejecutar(
            "UPDATE analitica.programa SET clasificacion=%s, clasificacion_criterio=%s, "
            "clasificacion_fuente=%s, clasificado_en=now() "
            "WHERE clasificado_en IS NULL AND nombre ~* %s",
            (r["clasificacion"], criterio, r["fuente"], r["patron"]))
        n = int(db.escalar(
            "SELECT count(*)::int FROM analitica.programa WHERE clasificacion_criterio = %s",
            (criterio,), default=0) or 0)
        resumen[r["clasificacion"]] += n
        if r["patron"] == ".*":
            resumen["por_defecto"] += n
            # El catch-all nunca es silencioso: una incidencia por programa.
            db.ejecutar("""
                INSERT INTO analitica.incidencia_carga
                  (tipo, severidad, entidad, entidad_id, programa_id, descripcion,
                   valor_origen, accion_sugerida)
                SELECT 'PROGRAMA_CLASIFICADO_POR_DEFECTO', 'ADVERTENCIA', 'programa',
                       p.programa_id, p.programa_id,
                       'El programa «' || p.nombre || '» solo casó con la regla catch-all (900) '
                       || 'y quedó como PRODUCTIVIDAD por defecto.',
                       p.nombre,
                       'Revisar con el área si corresponde a Emergentes; si sí, agregar una regla '
                       || 'específica en programa_clasificacion_regla y volver a correr.'
                FROM analitica.programa p
                WHERE p.clasificacion_criterio = %s
                ON CONFLICT (tipo, entidad, coalesce(entidad_id,-1), coalesce(anio,-1),
                             coalesce(municipio_id,-1), coalesce(programa_id,-1),
                             coalesce(fila_origen,-1))
                DO UPDATE SET detectada_en = now()
            """, (criterio,))
    return resumen


def _pseudo_lista_sql():
    return ", ".join("'" + m.replace("'", "''") + "'" for m in PSEUDO_MUNICIPIOS)


def backfill_trazabilidad(dry_run=False):
    """R5: municipio_usado / fuente_municipio / confianza_municipio en
    apoyo_municipio y accion. Determinista y re-ejecutable."""
    hechos = {}
    pseudo = _pseudo_lista_sql()
    for tabla in ("apoyo_municipio", "accion"):
        if dry_run:
            hechos[tabla] = int(db.escalar(
                f"SELECT count(*)::int FROM analitica.{tabla} WHERE municipio_usado IS NULL", default=0) or 0)
            continue
        # 1) pseudo-municipios (A6): no se reparten, se marcan y se excluyen de totales municipales
        db.ejecutar(f"""
            UPDATE analitica.{tabla} t SET
              municipio_usado = m.nombre,
              fuente_municipio = 'ESTATAL_NO_DESAGREGADO',
              confianza_municipio = 'BAJA'
            FROM analitica.municipio m
            WHERE m.municipio_id = t.municipio_id
              AND m.nombre IN ({pseudo})
        """)
        # 2) nombre exacto del catálogo
        db.ejecutar(f"""
            UPDATE analitica.{tabla} t SET
              municipio_usado = m.nombre,
              fuente_municipio = 'EXPLICITO',
              confianza_municipio = 'ALTA'
            FROM analitica.municipio m
            WHERE m.municipio_id = t.municipio_id
              AND m.region_id IS NOT NULL
              AND t.fuente_municipio IS DISTINCT FROM 'ESTATAL_NO_DESAGREGADO'
        """)
        # 3) sin municipio resuelto
        db.ejecutar(f"""
            UPDATE analitica.{tabla} t SET
              municipio_usado = coalesce(t.municipio_usado, '(sin municipio en el origen)'),
              fuente_municipio = 'DESCONOCIDO',
              confianza_municipio = 'BAJA'
            WHERE t.municipio_id IS NULL
        """)
        pendientes = int(db.escalar(
            f"SELECT count(*)::int FROM analitica.{tabla} WHERE fuente_municipio = 'DESCONOCIDO'",
            default=0) or 0)
        if pendientes:
            incidencias.registrar(
                "MUNICIPIO_NO_RESUELTO", "ADVERTENCIA", tabla,
                descripcion=f"{pendientes} fila(s) de analitica.{tabla} sin municipio resuelto.",
                accion_sugerida=("Agregar el alias faltante en analitica.municipio_alias y volver a "
                                 "correr el backfill; no se asigna municipio por aproximación."),
                valor_origen=str(pendientes))
        hechos[tabla] = int(db.escalar(
            f"SELECT count(*)::int FROM analitica.{tabla} WHERE municipio_usado IS NOT NULL",
            default=0) or 0)
    return hechos


def main(argv=None):
    ap = argparse.ArgumentParser(description="Clasifica programas y hace el backfill de trazabilidad.")
    ap.add_argument("--aplicar", action="store_true", help="escribe los cambios")
    ap.add_argument("--dry-run", action="store_true", help="solo reporta, no escribe")
    ap.add_argument("--listar", action="store_true", help="muestra las reglas vigentes")
    args = ap.parse_args(argv)

    try:
        if args.listar:
            for r in reglas():
                print(f"  {r['orden']:>3}  {r['clasificacion']:<14} {r['patron']}")
            return 0
        if not (args.aplicar or args.dry_run):
            ap.print_help()
            return 0
        dry = args.dry_run and not args.aplicar
        resumen = clasificar_programas(dry_run=dry)
        print(f"Programas EMERGENTE: {resumen['EMERGENTE']}  "
              f"PRODUCTIVIDAD: {resumen['PRODUCTIVIDAD']}  "
              f"(por catch-all: {resumen['por_defecto']}, con incidencia)")
        hechos = backfill_trazabilidad(dry_run=dry)
        for tabla, n in hechos.items():
            print(f"Trazabilidad {tabla}: {n} filas con municipio_usado")
        if not dry:
            faltantes = incidencias.detectar_anios_sin_datos()
            print(f"Años sin datos detectados: {faltantes or 'ninguno'}")
            desc = incidencias.detectar_descuadres_aportaciones()
            print(f"Descuadres de aportaciones registrados: {desc}")
    except db.SinDatos as e:
        print(f"ERROR: no hay conexión a la base ({e}).", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
