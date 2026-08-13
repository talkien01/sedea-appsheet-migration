# SPEC.md — Sistema Histórico de Apoyos SEDEA: Matriz, Fichas, Dashboard y Glosa

> **Proyecto:** `generador_fichas_webapp/` (monorepo `01_CLAUDE_2026_Repositorio`).
> **Naturaleza del build:** **EXTENSIÓN INCREMENTAL** sobre la app Flask y el esquema Postgres `analitica` que **ya existen y funcionan**. No es una reconstrucción. Está prohibido borrar o reescribir desde cero `app.py`, `ficha_engine.py`, `docx_writer.py`, `refresh_data.py`, `config.py`, `templates/index.html` ni el esquema `analitica`; solo se extienden.
> **Fecha de spec:** 2026-08-13. **Fecha de corte de datos por defecto:** 2026-12-31 (configurable).

---

## 0. Contexto de negocio (master prompt del usuario)

> **Nota de fidelidad:** el harness entregó el master prompt con el marcador `[PEGA AQUÍ TODO EL MASTER PROMPT...]` sin el texto literal de las secciones 1–17. Lo que sigue es la reconstrucción fiel del pedido a partir del briefing recibido y de los archivos fuente reales inspeccionados. Si aparece el texto original, se pega **verbatim** en esta sección sin alterar el resto del SPEC (ver Assumption **A0**).

**Sistema Histórico de Apoyos SEDEA** — se necesita un sistema único, verificable y reproducible que permita:

1. **Matriz histórica por municipio**: una sola tabla maestra con todos los apoyos otorgados por SEDEA por municipio, año y programa, desde el histórico disponible (2009) hasta el ejercicio corriente (2026), con 2027 como columna prevista pero **vacía**.
2. **Machotes de fichas ejecutivas**: plantillas homogéneas (municipal, regional y estatal) que se llenan solas desde la base, con el mismo formato para los 18 municipios, las 4 regiones y el estado.
3. **Reportes cruzados**: consultar y exportar por **región**, **municipio**, **año** y **programa**, en cualquier combinación.
4. **Distribución Emergentes vs Productividad**: clasificar cada programa/apoyo en esos dos grandes bloques de política pública y poder ver el peso de cada uno por municipio, región y año.
5. **Distribución de aportaciones**: desglose **Federal / Estatal / Municipal / Beneficiario (productor)** en montos y porcentajes, en cualquier nivel de agregación.
6. **Distribución por género y edad vía CURP**: derivar sexo y edad de la CURP del beneficiario, agrupar por rangos de edad, y reportar por municipio/programa/año.
7. **Dashboard interactivo en la nube**: tablero navegable con filtros (año, región, municipio, programa, clasificación) accesible por navegador, no un Excel local.
8. **HTML autocontenido**: exportable de un solo archivo `.html` que se pueda mandar por correo o WhatsApp y abra sin internet, sin CDN y sin servidor.
9. **Insumos verificables para la Glosa del Informe de Gobierno** del Gobernador de Querétaro: cada cifra que se entregue debe traer su fuente (archivo, hoja, tabla/vista) y el criterio de cálculo documentado, de modo que resista una auditoría o una pregunta en tribuna.
10. **Orden operativo obligatorio**: primero normalizar criterios, luego inventariar fuentes, luego completar la base maestra, luego cargar datos faltantes, luego matriz, machotes, dashboard, HTML autocontenido, insumos Glosa y por último validación.
11. **Trazabilidad total**: de cada cifra se debe poder decir de qué archivo, hoja y fila salió.
12. **Incidencias explícitas**: lo que no cuadra no se esconde ni se rellena; se reporta.
13. **Reglas duras del negocio** (ver §1.2): no inventar datos, apoyos ≠ beneficiarios únicos, monto total ≠ monto estatal, 2027 vacío ≠ cero, municipio siempre trazable, CURP inválida no se infiere, insumo de Glosa sin fuente no se publica.
14. **Reutilizar lo hecho**: ya existe la base `analitica` en Docker y el generador de fichas .docx probado con Amealco, Pedro Escobedo y San Juan del Río; se construye encima.
15. **Fuentes reales ya disponibles**: `Resumen Histórico por Municipio.xlsx`, `Datos_referencia_manual_municipios.xlsx`, `Base Cadereyta Programas sedea.xlsx`, `Regional_Cadereyta_2026_CURP.xlsx`, `Regional_Cadereyta_Distribucion_Cadereyta_Colon_Ezequiel.xlsx`, `Regional_Cadereyta_Machote.xlsx`, `Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx`, `Mapa_disponibilidad_datos_fichas.xlsx`, `Ficha_Estatal_Apicultores_2026_AJUSTADA.xlsx`, `Ficha_Estatal_Azucar_2026*.xlsx`, `0_indice Drive.docx` / `0 Índice Drive.pdf`.
16. **Piloto Cadereyta**: la región Cadereyta (Cadereyta de Montes, Colón, Ezequiel Montes, Peñamiller, San Joaquín, Tolimán) es el caso de prueba con datos más completos; lo que funcione ahí se replica al resto.
17. **Entregable final**: un sistema operable por personal de SEDEA sin conocimientos técnicos (menú, filtros, botón de descarga), con documentación de criterios.

### 1.2 Reglas críticas de negocio (NO negociables, aplican a todo el build)

| # | Regla | Implementación obligatoria |
|---|---|---|
| R1 | **No inventar datos.** Lo que no tiene fuente no se llena. | Campo faltante ⇒ `NULL` + advertencia/incidencia. Prohibido default `0`, `"N/D"` calculado, imputación o interpolación. |
| R2 | **Folios/apoyos ≠ beneficiarios únicos.** | Toda métrica de conteo se etiqueta explícitamente `numero_apoyos` (folios) o `beneficiarios_unicos` (CURP distinta). Nunca se rotula "beneficiarios" un conteo de apoyos. Si no hay CURP, `beneficiarios_unicos = NULL`, no igual a apoyos. |
| R3 | **Monto total ≠ monto estatal.** | Todo reporte que muestre dinero muestra las 5 columnas: `federal`, `estatal`, `municipal`, `beneficiario`, `total`. Nunca se etiqueta "inversión" a `apoyo_estatal` solo. |
| R4 | **2027 vacío ≠ cero.** | El año 2027 (y cualquier año sin carga) aparece como celda vacía / `null` y se rinde como `—`, jamás `0` ni `$0`. |
| R5 | **Trazabilidad de municipio.** | Toda fila territorial lleva `municipio_usado` (literal del origen) y `fuente_municipio` (cómo se resolvió: explícito, alias, CURP, distribución, estatal-no-desagregado, desconocido). |
| R6 | **CURP inválida no se infiere.** | Si la CURP no pasa validación completa, `genero`, `fecha_nacimiento`, `edad_anios` y `rango_edad` quedan `NULL` y se registra incidencia `CURP_INVALIDA`. Prohibido adivinar sexo por nombre o edad por promedio. |
| R7 | **Insumo de Glosa sin fuente no existe.** | `glosa_insumo` exige `fuente_tabla`/`fuente_vista`, `fuente_archivo`, `fuente_hoja`, `criterio_calculo` y `fecha_corte` NOT NULL; sin ellos el INSERT falla. |
| R8 | **Todo lo que no cuadra se reporta.** | Diferencias, duplicados y huecos van a `analitica.incidencia_carga`, visibles en dashboard y en las fichas. |

---

## 2. Objetivo

Extender la app Flask `generador_fichas_webapp` y el esquema Postgres `analitica` para entregar, sobre los datos ya cargados, una **matriz histórica municipio×año×programa**, **fichas ejecutivas municipal/regional/estatal**, un **dashboard web con filtros desplegable en la nube**, un **exportador HTML autocontenido** y un **módulo de insumos trazables para la Glosa del Informe de Gobierno**, incorporando clasificación Emergentes/Productividad, desglose de aportaciones, demografía por CURP y un registro explícito de incidencias.

---

## 3. Estado actual: qué YA existe vs qué FALTA

