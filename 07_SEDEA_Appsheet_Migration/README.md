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

### Densidad de la interfaz (build 11)

En escritorio y tablet (`≥ 768 px`) la interfaz es compacta:

- Las **acciones de fila** de tablas y árboles (editar, desactivar/activar,
  reactivar, resetear contraseña, quitar concepto, aprobar/descartar, copiar
  contraseña) son **botones de ícono de 32×32 px**. No muestran texto, pero
  conservan su nombre accesible en `aria-label` + `title` + un `<span class="sr-solo">`,
  así que el lector de pantalla y el tooltip nativo siguen diciendo lo mismo que
  antes. En móvil (`< 768 px`) crecen a **44×44 px** para el objetivo táctil.
  Todos viven en `pwa/src/componentes/BotonIcono.tsx`, único dueño de la clase
  `.boton-icono`.
- La variante **peligro** es glifo rojo sobre fondo neutro (no botón rojo sólido),
  con contraste WCAG AA en ambos modos. Desactivar y activar además se distinguen
  por el ícono (ojo tachado vs. palomita), nunca solo por color.
- Los botones **"Nuevo X"** conservan su texto: un `+` a secas sería ambiguo en
  ventanilla. Solo bajan de 40 a 34 px de alto.
- Las filas de tabla pasan a `6px 10px` de padding y las pantallas de gestión
  (`.pantalla-ancha`) usan todo el ancho del viewport, sin techo de 1180/1440 px,
  para que ninguna columna quede truncada.
- Las columnas de texto largo (requisito, nombre completo, valor de catálogo)
  llevan `.celda-texto` y sí ajustan línea; el resto sigue en una sola línea.

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

## Administración de catálogos (`/catalogos`)

Accesible para los roles `admin` y `editor_datos`.

**Layout: pestañas por nivel.** La pantalla se organiza en tres pestañas
horizontales, cada una con su **tabla a todo el ancho** de la pantalla (ya no hay
un árbol angosto ni una columna de formulario fija al lado):

| Pestaña | Qué contiene |
|---|---|
| **Programas** | Programas y los subprogramas que cuelgan de ellos |
| **Componentes** | Componentes, sus modalidades y los proyectos que cuelgan de ambos |
| **Conceptos de apoyo** | `tipos_apoyo`, paginado de 20 en 20 con buscador en el servidor |

Cada pestaña lleva su **contador** al lado del nombre ("Programas · 2") y una
**barra de herramientas**: buscador por clave o nombre, los botones `+ Nuevo …`
de esa pestaña y el toggle **"Mostrar desactivados"**.

La tabla tiene cinco columnas: **Clave · Nombre · Jerarquía · Estado · Acciones**.
La jerarquía no se pinta con sangrías sino nombrando al padre en su propia
columna — `↳ PRG-2026` para un subprograma, `PET → MOD-PEPFO` para un proyecto
que cuelga de componente + modalidad, `—` para una raíz. En móvil la tabla se
convierte en tarjetas, como el resto de las tablas de la app.

El **formulario de alta/edición** se abre como **modal** y solo existe mientras
se está creando o editando un registro.

**Cómo se leen los botones.**

- *Altas:* la barra de cada pestaña lleva sus botones con el glifo `+` —
  `+ Nuevo programa`, `+ Nuevo subprograma` en Programas; `+ Nuevo componente`,
  `+ Nueva modalidad`, `+ Nuevo proyecto` en Componentes; `+ Nuevo concepto` en
  Conceptos de apoyo. Los `data-testid` (`btn-nuevo-<entidad>`) no cambian.
- *Acciones de fila:* siempre las mismas tres ranuras y en el mismo orden —
  **Editar** (lápiz) · **Duplicar** (dos hojas) · **Desactivar/Reactivar** (ojo
  tachado / palomita). Las filas que no admiten *Duplicar* dejan la ranura vacía,
  para que las tres columnas queden alineadas en toda la tabla. Al pasar el
  cursor (o al llegar con el teclado) cada ícono muestra **su nombre en un
  tooltip inmediato**, sin esperar al tooltip lento del navegador.

**Duplicar.** Las filas de **proyectos** y de **conceptos de apoyo** tienen un
botón *Duplicar* (`btn-duplicar-proyectos-<id>` / `btn-duplicar-tipos_apoyo-<id>`)
junto a *Editar* y *Desactivar*. Al pulsarlo se abre el formulario **en modo alta**
precargado con todos los datos del registro original salvo los campos únicos, que
quedan vacíos para que los captures:

- `clave` (siempre), y
- `prefijo_folio` (solo en proyectos).

