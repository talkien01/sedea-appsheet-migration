# Sistema Histórico de Apoyos SEDEA

App Flask + esquema Postgres `analitica` para consultar, rendir y auditar los
apoyos que SEDEA ha entregado por municipio, año y programa (2009–2026, con 2027
previsto y vacío).

Incluye: matriz histórica unificada, fichas ejecutivas .docx (municipal, regional
y estatal), dashboard con filtros, exportación a CSV/XLSX y a un **HTML
autocontenido** que abre sin internet, e insumos trazables para la **Glosa del
Informe de Gobierno**.

- Especificación completa: [`SPEC.md`](SPEC.md)
- Criterios y reglas de negocio: [`docs/CRITERIOS.md`](docs/CRITERIOS.md)
- Diccionario de datos: [`docs/DICCIONARIO.md`](docs/DICCIONARIO.md)
- Inventario de fuentes: [`docs/INVENTARIO_FUENTES.md`](docs/INVENTARIO_FUENTES.md)
- Bitácora de la carga de emergentes 2021–2024: [`docs/CARGA_EMERGENTES_2021_2024.md`](docs/CARGA_EMERGENTES_2021_2024.md)

---

## Arrancar la app (comando exacto)

```bash
cd generador_fichas_webapp
pip install -r requirements.txt
docker start sedea_db        # la base; si ya corre, no hace falta
python app.py                # http://localhost:5000
```

En la nube o en producción:

```bash
gunicorn -w 3 -b 0.0.0.0:5000 "app:crear_app()"
```

Todo el stack (app + base) con Docker:

```bash
SEDEA_DB_PASSWORD=<password de la base> docker compose up -d --build
```

Si la base está apagada, la app **no se cae**: cae al modo CSV de solo lectura y
`/api/salud` lo reporta (`db:false`, `modo:"csv"`).

---

## Puesta a punto completa (una sola vez)

```bash
# 1. Dependencias
pip install -r requirements.txt

# 2. Configuración (copia y ajusta; .env no se sube al repo)
cp .env.example .env

# 3. Base de datos
docker start sedea_db

# 4. Migraciones y semillas (aditivas e idempotentes)
python -m db.migrate --up
python -m db.migrate --seed

# 5. Clasificar programas (Emergentes/Productividad) y backfill de trazabilidad
python -m services.clasificacion --aplicar

# 6. Inventario de fuentes
python -m ingesta.inventario_fuentes

# 7. Cargas (siempre con --dry-run primero)
python -m ingesta.cargar_programas --dry-run
python -m ingesta.cargar_programas
python -m ingesta.cargar_curp --archivo "Base Cadereyta Programas sedea.xlsx" --dry-run
python -m ingesta.cargar_curp --archivo "Base Cadereyta Programas sedea.xlsx"
python -m ingesta.cargar_curp --desde-oficial          # padrón 2026 completo
python -m ingesta.cargar_resumen_historico --archivo "Resumen Histórico por Municipio.xlsx" --dry-run
python -m ingesta.cargar_distribucion --archivo "Regional_Cadereyta_Distribucion_Cadereyta_Colon_Ezequiel.xlsx"
python -m ingesta.cargar_fichas_estatales

# 7b. Emergentes 2021-2024 (ver docs/CARGA_EMERGENTES_2021_2024.md)
#     Sequía 2023 folio por folio: 14,058 apoyos / $44,871,550 en los 18 municipios
python -m ingesta.cargar_emergentes_sequia --dry-run
python -m ingesta.cargar_emergentes_sequia
#     Seguros catastróficos y demás emergentes 2021-2022: solo agregado estatal,
#     porque el padrón individual no existe en el Drive (se marca AGREGADO, no se inventa)
python -m ingesta.cargar_emergentes_agregado --dry-run
python -m ingesta.cargar_emergentes_agregado

# 8. Insumos de la Glosa
python -m services.glosa --anio 2026

# 9. Refrescar los 16 CSV de respaldo
python refresh_data.py

# 10. Pruebas
pytest -q
```

