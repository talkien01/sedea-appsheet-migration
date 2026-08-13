"""Registro y consulta de incidencias de carga (R8).

Todo lo que no cuadra queda escrito en analitica.incidencia_carga con su acción
sugerida. Nada se silencia y nada se corrige "por dentro".
"""
import db

TIPOS = (
    "MUNICIPIO_NO_RESUELTO", "CURP_INVALIDA", "CURP_DUPLICADA",
    "PROGRAMA_NO_CLASIFICADO", "PROGRAMA_CLASIFICADO_POR_DEFECTO",
    "SUMA_APORTACIONES_NO_CUADRA", "MONTO_NEGATIVO", "ANIO_SIN_DATOS",
    "FOLIO_DUPLICADO", "FUENTE_FALTANTE", "DATO_MANUAL_FALTANTE",
)
SEVERIDADES = ("BLOQUEANTE", "ADVERTENCIA", "INFO")

_SQL = """
INSERT INTO analitica.incidencia_carga
  (tipo, severidad, entidad, entidad_id, anio, municipio_id, programa_id,
   descripcion, valor_origen, accion_sugerida, fuente_archivo, fuente_hoja, fila_origen)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (tipo, entidad, coalesce(entidad_id,-1), coalesce(anio,-1),
             coalesce(municipio_id,-1), coalesce(programa_id,-1), coalesce(fila_origen,-1))
DO UPDATE SET descripcion = EXCLUDED.descripcion,
              accion_sugerida = EXCLUDED.accion_sugerida,
              valor_origen = EXCLUDED.valor_origen,
              detectada_en = now()
"""


def registrar(tipo, severidad, entidad, descripcion, accion_sugerida,
              entidad_id=None, anio=None, municipio_id=None, programa_id=None,
              valor_origen=None, fuente_archivo=None, fuente_hoja=None, fila_origen=None):
    if tipo not in TIPOS:
        raise ValueError(f"tipo de incidencia desconocido: {tipo}")
    if severidad not in SEVERIDADES:
        raise ValueError(f"severidad desconocida: {severidad}")
    if not descripcion or not accion_sugerida:
        raise ValueError("toda incidencia necesita descripcion y accion_sugerida (R8)")
    db.ejecutar(_SQL, (tipo, severidad, entidad, entidad_id, anio, municipio_id,
                       programa_id, descripcion, valor_origen, accion_sugerida,
                       fuente_archivo, fuente_hoja, fila_origen))


def listar(tipo=None, severidad=None, resuelta=None, municipio=None, anio=None, limite=1000):
    where, params = [], []
    if tipo:
        where.append("tipo = %s")
        params.append(tipo)
    if severidad:
        where.append("severidad = %s")
        params.append(severidad)
    if resuelta is not None:
        where.append("resuelta = %s")
        params.append(bool(resuelta))
    if municipio:
        where.append("municipio = %s")
        params.append(municipio)
    if anio:
        where.append("anio = %s")
        params.append(int(anio))
    sql = "SELECT * FROM analitica.vw_incidencias"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY CASE severidad WHEN 'BLOQUEANTE' THEN 0 WHEN 'ADVERTENCIA' THEN 1 ELSE 2 END, incidencia_id"
    sql += f" LIMIT {int(limite)}"
    return db.consultar(sql, params)


def conteo_por_severidad():
    return db.consultar(
        "SELECT severidad, count(*)::int AS n FROM analitica.incidencia_carga "
        "WHERE NOT resuelta GROUP BY severidad ORDER BY 1")


def conteo_por_tipo():
    return db.consultar(
        "SELECT tipo, severidad, count(*)::int AS n FROM analitica.incidencia_carga "
        "WHERE NOT resuelta GROUP BY tipo, severidad ORDER BY n DESC")


def total_abiertas():
    try:
        return db.contar(
            "SELECT count(*)::int FROM analitica.incidencia_carga WHERE NOT resuelta")
    except db.SinDatos:
        return None


def detectar_descuadres_aportaciones():
    """A8/R8: cada fila de vw_matriz_aportaciones con cuadra=false genera su
    incidencia SUMA_APORTACIONES_NO_CUADRA."""
    # La detección es derivada: se recalcula completa en cada corrida.
    db.ejecutar("DELETE FROM analitica.incidencia_carga "
                "WHERE tipo = 'SUMA_APORTACIONES_NO_CUADRA'")
    db.ejecutar("""
        INSERT INTO analitica.incidencia_carga
          (tipo, severidad, entidad, anio, municipio_id, programa_id,
           descripcion, valor_origen, accion_sugerida)
        SELECT 'SUMA_APORTACIONES_NO_CUADRA', 'ADVERTENCIA', 'vw_matriz_aportaciones',
               a.anio, a.municipio_id, a.programa_id,
               coalesce(a.municipio,'(sin municipio)') || ' ' || a.anio || ' — ' ||
               coalesce(a.programa,'(sin programa)') ||
               ': la suma de aportaciones (' || a.suma_partes || ') no coincide con el total ('
               || a.total || '); tolerancia $1.00.',
               'total=' || a.total || '; suma_partes=' || a.suma_partes,
               'Revisar el desglose federal/estatal/municipal/beneficiario en la fuente original '
               || 'y corregir la carga; no se ajusta automáticamente.'
        FROM analitica.vw_matriz_aportaciones a
        WHERE a.cuadra = false
        ON CONFLICT (tipo, entidad, coalesce(entidad_id,-1), coalesce(anio,-1),
                     coalesce(municipio_id,-1), coalesce(programa_id,-1), coalesce(fila_origen,-1))
        DO UPDATE SET descripcion = EXCLUDED.descripcion, detectada_en = now()
    """)
    return db.contar("SELECT count(*)::int FROM analitica.incidencia_carga "
                          "WHERE tipo = 'SUMA_APORTACIONES_NO_CUADRA'")


def detectar_anios_sin_datos(anio_min=2009, anio_max=2027):
    """Documenta los huecos reales (p. ej. 2021/2022 en apoyo_municipio)."""
    presentes = {int(r["anio"]) for r in db.consultar(
        "SELECT DISTINCT anio FROM analitica.vw_matriz_historica WHERE anio IS NOT NULL")}
    faltantes = []
    for anio in range(anio_min, anio_max + 1):
        if anio in presentes:
            continue
        if anio == 2027:
            continue  # 2027 va vacío por definición (R4), no es incidencia
        faltantes.append(anio)
        registrar(
            "ANIO_SIN_DATOS", "ADVERTENCIA", "vw_matriz_historica",
            descripcion=(f"No hay ninguna fila municipal para el ejercicio {anio} en ninguno de "
                         f"los tres orígenes (accion, apoyo_municipio, v_oficial_*)."),
            accion_sugerida=(f"Pedir al área de datos la carga de {anio} por municipio. "
                             f"Mientras tanto ese año se rinde vacío, nunca como cero."),
            anio=anio,
        )
    return faltantes