El resto —nombre, componente, modalidad, categoría, unidad de medida— se copia como
punto de partida editable. Al guardar se crea un registro **nuevo e independiente**
con las validaciones normales de alta (clave repetida → error, sin crear nada); el
registro original nunca se modifica.

Caso de uso típico: das de alta el proyecto "Semilla de avena" completo, pulsas
*Duplicar*, cambias clave, prefijo y nombre, y queda "Semilla de garbanzo" colgando
del mismo componente y la misma modalidad.

> Los proyectos y las modalidades viven en la pestaña **Componentes**; los
> conceptos, en **Conceptos de apoyo**. Abre la pestaña antes de buscar la fila.

Es una función solo de front-end: no hay endpoint nuevo, usa el mismo `POST
/api/admin/catalogos/:entidad` del alta.

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
`editor1` puede tener contraseña propia con `SEED_EDITOR_PASSWORD` y los
usuarios de ventanilla con `SEED_VENTANILLA_PASSWORD`; si no se define,
reutilizan la de los demás.

| Usuario | Rol | Alcance |
|---|---|---|
| `admin` | admin | Todas las Regionales + bitácora |
| `capturista1` | capturista | Solo Regional Centro (`REG-01`) |
| `auditor1` | auditor | Todas las Regionales (sin regional asignada) |
| `editor1` | `editor_datos` | Depuración de staging y corrección de datos en producción (perfil de gabinete central, sin Regional asignada) |
| `ventanilla1` | `ventanilla` | Ventanilla de San Juan del Río (`REG-04`) con **alcance restringido**: 2 municipios y el componente `TR` |
| `ventanilla2` | `ventanilla` | Ventanilla SEDEA central, **sin restricción** (alcance "todos") |
| `vent.jalpan` | `ventanilla` | Ventanilla de Jalpan (`REG-02`) **sin alcance granular**: el recorte lo hace su Dirección Regional (solo captura en los 4 municipios de Jalpan) |
| `dict.test` | `dictaminador` | Sin Regional: cola de dictamen de todo el estado. No entra a `/solicitudes` |
| `vent.dict` | `ventanilla+dictaminador` | Multi-rol: captura en ventanilla **y** dictamina |

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

1. **Nuevo usuario** → nombre de acceso, nombre completo, rol y —si el rol es
   **Capturista**, **Ventanilla** o **Dictaminador**— su Dirección Regional.
   Los demás roles no llevan Regional.
   - En **Capturista** la Regional es obligatoria.
   - En **Ventanilla** la Regional decide en qué municipios puede capturar
     (secciones 2.2 y 4.1 de Nueva Solicitud): una ventanilla de Jalpan solo ve
     los 4 municipios de Jalpan, no los 18 del estado. La **única** excepción es
     la ventanilla central de SEDEA (`VEN-SED`), que atiende todo el estado y se
     da de alta con la opción explícita **“SEDEA Central (todo el estado)”**
     (equivale a dejar la Regional en blanco).
   - En **Dictaminador** la Regional recorta su **bandeja de dictamen**: un
     dictaminador de Jalpan solo ve, abre y dictamina solicitudes de Jalpan.
     Dejarla en **“SEDEA Central (todo el estado)”** (Regional en blanco) le
     devuelve la cola completa de las cuatro Regionales.
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

### Alta en lote con plantilla CSV

Para dar de alta a mucha gente de una vez (por ejemplo, todas las ventanillas de
una Regional al arrancar un programa) la pantalla `/usuarios` tiene abajo la
sección **Carga masiva**, con el mismo criterio de acceso que el alta individual
(`admin` y `editor_datos`).

1. **Descargar plantilla CSV** — baja un archivo con estas seis columnas y una
   fila de ejemplo comentada con `#` (se ignora al subirla, así que no hace falta
   borrarla para que funcione):

   | Columna | Obligatoria | Qué lleva |
   |---|---|---|
   | `usuario` | Sí | Nombre de acceso, único. Minúsculas, números, punto, guion y guion bajo. |
   | `nombre_completo` | Sí | Entre 3 y 120 caracteres. |
   | `rol` | Sí | Un rol, o varios unidos con `+` (ej. `capturista+ventanilla`). |
   | `regional_clave` | Según el rol | Clave de la Dirección Regional (`REG-01` … `REG-04`). Obligatoria si el rol incluye `capturista`; opcional en `ventanilla` y `dictaminador` (vacía = SEDEA Central, todo el estado); debe ir **vacía** en cualquier otro rol. |
   | `alcance_municipios` | No | Claves de municipio separadas por `;` (ej. `22004;22005`). Solo para `ventanilla`. Vacío = todos los de su Regional. |
   | `alcance_componentes` | No | Claves de componente separadas por `;` (ej. `DIN`). Solo para `ventanilla`. Vacío = todos. |