---

## Qué hay en la app

| Pantalla | Para qué sirve |
|---|---|
| `/` | Generar fichas .docx **municipal, regional y estatal** |
| `/matriz` | Matriz histórica con filtros y descarga CSV / XLSX / HTML |
| `/dashboard` | Tablero con KPIs y 5 gráficas (Chart.js vendorizado, sin internet) |
| `/glosa` | Insumos para la Glosa, cada uno con su fuente y criterio de cálculo |
| `/incidencias` | Lo que no cuadra: tipo, severidad y acción sugerida |

API JSON de solo lectura: `/api/salud`, `/api/catalogos`, `/api/matriz`,
`/api/emer-prod`, `/api/aportaciones`, `/api/genero-edad`, `/api/incidencias`,
`/api/glosa`, `/api/glosa/<clave>`, `/api/series/inversion-anual`, `/api/resumen`,
`/api/top-municipios`.
Exportaciones: `/exportar/matriz.csv`, `/exportar/matriz.xlsx`,
`/exportar/glosa.xlsx`, `/exportar/html`.

---

## Reglas que el sistema respeta siempre

1. **No se inventan datos.** Lo que no tiene fuente queda vacío y se rinde como «—».
2. **Apoyos ≠ personas.** Se cuentan folios; las personas se cuentan por CURP distinta.
3. **Monto total ≠ monto estatal.** Siempre las 5 columnas: federal, estatal, municipal, beneficiario, total.
4. **2027 vacío ≠ cero.**
5. **Municipio trazable** (`municipio_usado`, `fuente_municipio`).
6. **CURP inválida no se infiere**: sin género ni edad estimados.
7. **Insumo de Glosa sin fuente no existe.**
8. **Lo que no cuadra se reporta** en `/incidencias`.

El detalle está en [`docs/CRITERIOS.md`](docs/CRITERIOS.md).

---

## Estructura

- `app.py` — factory `crear_app()` y la portada; el resto en `blueprints/`.
- `blueprints/` — `fichas`, `paginas` (matriz/dashboard/glosa/incidencias), `api`, `export`.
- `services/` — `curp`, `clasificacion`, `matriz`, `aportaciones`, `genero_edad`,
  `incidencias`, `glosa`, `html_export`, `xlsx_export`, `formato`.
- `ingesta/` — scripts de carga con mapeos de columnas configurables en
  `ingesta/mapeos/*.json` (nunca índices de columna) y `--dry-run`.
- `db/` — capa de acceso (psycopg → `docker exec psql` → CSV) y migraciones
  (`db/migrations/`, `db/seeds/`). Se aplican con `python -m db.migrate --up`.
- `ficha_engine.py`, `docx_writer.py` — motor y escritor de fichas .docx.
- `refresh_data.py` — refresca los **16** CSV de respaldo desde el contenedor.
- `analitica_export/` — CSV de respaldo (modo degradado).
- `tests/` — `pytest` de las reglas críticas, del validador CURP, de la API y de las vistas.
- `work/` — experimentos viejos en Node: **legacy congelado, no se usa**.

## Incidencias conocidas de los datos

- **2022 no existe** en ningún origen municipal; 2021 solo está en `accion`.
- 2026 viene de `v_oficial_*` (dictaminado): trae estatal y total; federal,
  municipal y aportación del beneficiario van vacíos, no en cero.
- `Regional_Cadereyta_2026_CURP.xlsx` **no** trae CURP por persona pese a su
  nombre; el padrón con CURP real es `Base Cadereyta Programas sedea.xlsx`.
- Las dos versiones de `Ficha_Estatal_Azucar_2026*.xlsx` no coinciden entre sí.
- `analitica.beneficiarios_demografia` está vacía y sin dimensión municipio: la
  fuente de género y edad es `analitica.beneficiario_curp`.

Todas quedan registradas en `/incidencias` con su acción sugerida.
