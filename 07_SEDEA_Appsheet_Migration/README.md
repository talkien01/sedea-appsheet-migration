# SEDEA — Migración de AppSheet a PWA offline-first

Reemplazo del flujo **AppSheet + Google Sheets** de la Secretaría de Desarrollo
Agropecuario de Querétaro (SEDEA) por una solución propia:

- **PWA instalable** que funciona **sin señal** en campo (foto + GPS + padrón local).
- **API REST** con JWT, control de acceso por Dirección Regional y bitácora de auditoría.
- **PostgreSQL 16 + PostGIS 3.4** para almacenar las coordenadas como geometría real.
- **Panel de auditoría** con tabla, mapa Leaflet/OpenStreetMap y exportación de
  expedientes a PDF y CSV.

---

## Arranque rápido (todo en Docker)

```bash
cp .env.example .env      # ajusta JWT_SECRET y contraseñas
docker compose up --build
```

Cuando los tres contenedores estén arriba:

| Servicio | URL |
|---|---|
| PWA | http://localhost:8080 |
| API | http://localhost:3000/api/health |
| PostgreSQL | localhost:5432 |

El contenedor `backend` aplica las migraciones y siembra los datos demo
automáticamente al arrancar (solo si la base está vacía).

### Comando exacto para levantar la aplicación

```bash
docker compose up --build
```

> **Puertos ocupados.** Si el host ya usa 3000, 8080 o 5432, no hace falta tocar
> `docker-compose.yml`: define en tu `.env` las variables `BACKEND_PORT_HOST`,
> `PWA_PORT_HOST` o `POSTGRES_PORT_HOST` con puertos libres. Los puertos
> *internos* de los contenedores no cambian.

---

## Interfaz: design system, tema dual y layout responsivo

Desde el build 9 la PWA usa el design system de IntechQRO (naranja `#FF5A1F`
sobre neutros cálidos, Space Grotesk / Inter / JetBrains Mono) con **dos modos
completos** y una **arquitectura de aplicación**: barra lateral en escritorio,
barra inferior en el teléfono.

### Modo claro y modo oscuro

- El botón de tema está en el pie de la barra lateral (escritorio y tablet), en
  la franja de estado (móvil) y arriba a la derecha en `/login`. Siempre hay
  **exactamente uno** visible.
- Al abrir por primera vez la app respeta la preferencia del sistema. En cuanto
  se pulsa el botón, la elección queda guardada en `localStorage['sedea.tema']`
  y deja de seguir al sistema.
- Un script síncrono en `index.html` fija el modo antes del primer pintado, así
  que recargar no produce ningún fogonazo del tema contrario.
- La carátula imprimible de una solicitud sigue saliendo **negra sobre blanca**
  en cualquier modo: es un documento oficial que se firma en papel.

### Navegación según el ancho de pantalla

| Ancho | Navegación |
|---|---|
| < 768 px | Barra inferior fija con hasta 4 accesos del rol + hoja "Más" |
| 768 – 1023 px | Barra lateral en modo rail (solo iconos), expandible como panel |
| ≥ 1024 px | Barra lateral expandida de 256 px, colapsable a rail de 72 px |

El estado de la barra lateral se recuerda en `localStorage['sedea.lateral']`.
Las dos barras **nunca coexisten**: se montan y desmontan con `matchMedia`.

En pantallas de teléfono las tablas de gestión (auditoría, depuración,
correcciones, solicitudes, usuarios) se presentan como lista de tarjetas con la
misma información, para no obligar a hacer scroll horizontal.

### Tipografía

Las tres familias se sirven desde el propio origen (`pwa/public/fuentes/`,
licencia SIL OFL 1.1). **No hay ninguna llamada a una CDN de fuentes**: la app
tiene que arrancar sin internet. Si algún `.woff2` faltara, cae a las fuentes
del sistema sin romperse; ver `pwa/public/fuentes/LEEME.txt`.

---

## Desarrollo sin Docker

Requiere Node 20+ y un PostgreSQL con PostGIS accesible.

```bash
npm install                 # instala todos los workspaces
npm run build:shared        # compila @sedea/shared (tipos y validadores Zod)
npm run migrate             # aplica db/migrations en orden
npm run seed                # datos demo (usa SEED_ADMIN_PASSWORD)
npm run dev:backend         # API en http://localhost:3000
npm run dev:pwa             # PWA en http://localhost:5173 (proxy /api -> 3000)
```

| Acción | Comando |
|---|---|
| Instalar | `npm install` |
| Dev backend | `npm run dev -w backend` |
| Dev PWA | `npm run dev -w pwa` |
| Migrar | `npm run migrate` |
| Seed | `npm run seed` |
| Importar padrón | ver abajo |
| Levantar todo | `docker compose up --build` |

---

## Importación del padrón y catálogos

El importador **no tiene ningún nombre de columna escrito en el código**: el mapeo
vive en un JSON externo, por lo que se adapta a cualquier hoja que entregue la
Secretaría. Las columnas no mapeadas se conservan íntegras en `datos_extra` (JSONB).