2. **Subir el archivo** — se procesa **fila por fila, cada una independiente**:
   que una traiga un error no impide que las demás se creen. Cada fila se valida
   con **exactamente las mismas reglas del alta uno por uno** (es el mismo código:
   un CSV no puede colar un usuario que el formulario habría rechazado), y los
   motivos de error son literalmente los mismos textos.

3. **Tabla de resultados** — una fila por cada línea del archivo, con el número de
   línea tal como se ve en Excel, el chip **Creado** o **Error**, y el motivo
   exacto cuando falla (`Ya existe un usuario con ese nombre de acceso.`,
   `Los capturistas deben tener una Dirección Regional asignada.`, etc.).

4. **Descargar contraseñas de los creados** — un CSV con `usuario,password_temporal`
   de **solo los creados en esa corrida**. Rige el mismo principio que el modal
   del alta individual: **esa descarga es la única oportunidad de obtener esas
   contraseñas**. No se guardan en claro en ninguna parte, no quedan en la
   bitácora y al recargar la pantalla se pierden. Si se pierde una, se resuelve
   con **Resetear contraseña** de esa cuenta.

Los usuarios creados por lote quedan con contraseña temporal automática de 14
caracteres y **cambio obligatorio en el primer acceso**, igual que el alta
individual.

#### Contraseña temporal común para todo el lote

Cuando un grupo entra el mismo día conviene que todos reciban la **misma**
temporal, para poder dictarla una sola vez. En la sección *Carga masiva* se marca
**Usar una contraseña común para todo el lote** y se escribe en el campo que
aparece: esa contraseña se aplica a **todas** las filas del CSV en vez de generar
una aleatoria distinta por fila.

- Debe cumplir la **misma política** que la contraseña escrita a mano en el alta
  individual (mínimo 10 caracteres, con al menos una letra y un número). Si no la
  cumple, el endpoint **rechaza el lote completo antes de crear nada**: no quedan
  usuarios a medias.
- El **cambio obligatorio en el primer acceso sigue vigente** (`debe_cambiar_password`).
- La descarga *Descargar contraseñas de los creados* funciona igual; simplemente
  repite la misma contraseña en cada fila.
- **Sin marcar la casilla no cambia nada**: cada fila sigue recibiendo su
  temporal aleatoria de 14 caracteres, que es el comportamiento por defecto.

Para scripts, el mismo campo va como `password_comun` en el `multipart/form-data`
(o en el JSON `{ "csv": "...", "password_comun": "..." }`) de
`POST /api/usuarios/lote`.

Dos límites que la carga masiva **no** relaja, porque son los mismos de las altas
individuales:

- Un `editor_datos` no puede crear cuentas `admin` desde el CSV
  (`rol_no_asignable`).
- Las columnas de alcance solo las puede usar un `admin` y solo sobre el rol
  `ventanilla` puro, que es la misma regla del endpoint que administra el alcance.

### Reseteo de contraseña en lote (usuarios que ya existen)

La *Carga masiva* de arriba solo sirve para **altas nuevas**. Para el caso
contrario —usuarios que **ya están dados de alta**, cada uno con su temporal
aleatoria, y que se quiere dejar a todos con la **misma** contraseña para
facilitar el primer ingreso— se usa la selección de la tabla de `/usuarios`:

1. Marca la casilla de cada usuario que quieras resetear (o la del encabezado
   para seleccionarlos todos). Los usuarios en la papelera no son seleccionables.
2. Aparece una barra con **Resetear contraseña de N usuarios seleccionados**.
3. En el modal escribe la contraseña común y confirma.

Reglas, que son **las mismas del reseteo individual**, no unas nuevas:

- Misma política de contraseña (mínimo 10 caracteres, con al menos una letra y un
  número). Si no la cumple, se **rechaza el lote completo sin resetear a nadie**.
- Todos los reseteados quedan con **cambio obligatorio en el primer acceso**
  (`debe_cambiar_password`).
- Cada usuario es **independiente**: si el actor no puede administrar ese rol
  (por ejemplo un `editor_datos` que selecciona a un `admin`), **esa fila** queda
  en error con `rol_no_asignable` y **las demás sí se resetean**. El resultado se
  muestra usuario por usuario con el motivo de cada fallo.
- Se registra una entrada `usuario_password_reset` en la bitácora por cada
  usuario reseteado, **sin la contraseña** ni en claro ni hasheada.
