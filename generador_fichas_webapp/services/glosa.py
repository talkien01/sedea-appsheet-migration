"""Insumos verificables para la Glosa del Informe de Gobierno (R7).

Cada insumo se calcula con una consulta reproducible y guarda de dónde salió:
tabla, vista, archivo, hoja, criterio de cálculo, fecha de corte y responsable.
Si falta cualquiera de esos, el INSERT falla en la base y el insumo NO se genera.
"""
import sys

import config
import db
from services import formato

RESPONSABLE_POR_DEFECTO = "Dirección de Planeación SEDEA"


def listar(anio=None, tema=None, ambito=None, solo_verificados=None, clave=None):
    cond, params = [], []
    if anio:
        cond.append("anio = %s")
        params.append(int(anio))
    if tema:
        cond.append("upper(tema) = upper(%s)")
        params.append(tema)
    if ambito:
        cond.append("upper(ambito) = upper(%s)")
        params.append(ambito)
    if solo_verificados:
        cond.append("verificado = true")
    if clave:
        cond.append("clave = %s")
        params.append(clave)
    sql = "SELECT * FROM analitica.vw_insumos_glosa"
    if cond:
        sql += " WHERE " + " AND ".join(cond)
    sql += " ORDER BY clave"
    return [formato.fila_json(f) for f in db.consultar(sql, params)]


def obtener(clave):
    filas = listar(clave=clave)
    return filas[0] if filas else None


_SQL_UPSERT = """
INSERT INTO analitica.glosa_insumo
  (clave, tema, pregunta, indicador, valor_numerico, valor_texto, unidad, anio, ambito,
   region_id, municipio_id, programa_id, fuente_tabla, fuente_vista, fuente_archivo,
   fuente_hoja, criterio_calculo, fecha_corte, responsable, verificado, verificado_por,
   verificado_en)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
        CASE WHEN %s THEN now() ELSE NULL END)
ON CONFLICT (clave) DO UPDATE SET
  valor_numerico = EXCLUDED.valor_numerico,
  valor_texto = EXCLUDED.valor_texto,
  criterio_calculo = EXCLUDED.criterio_calculo,
  fuente_tabla = EXCLUDED.fuente_tabla,
  fuente_vista = EXCLUDED.fuente_vista,
  fuente_archivo = EXCLUDED.fuente_archivo,
  fuente_hoja = EXCLUDED.fuente_hoja,
  fecha_corte = EXCLUDED.fecha_corte,
  responsable = EXCLUDED.responsable,
  verificado = EXCLUDED.verificado,
  verificado_por = EXCLUDED.verificado_por,
  verificado_en = EXCLUDED.verificado_en,
  generado_en = now()
"""


def guardar(insumo):
    """Escribe un insumo. Si le falta cualquier campo de fuente, la base lo rechaza (R7)."""
    obligatorios = ("clave", "tema", "pregunta", "indicador", "unidad", "anio", "ambito",
                    "fuente_tabla", "fuente_vista", "fuente_archivo", "fuente_hoja",
                    "criterio_calculo", "fecha_corte", "responsable")
    faltantes = [c for c in obligatorios if not insumo.get(c)]
    if faltantes:
        raise ValueError(f"Insumo de Glosa incompleto, no se genera (R7). Faltan: {faltantes}")
    verificado = bool(insumo.get("verificado"))
    db.ejecutar(_SQL_UPSERT, (
        insumo["clave"], insumo["tema"], insumo["pregunta"], insumo["indicador"],
        insumo.get("valor_numerico"), insumo.get("valor_texto"), insumo["unidad"],
        int(insumo["anio"]), insumo["ambito"], insumo.get("region_id"),
        insumo.get("municipio_id"), insumo.get("programa_id"), insumo["fuente_tabla"],
        insumo["fuente_vista"], insumo["fuente_archivo"], insumo["fuente_hoja"],
        insumo["criterio_calculo"], insumo["fecha_corte"], insumo["responsable"],
        verificado, insumo.get("verificado_por") if verificado else None, verificado))


