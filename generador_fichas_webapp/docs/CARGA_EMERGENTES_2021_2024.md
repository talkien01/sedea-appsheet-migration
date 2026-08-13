# Carga de programas EMERGENTES 2021–2024 — bitácora de decisiones auditable

> Fecha: 2026-08-13. Complementa `docs/INVENTARIO_FUENTES.md` y `docs/CRITERIOS.md`.
> Todo lo que aquí se afirma es verificable contra los archivos y los ids de Drive citados.

## 1. Problema que se corrigió

La base tenía **0 apoyos clasificados `EMERGENTE` para 2022–2026** aunque sí hubo
programas emergentes reales en el periodo. Tres causas raíz:

1. Seis programas ya estaban en `analitica.programa` con `clasificacion='EMERGENTE'`
   (ids 46, 47, 56, 58, 65, 66) pero con **cero filas** en `apoyo_municipio` y `accion`.
2. Dos programas del periodo **no existían en el catálogo**.
3. Las pacas forrajeras entregadas como respuesta a la sequía 2023 estaban clasificadas
   `PRODUCTIVIDAD` junto con las entregas rutinarias de otros años.

## 2. Sequía 2023 — elección de la fuente primaria

El padrón de maíz para consumo humano de la sequía 2023 existe en Drive en **dos formas**.
Se leyeron encabezados de ambas antes de decidir.

| Candidato | Qué es realmente | Columnas | Cobertura | Veredicto |
|---|---|---|---|---|
| **Hojas consolidadas por región** `SDAproyectos23{cad,jal,qro,sjr}Sequía`, pestaña `23_Emer_Sequía_<REG>` | Export completo del layout SIPROS | **114**: `FOLIO SOLICITUD`, `CURP`, `MUNICIPIO PROYECTO`, `APOYO ESTATAL DICTAMINADO`, `TOTAL PROYECTO`, `GÉNERO`, `EJERCICIO`, `PROGRAMA`, `DICTAMEN`… | **18/18 municipios**, 14,058 folios | ✅ **FUENTE PRIMARIA** |
| ~20 archivos divididos por municipio y lote (`2023 SEQUÍA <MUNICIPIO> NNNN-NNNN de TOTAL…xlsx`, carpeta `1QbzsL0DJq2kYKCnd3YIPs_EDzitkaXtO`) | Formato de **alta al SIPROS**, hoja `Layout` con encabezado en la fila 6 | **26**: CURP, nombre, domicilio, `ID MUNICIPIO` (clave numérica), `MONTO` (vacío en todos) | Solo **8 de 18** municipios (Amealco parcial 0001–3500 de 3591, Tequisquiapan 0001–0466 de 484, San Juan del Río, Pedro Escobedo, Landa, Pinal, Jalpan, Arroyo Seco) | ❌ descartado |
| Hoja maestra `23_Emer_Sequía` (`1YWIeUOD5H5t17R8XUZ1L4efGC1riywyutgCT9vmrYh4`) | Misma información, un solo archivo de 3.7 MB | 114 | 18/18 | ❌ no exportable (`File too large for export`); es la unión de las 4 regionales |

**Por qué la consolidada regional y no la dividida:** los archivos divididos **no traen folio,
ni monto, ni municipio del proyecto, ni programa** — solo datos personales para dar de alta al
beneficiario en el SIPROS. Cargarlos habría obligado a inferir el municipio desde `ID MUNICIPIO`
y a dejar todos los montos en `NULL`, y aun así habría faltado la mitad del estado. **No hay
riesgo de duplicado** porque solo se cargó una de las dos rutas.

`fuente_archivo` de cada fila cargada guarda el `.xlsx` regional concreto y `fuente_hoja` la
pestaña `23_Emer_Sequía_<REG>`, así que de cualquier cifra se puede volver al archivo y la fila.

### Cuadre

| Concepto | Valor |
|---|---|
| Folios en el padrón (los 4 regionales) | **14,058** |
| Filas escritas en `beneficiario_curp` | **14,057** (una colisión real: mismo folio y misma CURP en JALPAN DE SERRA) |
| Apoyo estatal dictaminado sumado | **$44,871,550.00** |
| Resumen oficial del propio Drive | $44,871,550.00 / 14,058 productores — **cuadra municipio por municipio en los 18** |
| Monto autorizado, oficio `2023GEQ00040`, proyecto `2023-00007`, 24-ene-2023 | **$45,570,275.00** (Federal $0.00, Estatal $45,570,275.00, Municipal $0.00, Otros $0.00) |
| Diferencia autorizado − ejercido | **$698,725.00 (1.53 %)** |

La diferencia **no se forzó a cuadrar**: quedó como incidencia
`SUMA_APORTACIONES_NO_CUADRA` con `entidad='sequia_2023_dictamen'`. El padrón **no excede** lo
autorizado, que era la validación pedida.

`apoyo_federal`, `apoyo_municipal` y `aportacion_productor` se escriben en $0.00 **porque el
oficio de autorización los fija expresamente en $0.00**, no por relleno: el valor sale del
documento fuente. El código lo expresa con la constante `AUTORIZADO_EN_CERO_POR_DICTAMEN`.