> **Importante:** el importador **ya no escribe nunca directamente en
> `beneficiarios` ni en `catalogos`.** `--tipo padron` aterriza en
> `staging_beneficiarios` y `--tipo catalogo` en `staging_catalogos`, siempre en
> `estado_revision = 'pendiente'`. La única vía a producción es la aprobación
> humana desde la pantalla de Depuración (ver
> [Depuración de datos](#depuración-de-datos-staging)).

Fixtures sintéticos listos para probar el flujo completo (sin datos personales):

```bash
npm run importar -- --tipo padron   --archivo scripts/datos-ejemplo/padron.staging.ejemplo.csv   --mapeo scripts/mapeos/padron.staging.ejemplo.json

npm run importar -- --tipo catalogo   --archivo scripts/datos-ejemplo/catalogo.staging.ejemplo.csv   --mapeo scripts/mapeos/catalogo.staging.ejemplo.json
```

```bash
# Padrón (CSV o XLSX)
npm run importar -- --tipo padron \
  --archivo scripts/datos-ejemplo/padron.ejemplo.csv \
  --mapeo scripts/mapeos/padron.ejemplo.json

# Catálogos
npm run importar -- --tipo catalogo \
  --archivo scripts/datos-ejemplo/catalogo.ejemplo.csv \
  --mapeo scripts/mapeos/catalogo.ejemplo.json

# Ensayo sin escribir en la base
npm run importar -- --tipo padron --archivo <ruta> --mapeo <ruta> --dry-run

# Ayuda
npm run importar -- --help
```

Reglas del importador:

- Los encabezados se normalizan (sin acentos, mayúsculas, espacios colapsados)
  antes de compararse con el mapeo.
- La clave de idempotencia en staging es **(archivo, fila_origen)**: reejecutar
  la misma importación **actualiza** las filas que siguen en `pendiente` y **no
  toca** las que ya fueron aprobadas, descartadas o fusionadas.
- La resolución de Regional / Municipio / Concepto es de **solo lectura**: el
  importador nunca da de alta catálogos nuevos, para que un concepto fuera del
  catálogo vigente quede marcado con su alerta en lugar de colarse.
- Filas sin nombre o sin Regional resoluble **no se descartan**: se guardan con
  el motivo anotado en `motivo_revision` para que el revisor las corrija.
- Cada corrida escribe una fila en `importaciones` y una entrada
  `staging_import` en `auditoria_log` con el conteo de cada alerta.
- Al promover a producción la clave de upsert sigue siendo el **folio**; si la
  fila aprobada no trae folio se genera `IMP-<id de staging>`.

---

## Usuarios demo

Se crean con `npm run seed` usando la contraseña de la variable
`SEED_ADMIN_PASSWORD` (por defecto `cambiame123` en `.env.example`). El usuario
`editor1` puede tener contraseña propia con `SEED_EDITOR_PASSWORD` y los dos
usuarios de ventanilla con `SEED_VENTANILLA_PASSWORD`; si no se definen,
reutilizan la de los demás.

| Usuario | Rol | Alcance |
|---|---|---|
| `admin` | admin | Todas las Regionales + bitácora |
| `capturista1` | capturista | Solo Regional Centro (`REG-01`) |
| `auditor1` | auditor | Todas las Regionales (sin regional asignada) |
| `editor1` | `editor_datos` | Depuración de staging y corrección de datos en producción (perfil de gabinete central, sin Regional asignada) |
| `ventanilla1` | `ventanilla` | Ventanilla de San Juan del Río (`REG-04`) con **alcance restringido**: 2 municipios y el componente `TR` |
| `ventanilla2` | `ventanilla` | Ventanilla SEDEA central, **sin restricción** (alcance "todos") |

> **Advertencia:** estos usuarios existen únicamente para pruebas.
> **Desactívalos desde `/usuarios` (nunca los borres) antes de operar en
> producción** —ver *Administración de usuarios*—, y define un
> `SEED_ADMIN_PASSWORD` propio. Ninguna contraseña está escrita en el código
> fuente ni en los archivos SQL: el seeder genera los hashes bcrypt en tiempo de
> ejecución a partir del entorno.

---

## Administración de usuarios

Las cuentas reales se dan de alta **desde la propia aplicación**, en la pantalla
`/usuarios` (enlace **Usuarios** de la barra superior). Ya no hace falta tocar la
base de datos con SQL para crear capturistas.

### Quién entra

| Rol | Acceso a `/usuarios` |
|---|---|
| `admin` | Sí, sobre todas las cuentas, incluidas las de otros administradores |
| `editor_datos` | Sí, pero **no puede crear ni modificar cuentas con rol `admin`** (evita la escalada de privilegios) |
| `capturista` | **No.** La API responde 403 y la PWA muestra "No tienes permiso para ver esta sección." |
| `auditor` | **No.** Mismo comportamiento que `capturista` |

### Alta de una cuenta

1. **Nuevo usuario** → nombre de acceso, nombre completo, rol y —solo si el rol es
   **Capturista**— su Dirección Regional. Los demás roles no llevan Regional.
2. **Contraseña inicial:** el formulario incluye un selector con dos opciones.
   - **Generar automática** (opción por defecto): el sistema genera una
     **contraseña temporal de 14 caracteres**, sin caracteres ambiguos, y la
     muestra en un modal.
   - **Escribir yo mismo**: el `admin` o `editor_datos` **teclea la contraseña**
     que quiere asignarle a esa persona. Debe tener mínimo 10 caracteres, con al
     menos una letra y un número. Útil para acordar una clave por teléfono con
     personal de campo sin obligarlo a copiar 14 caracteres aleatorios.

   El mismo selector aparece en **Resetear contraseña**.

   **En los dos modos el usuario queda obligado a cambiar la contraseña en su
   primer acceso.** Lo único que cambia es quién elige el valor inicial, nunca la
   obligación de cambiarlo: no existe forma de crear ni resetear una cuenta
   dejándola exenta de ese cambio.
3. **La contraseña se muestra una sola vez**, sea generada o escrita a mano (se
   muestra también la manual para confirmar exactamente qué quedó guardado antes
   de comunicárselo al usuario). No se envía por correo, no
   se guarda en claro en ninguna parte, no aparece en la bitácora y **no se puede
   volver a consultar**: ni por API, ni en la base, ni en los registros. Si se
   pierde, se hace un **Resetear contraseña**, que genera otra distinta.
4. Se le entrega al usuario por un canal seguro. En su **primer inicio de sesión**
   la app lo lleva a `/cambiar-password` y **no le deja usar nada más** hasta que
   la cambie (el backend responde `cambio_password_requerido` a cualquier otra
   ruta). Esto aplica a **los cuatro roles**, no solo a los capturistas.

### Cambio obligatorio vs. cambio voluntario

Son dos flujos con la misma pantalla y con una diferencia deliberada:

| | Contraseña actual |
|---|---|
| **Cambio obligatorio** (primer acceso, o tras un reseteo) | **No se pide.** El campo ni siquiera aparece en pantalla |
| **Cambio voluntario** (*Cambiar mi contraseña*, en cualquier momento) | **Sí se pide** y se valida |

**Por qué el obligatorio no la pide:** el usuario **acaba de escribir esa misma
contraseña** para iniciar sesión y obtener el token con el que llama al endpoint.
Volver a pedírsela un segundo después no aporta seguridad y sí fricción real para
personal de campo que está tecleando 14 caracteres aleatorios en un teléfono. El
backend confía en el token recién emitido; si el cliente manda `password_actual`
de todas formas, la ignora en silencio.

**Por qué el voluntario sí la sigue pidiendo:** ahí no hay ninguna autenticación
reciente. Es la protección contra que alguien que encuentre un dispositivo con la
sesión abierta se apropie de la cuenta cambiando la contraseña sin conocerla. Esa
validación **no se relajó** en ningún caso.

En ambos flujos se sigue exigiendo que la nueva contraseña tenga al menos 10
caracteres con una letra y un número, y que sea **distinta de la vigente**
(se compara contra el hash, nunca contra un valor enviado por el cliente).

### Reglas que conviene conocer

- **El nombre de acceso es inmutable.** Una vez creado no se puede cambiar: es la
  clave con la que se lee el historial. Si quedó mal escrito, se desactiva esa
  cuenta y se crea otra.
- **Las bajas se hacen desactivando la cuenta, nunca borrándola.** No existe botón
  de eliminar ni endpoint `DELETE`. La fila se conserva para que
  `capturas.usuario_id`, `staging_beneficiarios.revisado_por` y
  `auditoria_log.usuario_id` sigan apuntando a un nombre real: borrar un usuario
  destruiría la trazabilidad de las evidencias que capturó y de las decisiones que
  tomó sobre el padrón.
- Una cuenta desactivada **deja de servir de inmediato**: no puede iniciar sesión y
  sus tokens vigentes dejan de funcionar sin esperar a que expiren.
- No se puede desactivar la **propia** cuenta ni dejar al sistema **sin ningún
  administrador activo**.
- Cualquier usuario, de cualquier rol, puede cambiar su contraseña cuando quiera
  desde **Cambiar mi contraseña**, en la barra superior. La contraseña debe tener
  al menos 10 caracteres con una letra y un número. **No hay recuperación por
  correo**: quien la olvide le pide a un `admin` o `editor_datos` un reseteo.
- Todo queda en la bitácora (`usuario_creado`, `usuario_editado`,
  `usuario_password_reset`, `usuario_activado`, `usuario_desactivado`,
  `password_cambiado`) **sin registrar nunca la contraseña**.

### Primer paso al pasar a producción

1. Entra con `admin` y crea desde `/usuarios` las cuentas reales de las Direcciones
   Regionales, con su Regional correspondiente.
2. Entrega a cada persona su contraseña inicial (generada o escrita por ti); al
   entrar la cambiará.
3. **Desactiva —no borres— las cuentas demo** (`capturista1`, `auditor1`,
   `editor1`) que no se vayan a usar, y cambia la contraseña de `admin` desde
   *Cambiar mi contraseña*. Desactivarlas conserva el historial de las pruebas;
   borrarlas lo rompería.

---

## Ventanilla: captura de Solicitudes de Apoyo

Hasta el build 5 la única forma de dar de alta beneficiarios era la importación
masiva del padrón revisada en staging. El **módulo de ventanilla** agrega la vía
uno por uno: personal de las Direcciones Regionales y de SEDEA central recibe la
Solicitud de Apoyo en papel y la captura en vivo en `/solicitudes/nueva`.

Es una pantalla **de oficina y en línea**: no usa la base local del navegador ni
la cola de sincronización offline. Sin conexión muestra
"Esta sección requiere conexión a internet."

### Puesta en marcha sobre una base que ya tiene datos

`docker compose up --build` aplica solas las migraciones nuevas (`012` y `013`),
pero **el seed automático solo corre con la base vacía**, así que en una
instalación que ya está operando hay que sembrar una vez los catálogos del
módulo (componentes, ventanillas, proyecto, siglas de folio y las reglas de
documentación — 42 de Build 6 más las 8 de Casas Ejidales que agrega la migración 014). El archivo es idempotente y **no toca ningún usuario ni
contraseña**:

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < db/seeds/005_ventanilla_catalogos.sql
```

Los usuarios de ventanilla reales se crean después desde `/usuarios`, con su
alcance. (`db/seeds/006_usuarios_ventanilla_demo.sql` solo crea las cuentas de
demostración `ventanilla1` / `ventanilla2` y no debe usarse en producción.)

### El rol `ventanilla`

`ventanilla` es un rol nuevo con acceso **exclusivo** al módulo de solicitudes:

- **Ve:** `/solicitudes`, `/solicitudes/nueva` y `/solicitudes/:id`.
- **No ve:** `/beneficiarios`, `/sync`, `/auditoria`, `/depuracion`,
  `/correcciones`, `/dashboard` ni `/usuarios`. Tampoco `/api/auditoria/*`,
  `/api/staging/*`, `/api/usuarios` ni `/api/estadisticas/*`: el backend responde
  403, no solo se ocultan los enlaces.

`admin` también usa el módulo, sin ninguna restricción de alcance.

### Alcance por municipios y componentes

Un usuario de ventanilla puede quedar limitado a ciertos municipios y a ciertos
componentes. Se administra desde `/usuarios`: al elegir el rol **Ventanilla**
aparece el bloque de alcance con las casillas de municipios y componentes.

> **Vacío = todos.** Cero filas en `usuario_municipios` / `usuario_componentes`
> significa "sin restricción". Es lo que hace que los usuarios ya existentes no
> queden bloqueados por la migración.

El alcance **se aplica en el backend**, no solo en la interfaz:

- Al guardar una solicitud, el municipio de la *ubicación del apoyo*, el
  componente y la ventanilla deben estar dentro del alcance; si no, la API
  responde **403** (`municipio_fuera_de_alcance`, `componente_fuera_de_alcance`,
  `ventanilla_fuera_de_alcance`).
- El listado y el detalle filtran **en SQL**: un usuario de ventanilla solo ve
  las solicitudes de su alcance.

### El folio oficial

Lo genera **siempre el backend**; el usuario nunca lo escribe (en el formulario
solo se lee "Se generará al guardar"). Formato:

```
{prefijo del proyecto}-{clave de la ventanilla}-{siglas del municipio}-{consecutivo}-{año}
PEO-SJR-AME-0001-26
```

- La clave regional sale de la **ventanilla receptora** (identifica quién recibió
  la solicitud), no del municipio.
- Las siglas salen de `municipios.siglas_folio`. Si esa columna está vacía hay un
  **fallback determinista**: el nombre del municipio sin acentos, en mayúsculas,
  solo letras A-Z, los primeros 3 caracteres, rellenando con `X` si faltan
  (`Amealco de Bonfil` → `AME`, `San Juan del Río` → `SAN`, `El Marqués` → `ELM`).
- El consecutivo es **por combinación proyecto + regional + municipio + año** y se
  reserva de forma atómica. Puede dejar huecos si una transacción falla después de
  reservarlo: un consecutivo nunca se reutiliza.

### Qué pasa al guardar

La solicitud **entra directo a producción, sin pasar por staging ni por
aprobación humana**: es captura dirigida por personal capacitado, una a una. En
una sola transacción se escriben la solicitud, sus conceptos, su checklist de
documentos, la bitácora y **un beneficiario por cada concepto solicitado**.

Con un solo concepto el beneficiario hereda el folio de la solicitud; con varios,
se numeran `<folio>-C1`, `<folio>-C2`, … Esos beneficiarios quedan disponibles de
inmediato para el flujo de captura de campo ya existente.

### Dos domicilios que no se mezclan

El formulario captura **dos direcciones distintas y nunca se fusionan**:

| Sección | Qué es | Para qué se usa |
|---|---|---|
| 2.2 Domicilio particular | Dónde vive el solicitante | Solo queda en la solicitud |
| 4.1 Ubicación del apoyo | Dónde está el predio o proyecto | **Es la que hereda el beneficiario** |

El capturista de campo debe ir al predio del proyecto, no a la casa del
solicitante; por eso el beneficiario creado toma siempre el municipio, la
localidad y el ejido de la sección 4.1.

### Documentos requeridos

El checklist se calcula solo, según componente, tipo de persona, proyecto y
conceptos elegidos (50 reglas sembradas — 42 de Build 6 y 8 de Casas Ejidales —,
incluidas exclusiones: las
"Cotizaciones" no se piden si el único concepto es fertilizante, pero vuelven a
pedirse si hay un segundo concepto no excluido). Al guardar, el checklist se
**materializa copiando el texto**: cambiar las reglas después no altera las
solicitudes ya recibidas. Desde el detalle se marca cada documento como recibido
y se adjunta el archivo (JPG/PNG/WEBP/PDF).

### La solicitud no se edita

Una vez guardada **no hay edición ni borrado** (`PATCH`/`DELETE` sobre
`/api/solicitudes/:id` responden 404): en ventanilla el papel firmado es la
fuente de verdad. Lo único que sigue siendo modificable es el checklist de
documentos. Si un dato del beneficiario derivado está mal, se corrige por
**`/correcciones`**, que deja traza en la bitácora.

---

## Casas Ejidales (concepto de apoyo del proyecto PEO)

### Qué es

**Casas Ejidales** es un **concepto de apoyo**: una fila del catálogo
`tipos_apoyo` con clave `CASAS-EJIDALES`. **No es un proyecto ni un programa.**
Se solicita **dentro del proyecto PEO ya existente**, en la jerarquía que ya
estaba sembrada:

| Nivel | Valor |
|---|---|
| Programa | Apoyo al Campo Queretano 2026 |
| Subprograma | Impulso a la Productividad |
| Componente | _Sin restricción_ |
| Proyecto | **PEO** — Proyectos Estratégicos para el Fortalecimiento Organizativo |
| Concepto de apoyo | Casas Ejidales — clave `CASAS-EJIDALES` |

No se creó ningún programa, subprograma, componente ni proyecto nuevo, ni
ninguna tabla o columna: los 8 documentos requeridos se ligan al concepto por
la columna `apoyo_id` de `documentos_requeridos`, que ya existía.

> **Nota de corrección.** La primera versión del Build 7 modeló Casas Ejidales
> **mal**, como un proyecto nuevo con prefijo de folio propio. Los documentos
> oficiales son en realidad del proyecto PEO (folio real
> `PEO-SJR-AME-0001-26`). El error se corrigió **antes de desplegar a
> producción**, sobre la misma migración `014`, sin migración de reversión.

### Folio: el normal de PEO

Las solicitudes con este concepto se folian **igual que cualquier otra
solicitud de PEO** y comparten su mismo contador:

```
PEO-{clave_regional}-{siglas_municipio}-{consecutivo 4 dígitos}-{año 2 dígitos}
```

Ejemplo: `PEO-SJR-AME-0001-26`

**No existe ningún prefijo de folio propio para Casas Ejidales**: un concepto
de apoyo no interviene en la generación del folio.

### Documentos requeridos (grupos de productores)

Los 8 documentos aplican cuando el capturista selecciona el concepto
**Casas Ejidales** con el proyecto **PEO** y `tipo_persona='grupo'`. Para
`fisica` o `moral` el algoritmo E41 los omite automáticamente.

1. Solicitud mediante escrito libre dirigida al Titular de la Secretaría
2. Ficha técnica
3. Acta integración del grupo de productores
4. Identificación oficial vigente con fotografía (INE o pasaporte) del representante del grupo de productores
5. CURP del representante del grupo de productores
6. Constancia de Situación Fiscal del representante del grupo de productores
7. Comprobante de domicilio del representante de grupo de productores
8. Relación de beneficiarios directos del grupo de productores

### Aplicar la migración 014 sobre una BD de Build 6 sin downtime

Si la instalación ya está en producción con Build 6, aplica la migración
aditiva (idempotente: da de alta el concepto y sus 8 reglas, y alinea el texto
de las 8 reglas del anexo PEO; no crea tablas, columnas ni catálogos):

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < db/migrations/014_casas_ejidales.sql
```

También puedes hacer un `docker compose up --build` normal: el runner de
migraciones aplica automáticamente las que aún no se hayan ejecutado. El
servicio no necesita bajarse para aplicarla.

Re-ejecutar después el seed de catálogos es seguro: las reglas ligadas a un
concepto de apoyo (`apoyo_id IS NOT NULL`) quedan fuera de su alcance y siguen
activas.

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < db/seeds/005_ventanilla_catalogos.sql
```

### Mejoras de UX incluidas en Build 7

Las siguientes mejoras en las pantallas de ventanilla **no requieren
variable de entorno nueva ni migración adicional**:

| Mejora | Descripción |
|---|---|
| **Visor inline de PDF** | Tras adjuntar un PDF, el detalle muestra un `<iframe>` en lugar de solo el enlace de descarga. Las imágenes JPG/PNG/WEBP se muestran con `<img>`. |
| **Banner post-guardado** | Al guardar una solicitud, la redirección automática (4 s) lleva a `/solicitudes/:id?nuevo=1`. El detalle muestra un banner de confirmación que desaparece al tocarlo o a los 10 s. |
| **Drag & drop** | Cada documento del checklist tiene una zona de arrastre encima del selector de archivo. Sin librerías externas. |
| **Carátula imprimible** | El botón "Imprimir carátula" llama a `window.print()`. Se imprime solo el bloque con folio, solicitante, municipio, proyecto, conceptos y lista de documentos con casillas vacías para check manual. |

---

## Flujo de trabajo en campo

1. **Login** con conexión la primera vez. Después la sesión vive 12 h en
   IndexedDB y la app abre sin red.
2. **Sincronización**: "Descargar padrón y catálogos" (paginado de 500 en 500).
3. **Padrón**: buscador tolerante a acentos y selects encadenados
   Regional → Municipio → Colonia → Sección. Para un `capturista` la Regional
   queda fija a la suya.
4. **Captura**: foto desde la cámara (comprimida a 1600 px / JPEG 0.75) + GPS con
   semáforo de precisión (verde ≤20 m, ámbar 21–50 m, rojo >50 m) + datos de
   entrega. Todo se guarda en IndexedDB con estado `pendiente`.
5. **Sincronización de capturas**: automática al recuperar conexión, al abrir la
   app y con el botón "Sincronizar ahora". Cada captura lleva un **UUID v4
   generado en el cliente**: el backend hace UPSERT por ese uuid, así que
   reenviar la misma captura **nunca** crea duplicados (responde
   `{"duplicado": true}`). Hasta 5 reintentos con backoff exponencial.

---

## Panel de auditoría

Rutas `/auditoria` y `/auditoria/beneficiario/:id`, accesibles solo para los roles
`auditor` y `admin`. Un `capturista` recibe **403** de la API y la pantalla
"No tienes permiso para ver esta sección.".

- Filtros: Regional, Municipio (dependiente), fecha desde/hasta y texto.
- Tabla con miniatura, beneficiario, CURP, Regional, Municipio, Colonia, Sección,
  coordenadas, precisión, fecha y capturista.
- Mapa **Leaflet** con tiles públicos de **OpenStreetMap** y su atribución
  obligatoria. Sin servicios de mapas de pago.
- Exportaciones: `Exportar CSV` del filtro actual, y por beneficiario
  `Descargar expediente PDF` y `Descargar expediente CSV`.

---

## Endpoints principales

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/health` | pública |
| POST | `/api/auth/login` | pública |
| GET | `/api/auth/me` | autenticado |
| GET | `/api/catalogos` | autenticado |
| GET | `/api/beneficiarios` | autenticado (filtrado por Regional) |
| GET | `/api/beneficiarios/:id` | autenticado (403 si es de otra Regional) |
| POST | `/api/capturas` | `capturista`, `admin` (multipart, idempotente) |
| GET | `/api/capturas` | autenticado |
| GET | `/api/auditoria/capturas` | `auditor`, `admin` |
| GET | `/api/auditoria/geojson` | `auditor`, `admin` |
| GET | `/api/auditoria/export.csv` | `auditor`, `admin` |
| GET | `/api/auditoria/expediente/:id.pdf` | `auditor`, `admin` |
| GET | `/api/auditoria/expediente/:id.csv` | `auditor`, `admin` |
| GET | `/api/auditoria/log` | `admin` |
| PATCH | `/api/beneficiarios/:id` | `editor_datos`, `admin` (edición correctiva) |
| GET | `/api/staging/resumen` | `editor_datos`, `admin` |
| GET | `/api/staging/beneficiarios` | `editor_datos`, `admin` |
| GET | `/api/staging/beneficiarios/:id` | `editor_datos`, `admin` |
| POST | `/api/staging/beneficiarios/:id/aprobar` | `editor_datos`, `admin` |
| POST | `/api/staging/beneficiarios/:id/descartar` | `editor_datos`, `admin` |
| POST | `/api/staging/beneficiarios/fusionar` | `editor_datos`, `admin` |
| GET | `/api/staging/catalogos` | `editor_datos`, `admin` |
| POST | `/api/staging/catalogos/:id/aprobar` | `editor_datos`, `admin` |
| POST | `/api/staging/catalogos/:id/descartar` | `editor_datos`, `admin` |
| GET | `/api/correcciones/beneficiarios` | `editor_datos`, `admin` |
| GET | `/api/correcciones/beneficiarios/:id` | `editor_datos`, `admin` |
| GET | `/api/correcciones/beneficiarios/:id/historial` | `editor_datos`, `admin` |
| GET | `/api/estadisticas/cobertura` | `admin`, `auditor`, `editor_datos` |
| GET | `/api/estadisticas/apoyos` | `admin`, `auditor`, `editor_datos` |
| GET | `/api/estadisticas/avance` | `admin`, `auditor`, `editor_datos` |
| GET | `/api/estadisticas/staging` | `admin`, `auditor`, `editor_datos` |
| GET | `/api/usuarios` | `admin`, `editor_datos` |
| POST | `/api/usuarios` | `admin`, `editor_datos` (devuelve la contraseña inicial; acepta `modo_password`) |
| PATCH | `/api/usuarios/:id` | `admin`, `editor_datos` |
| POST | `/api/usuarios/:id/reset-password` | `admin`, `editor_datos` (acepta `modo_password`) |
| PATCH | `/api/usuarios/:id/activo` | `admin`, `editor_datos` (alta/baja lógica) |
| PATCH | `/api/mi-cuenta/password` | autenticado (cualquier rol; `password_actual` solo en el cambio voluntario) |
| GET | `/media/*` | autenticado (header o `?token=`) |

**No existe `DELETE /api/usuarios/:id`:** las cuentas nunca se borran, se
desactivan (ver *Administración de usuarios*).

### Módulo de ventanilla (build 6)

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/solicitudes/catalogos` | `ventanilla`, `admin` |
| POST | `/api/solicitudes/documentos-requeridos` | `ventanilla`, `admin` |
| POST | `/api/solicitudes` | `ventanilla`, `admin` |
| GET | `/api/solicitudes` | `ventanilla`, `admin` (aislado por alcance) |
| GET | `/api/solicitudes/:id` | `ventanilla`, `admin` (aislado por alcance) |
| PATCH | `/api/solicitudes/:id/documentos/:docId` | `ventanilla`, `admin` |
| POST | `/api/solicitudes/:id/documentos/:docId/archivo` | `ventanilla`, `admin` |
| GET | `/api/usuarios/:id/alcance` | `admin` |
| PUT | `/api/usuarios/:id/alcance` | `admin` |

**No existe `POST /api/beneficiarios` ni `DELETE /api/beneficiarios/:id`:** no hay
alta ni baja manual de beneficiarios; todo beneficiario nace de una importación de
padrón oficial revisada en staging **o de una Solicitud de Apoyo capturada en
ventanilla** (ver *Ventanilla: captura de Solicitudes de Apoyo*). Tampoco existe
`PATCH` ni `DELETE` sobre `/api/solicitudes/:id`: la solicitud no se edita.

Errores en formato `{"error":{"codigo":"...","mensaje":"..."}}`.

---

## Depuración de datos (staging)

Entre la importación del padrón y las tablas de producción hay una **capa de
staging revisable por humanos**. Ningún registro sucio o duplicado del archivo de
origen llega al capturista de campo sin que una persona lo apruebe.

### Rol `editor_datos` y usuario demo `editor1`

El rol **`editor_datos`** es un perfil de gabinete con acceso **exclusivo** a las
pantallas y endpoints de depuración y corrección. **No** tiene acceso a la
captura de campo (`/beneficiarios*`, `/sync`) ni al panel de auditoría
(`/auditoria*`): la API le responde **403** en ambos. El rol `admin` conserva
acceso a todo, staging incluido.

El usuario demo es **`editor1`** (contraseña desde `SEED_EDITOR_PASSWORD`, con
respaldo en `SEED_ADMIN_PASSWORD`). Como todos los usuarios demo, **cámbialo o
elimínalo antes de operar en producción**.

### El importador nunca escribe en producción

`npm run importar -- --tipo padron` escribe en **`staging_beneficiarios`** y
`--tipo catalogo` en **`staging_catalogos`**, siempre con
`estado_revision = 'pendiente'`. **Nunca** escribe directo en `beneficiarios` ni
en `catalogos`. El importador tampoco auto-fusiona ni auto-descarta nada: toda
promoción a producción es una acción humana explícita.

### Los 6 flags de diagnóstico

Cada fila de padrón importada se marca con los flags que le apliquen (puede tener
varios a la vez). **Ningún flag provoca una acción automática**, solo informan al
revisor:

| Flag | Significa | Nivel |
|---|---|---|
| `folio_duplicado` | El folio se repite en el staging pendiente o ya existe en `beneficiarios` | alta |
| `curp_duplicada_mismo_concepto` | Misma CURP y **mismo** concepto de apoyo: probable captura duplicada real | alta |
| `curp_duplicada_concepto_distinto` | Misma CURP con **otro** concepto: probablemente legítimo | media |
| `sin_coordenadas` | Falta la latitud/longitud del proyecto, o está fuera de rango | media |
| `sin_colonia` | La colonia viene vacía en el archivo de origen | media |
| `concepto_no_reconocido` | El concepto no coincide con ningún `tipos_apoyo` vigente | media |

`nivel_alerta` es `alta` si hay algún flag alto, `media` si hay algún otro y
`ninguna` si la fila está limpia.

### Regla de negocio: un beneficiario puede recibir apoyos distintos

Una misma persona puede calificar legítimamente para **dos o más apoyos
distintos** (por ejemplo maquinaria **y** semilla o fertilizante). Por eso
**ningún duplicado se auto-descarta**: misma CURP con concepto distinto se marca
solo como alerta *media* y pasa igualmente por revisión humana. La pantalla de
detalle muestra el aviso *"Un beneficiario puede recibir apoyos distintos.
Confirma antes de descartar."*

### Acciones de revisión (`/depuracion`)

- **Aprobar**: promueve la fila a `beneficiarios` (upsert por folio) y la marca
  `aprobado`, dejando `revisado_por`, `revisado_en` y el id promovido.
- **Descartar**: marca la fila `descartado`. **No** escribe nada en producción.
- **Fusionar**: marca las filas secundarias como `fusionado` apuntando a la
  principal (`fusionado_en_id`), recalcula sus alertas y opcionalmente promueve
  la principal. **La fusión no borra filas**: se preserva la trazabilidad
  completa hacia el archivo de origen.

Los catálogos (`/depuracion/catalogos`) solo admiten **aprobar** y **descartar**:
una clave duplicada se resuelve aprobando una y descartando la otra.

Toda acción queda en `auditoria_log` con `staging_aprobado`, `staging_descartado`
o `staging_fusionado`, y cada importación con `staging_import`.

### Catálogo real de conceptos

`db/seeds/004_tipos_apoyo_apoyo.sql` trae los **152 conceptos de apoyo** reales
(`AP-001` … `AP-152`) extraídos de la hoja `APOYO` del catálogo oficial. La hoja
`Copia de APOYO` **se descarta por completo**: es una versión divergente (173
conceptos, solo 9 en común) que no corresponde al catálogo vigente. El seed se
regenera con:

```bash
npm run extraer-catalogo -- --archivo "<ruta al XLSX>" --hoja APOYO \
  --salida db/seeds/004_tipos_apoyo_apoyo.sql
```

El XLSX de origen **no se copia ni se commitea** (contiene PII en otras hojas);
solo se commitea el SQL generado, que contiene únicamente nombres de conceptos.

---

## Corrección de datos en producción

Cuando en campo o gabinete se detecta un dato desactualizado de un beneficiario
**ya promovido**, un `editor_datos` o un `admin` lo corrige desde
`/correcciones` sin tocar el padrón de origen.

### Campos editables (lista blanca estricta)

Solo estos **5 campos** son editables por esta vía:

| Campo | Límite |
|---|---|
| `colonia` | 120 caracteres |
| `domicilio` | 200 caracteres |
| `telefono` | 10 dígitos tras normalizar (`+52`, espacios, guiones y paréntesis se descartan) |
| `seccion` | 20 caracteres |
| `municipio` (`municipio_id`) | debe existir y estar activo |

Cambiar el municipio actualiza **también** la Dirección Regional del
beneficiario, porque es un dato derivado (un municipio pertenece a una sola
Regional). `localidad`, `nombre_completo`, `tipo_apoyo_id`, `cantidad_asignada` y
`regional_id` **no** son editables aquí.

### CURP y Folio nunca son editables

**`curp` y `folio` están bloqueados de forma permanente.** Son la identidad legal
del expediente: cambiarlos rompería la trazabilidad de auditoría entre el archivo
de origen, el staging, el padrón y las evidencias de campo. Si están mal, el caso
se resuelve **corrigiendo el padrón de origen y reimportando vía staging**, nunca
editando en caliente.

El backend es **estricto y ruidoso**, no silencioso: si el payload incluye `curp`,
`folio` o cualquier otra clave fuera de la lista blanca, responde **422**
`campo_no_editable` y **no aplica ningún cambio del payload**, ni siquiera los
campos que sí eran válidos. En la PWA, CURP y Folio se muestran `readonly` y
`disabled` con su explicación.

### Roles autorizados y bitácora

Solo **`editor_datos`** y **`admin`** pueden editar (`PATCH
/api/beneficiarios/:id`). `capturista` y `auditor` reciben **403**; el capturista
conserva la lectura de la ficha y su botón "Capturar apoyo", pero **nunca** ve el
botón de edición (no se renderiza).

Cada edición se registra en `auditoria_log` con `accion='beneficiario_editado'`,
`entidad='beneficiario'` y el detalle **campo por campo con el valor anterior y el
nuevo**, más el motivo opcional y el rol de quien editó. El historial se ve en la
propia ficha ("Historial de correcciones"). La edición es **solo en línea**: no se
encola en la cola de sincronización.

**No hay alta manual de beneficiarios.** No existe `POST /api/beneficiarios`, ni
`DELETE /api/beneficiarios/:id`, ni ningún botón "Nuevo beneficiario" en la PWA:
todo beneficiario entra por importación de padrón oficial revisada en staging.

---

## Dashboard de seguimiento

`/dashboard` reúne cuatro métricas agregadas de gestión, calculadas en vivo con
agregaciones SQL (`COUNT` / `GROUP BY`). **No hay tablas de métricas
precalculadas.**

| Métrica | Qué muestra |
|---|---|
| **Cobertura de captura** | Beneficiarios con y sin evidencia, global, por Regional (barras apiladas) y por municipio (tabla ordenada por % ascendente, los más rezagados primero) |
| **Distribución por tipo de apoyo** | Top 15 conceptos con más capturas + una barra final "Otros (N conceptos)" |
| **Avance en el tiempo** | Capturas por día o por semana, con línea de acumulado; todos los periodos del rango aparecen aunque valgan 0 |
| **Estado del staging** | Dona con filas pendientes / aprobadas / descartadas / fusionadas, más el resumen de catálogos |

Filtros globales: Dirección Regional, rango de fechas y agrupación (día/semana).
Un usuario con Regional asignada queda anclado a la suya.

### Roles con acceso

Pueden verlo **`admin`**, **`auditor`** y **`editor_datos`**. El **`capturista` no
lo ve**: es información agregada de gestión, no de campo — el enlace no aparece en
su barra y navegar directo a `/dashboard` muestra "No tienes permiso para ver esta
sección."

### Chart.js es la única dependencia nueva

Las gráficas usan **Chart.js 4.x**, software **open source (licencia MIT), sin
costo y sin servicios externos**: se sirve entero desde el bundle de la PWA, no
hay llamadas a ningún CDN ni telemetría. Es la **única dependencia nueva** de este
build: no se añadió `react-chartjs-2`, `recharts`, `d3` ni ninguna otra librería
de gráficas. El registro de componentes es selectivo
(`pwa/src/componentes/chartSetup.ts`) y el envoltorio propio
(`pwa/src/componentes/Grafica.tsx`) crea y destruye cada instancia. Todas las
etiquetas, leyendas y tooltips están en español.

---

## Despliegue en Hostinger + EasyPanel + Cloudflare Tunnel

Guía completa en [`infra/easypanel/README.md`](infra/easypanel/README.md) y
ejemplo de túnel en [`infra/cloudflare/tunnel.ejemplo.yml`](infra/cloudflare/tunnel.ejemplo.yml).

Resumen:

1. **Hostinger**: contrata un VPS (2 vCPU / 4 GB mínimo) e instala **EasyPanel**
   (`curl -sSL https://get.easypanel.io | sh`).
2. **EasyPanel**: crea el proyecto `sedea` con tres servicios:
   - `db`: imagen `postgis/postgis:16-3.4` con volumen en `/var/lib/postgresql/data`.
   - `backend`: build con `backend/Dockerfile` (contexto = raíz) y **volumen
     persistente en `/app/media`** para las fotografías.
   - `pwa`: build con `pwa/Dockerfile`, puerto 80, dominio propio y **HTTPS de
     Let's Encrypt activado**.
3. **Cloudflare Tunnel**: instala `cloudflared` en el VPS, crea el túnel
   (`cloudflared tunnel create sedea-campo`), apunta el DNS
   (`cloudflared tunnel route dns sedea-campo campo.tu-dominio.mx`) y arráncalo
   con el `tunnel.ejemplo.yml` adaptado. Así **no expones ningún puerto** del VPS
   a internet: ni 3000, ni 5432, ni 8080.
4. Verifica `https://campo.tu-dominio.mx/api/health`.

> HTTPS no es opcional: la cámara y `navigator.geolocation` solo funcionan en
> contextos seguros, y una PWA solo es instalable bajo HTTPS.

---

## Protección de datos

El padrón contiene **datos personales** (nombre, CURP, domicilio, teléfono) y las
capturas contienen **fotografías y ubicación precisa** de personas beneficiarias.
Medidas implementadas y obligaciones operativas:

1. **HTTPS obligatorio de extremo a extremo.** El acceso público debe hacerse
   siempre por `https://`, ya sea con el certificado Let's Encrypt de EasyPanel o
   a través de Cloudflare Tunnel. La configuración de referencia
   (`infra/nginx/sedea.conf.ejemplo`) fuerza la redirección 301 de HTTP a HTTPS y
   agrega `Strict-Transport-Security`. Sin HTTPS la aplicación no debe operarse:
   además de exponer datos personales, el navegador bloquea cámara y GPS.
2. **Control de acceso por Dirección Regional.** El aislamiento se aplica en la
   **capa SQL del backend**, nunca en el frontend: toda consulta de beneficiarios
   y capturas añade el filtro `regional_id` derivado del JWT cuando el rol lo
   exige. Un `capturista` solo ve y solo puede capturar en su Regional; si pide
   `?regional_id=<otra>` el parámetro se ignora, y si solicita un beneficiario
   ajeno recibe **403**. El panel de auditoría está reservado a `auditor` y
   `admin`, y la bitácora completa solo a `admin`.
3. **Bitácora `auditoria_log`.** Toda acción sensible queda registrada con
   usuario, IP, user-agent y fecha: `login`, `login_fallido`, `sync_padron`,
   `captura_creada`, `captura_duplicada`, `export_csv`, `export_pdf` e
   `import_padron`. Es la evidencia de quién consultó, exportó o modificó
   información personal, y es consultable en `GET /api/auditoria/log`.
4. **Credenciales.** Contraseñas con bcrypt (coste 10); el hash nunca sale de la
   base. JWT HS256 de 12 h firmado con `JWT_SECRET` (el arranque falla si mide
   menos de 16 caracteres). No hay secretos en el código ni en el repositorio:
   `.env` está en `.gitignore` y `.env.example` solo trae marcadores `cambiame`.
   Limitación de intentos fallidos de login por IP y rate limit global.
5. **Fotografías con acceso autenticado.** `/media/*` exige token válido: las
   evidencias no son públicas aunque se conozca la URL. Se almacenan en un
   volumen persistente, fuera de la imagen del contenedor.
6. **Usuarios demo.** `admin`, `capturista1` y `auditor1` son solo para pruebas.
   **Cámbialos o elimínalos antes de producción** y define un
   `SEED_ADMIN_PASSWORD` propio.
7. **Minimización y respaldos.** Exporta expedientes solo cuando exista una
   justificación de auditoría; los archivos descargados (PDF/CSV) salen del
   control de la aplicación y quedan bajo responsabilidad de quien los descarga.
   Respalda base de datos y volumen de fotografías con cifrado en reposo y
   accesos restringidos.

---

## Estructura del repositorio

```
├── db/migrations/   Migraciones SQL numeradas (001 crea la extensión postgis)
├── db/seeds/        Datos demo (catálogos, usuarios, 30 beneficiarios) + catálogos de ventanilla
├── packages/shared/ Tipos y validadores Zod compartidos backend <-> PWA
├── backend/         API Fastify 4 + TypeScript
├── pwa/             React 18 + Vite 5 + vite-plugin-pwa + Dexie + Leaflet
├── scripts/         CLI de importación con mapeo configurable
└── infra/           EasyPanel, Cloudflare Tunnel y Nginx de referencia
```

## Decisiones técnicas

- **Node + TypeScript + Fastify** en el backend para compartir un único paquete
  de tipos y validadores Zod con la PWA (`@sedea/shared`). El riesgo principal del
  proyecto es la desalineación de contratos entre la cola de sincronización y el
  endpoint de upsert; compartir el esquema lo elimina de raíz.
- **PostGIS por SQL crudo** (`pg`), sin ORM: las consultas geoespaciales
  (`ST_SetSRID`, `ST_MakePoint`, `ST_AsGeoJSON`) quedan explícitas y auditables.
- **Fotos en filesystem** (`STORAGE_DRIVER=local`) sobre un volumen; en la base
  solo se guarda la ruta relativa y el hash SHA-256.
- **Sin Background Sync API** (soporte inconsistente en iOS): la sincronización se
  dispara por evento `online`, al abrir la app y con el botón manual.
- **Sin pre-caché de tiles** de mapa: el mapa solo se usa en el panel de
  auditoría, que requiere red.
