# DICCIONARIO.md — Diccionario de datos de los objetos nuevos

Esquema: `analitica`. Todo lo listado aquí es **aditivo**: ninguna tabla, columna
ni vista preexistente fue eliminada o renombrada.

---

## 1. Tablas nuevas

### `analitica.programa_clasificacion_regla`
| Columna | Tipo | Notas |
|---|---|---|
| `regla_id` | serial PK | |
| `orden` | int UNIQUE NOT NULL | Ascendente; la primera regla que casa gana |
| `patron` | text NOT NULL | Regex (POSIX, case-insensitive) contra `programa.nombre` |
| `clasificacion` | text NOT NULL | `EMERGENTE` \| `PRODUCTIVIDAD` |
| `criterio` | text NOT NULL | Justificación en prosa |
| `fuente` | text NOT NULL | Documento normativo o acuerdo |
| `vigente_desde` | date NOT NULL | |

### `analitica.beneficiario_curp` (22 columnas)
`curp_id`, `curp_hash`, `curp`, `curp_valida`, `motivo_invalidez`, `genero`,
`fecha_nacimiento`, `edad_anios`, `rango_edad`, `entidad_nacimiento`, `anio`,
`programa_id`, `municipio_id`, `municipio_usado`, `fuente_municipio`, `folio`,
`monto_total`, `fuente_archivo`, `fuente_hoja`, `fila_origen`, `fecha_corte`,
`cargado_en`.
- `curp` nunca sale por API (solo `curp_hash`).
- `genero`/`fecha_nacimiento`/`edad_anios`/`rango_edad` son `NULL` si
  `curp_valida = false` (R6).
- UNIQUE `(curp_hash, anio, programa_id, folio)` para idempotencia.

### `analitica.incidencia_carga`
`incidencia_id`, `tipo`, `severidad`, `entidad`, `entidad_id`, `anio`,
`municipio_id`, `programa_id`, `descripcion`, `valor_origen`, `accion_sugerida`,
`fuente_archivo`, `fuente_hoja`, `fila_origen`, `resuelta`, `detectada_en`.

### `analitica.glosa_insumo`
`insumo_id`, `clave`, `tema`, `pregunta`, `indicador`, `valor_numerico`,
`valor_texto`, `unidad`, `anio`, `ambito`, `region_id`, `municipio_id`,
`programa_id`, `fuente_tabla`, `fuente_vista`, `fuente_archivo`, `fuente_hoja`,
`criterio_calculo`, `fecha_corte`, `responsable`, `verificado`, `verificado_por`,
`verificado_en`, `generado_en`.

### Columnas agregadas a tablas existentes
- `analitica.programa`: `clasificacion`, `clasificacion_criterio`,
  `clasificacion_fuente`, `clasificado_en`.
- `analitica.apoyo_municipio` y `analitica.accion`: `municipio_usado`,
  `fuente_municipio`, `confianza_municipio`, `fila_origen`.

---

## 2. Las 6 vistas nuevas y todas sus columnas

### `analitica.vw_matriz_historica`
Grano: `anio × municipio × programa × origen`. Unifica los 3 silos
(`accion` 2009–2021, `apoyo_municipio` 2023–2025, `v_oficial_municipio` 2026).

| Columna | Tipo | Notas |
|---|---|---|
| `anio` | int | |
| `region_id` | int | `NULL` en pseudo-municipios |
| `region` | text | |
| `municipio_id` | int | |
| `municipio` | text | |
| `municipio_usado` | text | Literal del origen (R5) |
| `fuente_municipio` | text | 6 valores (R5) |
| `programa_id` | int | |
| `programa` | text | |
| `clasificacion` | text | `EMERGENTE`\|`PRODUCTIVIDAD`\|`NO_CLASIFICADO` |
| `origen` | text | `apoyo_municipio`\|`accion`\|`oficial_2026` |
| `numero_apoyos` | int | Folios, no personas (R2) |
| `beneficiarios_unicos` | int | `NULL` si no hay CURP (R2) |
| `federal` | numeric | |
| `estatal` | numeric | |
| `municipal` | numeric | |
| `beneficiario` | numeric | Aportación del productor |
| `total` | numeric | |
| `fuente_archivo` | text | |
| `fuente_hoja` | text | |

### `analitica.vw_matriz_emer_prod`
`anio`, `region_id`, `region`, `municipio_id`, `municipio`, `clasificacion`,
`programas`, `numero_apoyos`, `federal`, `estatal`, `municipal`, `beneficiario`,
`total`, `pct_total_del_anio_municipio`.

### `analitica.vw_matriz_aportaciones`
`anio`, `ambito`, `region`, `municipio_id`, `municipio`, `programa_id`,
`programa`, `clasificacion`, `federal`, `estatal`, `municipal`, `beneficiario`,
`total`, `pct_federal`, `pct_estatal`, `pct_municipal`, `pct_beneficiario`,
`suma_partes`, `cuadra`.
`cuadra = abs(suma_partes − total) <= 1.00`. Los `pct_*` son `NULL` si `total`
es `NULL` o `0`.

### `analitica.vw_genero_edad`
`anio`, `ambito`, `region`, `municipio_id`, `municipio`, `programa_id`,
`programa`, `genero`, `rango_edad`, `personas`, `curps_validas`,
`curps_invalidas`, `pct_del_grupo`.
Las CURP inválidas se cuentan aparte, nunca dentro de un género (R6).

### `analitica.vw_incidencias`
Todas las columnas de `incidencia_carga` más `municipio`, `programa`, `region`
resueltos por nombre.

### `analitica.vw_insumos_glosa`
Todas las columnas de `glosa_insumo` más `municipio`, `region`, `programa` y la
bandera `completo` (todos los campos de fuente presentes **y** `verificado`).

---

## 3. Endpoints que exponen cada vista

| Vista | API | Pantalla |
|---|---|---|
| `vw_matriz_historica` | `/api/matriz`, `/exportar/matriz.csv`, `/exportar/matriz.xlsx` | `/matriz` |
| `vw_matriz_emer_prod` | `/api/emer-prod` | `/dashboard` |
| `vw_matriz_aportaciones` | `/api/aportaciones` | `/dashboard` |
| `vw_genero_edad` | `/api/genero-edad` | `/dashboard` |
| `vw_incidencias` | `/api/incidencias` | `/incidencias` |
| `vw_insumos_glosa` | `/api/glosa`, `/api/glosa/<clave>` | `/glosa` |