### 3.1 Inventario verificado del sistema actual

**Esquema `analitica` (Postgres en contenedor Docker `sedea_db`, `-U sedea_admin -d sedea`) — tablas existentes:**

| Objeto | Columnas confirmadas (por CSV exportado) | Estado |
|---|---|---|
| `region` | `region_id, nombre` | 4 filas: SAN JUAN DEL RÍO(10), CADEREYTA(11), JALPAN(12), QUERÉTARO(13) |
| `municipio` | `municipio_id, nombre, region_id` | 18 municipios reales + 6 pseudo-municipios sin región (`TODO EL ESTADO`, `ALCANCE ESTATAL`, `JALPAN REGIÓN`, `SAN JUAN DEL RÍO (REGIÓN)`, `QUERÉTARO (REGIÓN)`, `CADEREYTA REGIÓN`) |
| `municipio_alias` | `alias, municipio_id` | Poblado (AMEALCO, CADEREYTA, COLON, MARQUES, EL MARQUES…) |
| `programa` | `programa_id, nombre, categoria` | Poblado; **`categoria` está VACÍA en todas las filas** |
| `programa_alias` | (exportado) | Poblado |
| `apoyo_municipio` | `apoyo_id, anio, programa_id, municipio_id, numero_apoyos, apoyo_federal, apoyo_estatal, apoyo_municipal, aportacion_productor, total, fuente_archivo, fuente_hoja, cargado_en` | Poblado 2023–2025; **sin 2021, 2022 ni 2026** |
| `apoyo_metrica` | `apoyo_id, metrica, valor` | Poblado (Kgs., etc.) |
| `resumen_estatal` | `resumen_id, anio, programa_id, beneficiarios, beneficiarios_indir, numero_apoyos, apoyo_federal, apoyo_estatal, apoyo_municipal, aportacion_productor, total, fuente_archivo, cargado_en` | Poblado desde 2021 |
| `accion` | `accion_id, anio, programa_id, subprograma, responsable, num_obra, fecha, obra_accion, unidad, cantidad, municipio_id, localidad, inv_federal, inv_estatal, inv_beneficiario, inv_total, num_beneficiarios, clasificacion, metricas, beneficiario_id, fuente_archivo, cargado_en` | Poblado 2009–2021; **`clasificacion`, `metricas`, `beneficiario_id` vacíos** |
| `beneficiarios_demografia` | `id, anio, programa_id, genero, rango_edad, cantidad` | **TABLA VACÍA (0 filas)** y sin dimensión municipio |
| `v_ficha_municipio` | `anio, municipio, programa, numero_apoyos, apoyo_estatal, apoyo_municipal, aportacion_productor, total` | **No expone `apoyo_federal`** (viola R3) |
| `v_ficha_programa_anio` | (exportada) | OK |
| `v_inversion_anual` | `anio, federal, estatal, municipal, productores, total` | 2021–2025; sin 2026 |
| `v_oficial_componente` | `anio, componente, …` | 2026 |
| `v_oficial_municipio` | `anio, municipio_proyecto, componente, solicitudes, apoyos, estatal_dictaminado, total_dictaminado` | 2026 |
| `v_oficial_region` | `anio, regional, componente, …` | 2026 |

**App Flask actual:**
- `app.py`: 3 rutas — `GET /`, `POST /generar` (ficha municipal .docx), `POST /actualizar-datos`.
- `ficha_engine.py`: lee CSVs de `DATA_DIR`, filtra por municipio, calcula totales históricos + avance 2026, lee 4 hojas del xlsx manual (`Territorio`, `Productos_top`, `Precipitacion`, `Demografia_municipal`) y produce `warnings`. **Ya cumple R1** (no inventa, advierte).
- `docx_writer.py`: .docx con bloque de ADVERTENCIAS + 6 secciones. **Ya viola R3** (tabla histórica omite `apoyo_federal`).
- `refresh_data.py`: refresca CSVs vía `docker exec … psql`. **Refresca solo 11 de los 16 CSVs**: le faltan `02_municipio_alias.csv`, `04_programa_alias.csv`, `06_apoyo_metrica.csv`, `08_accion_full.csv`, `09_beneficiarios_demografia.csv` (sí están en `exportar_analitica.sql`, no en `QUERIES`).
- `config.py`: `DATA_DIR` por defecto apunta a `generador_fichas_webapp/analitica_export`, pero los 16 CSVs reales viven en la **raíz del monorepo** (`../analitica_export/`). Discrepancia a resolver.
- Stack: Flask 3.0.3, python-docx 1.1.2, openpyxl 3.1.5. **Sin conexión directa a Postgres** (todo por CSV).
- Existe una carpeta `work/` con experimentos en Node (`docx`, `xml-js`, `jszip`) — **legacy, no se toca, no se extiende**.

### 3.2 Matriz de cobertura del pedido

| Pedido | Estado | Acción en este build |
|---|---|---|
| 1. Matriz histórica municipio×año×programa | **PARCIAL** — `apoyo_municipio` 2023–25 + `accion` 2009–21 + `v_oficial_*` 2026, en 3 silos sin unificar | **NUEVO**: vista `analitica.vw_matriz_historica` que unifica los 3 orígenes con `origen` y `fuente_*` |
| 2. Machote ficha municipal | **YA EXISTE** (`docx_writer.escribir_ficha`) | **EXTENDER**: agregar columna Federal (R3), Emer/Prod, aportaciones %, género/edad, incidencias |
| 2b. Machote ficha regional y estatal | **FALTA** (README lo declara fuera de alcance) | **NUEVO**: `POST /generar/region`, `POST /generar/estatal` reusando `docx_writer` |
| 3. Reportes por región/municipio/año/programa | **PARCIAL** — datos sí, UI/API no (la app solo filtra por municipio) | **NUEVO**: API `/api/matriz` con filtros + UI |
| 4. Distribución Emergentes/Productividad | **NO MODELADA** — `programa.categoria` vacía, `accion.clasificacion` vacía | **NUEVO**: `programa.clasificacion` + `programa_clasificacion_regla` + `vw_matriz_emer_prod` |
| 5. Aportaciones Fed/Est/Mun/Benef | **MODELADA en tablas**, no expuesta (la vista y el .docx omiten federal) | **NUEVO**: `vw_matriz_aportaciones` + corregir ficha |
| 6. Género y edad por CURP | **NO EXISTE** — `beneficiarios_demografia` vacía, sin municipio, sin CURP | **NUEVO**: tabla `beneficiario_curp`, validador CURP, `vw_genero_edad` |
| 7. Dashboard interactivo en la nube | **FALTA** por completo | **NUEVO**: `/dashboard` + Dockerfile + docker-compose + gunicorn |
| 8. HTML autocontenido | **FALTA** por completo | **NUEVO**: `/exportar/html` de archivo único sin CDN |
| 9. Insumos Glosa | **FALTA** por completo | **NUEVO**: `glosa_insumo`, `vw_insumos_glosa`, `/glosa`, export .xlsx/.md |
| 11. Trazabilidad municipio | **PARCIAL** — hay `fuente_archivo`/`fuente_hoja` a nivel fila, **no** `municipio_usado`/`fuente_municipio` | **NUEVO**: 3 columnas + backfill desde alias |
| 12. Incidencias | **PARCIAL** — `warnings` en memoria, se pierden al cerrar | **NUEVO**: tabla `incidencia_carga` + `vw_incidencias` persistentes |
| 14. Reutilizar base y generador | — | Se reutiliza íntegro |

> Se verificó que **no existen** con otro nombre las vistas `vw_matriz_emer_prod`, `vw_matriz_aportaciones`, `vw_genero_edad`, `vw_incidencias` ni `vw_insumos_glosa`: las 6 vistas existentes usan prefijo `v_` y ninguna cubre esas semánticas.

---

## 4. Scope

### 4.1 SÍ incluye (lista cerrada)

