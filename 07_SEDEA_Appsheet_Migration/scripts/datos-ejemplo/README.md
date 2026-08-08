# Fixtures de ejemplo — todos sintéticos

**Ningún archivo de esta carpeta contiene datos personales reales.** Los nombres
(`PRUEBA A` … `PRUEBA L`), las CURP (`PRB*800101HQTXXX*`), los teléfonos y los
domicilios están inventados para ejercitar el importador y las pantallas de
depuración.

Los archivos reales del padrón (`[PROYECTESTRATORG] Base general.xlsx` y
`[PROYECTESTRATORG] CATALOGOS.xlsx`) contienen PII (CURP, RFC, teléfono, CLABE):
**no se copian aquí, no se commitean y están cubiertos por `.gitignore`.**
Solo se usan, fuera del repositorio, para generar el seed de conceptos de apoyo
(`db/seeds/004_tipos_apoyo_apoyo.sql`), que contiene únicamente nombres de
conceptos y por tanto no es PII.

## `padron.staging.ejemplo.csv` — 12 filas

Construido para disparar cada uno de los 6 flags de diagnóstico del staging.
Los dos conceptos de apoyo reales que usan las filas se toman textualmente del
catálogo de 152 conceptos:

- **Concepto A** = `CAA: REHABILITACIÓN DE BORDO` (clave `AP-001`)
- **Concepto B** = `CAA: GEOMEMBRANA / GEOTEXTIL` (clave `AP-008`)

| Fila | Escenario | Flags esperados |
|---|---|---|
| 1 | Limpia, concepto A | ninguno (`nivel_alerta='ninguna'`) |
| 2 | Limpia, concepto B | ninguno (`nivel_alerta='ninguna'`) |
| 3 | Folio `STG-003` | `folio_duplicado` |
| 4 | Folio `STG-003` repetido | `folio_duplicado` |
| 5 | CURP `…XXX05`, concepto A | `curp_duplicada_mismo_concepto` |
| 6 | CURP `…XXX05`, concepto A | `curp_duplicada_mismo_concepto` |
| 7 | CURP `…XXX07`, concepto A | `curp_duplicada_concepto_distinto` |
| 8 | CURP `…XXX07`, concepto B | `curp_duplicada_concepto_distinto` |
| 9 | Colonia vacía | `sin_colonia` |
| 10 | Latitud/longitud vacías | `sin_coordenadas` |
| 11 | Concepto `APOYO INEXISTENTE PARA PRUEBA` | `concepto_no_reconocido` |
| 12 | Colonia vacía **y** coordenadas vacías | `sin_colonia` + `sin_coordenadas` |

Conteos esperados tras importar: `folio_duplicado=2`,
`curp_duplicada_mismo_concepto=2`, `curp_duplicada_concepto_distinto=2`,
`sin_colonia=2`, `sin_coordenadas=2`, `concepto_no_reconocido=1`,
`nivel_alerta='ninguna'`=2, total 12 filas, todas en `estado_revision='pendiente'`.

Las columnas `ETAPA DEL TRAMITE` y `OBSERVACIONES DE GABINETE` **no** están en
el mapeo: sirven para comprobar que las columnas no mapeadas se conservan en
`staging_beneficiarios.datos_extra`.

## `catalogo.staging.ejemplo.csv` — 6 filas

Grupo `unidad_medida`. Las dos últimas filas comparten la clave `UM-BULTO`, por
lo que ambas quedan con `clave_duplicada=true` (`clave_duplicada=2`). La columna
`NOTA DE GABINETE` no está mapeada y termina en `datos_extra`.

## Comandos

```bash
npm run importar -- --tipo padron   --archivo scripts/datos-ejemplo/padron.staging.ejemplo.csv   --mapeo scripts/mapeos/padron.staging.ejemplo.json
npm run importar -- --tipo catalogo --archivo scripts/datos-ejemplo/catalogo.staging.ejemplo.csv --mapeo scripts/mapeos/catalogo.staging.ejemplo.json
```

Ambos escriben **solo** en las tablas de staging. Nada llega a `beneficiarios`
ni a `catalogos` sin aprobación humana desde `/depuracion`.

Los archivos `padron.ejemplo.csv` y `catalogo.ejemplo.csv` son los fixtures del
build 1 y siguen funcionando con el importador actual (también aterrizan en
staging).
