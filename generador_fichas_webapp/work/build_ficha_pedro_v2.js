const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, HeadingLevel, VerticalAlign
} = require("docx");

const BLUE = "366092", WHITE = "FFFFFF", YELLOW = "FFF2CC";
const fmt = n => "$" + Number(n).toLocaleString("en-US", {maximumFractionDigits:0});

function hcell(text, width) {
  return new TableCell({ width:{size:width,type:WidthType.DXA}, shading:{type:ShadingType.CLEAR, fill:BLUE}, verticalAlign:VerticalAlign.CENTER,
    children:[new Paragraph({alignment:AlignmentType.CENTER, children:[new TextRun({text,bold:true,color:WHITE,font:"Arial",size:17})]})] });
}
function cell(text, width, opts={}) {
  return new TableCell({ width:{size:width,type:WidthType.DXA}, verticalAlign:VerticalAlign.CENTER,
    shading: opts.fill ? {type:ShadingType.CLEAR, fill:opts.fill} : undefined,
    children:[new Paragraph({alignment: opts.center?AlignmentType.CENTER:AlignmentType.LEFT, children:[new TextRun({text:String(text),font:"Arial",size:17,bold:!!opts.bold})]})] });
}

const rows2325 = [
 ["2023","Dinamismo Agroalimentario",36,0,2158569,0,3035276,5193845],
 ["2023","Municipalizado",117,0,3000000,3000000,5072759,11072759],
 ["2024","Dinamismo Agroalimentario",159,0,5635835,0,11947960,17583795],
 ["2025","Apícolas",3,0,18728,0,0,18728],
 ["2025","Avena y Garbanzo",133,0,680400,0,0,680400],
 ["2025","Bordería",2,0,160685,0,93790,254475],
 ["2025","Dinamismo Agroalimentario",185,0,7103737,0,17017360,24121097],
 ["2025","Maíz Blanco",636,0,1705310,0,0,1705310],
 ["2025","Municipalizado",140,0,3000000,3000000,6565328,12565328],
 ["2025","Pacas y Suplementos",72,0,300888,0,0,300888],
 ["2025","Tecnificación",33,0,2800637,0,1716368,4517005],
];
const totalApoyos = rows2325.reduce((a,r)=>a+r[2],0);
const totalInv = rows2325.reduce((a,r)=>a+r[7],0);

const bodyRows = [ new TableRow({children:[hcell("Año",900),hcell("Programa",2600),hcell("Apoyos",1200),hcell("Apoyo Estatal",1700),hcell("Apoyo Municipal",1700),hcell("Aportación Productores",1900),hcell("Total",1800)]}) ];
for (const r of rows2325) {
  bodyRows.push(new TableRow({children:[
    cell(r[0],900,{center:true}), cell(r[1],2600), cell(r[2],1200,{center:true}),
    cell(fmt(r[4]),1700,{center:true}), cell(fmt(r[5]),1700,{center:true}), cell(fmt(r[6]),1900,{center:true}), cell(fmt(r[7]),1800,{center:true})
  ]}));
}
bodyRows.push(new TableRow({children:[
  cell("",900), cell("TOTAL 2023-2025",2600,{bold:true}), cell(totalApoyos,1200,{center:true,bold:true}),
  cell("",1700), cell("",1700), cell("",1900), cell(fmt(totalInv),1800,{center:true,bold:true})
]}));

const rows2026 = [
 ["Captación y Almacenamiento de Agua",3,3,510000,720000],
 ["Dinamismo Agroalimentario",194,196,5750195,17783790],
 ["Tecnificación del Riego",12,12,302359,604721],
];
const t26apoyos = rows2026.reduce((a,r)=>a+r[2],0);
const t26total = rows2026.reduce((a,r)=>a+r[4],0);
const rows26body = [ new TableRow({children:[hcell("Componente",3200),hcell("Solicitudes",1400),hcell("Apoyos",1400),hcell("Estatal dictaminado",1900),hcell("Total dictaminado",1900)]}) ];
for (const r of rows2026) {
  rows26body.push(new TableRow({children:[cell(r[0],3200),cell(r[1],1400,{center:true}),cell(r[2],1400,{center:true}),cell(fmt(r[3]),1900,{center:true}),cell(fmt(r[4]),1900,{center:true})]}));
}
rows26body.push(new TableRow({children:[cell("TOTAL",3200,{bold:true}),cell("",1400),cell(t26apoyos,1400,{center:true,bold:true}),cell("",1900),cell(fmt(t26total),1900,{center:true,bold:true})]}));