1. Migraciones SQL versionadas en `db/migrations/` que extienden `analitica` (nunca `DROP` de tablas/columnas existentes).
2. Clasificación Emergentes/Productividad por reglas versionadas y auditables.
3. Trazabilidad de municipio (`municipio_usado`, `fuente_municipio`, `confianza_municipio`) en `apoyo_municipio`, `accion` y `beneficiario_curp`.
4. Módulo de CURP: validación estricta (formato + dígito verificador + fecha + entidad), derivación de género/edad/rango, y tabla `beneficiario_curp`.
5. Tabla y vista de incidencias persistentes.
6. Módulo de insumos de Glosa con fuente y criterio obligatorios.
7. Las 6 vistas nuevas: `vw_matriz_historica`, `vw_matriz_emer_prod`, `vw_matriz_aportaciones`, `vw_genero_edad`, `vw_incidencias`, `vw_insumos_glosa`.
8. Capa de acceso a datos directa a Postgres (`db.py` con psycopg 3) **conservando** el modo CSV como fallback.
9. API JSON de solo lectura bajo `/api/*`.
10. Dashboard web `/dashboard` con filtros y gráficas (Chart.js **vendorizado**, sin CDN).
11. Exportadores: CSV, XLSX y **HTML autocontenido de un solo archivo**.
12. Fichas .docx: municipal (extendida), regional (nueva) y estatal (nueva).
13. Scripts de ingesta para los .xlsx fuente reales, incluyendo `Regional_Cadereyta_2026_CURP.xlsx` y la distribución Cadereyta/Colón/Ezequiel.
14. `docs/CRITERIOS.md`, `docs/INVENTARIO_FUENTES.md`, `docs/DICCIONARIO.md`.
15. `Dockerfile` + `docker-compose.yml` para desplegar app + db en la nube.
16. Pruebas `pytest` de las reglas críticas (R1–R8) y del validador CURP.
17. Corrección de los 3 defectos detectados: `refresh_data` incompleto, `DATA_DIR` mal apuntado, ficha sin columna Federal.

### 4.2 NO incluye (explícitamente fuera)

1. Autenticación, roles y multiusuario (el dashboard se publica detrás del túnel/proxy existente de la organización).
2. Escritura/edición de datos desde la web (el sistema es **solo lectura**; la carga es por scripts de ingesta).
3. Migración de los experimentos en Node de `work/` (quedan como legacy congelado).
4. PDF nativo (el HTML autocontenido se imprime a PDF desde el navegador).
5. Mapas geoespaciales / PostGIS.
6. Integración en vivo con SIAP/INEGI/CONAGUA (esos datos siguen llegando por el xlsx manual).
7. Predicciones, proyecciones o cualquier cifra 2027 (R4).
8. Almacenar CURP completa en respuestas de API públicas (solo hash + derivados; ver A7).

---

## 5. Orden operativo (fases obligatorias, en este orden)

| Fase | Nombre | Entregable | Criterios del rubric |
|---|---|---|---|
| F0 | Normalizar criterios | `docs/CRITERIOS.md` | 1–6 |
| F1 | Inventariar fuentes | `docs/INVENTARIO_FUENTES.md` + `ingesta/inventario_fuentes.py` | 7–13 |
| F2 | Completar base maestra | `db/migrations/001–006` aplicadas | 14–33 |
| F3 | Cargar datos faltantes | scripts `ingesta/*` ejecutados | 34–46 |
| F4 | Generar matriz | `vw_matriz_*` + `/api/matriz` + export | 47–60 |
| F5 | Machotes de fichas | 3 endpoints `.docx` | 61–70 |
| F6 | Dashboard | `/dashboard` desplegable | 71–82 |
| F7 | HTML autocontenido | `/exportar/html` | 83–89 |
| F8 | Insumos Glosa | `/glosa` + export | 90–97 |
| F9 | Validación | incidencias + pytest + reglas R1–R8 | 98–110 |

Ninguna fase se marca terminada si sus criterios de rubric no pasan.

---

## 6. Modelo de datos

Todo lo nuevo vive en el esquema `analitica`. Migraciones idempotentes (`IF NOT EXISTS`), numeradas, aplicadas por `python -m db.migrate`.

### 6.1 `001_clasificacion.sql`

```sql
ALTER TABLE analitica.programa
  ADD COLUMN IF NOT EXISTS clasificacion text NOT NULL DEFAULT 'NO_CLASIFICADO'
    CHECK (clasificacion IN ('EMERGENTE','PRODUCTIVIDAD','NO_CLASIFICADO')),
  ADD COLUMN IF NOT EXISTS clasificacion_criterio text,
  ADD COLUMN IF NOT EXISTS clasificacion_fuente text,
  ADD COLUMN IF NOT EXISTS clasificado_en timestamptz;

CREATE TABLE IF NOT EXISTS analitica.programa_clasificacion_regla (
  regla_id      serial PRIMARY KEY,
  orden         int NOT NULL,
  patron        text NOT NULL,              -- regex ILIKE sobre programa.nombre
  clasificacion text NOT NULL CHECK (clasificacion IN ('EMERGENTE','PRODUCTIVIDAD')),
  criterio      text NOT NULL,              -- justificación en prosa
  fuente        text NOT NULL,              -- documento normativo o acuerdo
  vigente_desde date NOT NULL DEFAULT current_date,
  UNIQUE (orden)
);
```

Reglas semilla (`db/seeds/001_reglas_clasificacion.sql`, orden ascendente, primera que casa gana):

| orden | patrón (regex, case-insensitive) | clasificación |
|---|---|---|
| 10 | `EMERGENTE` | EMERGENTE |
| 20 | `CONTINGENCIA\|SINIESTR\|SEQU[IÍ]A\|HELADA\|DESASTRE` | EMERGENTE |
| 30 | `SEGURO ` | EMERGENTE |
| 40 | `LIQUID[EÉ]Z\|APOYO ECON[OÓ]MICO PARA LIQUID` | EMERGENTE |
| 50 | `SANIDAD\|INOCUIDAD\|BRIGADAS COMUNITARIAS` | EMERGENTE |
| 900 | `.*` (catch-all) | PRODUCTIVIDAD |

- El catch-all **no** se aplica silenciosamente: los programas que solo casan con la regla 900 se marcan `PRODUCTIVIDAD` **y** generan incidencia `PROGRAMA_CLASIFICADO_POR_DEFECTO` (severidad `ADVERTENCIA`) para revisión humana.
- Reclasificar es un `UPDATE` de reglas + re-run del script; nunca se edita a mano fila por fila.

### 6.2 `002_trazabilidad.sql`

```sql
ALTER TABLE analitica.apoyo_municipio
  ADD COLUMN IF NOT EXISTS municipio_usado text,
  ADD COLUMN IF NOT EXISTS fuente_municipio text
    CHECK (fuente_municipio IN ('EXPLICITO','ALIAS','CURP','DISTRIBUCION','ESTATAL_NO_DESAGREGADO','DESCONOCIDO')),
  ADD COLUMN IF NOT EXISTS confianza_municipio text
    CHECK (confianza_municipio IN ('ALTA','MEDIA','BAJA')),
  ADD COLUMN IF NOT EXISTS fila_origen int;
-- idénticas 4 columnas en analitica.accion
```

Backfill determinista: si `municipio_id` resuelve por nombre exacto ⇒ `EXPLICITO`/`ALTA`; por `municipio_alias` ⇒ `ALIAS`/`ALTA`; pseudo-municipios (`TODO EL ESTADO`, `ALCANCE ESTATAL`, `* REGIÓN`) ⇒ `ESTATAL_NO_DESAGREGADO`/`BAJA`; sin resolver ⇒ `DESCONOCIDO`/`BAJA` + incidencia `MUNICIPIO_NO_RESUELTO`. `municipio_usado` guarda **siempre** el literal del origen, aunque coincida con el catálogo.

### 6.3 `003_curp.sql` → `analitica.beneficiario_curp`