- La contraseña común se muestra en claro una sola vez en pantalla (es una sola
  para todos, y hay que poder dictarla); no hay CSV de descarga porque no hace
  falta.

Para scripts: `POST /api/usuarios/reset-password-lote` con
`{ "ids": [1,2,3], "modo_password": "manual", "password_manual": "..." }`. Con
`"modo_password": "automatica"` (o sin el campo) cada usuario recibe su propia
temporal aleatoria y viene en `password_temporal` de su fila del resultado.
Siempre responde 200 con el detalle por id; el único 4xx es el de la contraseña
manual inválida, que se juzga antes de tocar nada.

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

## Reiniciar datos de prueba

> **IRREVERSIBLE.** Borra para siempre todo lo capturado. No hay papelera, no es
> un borrado lógico y no se puede deshacer. Está pensado para una sola cosa:
> dejar la base limpia después de las pruebas, justo antes de arrancar con los
> datos reales. Si no tienes respaldo, no lo corras.

**Qué borra** (12 tablas, todo lo capturado):

`dictamenes`, `predictamenes_ia`, `solicitud_documentos`, `solicitud_conceptos`,
`solicitudes`, `capturas`, `staging_beneficiarios`, `staging_catalogos`,
`importaciones`, `beneficiarios`, `sesiones_escaneo_curp`, `solicitud_folios`.

**Qué NO toca** (el catálogo del sistema queda intacto):

`usuarios`, `direcciones_regionales`, `municipios`, `componentes`, `programas`,
`subprogramas`, `modalidades`, `proyectos`, `tipos_apoyo`,
`documentos_requeridos`, `ventanillas`, `catalogos`, `configuracion_plazos` y
`auditoria_log` (la bitácora se conserva: ahí queda el rastro del reinicio).

Vaciar `solicitud_folios` reinicia el contador de consecutivos, así que la
siguiente solicitud real vuelve a generar el folio `-0001-` para cada
combinación proyecto/regional/municipio/año.

### Vía 1 — Botón en la app (solo `admin`)

*Usuarios* → al final de la pantalla, la **Zona de peligro** → **Reiniciar datos
de prueba**. El modal exige teclear la frase exacta `BORRAR TODOS LOS DATOS`
(en mayúsculas) para habilitar el botón de confirmar. Al terminar muestra
cuántas filas se borraron de cada tabla.

La sección solo aparece para rol `admin`; `editor_datos` administra usuarios
pero no puede ejecutar esta operación. El backend no confía en el frontend:
`POST /api/admin/reiniciar-datos-prueba` exige rol `admin` estricto y que el
body repita la frase (`{"confirmacion":"BORRAR TODOS LOS DATOS"}`), o responde
403 / 422 sin borrar nada.

### Vía 2 — Script SQL manual (sin esperar el deploy)

```bash
docker compose exec -T db psql -U sedea -d sedea -v ON_ERROR_STOP=1 \
  < scripts/reiniciar_datos_prueba.sql
```

Hace exactamente lo mismo, en el mismo orden, e imprime al final los conteos de
verificación (las 12 tablas en 0 y el catálogo intacto). Es idempotente:
correrlo dos veces deja el mismo estado.

El `.sql` es un **archivo generado** desde `packages/shared/src/reinicio.ts`, la
misma fuente que usa el endpoint, para que el script manual y el botón no se
puedan desincronizar. Si se agrega una tabla de datos capturados al esquema, se
agrega ahí y se regenera:

```bash
npm run generar-sql-reinicio -w backend
```

### Paso 3 (MANUAL Y APARTE) — limpiar los archivos de `/media`

Ni el botón ni el script borran los archivos físicos. Tras el TRUNCATE, las
fotos de evidencia y los documentos escaneados quedan huérfanos en el volumen
`media` (montado en `/app/media` del contenedor `backend`, ver
`MEDIA_DIR` en `docker-compose.yml`).

Esto es deliberado: exponer un `rm -rf` sobre un contenedor de producción detrás
de un endpoint HTTP es un riesgo que no vale la pena para algo que se hace una
sola vez. Se limpia a mano:

```bash
# 1. Revisar QUÉ se va a borrar antes de borrar nada.
docker compose exec backend sh -c 'du -sh /app/media/* 2>/dev/null; find /app/media -type f | wc -l'

# 2. Borrar el contenido, conservando el directorio raíz /app/media
#    (el backend lo necesita montado para poder seguir escribiendo).
docker compose exec backend sh -c 'find /app/media -mindepth 1 -delete'

# 3. Verificar que quedó vacío.
docker compose exec backend sh -c 'find /app/media -mindepth 1 | wc -l'   # -> 0
```

