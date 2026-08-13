# CRITERIOS.md — Criterios normalizados del Sistema Histórico de Apoyos SEDEA

> Fase F0 del SPEC. Este documento es la norma: cualquier cifra, vista, ficha o
> insumo de Glosa que contradiga lo aquí escrito está mal, aunque el código corra.
> Fecha de corte por defecto: **2026-12-31** (`FECHA_CORTE`, configurable).

---

## 1. Las 8 reglas críticas de negocio (R1–R8)

### R1 — No inventar datos
Lo que no tiene fuente **no se llena**. Un campo sin dato en el origen se guarda
como `NULL` y se reporta como advertencia o incidencia. Está **prohibido**:
default `0` en montos, `"N/D"` calculado, imputación, interpolación, promedios de
relleno o arrastre del año anterior. Los `NULL` se propagan hasta la pantalla y
se renderizan como `—`.

### R2 — Folios/apoyos ≠ beneficiarios únicos
Todo conteo se etiqueta explícitamente:

| Métrica | Significado | Fuente |
|---|---|---|
| `numero_apoyos` | Número de folios/apoyos autorizados. Una persona puede tener varios. | `apoyo_municipio.numero_apoyos`, conteo de folios |
| `beneficiarios_unicos` | Personas distintas, contadas por CURP distinta. | `count(distinct curp_hash)` en `beneficiario_curp` |

Nunca se rotula "beneficiarios" a un conteo de apoyos. Si no hay CURP cargada,
`beneficiarios_unicos` es `NULL` — **jamás** igual a `numero_apoyos`.

### R3 — Monto total ≠ monto estatal
Todo reporte con dinero muestra las **5 columnas**: `federal`, `estatal`,
`municipal`, `beneficiario` (aportación del productor) y `total`. Está prohibido
etiquetar "inversión" o "monto" a `apoyo_estatal` solo. La ficha municipal, la
matriz, el dashboard y las exportaciones traen las 5.

### R4 — 2027 vacío ≠ cero
El año **2027** (y cualquier año sin carga) aparece como celda vacía / `null` y
se rinde como `—`. Nunca `0`, nunca `$0`, nunca una barra de altura cero en una
gráfica. `GET /api/matriz?anio=2027` responde `200` con `data: []`, no un error y
no una fila de ceros. El rango del sistema es **2009–2027**; 2027 existe como
columna prevista y totalmente vacía.

### R5 — Trazabilidad de municipio
Toda fila territorial lleva:
- `municipio_usado`: el literal **tal como venía en el origen** (aunque coincida
  con el catálogo).
- `fuente_municipio`: cómo se resolvió (6 valores válidos, ver §3).
- `confianza_municipio`: `ALTA` | `MEDIA` | `BAJA`.

### R6 — CURP inválida no se infiere
Si la CURP no pasa la validación completa (formato, dígito verificador, fecha,
entidad), entonces `genero`, `fecha_nacimiento`, `edad_anios` y `rango_edad`
quedan en `NULL` y se registra incidencia `CURP_INVALIDA`. Está **prohibido**
adivinar el sexo por el nombre de pila y la edad por promedio del grupo.

### R7 — Insumo de Glosa sin fuente no existe
`analitica.glosa_insumo` exige NOT NULL en `fuente_tabla`, `fuente_vista`,
`fuente_archivo`, `fuente_hoja`, `criterio_calculo`, `fecha_corte` y
`responsable`. Además `criterio_calculo` debe tener ≥ 20 caracteres (no se acepta
"cálculo directo"). Si falta cualquiera de esos, el INSERT **falla**: el insumo no
se genera, no se aproxima.

### R8 — Todo lo que no cuadra se reporta
Diferencias, duplicados, huecos y defaults van a `analitica.incidencia_carga` con
`tipo`, `severidad` y `accion_sugerida`, y se ven en `/incidencias`, en
`/api/incidencias` y en la sección 10 de cada ficha.

---

## 2. Rangos de edad (exactos, 5 valores)

Se calculan a la **fecha de corte** (`FECHA_CORTE`, por defecto `2026-12-31`) a
partir de la fecha de nacimiento derivada de la CURP válida.

