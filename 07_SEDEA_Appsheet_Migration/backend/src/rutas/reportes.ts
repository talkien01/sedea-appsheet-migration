// Modulo de Reportes -- ver alcance completo en packages/shared/src/reportes.ts.
// Endpoints: catalogos para los filtros, el resumen/matriz en JSON y en
// .xlsx, y el padron con monto exacto por beneficiario en JSON y en .xlsx.
// Cada par pantalla/Excel comparte exactamente los mismos filtros/query para
// que lo que se ve en pantalla y lo que se descarga siempre digan lo mismo.
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {
  esquemaFiltrosComunes,
  esquemaFiltrosReporte,
  ETIQUETAS_DIMENSION,
  puedeVerReportes,
  type FiltrosComunesReporte,
  type FiltrosReporte
} from '@sedea/shared';
import { ErrorApi, errorNoAutorizado } from '../plugins/errores.js';
import { regionalForzada } from '../plugins/rbac.js';
import {
  catalogosReporte,
  generarPadronExcel,
  generarPadronPantalla,
  generarReporteSolicitudes
} from '../db/queries/reportes.js';

function leerConEsquema<T>(peticion: any, esquema: { safeParse: (v: unknown) => any }): T {
  const parseado = esquema.safeParse(peticion.query ?? {});
  if (!parseado.success) {
    throw new ErrorApi(
      422,
      'parametro_invalido',
      parseado.error.issues.map((i: { message: string }) => i.message).join('; ')
    );
  }
  return parseado.data as T;
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
    const filtros = leerConEsquema<FiltrosReporte>(peticion, esquemaFiltrosReporte);
    const filas = await generarReporteSolicitudes(
      filtros.agrupar_por,
      filtros.agrupar_por_2,
      filtros,
      regionalForzada(usuario)
    );
    return respuesta
      .status(200)
      .send({ dimension: filtros.agrupar_por, dimension2: filtros.agrupar_por_2, filas });
  });

  app.get('/api/reportes/solicitudes/export.xlsx', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerConEsquema<FiltrosReporte>(peticion, esquemaFiltrosReporte);
    const filas = await generarReporteSolicitudes(
      filtros.agrupar_por,
      filtros.agrupar_por_2,
      filtros,
      regionalForzada(usuario)
    );

    const libro = new ExcelJS.Workbook();
    libro.creator = 'SISPACQ';
    libro.created = new Date();
    const hoja = libro.addWorksheet('Reporte');

    const etiquetaDimension = ETIQUETAS_DIMENSION[filtros.agrupar_por];
    const columnas = [
      { header: etiquetaDimension, key: 'etiqueta', width: 28 },
      ...(filtros.agrupar_por_2
        ? [{ header: ETIQUETAS_DIMENSION[filtros.agrupar_por_2], key: 'etiqueta2', width: 24 }]
        : []),
      { header: 'Solicitudes', key: 'solicitudes', width: 14 },
      { header: 'Cantidad solicitada', key: 'cantidad', width: 18 },
      { header: 'Cantidad entregada', key: 'cantidad_entregada', width: 18 },
      { header: 'Monto solicitado', key: 'monto_solicitado', width: 18 },
      { header: 'Monto autorizado', key: 'monto_autorizado', width: 18 },
      { header: 'Monto entregado', key: 'monto_entregado', width: 18 }
    ];
    hoja.columns = columnas;

    const filaEncabezado = hoja.getRow(1);
    filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filaEncabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };
    filaEncabezado.alignment = { vertical: 'middle' };

    filas.forEach((f) => {
      hoja.addRow({
        etiqueta: f.etiqueta,
        etiqueta2: f.etiqueta2 ?? '',
        solicitudes: f.solicitudes,
        cantidad: f.cantidad,
        cantidad_entregada: f.cantidad_entregada,
        monto_solicitado: f.monto_solicitado,
        monto_autorizado: f.monto_autorizado,
        monto_entregado: f.monto_entregado
      });
    });

    const colLetra = (indice: number) => String.fromCharCode('A'.charCodeAt(0) + indice);
    const primeraFilaDatos = 2;
    const ultimaFilaDatos = 1 + filas.length;
    const colSolicitudes = colLetra(columnas.findIndex((c) => c.key === 'solicitudes'));
    const colCantidad = colLetra(columnas.findIndex((c) => c.key === 'cantidad'));
    const colCantidadEntregada = colLetra(columnas.findIndex((c) => c.key === 'cantidad_entregada'));
    const colMontoSolicitado = colLetra(columnas.findIndex((c) => c.key === 'monto_solicitado'));
    const colMontoAutorizado = colLetra(columnas.findIndex((c) => c.key === 'monto_autorizado'));
    const colMontoEntregado = colLetra(columnas.findIndex((c) => c.key === 'monto_entregado'));
    const filaTotal = hoja.addRow({
      etiqueta: 'Total',
      solicitudes: { formula: `SUM(${colSolicitudes}${primeraFilaDatos}:${colSolicitudes}${ultimaFilaDatos})` },
      cantidad: { formula: `SUM(${colCantidad}${primeraFilaDatos}:${colCantidad}${ultimaFilaDatos})` },
      cantidad_entregada: {
        formula: `SUM(${colCantidadEntregada}${primeraFilaDatos}:${colCantidadEntregada}${ultimaFilaDatos})`
      },
      monto_solicitado: {
        formula: `SUM(${colMontoSolicitado}${primeraFilaDatos}:${colMontoSolicitado}${ultimaFilaDatos})`
      },
      monto_autorizado: {
        formula: `SUM(${colMontoAutorizado}${primeraFilaDatos}:${colMontoAutorizado}${ultimaFilaDatos})`
      },
      monto_entregado: {
        formula: `SUM(${colMontoEntregado}${primeraFilaDatos}:${colMontoEntregado}${ultimaFilaDatos})`
      }
    });
    filaTotal.font = { bold: true };
    filaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4DED2' } };

    hoja.getColumn('cantidad').numFmt = '#,##0.00';
    hoja.getColumn('cantidad_entregada').numFmt = '#,##0.00';
    hoja.getColumn('monto_solicitado').numFmt = '"$"#,##0.00';
    hoja.getColumn('monto_autorizado').numFmt = '"$"#,##0.00';
    hoja.getColumn('monto_entregado').numFmt = '"$"#,##0.00';

    const buffer = await libro.xlsx.writeBuffer();
    const nombreArchivo = `reporte_${filtros.agrupar_por}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return respuesta
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${nombreArchivo}"`)
      .send(buffer);
  });

  app.get('/api/reportes/padron', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerConEsquema<FiltrosComunesReporte>(peticion, esquemaFiltrosComunes);
    const { filas, truncado } = await generarPadronPantalla(filtros, regionalForzada(usuario));
    return respuesta.status(200).send({ filas, truncado });
  });

  app.get('/api/reportes/padron/export.xlsx', soloReportes, async (peticion, respuesta) => {
    const usuario = peticion.usuario;
    if (!usuario) throw errorNoAutorizado();
    const filtros = leerConEsquema<FiltrosComunesReporte>(peticion, esquemaFiltrosComunes);
    const filas = await generarPadronExcel(filtros, regionalForzada(usuario));

    const libro = new ExcelJS.Workbook();
    libro.creator = 'SISPACQ';
    libro.created = new Date();
    const hoja = libro.addWorksheet('Padrón');

    hoja.columns = [
      { header: 'Beneficiario', key: 'beneficiario', width: 32 },
      { header: 'CURP', key: 'curp', width: 20 },
      { header: 'Dirección Regional', key: 'regional', width: 18 },
      { header: 'Municipio', key: 'municipio', width: 20 },
      { header: 'Concepto de apoyo', key: 'concepto', width: 26 },
      { header: 'Cantidad', key: 'cantidad', width: 14 },
      { header: 'Unidad', key: 'unidad_medida', width: 10 },
      { header: 'Monto', key: 'monto_estatal', width: 16 },
      { header: 'Entregado', key: 'entregado', width: 12 }
    ];

    const filaEncabezado = hoja.getRow(1);
    filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filaEncabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };
    filaEncabezado.alignment = { vertical: 'middle' };

    filas.forEach((f) => {
      hoja.addRow({
        beneficiario: f.beneficiario,
        curp: f.curp ?? '',
        regional: f.regional,
        municipio: f.municipio,
        concepto: f.concepto,
        cantidad: f.cantidad,
        unidad_medida: f.unidad_medida ?? '',
        monto_estatal: f.monto_estatal,
        entregado: f.entregado ? 'Sí' : 'No'
      });
    });

    const primeraFilaDatos = 2;
    const ultimaFilaDatos = 1 + filas.length;
    const filaTotal = hoja.addRow({
      beneficiario: 'Total',
      monto_estatal: { formula: `SUM(H${primeraFilaDatos}:H${ultimaFilaDatos})` }
    });
    filaTotal.font = { bold: true };
    filaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4DED2' } };

    hoja.getColumn('cantidad').numFmt = '#,##0.00';
    hoja.getColumn('monto_estatal').numFmt = '"$"#,##0.00';

    const buffer = await libro.xlsx.writeBuffer();
    const nombreArchivo = `padron_reportes_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return respuesta
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${nombreArchivo}"`)
      .send(buffer);
  });
}
