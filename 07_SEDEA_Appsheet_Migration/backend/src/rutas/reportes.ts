// Modulo de Reportes (Beta) -- ver alcance completo en
// packages/shared/src/reportes.ts. Tres endpoints: catalogos para los
// filtros, el reporte en JSON (pantalla) y el mismo reporte en .xlsx
// (exportar). Las dos ultimas comparten exactamente los mismos filtros/query
// para que la pantalla y el Excel descargado siempre digan lo mismo.
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { esquemaFiltrosReporte, ETIQUETAS_DIMENSION, puedeVerReportes } from '@sedea/shared';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import { catalogosReporte, generarReporteSolicitudes } from '../db/queries/reportes.js';

function leerFiltros(peticion: any) {
  const parseado = esquemaFiltrosReporte.safeParse(peticion.query ?? {});
  if (!parseado.success) {
    throw new ErrorApi(
      422,
      'parametro_invalido',
      parseado.error.issues.map((i) => i.message).join('; ')
    );
  }
  return parseado.data;
}

export default async function rutasReportes(app: FastifyInstance): Promise<void> {
  const soloReportes = {
    preHandler: [
      app.autenticar,
      async (peticion: any) => {
        if (!puedeVerReportes(peticion.usuario?.rol)) {
          throw new ErrorApi(403, 'rol_no_autorizado', 'No tienes permiso para ver Reportes.');
        }
      }
    ]
  };

  app.get('/api/reportes/catalogos', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    return respuesta.status(200).send(await catalogosReporte(regionalForzada(usuario)));
  });

  app.get('/api/reportes/solicitudes', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerFiltros(peticion);
    const filas = await generarReporteSolicitudes(
      filtros.agrupar_por,
      filtros,
      regionalForzada(usuario)
    );
    return respuesta.status(200).send({ dimension: filtros.agrupar_por, filas });
  });

  app.get('/api/reportes/solicitudes/export.xlsx', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerFiltros(peticion);
    const filas = await generarReporteSolicitudes(
      filtros.agrupar_por,
      filtros,
      regionalForzada(usuario)
    );

    const libro = new ExcelJS.Workbook();
    libro.creator = 'SISPACQ';
    libro.created = new Date();
    const hoja = libro.addWorksheet('Reporte');

    const etiquetaDimension = ETIQUETAS_DIMENSION[filtros.agrupar_por];
    hoja.columns = [
      { header: etiquetaDimension, key: 'etiqueta', width: 32 },
      { header: 'Solicitudes', key: 'solicitudes', width: 16 },
      { header: 'Cantidad', key: 'cantidad', width: 18 },
      { header: 'Monto autorizado', key: 'monto_autorizado', width: 20 }
    ];

    const filaEncabezado = hoja.getRow(1);
    filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filaEncabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };
    filaEncabezado.alignment = { vertical: 'middle' };

    filas.forEach((f) => {
      hoja.addRow({
        etiqueta: f.etiqueta,
        solicitudes: f.solicitudes,
        cantidad: f.cantidad,
        monto_autorizado: f.monto_autorizado
      });
    });

    const primeraFilaDatos = 2;
    const ultimaFilaDatos = 1 + filas.length;
    const filaTotal = hoja.addRow({
      etiqueta: 'Total',
      solicitudes: { formula: `SUM(B${primeraFilaDatos}:B${ultimaFilaDatos})` },
      cantidad: { formula: `SUM(C${primeraFilaDatos}:C${ultimaFilaDatos})` },
      monto_autorizado: { formula: `SUM(D${primeraFilaDatos}:D${ultimaFilaDatos})` }
    });
    filaTotal.font = { bold: true };
    filaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4DED2' } };

    hoja.getColumn('cantidad').numFmt = '#,##0.00';
    hoja.getColumn('monto_autorizado').numFmt = '"$"#,##0.00';

    const buffer = await libro.xlsx.writeBuffer();
    const nombreArchivo = `reporte_${filtros.agrupar_por}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return respuesta
      .header(
        'content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      .header('content-disposition', `attachment; filename="${nombreArchivo}"`)
      .send(buffer);
  });
}
