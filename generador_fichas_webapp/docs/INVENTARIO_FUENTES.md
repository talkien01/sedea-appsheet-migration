# INVENTARIO_FUENTES.md — Inventario de fuentes de datos

> Fase F1 del SPEC. La sección autogenerada se reescribe con `python -m ingesta.inventario_fuentes`; las notas manuales del final **no se tocan**.

<!-- AUTOGENERADO:INICIO -->
_Generado por `python -m ingesta.inventario_fuentes` el 2026-08-13 10:53._

## 1. Archivos fuente

| # | Archivo | Hojas (encabezados detectados) | Destino en `analitica` | Script de carga | Estado |
|---|---|---|---|---|---|
| 1 | `Resumen Histórico por Municipio.xlsx` | **Por Emer-Prod**: (sin encabezados en la fila 1)<br>**Por Aportaciones**: (sin encabezados en la fila 1) | apoyo_municipio (años faltantes 2021, 2022) | `ingesta/cargar_resumen_historico.py` | solo referencia |
| 2 | `Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx` | **Por Emer-Prod**: (sin encabezados en la fila 1)<br>**Por Aportaciones**: (sin encabezados en la fila 1)<br>**Control de criterios**: Campo, Criterio aplicado, Fuente, Observación, Estado, Fecha | contraste de apoyo_municipio 2026 (piloto Cadereyta) | `ingesta/cargar_resumen_historico.py --anio 2026` | solo referencia |
| 3 | `Base Cadereyta Programas sedea.xlsx` | **Hoja1**: ESTATUS, FOLIO SOLICITUD, CURP, NOMBRE COMPLETO, MUNICIPIO PROYECTO, LOCALIDAD PROYECTO | beneficiario_curp + programa/programa_alias | `ingesta/cargar_curp.py, ingesta/cargar_programas.py` | cargado |
| 4 | `Regional_Cadereyta_2026_CURP.xlsx` | **REGIONAL CADEREYTA**: REGIONAL CADEREYTA | resumen por municipio (NO trae CURP a nivel persona) | `ingesta/cargar_curp.py (rechaza el archivo: sin columna CURP)` | solo referencia |
| 5 | `Regional_Cadereyta_Distribucion_Cadereyta_Colon_Ezequiel.xlsx` | **DISTRIBUCIÓN MUNICIPIOS**: REGIONAL CADEREYTA — DISTRIBUCIÓN POR MUNICIPIO | contraste de vw_genero_edad | `ingesta/cargar_distribucion.py` | solo referencia |
| 6 | `Regional_Cadereyta_Machote.xlsx` | **REGIONAL CADEREYTA**: REGIONAL CADEREYTA | machote de ficha regional | `ingesta/inventario_fuentes.py` | solo referencia |
| 7 | `Datos_referencia_manual_municipios.xlsx` | **LEEME**: Plantilla de datos de referencia manual — 4 bloques que no viven en Postgres<br>**Territorio**: Municipio, Extensión territorial (Ha), % del territorio estatal, Superficie agrícola total (Ha), Riego (Ha), Riego - Unidades de Producción<br>**Productos_top**: Municipio, Rank, Producto, Superficie (Ha), Volumen (Ton), Valor (MDP)<br>**Precipitacion**: Municipio, Año, ENE, FEB, MAR, ABR<br>**Demografia_municipal**: Municipio, Grupo de edad, Hombres, Mujeres, Total, % del total municipal | consumo directo por ficha_engine (territorio, productos, precipitación, demografía) | `ficha_engine.cargar_manual` | cargado |
| 8 | `Mapa_disponibilidad_datos_fichas.xlsx` | **Mapa de disponibilidad**: Rubro de la ficha, Nivel, Disponible en Drive, Archivo / hoja fuente, Estado, Notas<br>**Pedro Escobedo - datos crudos**: Año, Programa, Apoyos, Apoyo Federal, Apoyo Estatal, Apoyo Municipal<br>**Esquema Postgres**: Tabla/Vista, Tipo, Columna, Tipo de dato, Llave foránea<br>**Cobertura 18 municipios**: Municipio, Región, Años con datos (apoyo_municipio), # Programas distintos, Total apoyos (2023-25), Inversión total $ (2023-25)<br>**Estatal por año**: Año, Federal, Estatal, Municipal, Productores, Total | referencia documental | `ingesta/inventario_fuentes.py` | solo referencia |
| 9 | `Ficha_Estatal_Apicultores_2026_AJUSTADA.xlsx` | **ESTATAL**: ESTATAL APICULTORES | resumen_estatal 2026 (apícolas) | `ingesta/cargar_fichas_estatales.py` | solo referencia |
| 10 | `Ficha_Estatal_Azucar_2026.xlsx` | **ESTATAL**: ESTATAL | resumen_estatal 2026 (azúcar, versión previa) | `ingesta/cargar_fichas_estatales.py` | solo referencia |
| 11 | `Ficha_Estatal_Azucar_2026_Actualizada.xlsx` | **ESTATAL**: ESTATAL | resumen_estatal 2026 (azúcar, versión vigente) | `ingesta/cargar_fichas_estatales.py` | solo referencia |
| 12 | `0_indice Drive.docx / 0 Índice Drive.pdf` | no es xlsx | índice documental del Drive | `—` | solo referencia |

