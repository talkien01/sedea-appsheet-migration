# Digitalización V1 — diseño funcional aprobado

## Objetivo

Convertir expedientes físicos en expedientes electrónicos de SISPACQ con un flujo masivo, trazable y simple. La asociación de cada expediente con su Solicitud se realiza de forma determinista mediante una carátula QR; la IA no participa en esa asociación.

## Flujo mínimo obligatorio

1. Seleccionar solicitudes por Regional, Municipio, filtros o selección manual.
2. Crear un lote definido por el usuario.
3. Generar un único PDF multipágina de carátulas QR.
4. Imprimir y colocar una carátula como primera hoja de cada expediente físico.
5. Escanear varios expedientes juntos con ADF dúplex.
6. Cargar el PDF del lote a SISPACQ.
7. Detectar las carátulas QR y separar automáticamente los expedientes.
8. Revisar únicamente incidencias.
9. Confirmar y crear el expediente electrónico por Solicitud.

La revisión con celular es opcional y nunca bloquea la digitalización.

## Lotes de preparación

Los lotes pueden construirse por:

- Regional.
- Municipio.
- Búsqueda/filtros.
- Selección manual.
- Cantidades rápidas: 10, 20, 30, 50, 100 y 200.
- Todas las solicitudes filtradas.

El usuario define un nombre operativo. SISPACQ asigna además un código técnico único.

Regional y Municipio son filtros de preparación; la autoridad territorial se valida nuevamente en backend usando el municipio de ubicación del predio (`solicitudes.ubi_municipio_id`).

## Carátula QR

- Tamaño carta vertical.
- Composición completamente centrada horizontalmente.
- QR central grande; objetivo inicial 10 × 10 cm, sujeto a prueba física con impresora y celulares reales.
- Alto contraste negro sobre blanco y zona libre alrededor del código.
- Datos visibles centrados: folio, beneficiario, municipio, Regional y lote.
- Leyenda inferior: la carátula debe permanecer como primera hoja del expediente.
- El QR no contiene CURP, nombre, municipio ni otra PII; únicamente un token/identificador seguro.
- El QR es persistente para el expediente principal y puede reutilizarse en reimpresiones.
- Los complementos tendrán identificadores independientes asociados a la misma Solicitud.

Funciones del QR: identificar, preparar, separar durante el escaneo y consultar posteriormente el expediente electrónico.

## Permisos V1

Operación normal de Digitalización:

- `ventanilla`
- `capturista`
- `editor_datos`
- `admin`

Consulta posterior del expediente digital también podrá habilitarse para `dictaminador` y `auditor` cuando exista el visor.

Las correcciones sensibles (reasociación, corrección de asociación equivocada, anulación) quedarán reservadas para `editor_datos` y `admin`.

El QR identifica un expediente pero nunca concede permisos. Todas las operaciones vuelven a validar rol y alcance territorial en backend.

## Revisión móvil opcional

La PWA podrá abrir la cámara y leer la carátula QR para mostrar el checklist físico de la Solicitud.

Propósito:

- Confirmar que el expediente corresponde al productor correcto.
- Verificar presencia de documentos.
- Ayudar a mantener un orden físico sugerido.
- Registrar faltantes y observaciones.

No es requisito para escanear ni digitalizar. Un expediente puede digitalizarse aunque la revisión móvil no se haya realizado o tenga faltantes; los faltantes se podrán completar después mediante complementos.

## Principios de integridad

- El PDF original del lote de escáner se conserva inmutable.
- Los expedientes derivados y complementos son versionados; no se sobrescriben silenciosamente.
- Se calcula SHA-256 para integridad y detección de duplicados.
- Un lote con incidencias no debe impedir confirmar los segmentos válidos, siempre con confirmación explícita.
- No se depende de IA para subir, asociar o separar expedientes.

## IA / pre-dictamen

OpenAI entra después de que el expediente haya sido asociado y confirmado. El análisis será asíncrono y no formará parte de la petición de carga del PDF.

La IA podrá posteriormente clasificar páginas, extraer campos, comparar contra la Solicitud y producir un pre-dictamen estructurado. El dictamen humano continúa siendo la decisión oficial.

## Fases de desarrollo

### Fase 1 — Base y lotes de preparación

- Modelo de datos aditivo.
- Selección de solicitudes.
- Creación/listado/detalle de lotes.
- Roles y aislamiento territorial.
- Identidad QR persistente preparada.

### Fase 2 — Carátulas QR

- Generación/reutilización de token del expediente principal.
- PDF carta multipágina.
- Generación masiva 10/20/30/50/100/200/todas/selección manual.
- Reimpresión segura.
- Estado `caratula_generada`.

### Fase 3 — PWA de preparación

- Menú Digitalización.
- Filtros por Regional/Municipio/estado.
- Crear y consultar lote.
- Generar/descargar carátulas.
- Seguimiento de preparación.

### Fase 4 — Carga masiva de PDF

- Endpoint específico de carga por streaming.
- SHA-256, tamaño, páginas y almacenamiento durable.
- Sin depender del límite general de adjuntos pequeños.

### Fase 5 — Separación QR e incidencias

- Detección de separadores.
- Segmentos por Solicitud.
- Duplicados, QR inválidos, páginas sin QR y demás incidencias.
- Confirmación explícita antes de crear expedientes oficiales.

### Fase 6 — Expediente electrónico y visor

- Expediente inicial y complementos versionados.
- Visor autenticado sin JWT en query string.
- Historial y trazabilidad.

### Fase 7 — Modo móvil opcional

- Cámara QR.
- Checklist físico.
- Completo/incompleto/observaciones.
- Flujo rápido para revisar el siguiente expediente.

### Fase 8 — IA documental

- Cola asíncrona.
- Clasificación de páginas y Structured Outputs.
- Extracción y comparación contra Solicitud.
- Pre-dictamen para revisión humana.
