// Visor de "Evidencia de entregas" -- ver alcance en
// packages/shared/src/entregas.ts. Endpoints:
//   GET /api/entregas/evidencia            -> listado + metricas (paginado)
//   GET /api/entregas/evidencia/catalogos  -> listas de los filtros
//   GET /api/entregas/evidencia/export.xlsx -> el mismo filtro, sin tope
//
// Es una vista de REVISION (no captura): guardada por rol de supervision y
// acotada a la Regional del usuario, igual que Reportes.
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {
  esquemaFiltrosEvidencia,
  puedeVerEvidenciaEntregas,
  type FiltrosEvidencia
} from '@sedea/shared';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import {
  catalogosEvidenciaEntregas,
  listarEvidenciaEntregas
} from '../db/queries/evidencia-entregas.js';

function leerFiltros(peticion: any): FiltrosEvidencia {
  const parseado = esquemaFiltrosEvidencia.safeParse(peticion.query ?? {});
  if (!parseado.success) {
    throw new ErrorApi(
      422,
      'parametro_invalido',
      parseado.error.issues.map((i: { message: string }) => i.message).join('; ')
    );
  }
  return parseado.data;
}

export default async function rutasEvidenciaEntregas(app: FastifyInstance): Promise<void> {
  const soloRevision = {
    preHandler: [
      app.autenticar,
      async (peticion: any) => {
        if (!puedeVerEvidenciaEntregas(peticion.usuario?.rol)) {
          throw new ErrorApi(403, 'rol_no_autorizado', 'No tienes permiso para ver la evidencia de entregas.');
        }
      }
    ]
  };

  app.get('/api/entregas/evidencia/catalogos', soloRevision, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    return respuesta.status(200).send(await catalogosEvidenciaEntregas(regionalForzada(usuario)));
  });

  app.get('/api/entregas/evidencia', soloRevision, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerFiltros(peticion);
    const resultado = await listarEvidenciaEntregas(filtros, regionalForzada(usuario));
    return respuesta.status(200).send(resultado);
  });

  app.get('/api/entregas/evidencia/export.xlsx', soloRevision, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerFiltros(peticion);
    const { filas } = await listarEvidenciaEntregas(filtros, regionalForzada(usuario), true);

    const libro = new ExcelJS.Workbook();
    libro.creator = 'SISPACQ';
    libro.created = new Date();
    const hoja = libro.addWorksheet('Evidencia de entregas');

    hoja.columns = [
      { header: 'Beneficiario', key: 'beneficiario', width: 32 },
      { header: 'CURP', key: 'curp', width: 20 },
      { header: 'Folio', key: 'folio', width: 22 },
      { header: 'Concepto', key: 'concepto', width: 24 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Unidad', key: 'unidad_medida', width: 10 },
      { header: 'Dirección Regional', key: 'regional', width: 18 },
      { header: 'Municipio', key: 'municipio', width: 20 },
      { header: 'Entregado', key: 'entregado_en', width: 20 },
      { header: 'Registró', key: 'entregado_por', width: 26 },
      { header: 'Latitud', key: 'lat', width: 14 },
      { header: 'Longitud', key: 'lng', width: 14 },
      { header: 'Precisión (m)', key: 'precision_m', width: 14 },
      { header: 'GPS', key: 'gps', width: 10 },
      { header: 'Observaciones', key: 'observaciones', width: 40 },
      { header: 'Foto (URL)', key: 'foto_url', width: 60 }
    ];

    const encabezado = hoja.getRow(1);
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };

    filas.forEach((f) => {
      const fila = hoja.addRow({
        beneficiario: f.beneficiario,
        curp: f.curp ?? '',
        folio: f.folio,
        concepto: f.concepto,
        cantidad: f.cantidad,
        unidad_medida: f.unidad_medida ?? '',
        regional: f.regional,
        municipio: f.municipio ?? '',
        entregado_en: new Date(f.entregado_en).toLocaleString('es-MX'),
        entregado_por: f.entregado_por,
        lat: f.lat ?? '',
        lng: f.lng ?? '',
        precision_m: f.precision_m ?? '',
        gps: f.sin_gps ? 'sin GPS' : 'sí',
        observaciones: f.observaciones ?? '',
        foto_url: f.foto_url
      });
      // La URL de la foto, clicable (requiere token de sesion al abrirla).
      const celdaFoto = fila.getCell('foto_url');
      celdaFoto.value = { text: f.foto_url, hyperlink: f.foto_url };
      celdaFoto.font = { color: { argb: 'FF185FA5' }, underline: true };
    });

    hoja.getColumn('cantidad').numFmt = '#,##0.00';

    const buffer = await libro.xlsx.writeBuffer();
    const nombreArchivo = `evidencia_entregas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return respuesta
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${nombreArchivo}"`)
      .send(buffer);
  });
}