| Campo | Tipo | Notas |
|---|---|---|
| `curp_id` | serial PK | |
| `curp_hash` | char(64) NOT NULL | SHA-256 de la CURP en mayúsculas (lo que se expone) |
| `curp` | char(18) | CURP literal, **nunca sale por API** |
| `curp_valida` | boolean NOT NULL | resultado del validador |
| `motivo_invalidez` | text | `FORMATO`,`DIGITO_VERIFICADOR`,`FECHA`,`ENTIDAD`,`LONGITUD`,`NULA` |
| `genero` | char(1) CHECK (`H`,`M`) | **NULL si `curp_valida = false`** |
| `fecha_nacimiento` | date | NULL si inválida |
| `edad_anios` | int | a `fecha_corte`; NULL si inválida |
| `rango_edad` | text | `MENOR_18`,`18-29`,`30-44`,`45-59`,`60+`; NULL si inválida |
| `entidad_nacimiento` | char(2) | clave RENAPO |
| `anio` | int NOT NULL | ejercicio del apoyo |
| `programa_id` | int FK | nullable |
| `municipio_id` | int FK | nullable |
| `municipio_usado` | text NOT NULL | literal del origen |
| `fuente_municipio` | text NOT NULL | mismo CHECK que §6.2 |
| `folio` | text | folio del apoyo, si viene |
| `monto_total` | numeric(14,2) | |
| `fuente_archivo`,`fuente_hoja` | text NOT NULL | |
| `fila_origen` | int NOT NULL | |
| `fecha_corte` | date NOT NULL | base del cálculo de edad |
| `cargado_en` | timestamptz DEFAULT now() | |

Índices: `(anio, municipio_id)`, `(curp_hash)`, `(programa_id, anio)`. `UNIQUE (curp_hash, anio, programa_id, folio)` para idempotencia de recarga.

**Validador CURP (`services/curp.py`, determinista):**
1. Longitud 18 y `^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[0-9A-Z]\d$`.
2. Dígito verificador (posición 18) calculado con el algoritmo RENAPO estándar sobre el alfabeto `0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ`.
3. Fecha `AAMMDD` válida como calendario. Siglo: posición 17 dígito ⇒ 1900s; letra ⇒ 2000s.
4. Entidad (posiciones 12–13) en el catálogo de 32 entidades + `NE`.
5. No en lista de palabras altisonantes (opcional, no invalida).
   Cualquier fallo ⇒ `curp_valida=false`, derivados `NULL`, incidencia `CURP_INVALIDA` (R6).

### 6.4 `004_incidencias.sql` → `analitica.incidencia_carga`

| Campo | Tipo |
|---|---|
| `incidencia_id` | serial PK |
| `tipo` | text NOT NULL CHECK IN (`MUNICIPIO_NO_RESUELTO`,`CURP_INVALIDA`,`CURP_DUPLICADA`,`PROGRAMA_NO_CLASIFICADO`,`PROGRAMA_CLASIFICADO_POR_DEFECTO`,`SUMA_APORTACIONES_NO_CUADRA`,`MONTO_NEGATIVO`,`ANIO_SIN_DATOS`,`FOLIO_DUPLICADO`,`FUENTE_FALTANTE`,`DATO_MANUAL_FALTANTE`) |
| `severidad` | text NOT NULL CHECK IN (`BLOQUEANTE`,`ADVERTENCIA`,`INFO`) |
| `entidad` | text NOT NULL (tabla afectada) |
| `entidad_id` | int |
| `anio`,`municipio_id`,`programa_id` | int |
| `descripcion` | text NOT NULL |
| `valor_origen` | text |
| `accion_sugerida` | text NOT NULL |
| `fuente_archivo`,`fuente_hoja` | text |
| `fila_origen` | int |
| `resuelta` | boolean NOT NULL DEFAULT false |
| `detectada_en` | timestamptz DEFAULT now() |

`UNIQUE (tipo, entidad, entidad_id, anio, coalesce(fila_origen,-1))` para no duplicar en re-corridas.

### 6.5 `005_glosa.sql` → `analitica.glosa_insumo`

| Campo | Tipo | Obligatorio |
|---|---|---|
| `insumo_id` | serial PK | |
| `clave` | text UNIQUE NOT NULL | formato `GLOSA-<anio>-<nnn>` |
| `tema` | text NOT NULL | eje del Informe |
| `pregunta` | text NOT NULL | pregunta prevista en tribuna |
| `indicador` | text NOT NULL | |
| `valor_numerico` | numeric(16,2) | NULL permitido (R1/R4) |
| `valor_texto` | text | |
| `unidad` | text NOT NULL | `MXN`,`apoyos`,`personas`,`hectáreas`,`%`… |
| `anio` | int NOT NULL | |
| `ambito` | text NOT NULL CHECK IN (`ESTATAL`,`REGION`,`MUNICIPIO`) | |
| `region_id`,`municipio_id`,`programa_id` | int | |
| `fuente_tabla` | text NOT NULL | |
| `fuente_vista` | text NOT NULL | |
| `fuente_archivo` | text NOT NULL | |
| `fuente_hoja` | text NOT NULL | |
| `criterio_calculo` | text NOT NULL | SQL o descripción reproducible |
| `fecha_corte` | date NOT NULL | |
| `responsable` | text NOT NULL | |
| `verificado` | boolean NOT NULL DEFAULT false | |
| `verificado_por`,`verificado_en` | text / timestamptz | |
| `generado_en` | timestamptz DEFAULT now() | |

CHECK adicional: `char_length(criterio_calculo) >= 20` (R7: no se acepta "cálculo directo").

### 6.6 `006_vistas.sql` — las 6 vistas nuevas

1. **`analitica.vw_matriz_historica`** — unión de los 3 orígenes, grano `anio × municipio × programa × origen`:
   `anio, region_id, region, municipio_id, municipio, municipio_usado, fuente_municipio, programa_id, programa, clasificacion, origen ('apoyo_municipio'|'accion'|'oficial_2026'), numero_apoyos, beneficiarios_unicos, federal, estatal, municipal, beneficiario, total, fuente_archivo, fuente_hoja`.
   `beneficiarios_unicos` sale de `beneficiario_curp` cuando existe, si no `NULL` (R2). Años sin filas **no** se generan como ceros (R4).
2. **`analitica.vw_matriz_emer_prod`** — `anio, region, municipio_id, municipio, clasificacion, programas, numero_apoyos, federal, estatal, municipal, beneficiario, total, pct_total_del_anio_municipio`.
3. **`analitica.vw_matriz_aportaciones`** — `anio, ambito, region, municipio, programa, clasificacion, federal, estatal, municipal, beneficiario, total, pct_federal, pct_estatal, pct_municipal, pct_beneficiario, suma_partes, cuadra` donde `cuadra = abs(suma_partes - total) <= 1.00`. Los `pct_*` son `NULL` si `total` es `NULL` o `0` (nunca división por cero).
4. **`analitica.vw_genero_edad`** — `anio, ambito, region, municipio_id, municipio, programa_id, programa, genero, rango_edad, personas, curps_validas, curps_invalidas, pct_del_grupo`. Las CURP inválidas se cuentan aparte, **nunca** dentro de un género (R6).
5. **`analitica.vw_incidencias`** — `incidencia_carga` enriquecida con nombres de municipio/programa/región y `resuelta = false` por defecto en la UI.
6. **`analitica.vw_insumos_glosa`** — `glosa_insumo` + nombres resueltos + bandera `completo` = todos los campos de fuente presentes y `verificado`.

### 6.7 Fuentes de datos de ingesta (mapeo archivo → destino)