## 2. CSV de respaldo (`DATA_DIR`)

Carpeta en uso: `C:\Users\vparsar\Downloads\01_CLAUDE_2026_Repositorio\generador_fichas_webapp\analitica_export`

| CSV | Presente en disco | ¿Lo refresca `refresh_data.py`? | Nota |
|---|---|---|---|
| `00_region.csv` | sí | sí |  |
| `01_municipio.csv` | sí | sí |  |
| `02_municipio_alias.csv` | sí | sí | Antes faltaba en `QUERIES` (11 de 16); ya está incluido. |
| `03_programa.csv` | sí | sí |  |
| `04_programa_alias.csv` | sí | sí | Antes faltaba en `QUERIES` (11 de 16); ya está incluido. |
| `05_apoyo_municipio_full.csv` | sí | sí |  |
| `06_apoyo_metrica.csv` | sí | sí | Antes faltaba en `QUERIES` (11 de 16); ya está incluido. |
| `07_resumen_estatal_full.csv` | sí | sí |  |
| `08_accion_full.csv` | sí | sí | Antes faltaba en `QUERIES` (11 de 16); ya está incluido. |
| `09_beneficiarios_demografia.csv` | sí | sí | Antes faltaba en `QUERIES` (11 de 16); ya está incluido. La tabla origen `analitica.beneficiarios_demografia` está **vacía (0 filas)** y no tiene dimensión municipio: no sirve para género/edad. La fuente primaria es `analitica.beneficiario_curp`. |
| `10_v_ficha_municipio.csv` | sí | sí |  |
| `11_v_ficha_programa_anio.csv` | sí | sí |  |
| `12_v_inversion_anual.csv` | sí | sí |  |
| `13_v_oficial_componente.csv` | sí | sí |  |
| `14_v_oficial_municipio.csv` | sí | sí |  |
| `15_v_oficial_region.csv` | sí | sí |  |

## 3. Estado de las tablas destino

| Tabla | Filas |
|---|---|
| `analitica.region` | 4 |
| `analitica.municipio` | 24 |
| `analitica.municipio_alias` | 13 |
| `analitica.programa` | 675 |
| `analitica.programa_alias` | 1 |
| `analitica.apoyo_municipio` | 191 |
| `analitica.apoyo_metrica` | 129 |
| `analitica.resumen_estatal` | 65 |
| `analitica.accion` | 53180 |
| `analitica.beneficiarios_demografia` | 0 |
| `analitica.beneficiario_curp` | 2225 |
| `analitica.incidencia_carga` | 675 |
| `analitica.glosa_insumo` | 8 |

## 4. Huecos conocidos

- `apoyo_municipio` cubre 2023–2025; **2022 no existe en ningún origen** (incidencia `ANIO_SIN_DATOS`). 2021 solo está en `accion`.
- 2026 vive en las vistas `v_oficial_*` (dictaminado); trae estatal y total, no federal/municipal/beneficiario.
- 2027 va **vacío por definición** (R4): no es un hueco, es la regla.
- `Resumen Histórico por Municipio.xlsx` es la plantilla en blanco: no tiene datos que cargar.
- `Regional_Cadereyta_2026_CURP.xlsx` **no** contiene CURP por persona pese a su nombre; el padrón con CURP real es `Base Cadereyta Programas sedea.xlsx`.
<!-- AUTOGENERADO:FIN -->

## Notas manuales

_(Esta sección la edita el equipo a mano; el script nunca la sobreescribe.)_

### Nota manual de prueba
Esta linea debe sobrevivir.
