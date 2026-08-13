# Generador de Fichas Municipales — SEDEA

App local (Flask) con una página web sencilla: eliges municipio, das clic en
"Generar", y descarga el .docx con las advertencias de datos faltantes al inicio.

## Instalación (una sola vez)

Necesitas Python 3.9+ instalado. Desde esta carpeta:

```bash
pip install -r requirements.txt
```

## Preparar los datos

1. Copia `Datos_referencia_manual_municipios.xlsx` (el que ya tienes) a esta misma carpeta.
2. Los CSV de Postgres: o los copias a mano dentro de `analitica_export/`
   (los mismos 16 archivos que ya conoces), o usas el botón "Actualizar datos"
   de la página, que corre las consultas contra el contenedor Docker
   `sedea_db` y los refresca solo — para esto Docker debe estar corriendo en
   esta misma máquina.

## Correr la app

```bash
python app.py
```

Abre `http://localhost:5000` en tu navegador. Ahí:
1. Eliges el municipio del menú.
2. Clic en "Generar .docx" — descarga la ficha con las advertencias arriba.
3. (Opcional) Clic en "Actualizar datos" antes de generar, para traer lo
   más reciente de Postgres.

## Estructura

- `app.py` — servidor Flask (las dos rutas: página principal y generar).
- `ficha_engine.py` — combina los CSV + la plantilla manual, calcula todo y arma
  la lista de advertencias. Es el mismo motor que ya se probó con Amealco,
  Pedro Escobedo y San Juan del Río.
- `docx_writer.py` — arma el archivo .docx final (python-docx).
- `refresh_data.py` — el botón "Actualizar datos"; corre `docker exec` contra
  `sedea_db` para refrescar los CSV sin pasos manuales.
- `config.py` — rutas y nombre del contenedor Docker. Si algo vive en otro
  lugar en tu máquina, cámbialo aquí (o con variables de entorno
  `ANALITICA_DATA_DIR`, `MANUAL_XLSX_PATH`, `SEDEA_DOCKER_CONTAINER`).

## Nota

Este primer alcance genera fichas a nivel MUNICIPIO. Estatal y por región
todavía no están conectados a esta app — se puede agregar como siguiente paso
si se necesita.