| Archivo fuente | Destino | Script |
|---|---|---|
| `Resumen Histórico por Municipio.xlsx` | `apoyo_municipio` (años faltantes 2021, 2022) | `ingesta/cargar_resumen_historico.py` |
| `Resumen_Historico_por_Municipio_llenado_2026_Cadereyta.xlsx` | `apoyo_municipio` 2026 (piloto) | idem, flag `--anio 2026` |
| `Base Cadereyta Programas sedea.xlsx` | `programa` + `programa_alias` | `ingesta/cargar_programas.py` |
| `Regional_Cadereyta_2026_CURP.xlsx` | `beneficiario_curp` | `ingesta/cargar_curp.py` |
| `Regional_Cadereyta_Distribucion_Cadereyta_Colon_Ezequiel.xlsx` | `apoyo_municipio` con `fuente_municipio='DISTRIBUCION'`, `confianza='MEDIA'` | `ingesta/cargar_distribucion.py` |
| `Datos_referencia_manual_municipios.xlsx` | consumo directo (ya lo hace `ficha_engine`) | — |
| `Ficha_Estatal_Apicultores_2026_AJUSTADA.xlsx`, `Ficha_Estatal_Azucar_2026*.xlsx` | `resumen_estatal` 2026 | `ingesta/cargar_fichas_estatales.py` |
| `Mapa_disponibilidad_datos_fichas.xlsx`, `Regional_Cadereyta_Machote.xlsx`, `0_indice Drive.docx` | referencia documental → `docs/INVENTARIO_FUENTES.md` | `ingesta/inventario_fuentes.py` |

**Todo script de ingesta:** es idempotente (`ON CONFLICT DO UPDATE`), soporta `--dry-run`, imprime `leidas/insertadas/actualizadas/omitidas/incidencias`, escribe `fuente_archivo`+`fuente_hoja`+`fila_origen` en cada fila, y **nunca** inserta valores no presentes en el origen.

---

## 7. User flows

Base local: `APP=http://localhost:5000`.

### 7.1 `GET /` — Página principal (EXISTENTE, se extiende)
- **Input:** ninguno.
- **Output:** HTML con el selector de municipio existente **más** una barra de navegación nueva con enlaces a `/dashboard`, `/matriz`, `/glosa`, `/incidencias`, y los indicadores `datos_ok`/`manual_ok` actuales.
- Se conserva el flujo actual de generar ficha municipal sin cambios de comportamiento visible salvo secciones nuevas en el .docx.

### 7.2 `GET /matriz` — Matriz histórica (NUEVO)
- **Inputs (query, todos opcionales y combinables):** `anio_desde`, `anio_hasta`, `region`, `municipio`, `programa`, `clasificacion` (`EMERGENTE|PRODUCTIVIDAD|NO_CLASIFICADO`), `origen`.
- **Output:** tabla HTML paginada (100 filas/página) con columnas Año, Región, Municipio, Programa, Clasificación, Apoyos, Federal, Estatal, Municipal, Beneficiario, Total, Origen; fila TOTAL al pie; celdas sin dato renderizadas como `—`; botones "Descargar CSV / XLSX / HTML".

### 7.3 `GET /dashboard` — Tablero interactivo (NUEVO)
- **Inputs:** mismos filtros que `/matriz`, en controles `<select>`/`<input>` con `id` estables (`f-anio`, `f-region`, `f-municipio`, `f-programa`, `f-clasificacion`, `btn-aplicar`, `btn-limpiar`).
- **Output:** 4 tarjetas KPI (`kpi-total`, `kpi-apoyos`, `kpi-municipios`, `kpi-incidencias`) + 5 gráficas Chart.js (`chart-inversion-anual` líneas, `chart-emer-prod` barras apiladas, `chart-aportaciones` dona, `chart-genero` barras, `chart-top-municipios` barras horizontales) + tabla resumen. Al aplicar filtros, las gráficas se recargan vía `fetch` a `/api/*` sin recargar la página.
- Si un filtro deja el resultado vacío: se muestra el mensaje `Sin datos para los filtros seleccionados` (id `sin-datos`), **no** ceros.

### 7.4 `GET /glosa` — Insumos para la Glosa (NUEVO)
- **Inputs:** `anio`, `tema`, `ambito`, `solo_verificados` (bool).
- **Output:** tarjetas/tabla con Clave, Pregunta, Indicador, Valor+unidad, Ámbito, y bloque **Fuente** siempre visible (`tabla/vista`, `archivo`, `hoja`, `criterio`, `fecha de corte`, `responsable`). Botón "Exportar paquete Glosa" → .xlsx con una hoja `Insumos` y una hoja `Fuentes`.

### 7.5 `GET /incidencias` — Tablero de calidad (NUEVO)
- **Inputs:** `tipo`, `severidad`, `municipio`, `anio`, `resuelta`.
- **Output:** tabla con conteo por tipo/severidad y detalle con `accion_sugerida`. Exportable a CSV.

### 7.6 Generación de fichas (EXTENDIDO)
- `POST /generar` (existente) — form `municipio` → `.docx`. Ahora incluye 4 secciones nuevas: 7) Distribución Emergentes/Productividad, 8) Distribución de aportaciones (con Federal), 9) Género y edad (o "sin CURP cargada para este municipio"), 10) Incidencias abiertas.
- `POST /generar/region` (nuevo) — form `region` → `Ficha_Region_<REGION>.docx`, mismas secciones agregadas a nivel región.
- `POST /generar/estatal` (nuevo) — sin parámetros → `Ficha_Estatal.docx` desde `resumen_estatal` + `v_oficial_componente`.

### 7.7 Endpoints API JSON (solo lectura, todos devuelven `{"ok":true,"filtros":{…},"total":N,"data":[…]}`)

| Método | Ruta | Parámetros | Devuelve |
|---|---|---|---|
| GET | `/api/salud` | — | `{ok, db:bool, modo:"postgres"\|"csv", vistas:[…], version}` |
| GET | `/api/catalogos` | — | `regiones`, `municipios`, `programas`, `anios`, `clasificaciones` |
| GET | `/api/matriz` | filtros §7.2 + `page`,`page_size` | filas de `vw_matriz_historica` |
| GET | `/api/emer-prod` | filtros | filas de `vw_matriz_emer_prod` |
| GET | `/api/aportaciones` | filtros | filas de `vw_matriz_aportaciones` |
| GET | `/api/genero-edad` | filtros | filas de `vw_genero_edad` |
| GET | `/api/incidencias` | `tipo`,`severidad`,`resuelta` | filas de `vw_incidencias` |
| GET | `/api/glosa` | `anio`,`tema`,`ambito` | filas de `vw_insumos_glosa` |
| GET | `/api/glosa/<clave>` | — | un insumo o 404 |
| GET | `/api/series/inversion-anual` | `region`,`municipio` | serie por año con las 5 columnas de dinero |
| GET | `/exportar/matriz.csv` | filtros | `text/csv` |
| GET | `/exportar/matriz.xlsx` | filtros | xlsx |
| GET | `/exportar/html` | filtros + `ambito` | `text/html` autocontenido |
| POST | `/actualizar-datos` | — | (existente, ampliado a 16 CSVs) |

Errores: parámetro inválido ⇒ 400 `{"ok":false,"error":"…"}`; recurso inexistente ⇒ 404; nunca 500 con traza al cliente.

### 7.8 HTML autocontenido (`/exportar/html`)
Un solo archivo `.html` que:
- Embebe CSS, JS (Chart.js vendorizado inline) y **los datos como JSON inline**; cero `http://`/`https://` en `src`/`href` de recursos.
- Se abre con doble clic sin servidor y sin red, conserva filtros básicos client-side y muestra pie con fecha de generación, fecha de corte, y las fuentes usadas.
- Nombre sugerido: `SEDEA_<ambito>_<clave>_<AAAAMMDD>.html`.

---

## 8. Stack y decisiones técnicas

### 8.1 Versiones fijadas (`requirements.txt`)

```
Flask==3.0.3
python-docx==1.1.2
openpyxl==3.1.5
psycopg[binary]==3.2.1
XlsxWriter==3.2.0
python-dotenv==1.0.1
gunicorn==22.0.0
pytest==8.3.2
```