Estructura que se limpia: `/app/media/AAAA/MM/` (fotos de capturas de campo) y
`/app/media/solicitudes/AAAA/MM/` (documentos de las solicitudes de ventanilla).

Si el despliegue no usa `docker compose` sino EasyPanel u otro orquestador,
sustituye `docker compose exec backend` por `docker exec <nombre-del-contenedor>`
y usa el mismo `find ... -mindepth 1 -delete`.

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

- Al guardar una solicitud, el componente y la ventanilla deben estar dentro del
  alcance y el municipio de la *ubicación del apoyo* debe pertenecer a la
  Regional del usuario; si no, la API responde **403**
  (`municipio_fuera_de_alcance`, `componente_fuera_de_alcance`,
  `ventanilla_fuera_de_alcance`).
- El listado filtra **en SQL**: un usuario de ventanilla solo ve las solicitudes
  de su alcance granular.

> **El alcance granular no restringe la captura de municipios.** Los dos
> desplegables de municipio de *Nueva solicitud* —el domicilio del solicitante
> (2.2) y la ubicación del predio o proyecto (4.1)— ofrecen **todos los
> municipios de la Regional del usuario**, no solo los de su alcance granular
> (`usuario_municipios`). Un capturista de una ventanilla atiende a productores
> de toda su Regional, y tanto el domicilio como el predio pueden caer en
> cualquiera de sus municipios. La API valida en el alta que el municipio del
> predio sea de la Regional del usuario: un municipio de otra Regional sigue
> devolviendo 403. La respuesta de `GET /api/solicitudes/catalogos` trae las dos
> listas por separado: `municipios_captura` (los de la Regional, para el
> formulario de alta) y `municipios` (recortada al alcance granular, para los
> filtros y las vistas de consulta).

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

### Acuse en PDF: réplica del formato oficial en papel

Desde el detalle de una solicitud (`/solicitudes/:id`) hay **dos documentos
distintos y complementarios**, cada uno con su botón:

| Botón | Documento | Para qué |
|---|---|---|
| *Imprimir Folio de Entrega* | Folio Carta **horizontal**, 2 páginas, con QR | Entrega del apoyo **ya aprobado** |
| *Solicitud de Apoyo (PDF)* | Réplica de 3 páginas del formato oficial | Acuse/expediente **desde la captura** |

El segundo se sirve en:

```
GET /api/solicitudes/:id/solicitud-completa.pdf
```

Reproduce fielmente el formato en papel del Programa Institucional Apoyo al
Campo Queretano: secciones 1 a 7, comprobante del beneficiario y el texto legal
**copiado del original sin parafrasear**. La única corrección aplicada es el
**espacio faltante** en las concatenaciones del formato en papel
("comercialesilícitas" → "comerciales ilícitas", "deQuerétaro" → "de
Querétaro", "deDatos" → "de Datos", etc.); no se cambia ninguna palabra. Se
genera server-side con PDFKit
(`backend/src/servicios/solicitud-completa.ts`), igual que el folio de entrega.

Dos cosas salen resueltas donde el papel las dejaba en blanco, porque el sistema
sí las conoce: en el **comprobante del beneficiario**, el funcionario receptor
(el usuario de ventanilla que capturó) y la fecha de recepción.

Las **líneas de firma** (solicitante y funcionario receptor) cierran la
**página 2**, justo después de las declaraciones de la sección 6. La **página
3** arranca directamente con "DATOS PARA LLENAR POR EL ÁREA OPERATIVA DE LA
SEDEA".

La **sección 7 (dictamen)** y las firmas van en blanco para llenarse a mano,
salvo que la solicitud ya tenga un dictamen humano registrado (tabla
`dictamenes`): entonces se imprime el resultado positiva/negativa, los conceptos,
la nota y el nombre del dictaminador.

Los componentes y las ventanillas del formato **se leen del catálogo en vivo**:
al dar de alta un componente nuevo aparece solo, sin tocar el código.

Campos del formato viejo que salen **en blanco** porque hoy no se capturan en
`solicitudes`: **Número exterior** y **Número interior** del domicilio (el modelo
guarda un solo campo libre `dom_vialidad`, "Nombre de la vialidad y número").

Descarga directa con curl:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"usuario":"ventanilla2","password":"cambiame123"}' | jq -r .token)

curl -s -o solicitud.pdf \
  -H "authorization: Bearer $TOKEN" \
  http://localhost:3000/api/solicitudes/4/solicitud-completa.pdf
