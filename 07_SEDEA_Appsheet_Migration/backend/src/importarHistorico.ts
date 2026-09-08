// Import de los catalogos geograficos y el historico de apoyos que traia el
// sistema anterior en AppSheet ("CATALOGOS") y un programa previo distinto
// ("Impulso Productivo del Campo", PIIPC) -- ver migracion 035.
//
// Lee CSVs locales (NUNCA se consulta Google Sheets en vivo) desde
// backend/data-historico/ (carpeta gitignorada: trae CURP/telefono/domicilio
// reales). Uso: `npx tsx backend/src/importarHistorico.ts` desde la raiz del
// repo, con la base de datos arriba.
//
// Es seguro volver a correrlo:
// - municipios/localidades/ejidos/comunidades se UPSERTean por su id_legado
//   (su `id` real de Postgres nunca cambia entre corridas, porque
//   `solicitudes.dom_localidad_id` puede llegar a apuntarles).
// - beneficiarios_historicos / historial_solicitudes+conceptos NO los
//   referencia nadie por FK: se recargan completos (DELETE + INSERT) cada
//   vez, mas simple y sin riesgo de duplicados parciales.
//
// OJO llaves legado (verificado contra datos reales, no asumido):
// - `localidades.id_legado` = CLAVE_LOC de INEGI (9 digitos, ej. 220030001),
//   NO la columna "ID" de la pestana LOCALIDAD -- tanto BENEFICIARIOS!ID
//   LOCALIDAD como PIIPC!ID_LOC_PROY guardan ese CLAVE_LOC, no el "ID" corto.
// - `ejidos.id_legado` = columna "No" de la pestana EJIDO (numeros chicos,
//   coincide con PIIPC!ID_EJIDO).
// - Municipio legado (1..18) = MUNICIPIO!CVE_MUN, usado tal cual por
//   BENEFICIARIOS!ID MUNICIPIO y PIIPC!ID MUN_PROY / ID MUNICIPIO.
// - El Sheet exportado via openpyxl guarda numeros como floats de texto
//   ("3.0"): todo id/clave legado se trunca con `entero()` antes de usarse.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, esperarBaseDatos } from './db/pool.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_DATOS = path.resolve(AQUI, '..', 'data-historico');

// ---------------------------------------------------------------------------
// CSV minimo (RFC4180): soporta comillas, comas y saltos de linea dentro de
// un campo. No usamos una libreria porque no hay ninguna ya instalada en
// backend y esto es lo unico que se necesita.
// ---------------------------------------------------------------------------
function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\r') {
      // ignorado, \n cierra la fila
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => !(f.length === 1 && f[0] === ''));
}

function leerCsv(nombreArchivo: string): string[][] {
  const ruta = path.join(DIR_DATOS, nombreArchivo);
  const texto = fs.readFileSync(ruta, 'utf-8');
  const filas = parsearCsv(texto);
  return filas.slice(1); // sin encabezado
}

const t = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  if (s === '') return null;
  // Sheet exportado con openpyxl: numeros de texto llegan como "35.0".
  const m = /^(-?\d+)\.0$/.exec(s);
  return m ? m[1] : s;
};

