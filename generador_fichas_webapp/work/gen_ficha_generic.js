const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, HeadingLevel, VerticalAlign
} = require("docx");

const BLUE="366092", WHITE="FFFFFF", YELLOW="FFF2CC", RED="FDE9E9", REDTEXT="A6192E";
const fmt = n => "$" + Number(n).toLocaleString("en-US",{maximumFractionDigits:0});

function hcell(text,width){return new TableCell({width:{size:width,type:WidthType.DXA},shading:{type:ShadingType.CLEAR,fill:BLUE},verticalAlign:VerticalAlign.CENTER,
  children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text,bold:true,color:WHITE,font:"Arial",size:17})]})]});}
function cell(text,width,opts={}){return new TableCell({width:{size:width,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,
  shading:opts.fill?{type:ShadingType.CLEAR,fill:opts.fill}:undefined,
  children:[new Paragraph({alignment:opts.center?AlignmentType.CENTER:AlignmentType.LEFT,children:[new TextRun({text:String(text),font:"Arial",size:17,bold:!!opts.bold})]})]});}

const jsonFile = process.argv[2];
const outFile = process.argv[3];
const data = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));

const children = [];
children.push(new Paragraph({children:[new TextRun({text:"SECRETARÍA DE DESARROLLO AGROPECUARIO",bold:true,font:"Arial",size:26})]}));
children.push(new Paragraph({children:[new TextRun({text:`FICHA MUNICIPAL — ${data.municipio}`,bold:true,font:"Arial",size:30})]}));
children.push(new Paragraph({children:[new TextRun({text:"Generada automáticamente por ficha_engine.py — fuente: analitica (Postgres) + Datos_referencia_manual_municipios.xlsx",italics:true,font:"Arial",size:20})]}));
children.push(new Paragraph({children:[new TextRun({text:""})]}));

// ---- WARNINGS BLOCK ----
if (data.warnings && data.warnings.length) {
  children.push(new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:`⚠ ADVERTENCIAS — ${data.warnings.length} pendiente(s) antes de publicar`,bold:true,font:"Arial",size:22,color:REDTEXT})]}));
  const wRows = [ new TableRow({children:[hcell("#",500), hcell("Advertencia — dato faltante y qué hacer",10700)]}) ];
  data.warnings.forEach((w,i)=>{
    wRows.push(new TableRow({children:[cell(i+1,500,{center:true,fill:RED}), cell(w,10700,{fill:RED})]}));
  });
  children.push(new Table({width:{size:11200,type:WidthType.DXA}, rows: wRows}));
  children.push(new Paragraph({children:[new TextRun({text:""})]}));
}

// ---- 1. Historico 2023-2025 ----
children.push(new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:`1. Apoyos e inversión por programa, ${data.anios_presentes.join("-")} (analitica.apoyo_municipio)`,bold:true,font:"Arial",size:22})]}));
const hRows = [ new TableRow({children:[hcell("Año",900),hcell("Programa",2600),hcell("Apoyos",1200),hcell("Apoyo Estatal",1700),hcell("Apoyo Municipal",1700),hcell("Aportación Productores",1900),hcell("Total",1800)]}) ];
for (const r of data.historico_2023_2025) {
  hRows.push(new TableRow({children:[
    cell(r.anio,900,{center:true}), cell(r.programa_nombre,2600), cell(r.numero_apoyos,1200,{center:true}),
    cell(fmt(r.apoyo_estatal),1700,{center:true}), cell(fmt(r.apoyo_municipal),1700,{center:true}),
    cell(fmt(r.aportacion_productor),1900,{center:true}), cell(fmt(r.total),1800,{center:true})
  ]}));
}
hRows.push(new TableRow({children:[cell("",900),cell("TOTAL",2600,{bold:true}),cell(data.total_apoyos_historico,1200,{center:true,bold:true}),cell("",1700),cell("",1700),cell("",1900),cell(fmt(data.total_inversion_historico),1800,{center:true,bold:true})]}));
children.push(new Table({width:{size:11200,type:WidthType.DXA}, rows: hRows}));
children.push(new Paragraph({children:[new TextRun({text:""})]}));

// ---- 2. Avance 2026 ----
children.push(new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:"2. Avance 2026 (analitica.v_oficial_municipio)",bold:true,font:"Arial",size:22})]}));
if (data.avance_2026.length) {
  const oRows = [ new TableRow({children:[hcell("Componente",3200),hcell("Solicitudes",1400),hcell("Apoyos",1400),hcell("Estatal dictaminado",1900),hcell("Total dictaminado",1900)]}) ];
  for (const r of data.avance_2026) {
    oRows.push(new TableRow({children:[cell(r.componente,3200),cell(r.solicitudes,1400,{center:true}),cell(r.apoyos,1400,{center:true}),cell(fmt(r.estatal_dictaminado||0),1900,{center:true}),cell(fmt(r.total_dictaminado||0),1900,{center:true})]}));
  }
  oRows.push(new TableRow({children:[cell("TOTAL",3200,{bold:true}),cell("",1400),cell(data.total_apoyos_2026,1400,{center:true,bold:true}),cell("",1900),cell(fmt(data.total_2026),1900,{center:true,bold:true})]}));
  children.push(new Table({width:{size:9800,type:WidthType.DXA}, rows: oRows}));
} else {
  children.push(new Paragraph({children:[new TextRun({text:"Sin datos 2026 en v_oficial_municipio para este municipio.",italics:true,font:"Arial",size:18})]}));
}
children.push(new Paragraph({children:[new TextRun({text:""})]}));

// ---- 3. Territorio / Productos / Precipitacion / Demografia (si hay datos) ----
function tablaManual(titulo, rows, cols) {
  children.push(new Paragraph({heading:HeadingLevel.HEADING_2, children:[new TextRun({text:titulo,bold:true,font:"Arial",size:22})]}));
  if (!rows.length || Object.values(rows[0]).every(v => v===null || v==="" || cols.slice(0,1).includes(v))) {
    children.push(new Paragraph({children:[new TextRun({text:"PENDIENTE — sin datos cargados en la plantilla manual todavía.",italics:true,font:"Arial",size:18,color:REDTEXT})]}));
  } else {
    const hr = new TableRow({children: cols.map(c=>hcell(c,Math.floor(11200/cols.length)))});
    const trs = [hr];
    for (const r of rows) {
      trs.push(new TableRow({children: cols.map(c=>cell(r[c]==null?"":r[c], Math.floor(11200/cols.length)))}));
    }
    children.push(new Table({width:{size:11200,type:WidthType.DXA}, rows: trs}));
  }
  children.push(new Paragraph({children:[new TextRun({text:""})]}));
}

tablaManual("3. Territorio y superficie agrícola", data.territorio, ["Municipio","Extensión territorial (Ha)","% del territorio estatal","Superficie agrícola total (Ha)","Riego (Ha)","Temporal (Ha)"]);
tablaManual("4. Top de productos", data.productos, ["Municipio","Rank","Producto","Superficie (Ha)","Volumen (Ton)","Valor (MDP)"]);
tablaManual("5. Precipitación mensual", data.precipitacion, ["Municipio","Año","ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC","Anual"]);
tablaManual("6. Demografía municipal de beneficiarios", data.demografia, ["Municipio","Grupo de edad","Hombres","Mujeres","Total","% del total municipal"]);

const doc = new Document({ sections:[{ properties:{page:{size:{width:12240,height:15840},margin:{top:720,bottom:720,left:720,right:720}}}, children }] });
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outFile, buf); console.log("saved", outFile); });
