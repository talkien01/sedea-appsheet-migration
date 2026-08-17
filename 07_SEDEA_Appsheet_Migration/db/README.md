# Base de datos

PostgreSQL 16 + PostGIS 3.4 (imagen `postgis/postgis:16-3.4`).

## Migraciones

Los archivos de `db/migrations/` son SQL plano, **numerados** y se aplican en orden
alfabetico. El runner (`backend/src/migrar.ts`) registra cada archivo aplicado en la
tabla `_migraciones`, por lo que volver a ejecutarlo es idempotente.

| Archivo | Contenido |
|---|---|
| `001_extensiones.sql` | `CREATE EXTENSION IF NOT EXISTS postgis` (+ `unaccent`, `pg_trgm`) |
| `002_catalogos.sql` | `direcciones_regionales`, `municipios`, `tipos_apoyo`, `catalogos` |
| `003_usuarios.sql` | `usuarios` |
| `004_beneficiarios.sql` | `importaciones`, `beneficiarios` (+ indice GIN de busqueda) |
| `005_capturas.sql` | `capturas` con `geometry(Point,4326)` e indice GIST |
| `006_auditoria_log.sql` | `auditoria_log` |

```bash
npm run migrate
```

## Seeds

`db/seeds/` contiene datos de demostracion. El orden real de ejecucion es
**catalogos -> usuarios -> beneficiarios** (los usuarios dependen de las
Regionales), y lo controla `backend/src/sembrar.ts`.

Las contrasenas de los usuarios demo **no estan en el SQL**: el archivo
`001_usuarios_demo.sql` trae marcadores `__HASH_*__` que el seeder sustituye por
hashes bcrypt generados con `SEED_ADMIN_PASSWORD`.

```bash
npm run seed             # siembra siempre
npm run seed -- --si-vacio   # siembra solo si no hay usuarios
```

## Numeracion de las migraciones

La secuencia salta del `010` al `012`: **no existe ningun archivo `011_*.sql` y
no debe crearse**. El hueco es intencional y esta congelado porque un criterio
de aceptacion del build 5 verifica explicitamente su ausencia. El modulo de
ventanilla (build 6) usa por eso `012` y `013`.

## Seeds del modulo de ventanilla (build 6)

`005_ventanilla_catalogos.sql` siembra programas, subprogramas, los 3
componentes, el proyecto PEO, las 5 ventanillas, las siglas de folio de los
municipios y las 42 reglas de documentacion. `006_usuarios_ventanilla_demo.sql`
crea `ventanilla1` (alcance restringido) y `ventanilla2` (alcance "todos"),
sustituyendo el marcador `__HASH_VENTANILLA__` con `SEED_VENTANILLA_PASSWORD`
(con fallback a `SEED_ADMIN_PASSWORD`). Ambos son idempotentes.

## Verificaciones utiles

```sql
SELECT postgis_version();
SELECT f_table_name, type, srid FROM geometry_columns;
SELECT indexname FROM pg_indexes WHERE tablename = 'capturas';
```