### Discrepancias registradas, no ocultadas

- **53 `FOLIO_DUPLICADO`** — folios repetidos dentro del mismo municipio.
- **154 folios repetidos entre municipios distintos** dentro del mismo archivo regional (p. ej.
  `PES-CAD-1910` aparece en COLÓN y en PEÑAMILLER con CURP y monto distintos): son personas
  distintas, la serie de folios se reutilizó. Por eso la clave de `beneficiario_curp` es
  `(curp_hash, anio, programa_id, folio)` y no el folio solo.
- **272 `CURP_INVALIDA`** — género, fecha de nacimiento y rango de edad quedan `NULL` (R6). Por eso
  `vw_genero_edad` reporta 9,145 H / 4,635 M / 272 sin género, contra los 9,317 H / 4,741 M del
  resumen del Drive: la diferencia es exactamente lo que no se pudo derivar sin adivinar.
- **`numero_apoyos` (14,058) ≠ `beneficiarios_unicos` (14,057)** — R2: nunca se rotulan igual.

## 3. Seguros catastróficos y demás emergentes 2021–2022 — solo agregado

Se buscó el padrón folio por folio y **no existe en el Drive**:

- Carpeta `Bases Seguros Catastróficos Benef 2022` (`1swbl6f0EUtueKoD8LWxaR_8rQxq1a8V-`):
  no enumera archivos.
- `HISTORICO SEGUROS CATASTROFICOS DEL 2011-2021 (1).xlsx` (`1GwCv0gtX4DYFnaE4LJPyjizNWQsCal5A`):
  82 filas de resumen por esquema (agrícola/pecuario) y año, con primas, hectáreas siniestradas
  y monto indemnizado. **Sin CURP y sin folio.**
- Los únicos archivos por persona del periodo son `2022 PFDAFP SEGURO AGR ElMarq/Huimil…xlsx`,
  que son otra vez layouts de alta al SIPROS de 26 columnas, sin monto, y solo de 2 municipios.

Por lo tanto **no se inventó un padrón**. Se cargó el agregado de
`Emergenes 2021-2024.xlsx`, hoja `ResumenEstatalAdmón ok`, marcado explícitamente:

| Año | Programa | Federal | Estatal | Productor | Total | Benef. directos |
|---|---|---:|---:|---:|---:|---:|
| 2021 | SEGURO AGRÍCOLA CATASTRÓFICO | 0 | 32,804,105 | 0 | 32,804,105 | 13,281 |
| 2021 | SEGURO PECUARIO CATASTRÓFICO | 0 | 1,175,293 | 0 | 1,175,293 | 146 |
| 2021 | EMERGENTE PECUARIO | 0 | 15,000,000 | 0 | 15,000,000 | 1 (UGRQ) |
| 2021 | EMERGENTE REACTIVACIÓN ECONÓMICA MÓDULOS D.R. 023, S.J.R. | 5,843,485 | 7,949,132 | 2,757,634 | 16,550,251 | 407 |
| 2022 | EMERGENTE CAPITALIZACIÓN A USUARIOS HIDROAGRÍCOLAS | 6,357,394 | 3,600,000 | 2,688,339.49 | 12,645,733 | 3 |
| 2022 | SEGURO PORCÍCOLA | 0 | 3,000,000 | 3,000,000 | 6,000,000 | 1 |

Marcas de auditoría de cada una de esas 6 filas:

- `apoyo_municipio.granularidad = 'AGREGADO'` (frente a `'FOLIO'` de Sequía 2023).
- `apoyo_municipio.observaciones` empieza con
  «AGREGADO SIN PADRÓN FOLIO POR FOLIO: …».
- Territorio = pseudo-municipio **ALCANCE ESTATAL** con
  `fuente_municipio='ESTATAL_NO_DESAGREGADO'` (A6: no se reparte entre municipios).
- `numero_apoyos = NULL`. El origen reporta **beneficiarios directos**, que no son apoyos;
  rotularlos como apoyos violaría R2. El conteo vive en
  `resumen_estatal.beneficiarios` / `beneficiarios_indir`, que es su columna.
- Una incidencia **`FUENTE_FALTANTE`** por fila, visible en `/incidencias`.

Totales resultantes, que cuadran con los bloques TOTAL del propio archivo fuente:
**2021 EMERGENTE = $65,529,649**, **2022 EMERGENTE = $18,645,733**.

## 4. Programas dados de alta en el catálogo

`db/migrations/008_emergentes.sql` (aditiva; no modifica migraciones ya aplicadas):

| Programa | Clasificación | Fuente del criterio |
|---|---|---|
| PROGRAMA INSTITUCIONAL EMERGENTE POR SEQUÍA PARA PRODUCTORES DEL CAMPO | EMERGENTE | Oficio `2023GEQ00040`, proyecto `2023-00007`, Secretaría de Finanzas, 24-ene-2023 |
| PROGRAMA INSTITUCIONAL GESTIÓN DE RIESGOS | EMERGENTE | `Emergenes 2021-2024.xlsx`, hoja `ResumenEstatalAdmón ok 2`, renglón 2024 ($65,000,000) |