const doc = new Document({ sections:[{
  properties:{ page:{ size:{width:12240,height:15840}, margin:{top:720,bottom:720,left:720,right:720} } },
  children: [
    new Paragraph({children:[new TextRun({text:"SECRETARÍA DE DESARROLLO AGROPECUARIO",bold:true,font:"Arial",size:26})]}),
    new Paragraph({children:[new TextRun({text:"FICHA MUNICIPAL — PEDRO ESCOBEDO (v2, verificada contra Postgres)",bold:true,font:"Arial",size:30})]}),
    new Paragraph({children:[new TextRun({text:"Región San Juan del Río · Fuente: base de datos analitica (Docker sedea_db), export 11-ago-2026",italics:true,font:"Arial",size:20})]}),
    new Paragraph({children:[new TextRun({text:""})]}),
    new Paragraph({children:[new TextRun({text:"Esta versión reemplaza el borrador anterior (basado en xlsx sueltos del Drive). Todas las cifras de abajo salen directo de analitica.apoyo_municipio y analitica.v_oficial_municipio, sin ajustes manuales. Donde no hay dato en la base, se deja en blanco / PENDIENTE — no se completó por inferencia.",font:"Arial",size:18,color:"993300"})]}),
    new Paragraph({children:[new TextRun({text:""})]}),

    new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:"1. Apoyos e inversión por programa, 2023-2025 (analitica.apoyo_municipio)",bold:true,font:"Arial",size:22})]}),
    new Table({width:{size:11200,type:WidthType.DXA}, rows: bodyRows}),
    new Paragraph({children:[new TextRun({text:""})]}),
    new Paragraph({children:[new TextRun({text:"No hay filas para 2021 ni 2022 a nivel municipio en la base (confirmado: la tabla apoyo_municipio solo tiene 2023, 2024, 2025 para todo el estado, no es un hueco específico de Pedro Escobedo). El campo 'apoyo_federal' es $0 en todas las filas — así está cargado en la base.",italics:true,font:"Arial",size:16})]}),
    new Paragraph({children:[new TextRun({text:""})]}),

    new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:"2. Avance 2026 — solo 3 componentes disponibles (analitica.v_oficial_municipio)",bold:true,font:"Arial",size:22})]}),
    new Table({width:{size:9800,type:WidthType.DXA}, rows: rows26body}),
    new Paragraph({children:[new TextRun({text:""})]}),
    new Paragraph({children:[new TextRun({text:"v_oficial_municipio para 2026 solo cubre Captación y Almacenamiento de Agua, Dinamismo Agroalimentario y Tecnificación del Riego — no los demás ~20 programas que sí existen en años anteriores (Municipalizado, Maíz Blanco, Bordería, etc.). Esos programas 2026 no están cargados todavía; no se reportan cifras para ellos.",italics:true,font:"Arial",size:16})]}),
    new Paragraph({children:[new TextRun({text:""})]}),

    new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:"3. Secciones sin fuente en la base (no incluidas — mismo criterio que el resto del proyecto)",bold:true,font:"Arial",size:22})]}),
    new Table({width:{size:11200,type:WidthType.DXA}, rows:[
      new TableRow({children:[hcell("Sección",3600),hcell("Estado",2200),hcell("Detalle",5400)]}),
      new TableRow({children:[cell("Extensión territorial y superficie agrícola",3600), cell("PENDIENTE",2200,{center:true,fill:YELLOW}), cell("No existe tabla de territorio en el esquema analitica (confirmado, 10 tablas + 6 vistas revisadas completas).",5400)]}),
      new TableRow({children:[cell("Top de productos (superficie, volumen, valor)",3600), cell("PENDIENTE",2200,{center:true,fill:YELLOW}), cell("Misma razón: no existe tabla de producción por cultivo/especie en la base.",5400)]}),
      new TableRow({children:[cell("Precipitación mensual",3600), cell("PENDIENTE",2200,{center:true,fill:YELLOW}), cell("No existe tabla de precipitación en la base; sigue viniendo de CONAGUA vía Drive.",5400)]}),
      new TableRow({children:[cell("Distribución de beneficiarios por sexo y edad",3600), cell("SIN FUENTE",2200,{center:true,fill:YELLOW}), cell("analitica.beneficiarios_demografia está vacía (confirmado por el equipo). v_oficial_componente sí trae hombres/mujeres pero solo a nivel ESTATAL, no por municipio — no se puede derivar el dato de Pedro Escobedo sin inventarlo.",5400)]}),
    ]}),
  ]
}]});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("/sessions/vibrant-intelligent-goldberg/mnt/outputs/work/Ficha_prueba_Pedro_Escobedo.docx", buf);
  console.log("saved v2");
});