- Python **3.11**. Sin ORM (SQL explícito y auditable, alineado con R7).
- Sin pandas: `openpyxl` para leer, `XlsxWriter` para escribir, `csv` estándar.
- Chart.js **4.4.3** vendorizado en `static/vendor/chart.umd.min.js` (prohibido CDN, requisito de HTML autocontenido y de red cerrada de gobierno).
- Front end: Jinja2 + JS vanilla con `fetch`. Sin React, sin build step, sin npm en la app (la carpeta `work/node_modules` es legacy y no se usa).

### 8.2 Estructura de carpetas final

```
generador_fichas_webapp/
  app.py                     # EXISTENTE → pasa a app factory + registro de blueprints
  config.py                  # EXISTENTE → + DATABASE_URL, FECHA_CORTE, MODO_DATOS
  ficha_engine.py            # EXISTENTE → + secciones emer/prod, aportaciones, género, incidencias
  docx_writer.py             # EXISTENTE → + columna Federal, + 4 secciones, + fichas región/estatal
  refresh_data.py            # EXISTENTE → completar a los 16 CSVs
  db.py                      # NUEVO   psycopg 3, pool simple, fallback CSV
  blueprints/
    fichas.py  api.py  dashboard.py  glosa.py  incidencias.py  export.py
  services/
    curp.py  clasificacion.py  matriz.py  aportaciones.py  genero_edad.py
    incidencias.py  glosa.py  html_export.py  xlsx_export.py  formato.py
  ingesta/
    inventario_fuentes.py  cargar_resumen_historico.py  cargar_programas.py
    cargar_curp.py  cargar_distribucion.py  cargar_fichas_estatales.py
    mapeos/*.json
  db/
    migrate.py
    migrations/001_clasificacion.sql … 006_vistas.sql
    seeds/001_reglas_clasificacion.sql
  templates/
    base.html  index.html(EXISTENTE)  matriz.html  dashboard.html
    glosa.html  incidencias.html  export_standalone.html
  static/ vendor/chart.umd.min.js  app.css  app.js
  analitica_export/          # CSVs (fallback)
  docs/ CRITERIOS.md  INVENTARIO_FUENTES.md  DICCIONARIO.md
  tests/ test_curp.py test_reglas_negocio.py test_api.py test_vistas.py
  Dockerfile  docker-compose.yml  .env.example  requirements.txt
  SPEC.md  README.md
  work/                      # LEGACY congelado, no tocar
```

### 8.3 Configuración (`.env.example`, sin secretos reales)

```
DATABASE_URL=postgresql://sedea_admin:cambiame@localhost:5432/sedea
SEDEA_DOCKER_CONTAINER=sedea_db
SEDEA_DB_USER=sedea_admin
SEDEA_DB_NAME=sedea
ANALITICA_DATA_DIR=./analitica_export
MANUAL_XLSX_PATH=./Datos_referencia_manual_municipios.xlsx
MODO_DATOS=auto            # auto | postgres | csv
FECHA_CORTE=2026-12-31
ANIO_MIN=2009
ANIO_MAX=2027
PUERTO=5000
```

`MODO_DATOS=auto`: intenta Postgres; si la conexión falla, cae a CSV y `/api/salud` reporta `modo:"csv"` con `db:false` (nunca revienta la app).

### 8.4 Comandos de desarrollo

```bash
# 1. Dependencias
pip install -r requirements.txt

# 2. Base de datos (contenedor existente; si está detenido)
docker start sedea_db          # o: docker compose up -d db

# 3. Migraciones + semillas (idempotentes)
python -m db.migrate --up
python -m db.migrate --seed

# 4. Clasificar programas y backfill de trazabilidad
python -m services.clasificacion --aplicar
python -m ingesta.inventario_fuentes

# 5. Cargas (con dry-run primero)
python -m ingesta.cargar_curp --archivo "Regional_Cadereyta_2026_CURP.xlsx" --dry-run
python -m ingesta.cargar_curp --archivo "Regional_Cadereyta_2026_CURP.xlsx"

# 6. Refrescar CSVs de respaldo (16 archivos)
python refresh_data.py

# 7. Correr
python app.py                                   # dev, http://localhost:5000
gunicorn -w 3 -b 0.0.0.0:5000 "app:crear_app()" # nube

# 8. Pruebas
pytest -q

# 9. Todo en Docker
docker compose up -d --build
```

### 8.5 Despliegue en la nube
`docker-compose.yml` con 2 servicios: `db` (`postgres:16`, volumen persistente, nombre de contenedor `sedea_db` para no romper `refresh_data.py`) y `app` (Dockerfile python:3.11-slim + gunicorn, `depends_on: db`, healthcheck a `/api/salud`). Publicación externa vía el túnel/reverse-proxy ya usado en el repo; la app no implementa TLS ni auth propios (§4.2).

---

## 9. Assumptions (decisiones tomadas ante ambigüedad)

- **A0.** El master prompt literal (secciones 1–17) no llegó en el task (venía el marcador de pegado). La §0 es una reconstrucción fiel del briefing; si aparece el original se sustituye verbatim sin cambiar el resto del SPEC.
- **A1.** El Planner **no** pudo inspeccionar el interior de los `.xlsx` (son binarios y el entorno no tenía shell). Por eso todo script de ingesta se implementa con **mapeo de columnas configurable** (`ingesta/mapeos/*.json`, coincidencia por encabezado normalizado sin acentos/mayúsculas y sinónimos), nunca con índices de columna hardcodeados; y trae `--dry-run` que imprime los encabezados detectados y los no mapeados. **El Generator debe abrir los .xlsx y llenar los mapeos con los encabezados reales antes de dar por cerrada F3.**
- **A2.** Se conserva `analitica` como esquema único; nada se mueve a un esquema nuevo para no romper consultas existentes de terceros.
- **A3.** Rangos de edad: `MENOR_18`, `18-29`, `30-44`, `45-59`, `60+`. Edad calculada a `FECHA_CORTE`.
- **A4.** "Beneficiario" en las aportaciones = columna `aportacion_productor` de `apoyo_municipio` / `inv_beneficiario` de `accion`. Se rotula "Beneficiario (productor)" en toda la UI.
- **A5.** Para 2026 la fuente autorizada es `v_oficial_*` (dictaminado). En la matriz se marca `origen='oficial_2026'` y las columnas `federal`/`municipal`/`beneficiario` van `NULL` (esa fuente solo trae estatal y total dictaminado), no 0.
- **A6.** Los 6 pseudo-municipios (`TODO EL ESTADO`, `ALCANCE ESTATAL`, `* REGIÓN`) **no** se reparten entre municipios; se conservan con `fuente_municipio='ESTATAL_NO_DESAGREGADO'` y se excluyen de los totales municipales, incluyéndose solo en el total estatal, con nota al pie.
- **A7.** La CURP completa se almacena pero **no se expone**: la API devuelve `curp_hash` y derivados. Las exportaciones agregadas nunca incluyen filas identificables a nivel individual.
- **A8.** Tolerancia de cuadre de aportaciones: **±$1.00** por redondeo. Diferencias mayores ⇒ incidencia `SUMA_APORTACIONES_NO_CUADRA`.
- **A9.** Rango de años del sistema: 2009–2027. 2027 se muestra en la matriz como columna presente y totalmente vacía (R4).
- **A10.** `programa.categoria` (existente, vacía) **no** se reutiliza para Emergentes/Productividad; se crea `clasificacion` aparte para no colisionar con el uso original de esa columna.
- **A11.** Idioma: toda la UI, nombres de columnas y documentación en español; identificadores SQL sin acentos.
- **A12.** Moneda en MXN, formato `$1,234,567` (sin decimales en UI, con 2 decimales en exportaciones).
- **A13.** El dashboard es público dentro de la red/túnel de la organización (§4.2); no se manejan datos personales identificables en pantalla (solo agregados).
- **A14.** La discrepancia de `DATA_DIR` se resuelve así: `config.DATA_DIR` busca primero `./analitica_export`, y si no existe o está vacío, `../analitica_export` (raíz del monorepo); el elegido se reporta en `/api/salud`.
- **A15.** Región Cadereyta = Cadereyta de Montes, Colón, Ezequiel Montes, Peñamiller, San Joaquín, Tolimán (según `region_id=11` en el catálogo real).
- **A16.** Si `beneficiarios_demografia` (vacía y sin municipio) llegara a poblarse, se usa solo como fallback estatal; la fuente primaria de género/edad es `beneficiario_curp`.