`db/seeds/003_regla_gestion_riesgos.sql` agrega la **regla 25**
(`GESTI[OÓ]N DE RIESGOS|ADMINISTRACI[OÓ]N DE RIESGOS`) a
`programa_clasificacion_regla`. Sin ella, `services.clasificacion --aplicar` —que reescribe
`programa.clasificacion` entero desde las reglas— habría degradado «Gestión de Riesgos» a
`PRODUCTIVIDAD` por el catch-all 900 en el siguiente mantenimiento. La clasificación nunca se
edita fila por fila (SPEC §6.1). «Sequía» ya casaba con las reglas 10 y 20.

## 5. Reclasificación acotada de PACAS FORRAJERAS (sequía 2023)

**Investigación previa del mecanismo existente.** `analitica.programa_clasificacion_regla` tiene
una columna `vigente_desde`, pero:

- su único consumidor es `services/clasificacion.py::clasificar_programas()`, que **no la lee**;
- lo que la regla escribe es `analitica.programa.clasificacion`, que es **un valor por programa
  para todos los años** — no tiene dimensión de ejercicio;
- `--aplicar` hace primero un `UPDATE … SET clasificacion='NO_CLASIFICADO'` de toda la tabla y
  vuelve a derivar desde cero.

Conclusión: `vigente_desde` versiona *desde cuándo rige la regla*, no *a qué ejercicio del apoyo
aplica*. Agregar ahí un patrón `PACAS` habría marcado emergentes **todas** las entregas de pacas
de todos los años (incluida `PACAS Y SUPLEMENTOS` 2025, $9.6 M, que es entrega rutinaria), que es
exactamente la contaminación que se pidió evitar.

**Mecanismo implementado:** tabla nueva `analitica.programa_clasificacion_anio`
(`programa_id`, `anio`, `clasificacion`, `criterio`, `fuente`, `vigente_desde`,
`UNIQUE (programa_id, anio)`), y `vw_matriz_historica` (migración 009) usa la
**clasificación efectiva**:

```sql
coalesce(ca.clasificacion, p.clasificacion)   -- excepción del año gana sobre el catálogo
```

Las otras cinco vistas se derivan de `vw_matriz_historica`, así que heredan la clasificación
efectiva sin tocarlas. `services/clasificacion.py` **no toca** esta tabla, así que la excepción
sobrevive a cualquier re-corrida de `--aplicar` (verificado).

`db/seeds/002_clasificacion_anio_sequia_2023.sql` declara la excepción **solo para 2023** sobre
los 5 programas de pacas (ids 40, 69, 115, 227, 610). `EMPACADORA` (id 168, maquinaria) queda
fuera a propósito. Criterio y fuente citan el renglón «PACAS FORRAJERAS y viajes de agua (2)»
del bloque TOTAL 2023 de `Emergenes 2021-2024.xlsx` ($5,000,000 / 2,415 apoyos).

> **Sin efecto sobre los datos hoy:** la base **no tiene ninguna fila de pacas en 2023**
> (`apoyo_municipio` solo tiene pacas en 2025 y `accion` ninguna). La regla queda lista y
> documentada, y aplicará en cuanto se cargue esa entrega. Es un hallazgo, no un fallo:
> el padrón de pacas 2023 sigue pendiente de carga.

## 6. Cómo reproducir

```bash
python -m db.migrate --up
python -m db.migrate --seed
python -m services.clasificacion --aplicar
python -m ingesta.cargar_emergentes_sequia --dry-run   # imprime encabezados y el cuadre
python -m ingesta.cargar_emergentes_sequia
python -m ingesta.cargar_emergentes_agregado --dry-run
python -m ingesta.cargar_emergentes_agregado
python -m ingesta.inventario_fuentes
pytest -q
```

Ambos cargadores son idempotentes (`ON CONFLICT DO UPDATE`): re-ejecutarlos no cambia
`count(*)`.

## 7. Pendientes para el área (no se decidieron por cuenta propia)

1. **$698,725.00** autorizados y no ejercidos en Sequía 2023: confirmar si es subejercicio,
   folios cancelados o una ampliación posterior, antes de usar la cifra en Glosa.
2. **154 folios repetidos entre municipios** en los archivos regionales: confirmar que la
   reutilización de la serie es intencional.
3. **272 CURP inválidas**: corregirlas en el origen para poder derivar género y edad.
4. **Padrón de pacas forrajeras 2023** (2,415 apoyos / $5,000,000 según el resumen estatal):
   no está en el Drive revisado; sin él, la reclasificación acotada del §5 no tiene filas
   sobre las cuales operar.
5. **Padrón individual de seguros catastróficos**: solicitarlo a la aseguradora / Dirección
   Regional; mientras no exista, esas cifras se reportan como estatal no desagregado.