```

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

El desplegable de municipio tampoco es el mismo en las dos: el de 2.2 lista
**todos los municipios de la Regional** del usuario y el de 4.1 solo los de su
alcance asignado (ver *Alcance por municipios y componentes*).

### Escaneo del QR de la Constancia CURP (sección 2.1)

En *Datos del solicitante* hay un botón **Escanear CURP** que abre la cámara del
dispositivo (la trasera en celular, la webcam en escritorio) y lee el código QR
de la Constancia CURP. Con un escaneo válido se llenan cuatro campos: CURP,
nombre del solicitante, sexo y fecha de nacimiento. Todo lo demás se sigue
capturando a mano.

- La decodificación es 100 % en el navegador (`jsqr`): la imagen no sale del
  dispositivo ni se guarda.
- El QR trae los campos separados por `|`:
  `CURP|CURP_anterior|paterno|materno|nombre(s)|sexo|DD/MM/AAAA|entidad|código|`.
  La CURP anterior y el código INEGI de la entidad se ignoran.
- Si el QR no es el de una Constancia CURP, sale el aviso *"No se pudo leer el
  CURP, intenta de nuevo o captura los datos manualmente"* y el formulario
  queda intacto. Lo mismo si el navegador no tiene cámara o el usuario niega el
  permiso: la captura manual nunca se bloquea.
- Fuera de alcance: lectores USB que emulan teclado. Solo cámara.
- El navegador solo entrega la cámara en contexto seguro: `https://` o
  `localhost`. Servida por `http://` en una IP de la red, el botón mostrará el
  aviso de cámara no disponible.
- Código: `packages/shared/src/curpQr.ts` (parseo, compartido con el backend) y
  `pwa/src/componentes/EscanerCurpQr.tsx` (modal de cámara). Pruebas:
  `npx playwright test test-curp-qr.spec.ts` (con el stack arriba).

### Escanear con el celular cuando la computadora no tiene cámara

El equipo de ventanilla suele ser un escritorio sin cámara utilizable, y por la
restricción de contexto seguro de arriba el botón *Escanear CURP* tampoco sirve
si la PWA se sirve por `http://` en una IP de la red. Para eso está el segundo
botón, **Escanear con el celular**:

1. El capturista lo pulsa y la pantalla muestra un código QR de vinculación.
2. Lo escanea con la cámara de su celular, que abre `/escaneo-movil/:token`.
3. En el celular escanea la Constancia CURP.
4. Los cuatro campos aparecen solos en el formulario de la computadora, con el
   mismo aviso de revisión que el escaneo directo.

Cómo está resuelto, y por qué:

- El celular **no inicia sesión**. La pantalla `/escaneo-movil/:token` vive
  fuera del cascarón y de `RutaProtegida` a propósito: se abre en un teléfono
  donde nadie se autenticó. El token de la URL es la única credencial y lo
  único que habilita es entregar un escaneo.
- Por eso el token es de 24 bytes aleatorios, vive **10 minutos** y es de **un
  solo uso**. Un token inexistente y uno ajeno responden ambos 404, para que no
  se pueda distinguir uno del otro sondeando.
- El celular manda el **texto crudo** del QR, no los campos ya parseados: así el
  criterio de validez vive en un solo lugar (`@sedea/shared`) y el teléfono no
  puede inventar una CURP que el parser habría rechazado.
- La sesión es un buzón efímero entre dos navegadores: **no escribe nada en
  `solicitudes`**. Los datos llegan al expediente por la vía de siempre, cuando
  el capturista los revisa y envía el formulario.
- El QR de vinculación se genera en el navegador (`qrcode`); el token no pasa
  por ningún servicio externo.
- El celular tiene que alcanzar el mismo servidor que ve la computadora: el QR
  codifica el origen actual, así que en la red de la oficina eso es una IP o un
  host local, y el teléfono debe estar en esa misma red.
- Código: `backend/src/rutas/escaneoCurp.ts` (3 endpoints),
  `pwa/src/componentes/VincularCelular.tsx` (modal del escritorio),
  `pwa/src/pantallas/EscaneoMovil.tsx` (pantalla del celular) y la migración
  `db/migrations/019_sesiones_escaneo_curp.sql`. Pruebas:
  `npx playwright test test-escaneo-movil.spec.ts` (con el stack arriba).

### Todo el texto libre se guarda en MAYÚSCULAS