---

## 10. Rubric de evaluación (criterios binarios verificables)

Formato Given/When/Then abreviado. Base: `APP=http://localhost:5000`, DB en contenedor `sedea_db`. El Evaluator usa `curl`, `psql` (vía `docker exec`) y Playwright. **Cada criterio es binario: pasa o no pasa.**

### F0 — Normalización de criterios (1–6)

1. Existe `docs/CRITERIOS.md` y define, con texto explícito, las 8 reglas críticas R1–R8 de la §1.2.
2. `docs/CRITERIOS.md` define los 5 rangos de edad exactos (`MENOR_18`,`18-29`,`30-44`,`45-59`,`60+`).
3. `docs/CRITERIOS.md` define la diferencia entre `numero_apoyos` y `beneficiarios_unicos` (R2).
4. `docs/CRITERIOS.md` define los 6 valores válidos de `fuente_municipio`.
5. Existe `docs/DICCIONARIO.md` que lista las 6 vistas nuevas con todas sus columnas.
6. Dado `docs/CRITERIOS.md`, cuando se busca la palabra "2027", entonces aparece la regla de que va vacío y no cero (R4).

### F1 — Inventario de fuentes (7–13)

7. Existe `docs/INVENTARIO_FUENTES.md` con una tabla que lista **al menos** los 10 archivos fuente de la §6.7.
8. Cada fila del inventario tiene: nombre de archivo, hojas, destino en `analitica`, script de carga y estado (`cargado`/`pendiente`/`solo referencia`).
9. `python -m ingesta.inventario_fuentes --help` sale con código 0.
10. `python -m ingesta.inventario_fuentes` sale con código 0 y regenera/actualiza `docs/INVENTARIO_FUENTES.md` sin borrar las notas manuales.
11. El inventario reporta explícitamente los 5 CSVs que `refresh_data.py` no refrescaba (`02_municipio_alias`, `04_programa_alias`, `06_apoyo_metrica`, `08_accion_full`, `09_beneficiarios_demografia`) y su estado actual.
12. El inventario indica para `09_beneficiarios_demografia.csv` que la tabla origen está **vacía (0 filas)**.
13. `refresh_data.py` tiene las 16 entradas en `QUERIES` (antes eran 11).

### F2 — Base maestra extendida (14–33)

14. `python -m db.migrate --up` sale con código 0.
15. Reejecutar `python -m db.migrate --up` sale con código 0 y no produce error (idempotencia).
16. `information_schema.columns` confirma `analitica.programa.clasificacion` con CHECK de 3 valores.
17. Existe la tabla `analitica.programa_clasificacion_regla` con ≥6 filas tras `--seed`.
18. `analitica.apoyo_municipio` tiene las columnas `municipio_usado`, `fuente_municipio`, `confianza_municipio`, `fila_origen`.
19. `analitica.accion` tiene esas mismas 4 columnas.
20. Existe la tabla `analitica.beneficiario_curp` con las 22 columnas de §6.3.
21. `beneficiario_curp` tiene un índice UNIQUE sobre `(curp_hash, anio, programa_id, folio)`.
22. Existe la tabla `analitica.incidencia_carga` con CHECK de `severidad` en 3 valores.
23. Existe la tabla `analitica.glosa_insumo`.
24. `INSERT` en `glosa_insumo` omitiendo `criterio_calculo` **falla** con error de NOT NULL (R7).
25. `INSERT` en `glosa_insumo` con `criterio_calculo` de menos de 20 caracteres **falla** por CHECK (R7).
26. `INSERT` en `beneficiario_curp` con `genero='X'` **falla** por CHECK.
27. Existe la vista `analitica.vw_matriz_historica` y `SELECT * … LIMIT 1` devuelve las columnas `origen`, `municipio_usado`, `fuente_municipio`, `clasificacion`, `federal`.
28. Existe la vista `analitica.vw_matriz_emer_prod` y expone la columna `clasificacion`.
29. Existe la vista `analitica.vw_matriz_aportaciones` y expone `pct_federal`, `pct_estatal`, `pct_municipal`, `pct_beneficiario`, `cuadra`.
30. Existe la vista `analitica.vw_genero_edad` y expone `curps_invalidas`.
31. Existe la vista `analitica.vw_incidencias`.
32. Existe la vista `analitica.vw_insumos_glosa` y expone `completo`.
33. Ninguna tabla ni columna preexistente fue eliminada: las 10 tablas originales y las 6 vistas `v_*` siguen existiendo y `SELECT count(*)` sobre cada una funciona.

### F3 — Carga de datos faltantes (34–46)

34. `python -m services.clasificacion --aplicar` sale con código 0.
35. Tras aplicar, `SELECT count(*) FROM analitica.programa WHERE clasificacion='NO_CLASIFICADO'` devuelve 0.
36. Existe al menos 1 programa con `clasificacion='EMERGENTE'` y al menos 1 con `PRODUCTIVIDAD`.
37. Todo programa clasificado tiene `clasificacion_criterio` y `clasificacion_fuente` no nulos.
38. Los programas clasificados por la regla catch-all generaron incidencias `PROGRAMA_CLASIFICADO_POR_DEFECTO`.
39. `SELECT count(*) FROM analitica.apoyo_municipio WHERE municipio_usado IS NULL` devuelve 0 (backfill completo).
40. `SELECT count(*) FROM analitica.apoyo_municipio WHERE fuente_municipio IS NULL` devuelve 0.
41. Las filas de los 6 pseudo-municipios tienen `fuente_municipio='ESTATAL_NO_DESAGREGADO'` (A6).
42. `python -m ingesta.cargar_curp --archivo <xlsx> --dry-run` sale con código 0, no escribe en la base (`count(*)` de `beneficiario_curp` no cambia) e imprime los encabezados detectados.
43. `python -m ingesta.cargar_curp --archivo <xlsx>` sale 0 e imprime las 5 métricas `leidas/insertadas/actualizadas/omitidas/incidencias`.
44. Reejecutar la misma carga no aumenta `count(*)` de `beneficiario_curp` (idempotencia).
45. Toda fila de `beneficiario_curp` tiene `fuente_archivo`, `fuente_hoja` y `fila_origen` no nulos.
46. Toda fila con `curp_valida=false` tiene `genero IS NULL AND fecha_nacimiento IS NULL AND rango_edad IS NULL` (R6).

### F4 — Matriz y API (47–60)

47. `curl -s $APP/api/salud` devuelve 200 con `ok:true`, `modo` en (`postgres`,`csv`) y lista de vistas.
48. `curl -s $APP/api/catalogos` devuelve 200 con las 5 claves `regiones`, `municipios`, `programas`, `anios`, `clasificaciones`; `regiones` tiene 4 elementos y `municipios` los 18 reales.
49. `curl -s $APP/api/matriz` devuelve 200 con `data` array no vacío.
50. `curl -s "$APP/api/matriz?municipio=CADEREYTA%20DE%20MONTES"` devuelve 200 y **todos** los elementos tienen ese municipio.
51. `curl -s "$APP/api/matriz?anio_desde=2023&anio_hasta=2024"` devuelve 200 y ningún elemento tiene `anio` fuera de [2023,2024].
52. `curl -s "$APP/api/matriz?clasificacion=EMERGENTE"` devuelve 200 y todos los elementos tienen `clasificacion:"EMERGENTE"`.
53. `curl -s "$APP/api/matriz?anio=2027"` devuelve 200 con `data: []` (no ceros, no error) — R4.
54. `curl -s "$APP/api/matriz?anio=abc"` devuelve 400 con `ok:false` y campo `error`.
55. `curl -s "$APP/api/matriz?page=1&page_size=5"` devuelve como máximo 5 elementos y trae `page`, `page_size`, `total`.
56. Todo elemento de `/api/matriz` incluye las 5 claves de dinero `federal`, `estatal`, `municipal`, `beneficiario`, `total` (R3).
57. Todo elemento de `/api/matriz` incluye `municipio_usado` y `fuente_municipio` (R5).
58. `curl -s $APP/api/aportaciones` devuelve 200 y ningún elemento tiene `pct_*` distinto de `null` cuando `total` es `null` o `0`.
59. `curl -s "$APP/exportar/matriz.csv"` devuelve 200 con `Content-Type` que contiene `csv` y una primera línea de encabezados que incluye `federal`.
60. `curl -sI "$APP/exportar/matriz.xlsx"` devuelve 200 con `Content-Type` de spreadsheet y `Content-Disposition: attachment`.