function n(v: string | undefined): number | null {
  const s = (v ?? '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/** Entero desde un id/clave legado, tolerando el sufijo ".0" de openpyxl. */
function entero(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const num = Math.trunc(Number(s));
  return Number.isFinite(num) ? num : null;
}

/** Fechas del origen vienen DD/MM/AAAA. */
function fechaMx(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function importar(): Promise<void> {
  await esperarBaseDatos();
  console.log('Leyendo CSVs de', DIR_DATOS);

  // -------------------------------------------------------------------
  // 1) Mapa legado (1..18, CATALOGOS!MUNICIPIO.CVE_MUN) -> municipios.id
  //    real. Se deriva la clave INEGI ("22XXX") desde LOCALIDAD (CVE_ENTIDA +
  //    CVE_MUNICI), porque el tab MUNICIPIO no la trae directo -- y esa
  //    clave INEGI SI coincide exacto con `municipios.clave` en Postgres.
  // -------------------------------------------------------------------
  const filasLocalidad = leerCsv('localidad.csv');
  const inegiPorLegado = new Map<number, string>();
  for (const f of filasLocalidad) {
    const legado = entero(f[3]); // ID_MUNICIP
    const cveMunici = entero(f[12]); // CVE_MUNICI
    if (legado === null || cveMunici === null || inegiPorLegado.has(legado)) continue;
    inegiPorLegado.set(legado, `22${String(cveMunici).padStart(3, '0')}`);
  }

  const municipiosDb = await pool.query<{ id: number; clave: string }>(
    'SELECT id, clave FROM municipios'
  );
  const idPorClave = new Map(municipiosDb.rows.map((m) => [m.clave, m.id]));
  const municipioIdPorLegado = new Map<number, number>();
  for (const [legado, clave] of inegiPorLegado) {
    const id = idPorClave.get(clave);
    if (id) municipioIdPorLegado.set(legado, id);
  }
  console.log(`Municipios: ${municipioIdPorLegado.size}/18 mapeados de legado -> id real.`);
  for (const [legado, id] of municipioIdPorLegado) {
    await pool.query('UPDATE municipios SET id_legado_appsheet = $1 WHERE id = $2', [legado, id]);
  }

  // -------------------------------------------------------------------
  // 2) localidades (upsert por id_legado = CLAVE_LOC, ej. 220030001)
  // -------------------------------------------------------------------
  let localidadesOk = 0;
  let localidadesSinMunicipio = 0;
  for (const f of filasLocalidad) {
    const idLegado = entero(f[0]); // CLAVE LOC
    const municipioId = municipioIdPorLegado.get(entero(f[3]) ?? -1);
    if (idLegado === null || !municipioId) {
      localidadesSinMunicipio++;
      continue;
    }
    await pool.query(
      `INSERT INTO localidades (id_legado, municipio_id, nombre, ambito, cve_seccion, latitud, longitud, poblacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id_legado) DO UPDATE SET
         municipio_id = EXCLUDED.municipio_id, nombre = EXCLUDED.nombre,
         ambito = EXCLUDED.ambito, cve_seccion = EXCLUDED.cve_seccion,
         latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
         poblacion = EXCLUDED.poblacion`,
      [idLegado, municipioId, t(f[4]), t(f[5]), t(f[15]), n(f[6]), n(f[7]), n(f[10])]
    );
    localidadesOk++;
  }
  console.log(`localidades: ${localidadesOk} importadas, ${localidadesSinMunicipio} sin municipio resuelto.`);

  // -------------------------------------------------------------------
  // 3) ejidos (upsert por id_legado = columna "No")
  // -------------------------------------------------------------------
  const filasEjido = leerCsv('ejido.csv');
  let ejidosOk = 0;
  for (const f of filasEjido) {
    const idLegado = entero(f[0]); // No
    const municipioId = municipioIdPorLegado.get(entero(f[1]) ?? -1); // CVE_MUN
    if (idLegado === null || !municipioId || !t(f[3])) continue;
    await pool.query(
      `INSERT INTO ejidos (id_legado, municipio_id, nombre, tipo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_legado) DO UPDATE SET
         municipio_id = EXCLUDED.municipio_id, nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo`,
      [idLegado, municipioId, t(f[3]), t(f[4])]
    );
    ejidosOk++;
  }
  console.log(`ejidos: ${ejidosOk} importados.`);

  // -------------------------------------------------------------------
  // 4) comunidades (upsert por id_legado, texto tipo "AM_1_1")
  // -------------------------------------------------------------------
  const filasComunidad = leerCsv('comunidades.csv');
  let comunidadesOk = 0;
  for (const f of filasComunidad) {
    const idLegado = t(f[0]); // ID COMUNIDAD
    const municipioId = municipioIdPorLegado.get(entero(f[1]) ?? -1); // ID MUN
    if (!idLegado || !municipioId || !t(f[3])) continue;
    await pool.query(
      `INSERT INTO comunidades (id_legado, municipio_id, nombre) VALUES ($1,$2,$3)
       ON CONFLICT (id_legado) DO UPDATE SET
         municipio_id = EXCLUDED.municipio_id, nombre = EXCLUDED.nombre`,
      [idLegado, municipioId, t(f[3])]
    );
    comunidadesOk++;
  }
  console.log(`comunidades: ${comunidadesOk} importadas.`);

  // -------------------------------------------------------------------
  // 5) beneficiarios_historicos (fuente CATALOGOS) -- recarga completa
  // -------------------------------------------------------------------
  const localidadesDb = await pool.query<{ id: number; id_legado: number }>(
    'SELECT id, id_legado FROM localidades WHERE id_legado IS NOT NULL'
  );
  const localidadIdPorLegado = new Map(localidadesDb.rows.map((l) => [l.id_legado, l.id]));

  await pool.query("DELETE FROM beneficiarios_historicos WHERE fuente = 'catalogos'");
  const filasBeneficiario = leerCsv('beneficiarios.csv');
  let beneficiariosOk = 0;
  for (const f of filasBeneficiario) {
    const curp = t(f[0]);
    if (!curp) continue;
    const municipioId = municipioIdPorLegado.get(entero(f[21]) ?? -1) ?? null; // ID MUNICIPIO
    const localidadId = localidadIdPorLegado.get(entero(f[22]) ?? -1) ?? null; // ID LOCALIDAD (= CLAVE_LOC)
    await pool.query(
      `INSERT INTO beneficiarios_historicos
         (fuente, curp, nombre_completo, nombre_pila, apellido_paterno, apellido_materno,
          telefono, correo, rfc, banco, dom_calle, dom_numero, dom_colonia, dom_cp,
          dom_tipo_asentamiento, municipio_id, localidad_id)
       VALUES ('catalogos',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        curp.toUpperCase(),
        t(f[4]),
        t(f[1]),
        t(f[2]),
        t(f[3]),
        t(f[15]),
        t(f[17]),
        t(f[20]) ?? t(f[10]),
        t(f[19]),
        t(f[6]),
        t(f[7]),
        t(f[8]),
        t(f[9]),
        t(f[5]),
        municipioId,
        localidadId
      ]
    );
    beneficiariosOk++;
  }
  console.log(`beneficiarios_historicos: ${beneficiariosOk} importados.`);

  // -------------------------------------------------------------------
  // 6) historial_solicitudes + historial_conceptos (fuente PIIPC) -- recarga
  //    completa. Indices de columna tomados de
  //    "26_Impulso_productivo_campo - Base general.csv" (176 columnas).
  // -------------------------------------------------------------------
  await pool.query("DELETE FROM historial_solicitudes WHERE fuente = 'piipc'"); // cascada a conceptos
  const filasPiipc = leerCsv('piipc_base_general.csv');
  let solicitudesOk = 0;
  let conceptosOk = 0;
  for (const f of filasPiipc) {
    const curp = t(f[1]);
    if (!curp) continue;

    const municipioProyectoId = municipioIdPorLegado.get(entero(f[127]) ?? -1) ?? null; // ID MUN_PROY
    const localidadProyectoId = localidadIdPorLegado.get(entero(f[128]) ?? -1) ?? null; // ID_LOC_PROY

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO historial_solicitudes
         (fuente, folio_origen, curp, nombre_completo, nombre_pila, apellido_paterno, apellido_materno,
          sexo, fecha_nacimiento, telefono, correo, anio, fecha_solicitud, programa, subprograma,
          componente, regional, ventanilla, nombre_capturista, dom_municipio_texto, dom_localidad_texto,
          dom_colonia, dom_calle, dom_cp, municipio_proyecto_id, localidad_proyecto_id,
          municipio_proyecto_texto, localidad_proyecto_texto, ejido_proyecto_texto, seccion_electoral,
          recibido)
       VALUES ('piipc',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               $23,$24,$25,$26,$27,$28,$29,$30)
       RETURNING id`,
      [
        t(f[0]),
        curp.toUpperCase(),
        t(f[7]),
        t(f[6]),
        t(f[5]),
        t(f[4]),
        t(f[11]),
        fechaMx(f[12]),
        t(f[15]),
        t(f[16]),
        entero(f[48]),
        fechaMx(f[35]),
        t(f[49]),
        t(f[50]),
        t(f[51]),
        t(f[39]),
        t(f[37]),
        t(f[38]),
        t(f[20]),
        t(f[21]),
        t(f[28]),
        t(f[25]),
        t(f[30]),
        municipioProyectoId,
        localidadProyectoId,
        t(f[40]),
        t(f[41]),
        t(f[42]),
        t(f[44]),
        f[175]?.trim() === 'RECIBIDO'
      ]
    );
    solicitudesOk++;
    const historialId = rows[0].id;

    // Concepto 1: siempre presente si hay CONCEPTO APOYO.
    if (t(f[74])) {
      await pool.query(
        `INSERT INTO historial_conceptos
           (historial_solicitud_id, num_concepto, concepto, descripcion, cantidad_solicitada,
            unidad_medida, proveedor, monto_total, monto_estatal, monto_beneficiario)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [historialId, t(f[74]), t(f[75]), n(f[82]), t(f[83]), t(f[86]), n(f[88]), n(f[89]), n(f[90])]
      );
      conceptosOk++;
    }
    // Concepto 2: solo si el folio pidio un segundo apoyo.
    if (t(f[166])) {
      await pool.query(
        `INSERT INTO historial_conceptos
           (historial_solicitud_id, num_concepto, concepto, descripcion, cantidad_solicitada,
            unidad_medida, proveedor, monto_total, monto_estatal, monto_beneficiario)
         VALUES ($1,2,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          historialId,
          t(f[166]),
          t(f[167]),
          n(f[169]),
          t(f[170]),
          t(f[174]),
          n(f[173]),
          n(f[171]),
          n(f[172])
        ]
      );
      conceptosOk++;
    }
  }
  console.log(`historial_solicitudes: ${solicitudesOk} importadas, historial_conceptos: ${conceptosOk}.`);

  await pool.end();
  console.log('Listo.');
}

importar().catch((err) => {
  console.error(err);
  process.exit(1);
});