Los campos de texto libre del formulario se homologan a mayúsculas **mientras
se escriben**: lo que el capturista ve en pantalla es exactamente lo que se
guarda. Aplica al nombre del solicitante, razón social, localidad, delegación,
asentamiento y vialidad del domicilio, CURP, cultivo principal, tipo de ganado,
especies acuícolas y de pesca, descripción del proyecto, localidad y ejido del
predio, y observaciones.

Quedan **fuera a propósito**: el correo electrónico (los correos van en
minúsculas), el teléfono, el código postal, las coordenadas y todo campo
numérico o de catálogo. El helper vive en
`pwa/src/componentes/campoMayusculas.ts`.

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
| **Folio de entrega con QR** | `/solicitudes/:id/folio` genera la hoja de entrega con el QR del folio. También se imprime con `window.print()`. Sale en **Carta horizontal** y **dos páginas**: la 1 lleva beneficiario, apoyo y QR en tres columnas; la 2, solo el folio en letra gigante para separar expedientes en la mesa de entrega. El apoyo se documenta en **cantidad + unidad de medida** (todos los conceptos de la solicitud), **no** en dinero: el folio se firma al recibir costales u obra, y el monto solo confundía en ventanilla. |

### Reglas de impresión compartidas

`pwa/src/styles/impresion.css` (importado desde `global.css`) contiene el bloque
`@media print` común a **todas** las pantallas imprimibles: `@page A4` con margen
de 12 mm, ocultado del chrome de la app (franja de estado, barra lateral, barra
inferior, hoja "Más", banners y zonas de arrastre) y aplanado de la rejilla del
cascarón a bloques.

Ese aplanado es obligatorio: el cascarón es un `display: grid` con una columna
fija para la barra lateral y `height: 100dvh`. Si no se neutraliza, el documento
sale desplazado a la derecha y recortado fuera del área imprimible, y la barra
lateral se dibuja dentro del PDF. Cada pantalla imprimible agrega en su propio
bloque `@media print` únicamente lo específico de su documento.

**Cómo una pantalla usa un tamaño de hoja distinto.** `@page` no se puede acotar
con un selector: es global a la hoja de estilos. El folio de entrega necesita
Carta horizontal mientras la carátula de expediente sigue en A4 vertical, así que
su `@page { size: letter landscape }` vive en el `<style>` que renderiza el propio
`FolioEntrega.tsx`. Ese `<style>` **solo existe en el DOM mientras esa ruta está
montada**, y va después de `impresion.css` en la cascada: gana en el folio y
desaparece al salir de la pantalla. Si se necesita otro tamaño en una pantalla
nueva, seguir ese patrón —**no** cambiar el `@page` compartido—.


---

## Pre-dictaminación con IA y dictamen (`/dictamen`)

Rol nuevo **`dictaminador`** (combinable con `+`, p. ej. `ventanilla+dictaminador`).

**Aislamiento por Dirección Regional.** La cola de dictamen **no es compartida**:
un dictaminador con Regional asignada ve, abre y dictamina únicamente las
solicitudes de su Regional —bandeja, métricas de la cabecera, detalle,
pre-dictaminación en lote y confirmación—. El criterio es el mismo que ya usan
ventanilla y capturista: manda el **municipio de ubicación del predio**. Una
solicitud de otra Regional responde **404** aunque se pida por URL directa, así
que ocultarla de la lista no es lo único que la protege. Un dictaminador de
**SEDEA Central** (Regional en blanco) y el `admin` siguen viendo todo el estado.

**Qué hace.** La IA lee **los archivos que ventanilla ya adjuntó documento por
documento** (el checklist de la solicitud, endpoint E46 de siempre) y emite un
**pre-dictamen** por solicitud: `positivo`, `negativo` o `error`. La cola de
`/dictamen` se ordena sola para que el humano revise **primero los negativos**:

    negativo → error → sin pre-dictamen → positivo

Dentro de cada grupo, la solicitud más vieja va primero.

**La IA nunca dictamina sola.** Todo pre-dictamen —positivo o negativo— exige
que una persona con rol `dictaminador` o `admin` elija un resultado explícito y
pulse *Confirmar dictamen*. No existe ningún botón que acepte la sugerencia de la
IA, ni ningún camino de código que copie el veredicto de la IA al dictamen humano.
Regenerar un pre-dictamen o re-dictaminar **inserta una fila nueva**: el historial
es append-only y nada se sobrescribe.

**Qué valida (fase 1).** Por cada documento del checklist: si está presente, si es
legible y —cuando la CURP es visible— si coincide con la capturada. Nada más: no
evalúa vigencias, montos ni superficies.

