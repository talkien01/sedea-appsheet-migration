"""Pruebas de las 6 vistas nuevas y de las restricciones de la base.

Se saltan solas si la base está apagada (`docker start sedea_db`).
"""
import pytest

import db

pytestmark = pytest.mark.skipif(not db.hay_db(), reason="requiere la base encendida")

VISTAS_NUEVAS = ["vw_matriz_historica", "vw_matriz_emer_prod", "vw_matriz_aportaciones",
                 "vw_genero_edad", "vw_incidencias", "vw_insumos_glosa"]
OBJETOS_PREEXISTENTES = ["region", "municipio", "municipio_alias", "programa", "programa_alias",
                         "apoyo_municipio", "apoyo_metrica", "resumen_estatal", "accion",
                         "beneficiarios_demografia", "v_ficha_municipio", "v_ficha_programa_anio",
                         "v_inversion_anual", "v_oficial_componente", "v_oficial_municipio",
                         "v_oficial_region"]


@pytest.mark.parametrize("vista", VISTAS_NUEVAS)
def test_las_vistas_nuevas_existen(vista):
    n = db.escalar(f"SELECT count(*)::int FROM analitica.{vista}", default=None)
    assert n is not None


@pytest.mark.parametrize("objeto", OBJETOS_PREEXISTENTES)
def test_nada_preexistente_se_borro(objeto):
    n = db.escalar(f"SELECT count(*)::int FROM analitica.{objeto}", default=None)
    assert n is not None


def test_matriz_historica_expone_columnas_clave():
    fila = db.consultar("SELECT * FROM analitica.vw_matriz_historica LIMIT 1")[0]
    for c in ("origen", "municipio_usado", "fuente_municipio", "clasificacion", "federal",
              "beneficiarios_unicos"):
        assert c in fila


def test_matriz_historica_no_inventa_2027():
    n = int(db.escalar("SELECT count(*)::int FROM analitica.vw_matriz_historica WHERE anio = 2027",
                       default=0))
    assert n == 0


def test_emer_prod_expone_clasificacion():
    assert "clasificacion" in db.consultar("SELECT * FROM analitica.vw_matriz_emer_prod LIMIT 1")[0]


def test_aportaciones_expone_pct_y_cuadra():
    fila = db.consultar("SELECT * FROM analitica.vw_matriz_aportaciones LIMIT 1")[0]
    for c in ("pct_federal", "pct_estatal", "pct_municipal", "pct_beneficiario", "cuadra"):
        assert c in fila


def test_genero_edad_expone_curps_invalidas():
    assert "curps_invalidas" in db.consultar("SELECT * FROM analitica.vw_genero_edad LIMIT 1")[0]


def test_insumos_glosa_expone_completo():
    assert "completo" in db.consultar("SELECT * FROM analitica.vw_insumos_glosa LIMIT 1")[0]


def test_todo_programa_esta_clasificado():
    n = int(db.escalar("SELECT count(*)::int FROM analitica.programa "
                       "WHERE clasificacion = 'NO_CLASIFICADO'", default=0))
    assert n == 0
    assert int(db.escalar("SELECT count(*)::int FROM analitica.programa "
                          "WHERE clasificacion_criterio IS NULL OR clasificacion_fuente IS NULL",
                          default=0)) == 0


def test_hay_emergentes_y_productividad():
    for clase in ("EMERGENTE", "PRODUCTIVIDAD"):
        assert int(db.escalar("SELECT count(*)::int FROM analitica.programa WHERE clasificacion=%s",
                              (clase,), default=0)) >= 1


def test_backfill_de_trazabilidad_completo():
    for tabla in ("apoyo_municipio", "accion"):
        assert int(db.escalar(f"SELECT count(*)::int FROM analitica.{tabla} "
                              "WHERE municipio_usado IS NULL OR fuente_municipio IS NULL",
                              default=0)) == 0


def test_pseudo_municipios_marcados():
    n = int(db.escalar("""
        SELECT count(*)::int FROM analitica.accion a
        JOIN analitica.municipio m USING (municipio_id)
        WHERE m.region_id IS NULL AND a.fuente_municipio <> 'ESTATAL_NO_DESAGREGADO'
    """, default=0))
    assert n == 0


def test_curp_invalida_no_tiene_derivados():
    assert int(db.escalar("""
        SELECT count(*)::int FROM analitica.beneficiario_curp
        WHERE curp_valida = false AND (genero IS NOT NULL OR fecha_nacimiento IS NOT NULL
              OR rango_edad IS NOT NULL OR edad_anios IS NOT NULL)
    """, default=0)) == 0


def test_beneficiario_curp_siempre_trae_fuente():
    assert int(db.escalar("""
        SELECT count(*)::int FROM analitica.beneficiario_curp
        WHERE fuente_archivo IS NULL OR fuente_hoja IS NULL OR fila_origen IS NULL
    """, default=0)) == 0


def test_glosa_rechaza_criterio_corto():
    with pytest.raises(Exception):
        db.ejecutar("""
            INSERT INTO analitica.glosa_insumo
              (clave, tema, pregunta, indicador, unidad, anio, ambito, fuente_tabla,
               fuente_vista, fuente_archivo, fuente_hoja, criterio_calculo, fecha_corte, responsable)
            VALUES ('GLOSA-TEST-CORTO','t','p','i','MXN',2026,'ESTATAL','t','v','a','h',
                    'directo','2026-12-31','r')
        """)


def test_glosa_rechaza_sin_criterio():
    with pytest.raises(Exception):
        db.ejecutar("""
            INSERT INTO analitica.glosa_insumo
              (clave, tema, pregunta, indicador, unidad, anio, ambito, fuente_tabla,
               fuente_vista, fuente_archivo, fuente_hoja, fecha_corte, responsable)
            VALUES ('GLOSA-TEST-SINCRIT','t','p','i','MXN',2026,'ESTATAL','t','v','a','h',
                    '2026-12-31','r')
        """)


def test_beneficiario_curp_rechaza_genero_invalido():
    with pytest.raises(Exception):
        db.ejecutar("""
            INSERT INTO analitica.beneficiario_curp
              (curp_hash, curp_valida, genero, anio, municipio_usado, fuente_municipio,
               fuente_archivo, fuente_hoja, fila_origen, fecha_corte)
            VALUES (repeat('a',64), true, 'X', 2026, 'X', 'EXPLICITO', 'a', 'h', 1, '2026-12-31')
        """)


def test_incidencias_cubren_los_descuadres():
    """A8/R8: toda fila con cuadra=false tiene su incidencia."""
    faltantes = int(db.escalar("""
        SELECT count(*)::int FROM analitica.vw_matriz_aportaciones a
        WHERE a.cuadra = false AND NOT EXISTS (
          SELECT 1 FROM analitica.incidencia_carga i
          WHERE i.tipo = 'SUMA_APORTACIONES_NO_CUADRA'
            AND i.anio = a.anio
            AND coalesce(i.municipio_id,-1) = coalesce(a.municipio_id,-1)
            AND coalesce(i.programa_id,-1) = coalesce(a.programa_id,-1))
    """, default=0))
    assert faltantes == 0


def test_indice_unico_de_beneficiario_curp():
    definicion = db.escalar("""
        SELECT indexdef FROM pg_indexes
        WHERE schemaname='analitica' AND indexname='beneficiario_curp_uniq'
    """)
    assert definicion and "UNIQUE" in definicion
    for col in ("curp_hash", "anio", "programa_id", "folio"):
        assert col in definicion