### F5 — Machotes de fichas (61–70)

61. `curl -s -X POST -d "municipio=CADEREYTA DE MONTES" $APP/generar -o f.docx` devuelve 200 y el archivo pesa > 10 KB.
62. El `.docx` municipal es un ZIP válido y su `word/document.xml` contiene el nombre del municipio.
63. El `.docx` municipal contiene el encabezado de columna **"Federal"** en la tabla histórica (corrige la omisión actual, R3).
64. El `.docx` municipal contiene una sección con el texto "Emergentes" y "Productividad".
65. El `.docx` municipal contiene una sección de "Distribución de aportaciones".
66. El `.docx` municipal contiene una sección de "Género y edad"; si no hay CURP para ese municipio, contiene la leyenda de dato no disponible y **no** muestra ceros (R1).
67. El `.docx` municipal conserva el bloque "ADVERTENCIAS" del comportamiento actual.
68. `curl -s -X POST -d "region=CADEREYTA" $APP/generar/region -o r.docx` devuelve 200 y el docx menciona los 6 municipios de la región (A15).
69. `curl -s -X POST $APP/generar/estatal -o e.docx` devuelve 200 y el docx contiene "FICHA ESTATAL".
70. `POST /generar` con un municipio inexistente devuelve 400 (no 500, no docx vacío).

### F6 — Dashboard (71–82)

71. Playwright: `GET $APP/dashboard` responde 200 y el `<title>` contiene "Dashboard".
72. Playwright: existen y son visibles los 5 controles `#f-anio`, `#f-region`, `#f-municipio`, `#f-programa`, `#f-clasificacion`.
73. Playwright: existen las 4 tarjetas KPI `#kpi-total`, `#kpi-apoyos`, `#kpi-municipios`, `#kpi-incidencias` con texto no vacío.
74. Playwright: `#kpi-total` muestra un monto con prefijo `$` y separadores de miles.
75. Playwright: existen los 5 `<canvas>` `#chart-inversion-anual`, `#chart-emer-prod`, `#chart-aportaciones`, `#chart-genero`, `#chart-top-municipios`.
76. Playwright: al seleccionar región `CADEREYTA` y pulsar `#btn-aplicar`, la tabla resumen solo contiene municipios de esa región.
77. Playwright: al aplicar filtros la petición sale a `/api/` y no hay recarga completa de página.
78. Playwright: al filtrar por `anio=2027` aparece el elemento `#sin-datos` y **no** aparece el texto `$0`.
79. Playwright: `#btn-limpiar` restablece todos los filtros a su valor por defecto.
80. Playwright: no hay peticiones de red a dominios externos (fuera de `localhost`) al cargar `/dashboard`.
81. Playwright: la consola del navegador no registra errores de nivel `error` al cargar `/dashboard`.
82. `docker compose config` sale con código 0 y define los servicios `db` y `app`; `docker compose up -d --build` deja ambos `running` y `curl $APP/api/salud` responde 200 en ≤120 s.

### F7 — HTML autocontenido (83–89)

83. `curl -s "$APP/exportar/html?ambito=MUNICIPIO&municipio=CADEREYTA%20DE%20MONTES" -o out.html` devuelve 200.
84. `out.html` pesa > 50 KB (lleva datos y JS embebidos) y es un solo archivo (no genera carpetas ni assets adjuntos).
85. `grep -Eo 'src="https?://|href="https?://' out.html` **no** encuentra coincidencias (cero CDN).
86. `out.html` contiene una etiqueta `<script>` con datos JSON inline y la cadena `Chart` (librería embebida).
87. Playwright abriendo `file://…/out.html` **con la red bloqueada**: la página renderiza y al menos un `<canvas>` tiene dimensiones > 0.
88. `out.html` contiene la fecha de generación, la fecha de corte y un bloque "Fuentes".
89. `out.html` renderiza `—` (y no `0`) en las celdas de años sin dato (R4).

### F8 — Insumos Glosa (90–97)

90. `curl -s $APP/api/glosa` devuelve 200 con `data` array.
91. Todo elemento de `/api/glosa` tiene no vacíos: `fuente_tabla`, `fuente_vista`, `fuente_archivo`, `fuente_hoja`, `criterio_calculo`, `fecha_corte`, `responsable` (R7).
92. `curl -s $APP/api/glosa/GLOSA-2026-001` devuelve 200 con esa `clave`; una clave inexistente devuelve 404.
93. Playwright: `GET $APP/glosa` responde 200 y cada insumo mostrado incluye visible su bloque de fuente (archivo + hoja + criterio).
94. Playwright: el botón de exportar paquete Glosa produce una descarga `.xlsx`.
95. El `.xlsx` de Glosa contiene las hojas `Insumos` y `Fuentes`.
96. Existe al menos un insumo con `valor_numerico` `null` documentado como "sin dato" y la UI lo muestra como `—`, no `0` (R1/R4).
97. `curl -s "$APP/api/glosa?solo_verificados=true"` devuelve solo elementos con `verificado:true`.

### F9 — Validación y reglas críticas (98–110)

98. `pytest -q` sale con código 0 y ejecuta ≥25 pruebas.
99. `tests/test_curp.py` prueba al menos: CURP válida conocida, dígito verificador incorrecto, fecha imposible (`990231`), entidad inexistente, longitud 17 — y en los 4 casos inválidos afirma que género/edad quedan `None`.
100. `services/curp.py` no contiene heurística por nombre: la función que deriva género no referencia nombres de pila.
101. `curl -s $APP/api/incidencias` devuelve 200 con `data` array y cada elemento trae `tipo`, `severidad`, `accion_sugerida` no vacíos (R8).
102. Playwright: `GET $APP/incidencias` responde 200 y muestra un conteo por severidad.
103. Cada fila de `vw_matriz_aportaciones` con `cuadra=false` tiene su incidencia `SUMA_APORTACIONES_NO_CUADRA` correspondiente (A8/R8).
104. Ninguna respuesta de `/api/*` contiene la clave `curp` con 18 caracteres (solo `curp_hash`) — A7.
105. `grep -rn` sobre `services/` e `ingesta/` no encuentra imputación de datos: sin `fillna`, sin `or 0` aplicado a montos, sin defaults de dinero (R1). Los `NULL` se propagan.
106. En `/api/matriz?anio=2027` y `/api/series/inversion-anual`, la entrada de 2027, si aparece, tiene `total: null`, nunca `0` (R4).
107. Ninguna respuesta de `/api/*` etiqueta `numero_apoyos` como "beneficiarios"; donde no hay CURP, `beneficiarios_unicos` es `null` y no igual a `numero_apoyos` (R2).
108. `python refresh_data.py` sale con código 0 y deja los 16 CSVs en `DATA_DIR` (o reporta error explícito por archivo si Docker está detenido, sin excepción no controlada).
109. Con la base apagada (`docker stop sedea_db`), `GET $APP/` sigue respondiendo 200 y `/api/salud` devuelve `db:false`, `modo:"csv"` (degradación controlada).
110. `README.md` fue actualizado: documenta los comandos de §8.4, retira la nota de "Estatal y por región todavía no están conectados" y enlaza `SPEC.md` y `docs/CRITERIOS.md`.

**Total: 110 criterios.** Terminado = 110/110 en verde.