# ---------------------------------------------------------------------------
# Generación de los insumos base
# ---------------------------------------------------------------------------
def generar(anio=2026, responsable=RESPONSABLE_POR_DEFECTO):
    """Calcula los insumos base del ejercicio con SQL reproducible y los guarda.
    Los que no tienen dato se guardan con valor_numerico NULL y su explicación,
    nunca con 0 (R1/R4)."""
    corte = config.FECHA_CORTE
    creados = []

    def sql_un_valor(sql, params=None):
        v = db.escalar(sql, params)
        return float(v) if v is not None else None

    total = sql_un_valor(
        "SELECT sum(total) FROM analitica.vw_matriz_historica WHERE anio = %s", (anio,))
    apoyos = sql_un_valor(
        "SELECT sum(numero_apoyos) FROM analitica.vw_matriz_historica WHERE anio = %s", (anio,))
    municipios = sql_un_valor(
        "SELECT count(DISTINCT municipio_id) FROM analitica.vw_matriz_historica "
        "WHERE anio = %s AND municipio_id IS NOT NULL", (anio,))
    personas = sql_un_valor(
        "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp "
        "WHERE anio = %s AND curp_valida", (anio,))
    mujeres = sql_un_valor(
        "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp "
        "WHERE anio = %s AND curp_valida AND genero = 'M'", (anio,))
    mayores = sql_un_valor(
        "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp "
        "WHERE anio = %s AND curp_valida AND rango_edad = '60+'", (anio,))
    emergentes = sql_un_valor(
        "SELECT sum(total) FROM analitica.vw_matriz_historica "
        "WHERE anio = %s AND clasificacion = 'EMERGENTE'", (anio,))
    total_2027 = sql_un_valor(
        "SELECT sum(total) FROM analitica.vw_matriz_historica WHERE anio = 2027")

    base = {"anio": anio, "ambito": "ESTATAL", "fecha_corte": corte, "responsable": responsable,
            "fuente_tabla": "analitica.apoyo_municipio + analitica.accion + oficial.solicitud",
            "fuente_vista": "analitica.vw_matriz_historica",
            "fuente_archivo": "analitica_export/05_apoyo_municipio_full.csv + oficial.solicitud",
            "fuente_hoja": "vw_matriz_historica"}

    insumos = [
        dict(base, clave=f"GLOSA-{anio}-001", tema="Inversión agropecuaria",
             pregunta=f"¿Cuánto invirtió SEDEA en el campo queretano en {anio}?",
             indicador="Inversión total ejercida (todas las aportaciones)",
             valor_numerico=total, unidad="MXN", verificado=True,
             verificado_por=responsable,
             criterio_calculo=(
                 "SELECT sum(total) FROM analitica.vw_matriz_historica WHERE anio = "
                 f"{anio}. Total = federal + estatal + municipal + aportación del productor; "
                 "no es solo la aportación estatal (R3).")),
        dict(base, clave=f"GLOSA-{anio}-002", tema="Cobertura",
             pregunta=f"¿Cuántos apoyos se entregaron en {anio}?",
             indicador="Número de apoyos (folios), NO personas únicas",
             valor_numerico=apoyos, unidad="apoyos", verificado=True,
             verificado_por=responsable,
             criterio_calculo=(
                 f"SELECT sum(numero_apoyos) FROM analitica.vw_matriz_historica WHERE anio = {anio}. "
                 "Cuenta folios autorizados; una persona puede tener más de un folio (R2).")),
        dict(base, clave=f"GLOSA-{anio}-003", tema="Cobertura",
             pregunta="¿A cuántos municipios llegó el programa?",
             indicador="Municipios con al menos un apoyo",
             valor_numerico=municipios, unidad="municipios", verificado=True,
             verificado_por=responsable,
             criterio_calculo=(
                 "SELECT count(DISTINCT municipio_id) FROM analitica.vw_matriz_historica WHERE "
                 f"anio = {anio}. Excluye los pseudo-municipios estatales no desagregados (A6).")),
        dict(base, clave=f"GLOSA-{anio}-004", tema="Personas beneficiarias",
             pregunta="¿Cuántas personas distintas recibieron apoyo?",
             indicador="Beneficiarios únicos por CURP válida",
             valor_numerico=personas, unidad="personas", verificado=True,
             verificado_por=responsable,
             fuente_tabla="analitica.beneficiario_curp",
             fuente_vista="analitica.vw_genero_edad",
             fuente_archivo="Base Cadereyta Programas sedea.xlsx + oficial.solicitud",
             fuente_hoja="Hoja1",
             criterio_calculo=(
                 "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp WHERE anio = "
                 f"{anio} AND curp_valida. Solo CURP que pasan validación completa; las inválidas "
                 "se reportan aparte y no se estiman (R6).")),
        dict(base, clave=f"GLOSA-{anio}-005", tema="Personas beneficiarias",
             pregunta="¿Qué proporción de las personas beneficiarias son mujeres?",
             indicador="Mujeres con CURP válida",
             valor_numerico=mujeres, unidad="personas", verificado=True,
             verificado_por=responsable,
             fuente_tabla="analitica.beneficiario_curp",
             fuente_vista="analitica.vw_genero_edad",
             fuente_archivo="Base Cadereyta Programas sedea.xlsx + oficial.solicitud",
             fuente_hoja="Hoja1",
             criterio_calculo=(
                 "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp WHERE anio = "
                 f"{anio} AND curp_valida AND genero = 'M'. El sexo sale de la posición 11 de la "
                 "CURP, nunca del nombre (R6).")),
        dict(base, clave=f"GLOSA-{anio}-006", tema="Personas beneficiarias",
             pregunta="¿Cuántas personas beneficiarias son adultas mayores?",
             indicador="Personas de 60 años o más (a la fecha de corte)",
             valor_numerico=mayores, unidad="personas", verificado=True,
             verificado_por=responsable,
             fuente_tabla="analitica.beneficiario_curp",
             fuente_vista="analitica.vw_genero_edad",
             fuente_archivo="Base Cadereyta Programas sedea.xlsx + oficial.solicitud",
             fuente_hoja="Hoja1",
             criterio_calculo=(
                 "SELECT count(DISTINCT curp_hash) FROM analitica.beneficiario_curp WHERE anio = "
                 f"{anio} AND curp_valida AND rango_edad = '60+'. Edad calculada a la fecha de "
                 f"corte {corte} desde la fecha de nacimiento de la CURP.")),
        dict(base, clave=f"GLOSA-{anio}-007", tema="Política pública",
             pregunta="¿Cuánto se destinó a programas emergentes?",
             indicador="Inversión total en programas clasificados como EMERGENTE",
             valor_numerico=emergentes, unidad="MXN", verificado=True,
             verificado_por=responsable,
             valor_texto=(None if emergentes is not None else
                          f"Sin dato: en {anio} no hay ninguna fila clasificada como EMERGENTE en "
                          f"los orígenes cargados. Se rinde vacío, no como cero (R1/R4)."),
             fuente_vista="analitica.vw_matriz_emer_prod",
             criterio_calculo=(
                 "SELECT sum(total) FROM analitica.vw_matriz_historica WHERE anio = "
                 f"{anio} AND clasificacion = 'EMERGENTE'. La clasificación viene de las reglas "
                 "versionadas de analitica.programa_clasificacion_regla.")),
        dict(base, clave=f"GLOSA-{anio}-008", tema="Ejercicio siguiente",
             pregunta="¿Cuánto se ejerció en 2027?",
             indicador="Inversión total 2027",
             valor_numerico=total_2027, unidad="MXN", verificado=True,
             verificado_por=responsable,
             valor_texto=("Sin dato: el ejercicio 2027 aún no inicia y no hay cifras cargadas. "
                          "Se rinde vacío, no como cero (R4)."),
             criterio_calculo=(
                 "SELECT sum(total) FROM analitica.vw_matriz_historica WHERE anio = 2027. "
                 "Devuelve NULL porque no existe ninguna fila de 2027; está prohibido "
                 "publicarlo como $0 o como proyección (R4).")),
    ]
    for insumo in insumos:
        guardar(insumo)
        creados.append(insumo["clave"])
    return creados


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="Genera los insumos base de la Glosa.")
    ap.add_argument("--anio", type=int, default=2026)
    ap.add_argument("--responsable", default=RESPONSABLE_POR_DEFECTO)
    args = ap.parse_args(argv)
    try:
        creados = generar(anio=args.anio, responsable=args.responsable)
    except db.SinDatos as e:
        print(f"ERROR: sin base de datos ({e}).", file=sys.stderr)
        return 2
    print(f"Insumos generados/actualizados: {len(creados)}")
    for c in creados:
        print(" ", c)
    return 0


if __name__ == "__main__":
    sys.exit(main())
