const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, HeadingLevel, BorderStyle, VerticalAlign
} = require("docx");

const BLUE = "366092";
const LIGHTBLUE = "D9E1F2";
const YELLOW = "FFF2CC";
const WHITE = "FFFFFF";

function hcell(text, width, opts={}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: BLUE },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, color: WHITE, font: "Arial", size: 18 })] })],
    ...opts
  });
}
function cell(text, width, opts={}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: String(text), font: "Arial", size: 18, bold: !!opts.bold })] })],
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
  });
}

const doc = new Document({
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    children: [
      new Paragraph({ children: [new TextRun({ text: "SECRETARÍA DE DESARROLLO AGROPECUARIO", bold: true, font: "Arial", size: 26 })] }),
      new Paragraph({ children: [new TextRun({ text: "FICHA MUNICIPAL — PEDRO ESCOBEDO (BORRADOR DE PRUEBA)", bold: true, font: "Arial", size: 30 })] }),
      new Paragraph({ children: [new TextRun({ text: "Región San Juan del Río · Elaborado a partir de fuentes del Drive (programas.sedea@queretaro.gob.mx)", italics: true, font: "Arial", size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),
      new Paragraph({ children: [new TextRun({ text: "Nota de método: este documento es una prueba para validar el flujo de trabajo, siguiendo el mismo layout que la ficha de Amealco de Bonfil que compartió el equipo. Las cifras con fuente confirmada se muestran en tablas; las secciones para las que aún no se localizó información de Pedro Escobedo específicamente en el Drive se marcan como PENDIENTE, con la fuente que habría que construir (ver también 'Mapa_disponibilidad_datos_fichas.xlsx').", font: "Arial", size: 18, color: "993300" })] }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1. Resumen de apoyos e inversión por concepto (varios cortes 2023-2025)", bold: true, font: "Arial", size: 22 })] }),
      new Table({
        width: { size: 10800, type: WidthType.DXA },
        rows: [
          new TableRow({ children: [hcell("Concepto / Programa", 3200), hcell("Apoyos / Beneficiarios", 1600), hcell("Apoyo Estatal", 1800), hcell("Apoyo Municipal", 1600), hcell("Aportación Productores", 1800), hcell("Total", 1800)] }),
          new TableRow({ children: [cell("Municipalizado 2023", 3200), cell("117", 1600, {center:true}), cell("$3,000,000", 1800, {center:true}), cell("$3,000,000", 1600, {center:true}), cell("$5,072,759", 1800, {center:true}), cell("$11,072,759", 1800, {center:true})] }),
          new TableRow({ children: [cell("Dinamismo Agroalimentario 2023", 3200), cell("36", 1600, {center:true}), cell("$2,158,569", 1800, {center:true}), cell("—", 1600, {center:true}), cell("$3,035,276", 1800, {center:true}), cell("$5,193,845", 1800, {center:true})] }),
          new TableRow({ children: [cell("Dinamismo Agroalimentario 2024", 3200), cell("159", 1600, {center:true}), cell("$5,635,835", 1800, {center:true}), cell("—", 1600, {center:true}), cell("$11,947,960", 1800, {center:true}), cell("$17,583,795", 1800, {center:true})] }),
          new TableRow({ children: [cell("Municipalizado 2025", 3200), cell("245", 1600, {center:true}), cell("$2,765,993", 1800, {center:true}), cell("$2,765,993", 1600, {center:true}), cell("n.d.", 1800, {center:true}), cell("$8,297,979", 1800, {center:true})] }),
          new TableRow({ children: [cell("Dinamismo Agroalimentario 2025", 3200), cell("185", 1600, {center:true}), cell("$7,103,737", 1800, {center:true}), cell("—", 1600, {center:true}), cell("$17,017,360", 1800, {center:true}), cell("$24,121,097", 1800, {center:true})] }),
          new TableRow({ children: [cell("Maíz Blanco 2025 (199.7 ton, 1,391 ha)", 3200), cell("636", 1600, {center:true}), cell("$1,705,310", 1800, {center:true}), cell("—", 1600, {center:true}), cell("n.d.", 1800, {center:true}), cell("n.d.", 1800, {center:true})] }),
          new TableRow({ children: [cell("Pacas y suplementos 2025 (62.7 ton)", 3200), cell("72", 1600, {center:true}), cell("$300,888", 1800, {center:true}), cell("—", 1600, {center:true}), cell("n.d.", 1800, {center:true}), cell("n.d.", 1800, {center:true})] }),
          new TableRow({ children: [cell("Bordería 2025", 3200), cell("2", 1600, {center:true}), cell("$160,685", 1800, {center:true}), cell("—", 1600, {center:true}), cell("$93,790", 1800, {center:true}), cell("$254,475", 1800, {center:true})] }),
          new TableRow({ children: [cell("Tecnificación de riego 2025", 3200), cell("33", 1600, {center:true}), cell("$2,800,637", 1800, {center:true}), cell("—", 1600, {center:true}), cell("$1,716,368", 1800, {center:true}), cell("$4,517,005", 1800, {center:true})] }),
        ]
      }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),
      new Paragraph({ children: [new TextRun({ text: "Fuente: Drive > Carpetas Chucho 2025 e Historicos > Eventos _REGIÓN SJR_ > 2025 0904 REG SJR.xlsx (hojas Municipalizado23/24/25Estatal, Dinamismo2023/2024/2025Estatal, Maíz Blanco2025Estatal, Pacas&Suplementos2025, Bordería2025Estatal, Tecnificación2025Estatal). Cifras a distintos cortes (no todas al mismo corte de fecha que la ficha de Amealco 03-ago-2026); pendiente homologar corte único.", italics: true, font: "Arial", size: 16 })] }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2. Acumulado de inversión — Pedro Escobedo dentro de la Región SJR", bold: true, font: "Arial", size: 22 })] }),
      new Table({
        width: { size: 10800, type: WidthType.DXA },
        rows: [
          new TableRow({ children: [hcell("Periodo", 2800), hcell("Apoyos", 1400), hcell("Federal", 1650), hcell("Estatal", 1650), hcell("Municipal", 1650), hcell("Productores", 1650)] }),
          new TableRow({ children: [cell("Acumulado 2022-2024", 2800), cell("3,703", 1400, {center:true}), cell("$9,240,144", 1650, {center:true}), cell("$55,781,255", 1650, {center:true}), cell("$6,000,000", 1650, {center:true}), cell("$46,893,430", 1650, {center:true})] }),
          new TableRow({ children: [cell("Acumulado a corte sept-2025", 2800), cell("4,769", 1400, {center:true}), cell("$9,240,144", 1650, {center:true}), cell("$68,931,547", 1650, {center:true}), cell("$8,975,000", 1650, {center:true}), cell("$63,772,100", 1650, {center:true})] }),
        ]
      }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),
      new Paragraph({ children: [new TextRun({ text: "Nota: la ficha de Amealco que compartió el usuario trae, para este mismo bloque a nivel 'REGIÓN SAN JUAN DEL RÍO', la cifra de Pedro Escobedo con corte 03-ago-2026: 4,769 apoyos / $68,931,547 estatal / $8,975,000 municipal / $63,772,100 productores / $141,678,647 total (sin federal). La tabla de arriba usa el archivo regional con corte 04-sept-2025, por eso el total no coincide exactamente ($150,918,791 con federal incluido). Ambas cifras son de fuente oficial pero de cortes distintos — se recomienda homologar la fecha de corte antes de publicar.", font: "Arial", size: 16, italics: true })] }),
      new Paragraph({ children: [new TextRun({ text: "" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3. Secciones pendientes (mismo formato que la ficha de Amealco)", bold: true, font: "Arial", size: 22 })] }),
      new Table({
        width: { size: 10800, type: WidthType.DXA },
        rows: [
          new TableRow({ children: [hcell("Sección", 3600), hcell("Estado", 2200), hcell("Qué falta / próximo paso", 5000)] }),
          new TableRow({ children: [cell("Extensión territorial y superficie agrícola (riego/temporal)", 3600), cell("PENDIENTE", 2200, {center:true, fill:YELLOW}), cell("No se localizó fuente municipal (tipo SIAP/INEGI) para Pedro Escobedo en el Drive.", 5000)] }),
          new TableRow({ children: [cell("Top de productos (superficie, volumen, valor)", 3600), cell("PENDIENTE", 2200, {center:true, fill:YELLOW}), cell("Misma fuente que extensión territorial; no localizada por municipio.", 5000)] }),
          new TableRow({ children: [cell("Precipitación mensual histórica", 3600), cell("PENDIENTE (posible)", 2200, {center:true, fill:YELLOW}), cell("Existe serie estatal (CONAGUA); falta confirmar si hay desagregación por municipio/estación.", 5000)] }),
          new TableRow({ children: [cell("Distribución de beneficiarios por sexo y edad", 3600), cell("PARCIAL", 2200, {center:true, fill:YELLOW}), cell("Columnas H/M existen para algunos conceptos en el archivo regional, pero incompletas para Pedro Escobedo.", 5000)] }),
          new TableRow({ children: [cell("Serie año-por-año con mismo detalle que hoja 'Amealco'", 3600), cell("PENDIENTE", 2200, {center:true, fill:YELLOW}), cell("Amealco tiene una hoja propia consolidada en su archivo municipal; Pedro Escobedo no tiene ese archivo aún — habría que construirlo con el mismo patrón.", 5000)] }),
        ]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("/sessions/vibrant-intelligent-goldberg/mnt/outputs/work/Ficha_prueba_Pedro_Escobedo.docx", buf);
  console.log("saved");
});