| Clave | Definición |
|---|---|
| `MENOR_18` | edad < 18 |
| `18-29` | 18 ≤ edad ≤ 29 |
| `30-44` | 30 ≤ edad ≤ 44 |
| `45-59` | 45 ≤ edad ≤ 59 |
| `60+` | edad ≥ 60 |

Si la CURP es inválida el rango es `NULL` (R6) y la persona se cuenta solo en
`curps_invalidas`, nunca dentro de un rango ni de un género.

---

## 3. Valores válidos de `fuente_municipio` (6)

| Valor | Cuándo se usa | Confianza |
|---|---|---|
| `EXPLICITO` | El origen trae el nombre del municipio y coincide con el catálogo `analitica.municipio`. | ALTA |
| `ALIAS` | El origen trae una variante que resolvió por `analitica.municipio_alias`. | ALTA |
| `CURP` | El municipio se dedujo del beneficiario vía su registro CURP, no del renglón. | MEDIA |
| `DISTRIBUCION` | La cifra se repartió con un criterio documentado (archivo de distribución). | MEDIA |
| `ESTATAL_NO_DESAGREGADO` | Pseudo-municipios `TODO EL ESTADO`, `ALCANCE ESTATAL`, `* REGIÓN`: no se reparten entre municipios. | BAJA |
| `DESCONOCIDO` | No se pudo resolver. Genera incidencia `MUNICIPIO_NO_RESUELTO`. | BAJA |

Los pseudo-municipios se **excluyen** de los totales municipales y se incluyen
solo en el total estatal, con nota al pie.

---

## 4. Clasificación Emergentes / Productividad

- Vive en `analitica.programa.clasificacion` (columna **nueva**). La columna
  preexistente `programa.categoria` está vacía y **no se reutiliza**.
- Valores: `EMERGENTE`, `PRODUCTIVIDAD`, `NO_CLASIFICADO`.
- Se asigna por reglas versionadas en `analitica.programa_clasificacion_regla`
  (orden ascendente, primera que casa gana), nunca a mano fila por fila.
- El catch-all (orden 900 → `PRODUCTIVIDAD`) **no es silencioso**: genera
  incidencia `PROGRAMA_CLASIFICADO_POR_DEFECTO` (severidad `ADVERTENCIA`).
- Todo programa clasificado guarda `clasificacion_criterio` y
  `clasificacion_fuente`.

---

## 5. Criterios de conteo y de monto

| Criterio | Regla aplicada |
|---|---|
| Estatus | Solo se cuentan solicitudes `AUTORIZADA`. Canceladas/negativas se excluyen y se reportan. |
| Apoyos | Conteo de folios autorizados (R2). |
| Monto | Monto **total** del proyecto = federal + estatal + municipal + beneficiario (R3). |
| Año | Ejercicio presupuestal del apoyo. |
| Cuadre | `abs(federal+estatal+municipal+beneficiario − total) ≤ $1.00` (redondeo). Diferencia mayor ⇒ incidencia `SUMA_APORTACIONES_NO_CUADRA`. |
| Porcentajes | `pct_* = NULL` si `total` es `NULL` o `0`. Nunca división por cero, nunca 0 % inventado. |
| Moneda | MXN. UI sin decimales (`$1,234,567`); exportaciones con 2 decimales. |

---

## 6. Orígenes de datos por época (silos reales)

| Años | Origen autorizado | `origen` en la matriz |
|---|---|---|
| 2009–2021 | `analitica.accion` | `accion` |
| 2023–2025 | `analitica.apoyo_municipio` | `apoyo_municipio` |
| 2026 | `analitica.v_oficial_municipio` (dictaminado) | `oficial_2026` |
| 2021, 2022 | **sin datos municipales cargados** | — (incidencia `ANIO_SIN_DATOS`) |
| 2027 | previsto, vacío por definición (R4) | — |

Para 2026 la fuente oficial solo trae estatal y total dictaminado: `federal`,
`municipal` y `beneficiario` van `NULL`, no `0` (R1).

---

## 7. Privacidad

La CURP completa se almacena en `beneficiario_curp.curp` pero **nunca sale por
API ni por exportación**: hacia afuera solo viaja `curp_hash` (SHA-256) y los
derivados agregados. Las exportaciones son agregadas; no hay filas identificables
a nivel individual.