**Disparo manual y en lote.** Se seleccionan solicitudes con las casillas de la
bandeja (máximo **20** por lote) y se pulsa *Pre-dictaminar*. Nunca se dispara solo
al adjuntar un documento, porque cada corrida cuesta llamadas al modelo.

### Driver de IA

| Variable | Default | Uso |
|---|---|---|
| `PREDICTAMEN_DRIVER` | `simulado` | `simulado`, `anthropic` u `openai_compatible` |
| `ANTHROPIC_API_KEY` | *(vacío)* | Solo con driver `anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Modelo con visión |
| `PREDICTAMEN_API_BASE_URL` | *(vacío)* | Solo con driver `openai_compatible` |
| `PREDICTAMEN_API_KEY` | *(vacío)* | Solo con driver `openai_compatible` |
| `PREDICTAMEN_MODEL` | *(vacío)* | Solo con driver `openai_compatible` |

Los tres drivers cumplen la **misma interfaz** y son intercambiables: cambiar de
uno a otro es cambiar variables de entorno, no código. Ni el servicio de
pre-dictamen, ni los endpoints, ni las pantallas cambian.

El default es **`simulado`**: no toca la red, es determinista y permite instalar,
probar y correr los tests sin llave de API y sin gastar. Producción se configura
explícitamente con un driver real y las llaves en el `.env` **del servidor**
(nunca en git). Con un driver real y sin sus credenciales el arranque **no**
falla: el endpoint de pre-dictaminación responde `503 ia_no_configurada`
(`anthropic` sin `ANTHROPIC_API_KEY`; `openai_compatible` sin
`PREDICTAMEN_API_KEY` o sin `PREDICTAMEN_API_BASE_URL`).

#### Driver `openai_compatible` (Qwen, OpenAI y otros)

Habla el protocolo de **Chat Completions estilo OpenAI** con bloques de imagen
(`image_url` con data URI) por HTTP directo, sin SDK. Sirve para cualquier
proveedor que exponga esa API: **Qwen (Alibaba)** vía DashScope *compatible-mode*,
OpenAI, OpenRouter, Together, Fireworks.

Ejemplo **Qwen-VL vía DashScope**:

```bash
PREDICTAMEN_DRIVER=openai_compatible
PREDICTAMEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PREDICTAMEN_API_KEY=sk-...          # llave de DashScope
PREDICTAMEN_MODEL=qwen-vl-max
```

El **mismo driver** sirve para OpenAI/ChatGPT cambiando solo esas variables
(`PREDICTAMEN_API_BASE_URL=https://api.openai.com/v1`, `PREDICTAMEN_MODEL=gpt-4o`).

Nota sobre PDF: las imágenes (JPG/PNG/WEBP) viajan como `image_url`; los PDF
viajan como bloque `file` con `file_data`, formato que **no todos los proveedores
soportan** — Qwen-VL solo acepta imágenes, así que con ese proveedor los adjuntos
deben escanearse como imagen.

La llamada HTTP está verificada con un stub (sin gastar API):

```bash
npx tsx scripts/prueba-driver-openai.ts
```

La integración contra un endpoint **vivo** de Qwen queda pendiente de que alguien
configure una llave real de DashScope y la pruebe manualmente.

Con el driver real hay **una llamada por documento adjuntado**; los documentos sin
archivo no cuestan nada (se resuelven en el servidor).

### Datos de prueba

```bash
# Con el stack arriba: crea/actualiza 3 solicitudes de fixture (idempotente).
API_URL=http://localhost:3000 npx tsx scripts/fixture-dictamen.ts
```

Deja una solicitud con todos sus documentos correctos, otra con exactamente un
documento ilegible y una tercera sin ningún archivo adjunto.

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
| GET | `/api/solicitudes/:id/folio-entrega.pdf` | autenticado (PDF A4 con QR del folio) |
| GET | `/api/solicitudes/:id/solicitud-completa.pdf` | `ventanilla`, `capturista`, `admin` (aislado por alcance) |
| PATCH | `/api/solicitudes/:id/documentos/:docId` | `ventanilla`, `admin` |
| POST | `/api/solicitudes/:id/documentos/:docId/archivo` | `ventanilla`, `admin` |
| GET | `/api/usuarios/:id/alcance` | `admin` |
| POST | `/api/dictamen/predictaminar` | `dictaminador`, `admin` |
| GET | `/api/dictamen/bandeja` | `dictaminador`, `admin` |
| GET | `/api/dictamen/metricas` | `dictaminador`, `admin` |
| GET | `/api/dictamen/:solicitudId` | `dictaminador`, `admin` |
| POST | `/api/dictamen/:solicitudId/confirmar` | `dictaminador`, `admin` |
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
