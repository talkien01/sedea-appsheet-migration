"""Exportador de HTML autocontenido (§7.8).

Un solo archivo que abre con doble clic, sin servidor y sin red: CSS, JS,
Chart.js y los datos van embebidos. Cero referencias `http://` o `https://` en
`src`/`href`. Las celdas sin dato se rinden como «—», nunca como 0 (R4).
"""
import datetime
import json
import os

import config

VENDOR = os.path.join(config.BASE_DIR, "static", "vendor", "chart.umd.min.js")

_CSS = """
:root{--tinta:#12212f;--azul:#366092;--gris:#eef2f6;--borde:#cbd5e1;--rojo:#a6192e}
*{box-sizing:border-box}
body{margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:var(--tinta);background:#fff}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;color:var(--azul);margin:28px 0 8px}
.sub{color:#5b6b7c;font-size:13px;margin-bottom:18px}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.kpi{flex:1 1 180px;border:1px solid var(--borde);border-radius:8px;padding:12px 14px;background:var(--gris)}
.kpi .v{font-size:22px;font-weight:bold}.kpi .t{font-size:12px;color:#5b6b7c;text-transform:uppercase}
table{border-collapse:collapse;width:100%;font-size:12px}
th{background:var(--azul);color:#fff;padding:6px;text-align:left;position:sticky;top:0}
td{border-bottom:1px solid var(--borde);padding:5px 6px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.vacio{color:#94a3b8}
.filtros{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
select,input{padding:6px;border:1px solid var(--borde);border-radius:6px;font-size:13px}
.graficas{display:flex;flex-wrap:wrap;gap:20px}
.grafica{flex:1 1 380px;min-width:320px;border:1px solid var(--borde);border-radius:8px;padding:10px}
footer{margin-top:32px;border-top:2px solid var(--azul);padding-top:12px;font-size:12px;color:#5b6b7c}
.aviso{background:#fde9e9;border:1px solid var(--rojo);color:var(--rojo);padding:10px;border-radius:6px;font-size:13px}
"""

_JS = """
const DATOS = window.__DATOS__;
const VACIO = '\\u2014';
function dinero(v){ return (v===null||v===undefined||v==='') ? VACIO
  : '$' + Number(v).toLocaleString('es-MX',{maximumFractionDigits:0}); }
function num(v){ return (v===null||v===undefined||v==='') ? VACIO
  : Number(v).toLocaleString('es-MX'); }
function texto(v){ return (v===null||v===undefined||v==='') ? VACIO : v; }

function pintarTabla(filas){
  const cuerpo = document.getElementById('cuerpo');
  cuerpo.innerHTML = '';
  if(!filas.length){
    cuerpo.innerHTML = '<tr><td colspan="12" id="sin-datos">Sin datos para los filtros seleccionados</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  filas.forEach(f=>{
    const tr = document.createElement('tr');
    const celdas = [
      texto(f.anio), texto(f.region), texto(f.municipio), texto(f.programa),
      texto(f.clasificacion), num(f.numero_apoyos), dinero(f.federal), dinero(f.estatal),
      dinero(f.municipal), dinero(f.beneficiario), dinero(f.total), texto(f.origen)
    ];
    celdas.forEach((c,i)=>{
      const td = document.createElement('td');
      td.textContent = c;
      if(i>=5 && i<=10) td.className = 'num';
      if(c===VACIO) td.classList.add('vacio');
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  cuerpo.appendChild(frag);
}

function aplicar(){
  const anio = document.getElementById('f-anio').value;
  const muni = document.getElementById('f-municipio').value;
  const clas = document.getElementById('f-clasificacion').value;
  const filas = DATOS.filas.filter(f =>
    (!anio || String(f.anio)===anio) &&
    (!muni || f.municipio===muni) &&
    (!clas || f.clasificacion===clas));
  pintarTabla(filas);
}

function opciones(id, valores){
  const sel = document.getElementById(id);
  valores.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
  sel.addEventListener('change', aplicar);
}

function graficar(){
  if(typeof Chart === 'undefined') return;
  const serie = DATOS.serie_anual.filter(s=>s.total!==null && s.total!==undefined);
  const ctx = document.getElementById('g-anual');
  if(ctx && serie.length){
    new Chart(ctx, {type:'line', data:{labels:serie.map(s=>s.anio),
      datasets:[{label:'Inversión total', data:serie.map(s=>s.total), borderColor:'#366092',
                 backgroundColor:'rgba(54,96,146,.15)', tension:.25, fill:true, spanGaps:false}]},
      options:{responsive:true, plugins:{legend:{display:true}}}});
  }
  const ap = DATOS.aportaciones;
  const ctx2 = document.getElementById('g-aportaciones');
  if(ctx2 && ap && ap.valores && ap.valores.length){
    new Chart(ctx2, {type:'doughnut', data:{labels:ap.labels,
      datasets:[{data:ap.valores, backgroundColor:['#366092','#7fa8d4','#a6192e','#f0a500']}]},
      options:{responsive:true}});
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  opciones('f-anio', DATOS.catalogos.anios.map(String));
  opciones('f-municipio', DATOS.catalogos.municipios);
  opciones('f-clasificacion', DATOS.catalogos.clasificaciones);
  pintarTabla(DATOS.filas);
  graficar();
});
"""


def _chartjs():
    if os.path.exists(VENDOR):
        with open(VENDOR, encoding="utf-8") as f:
            return f.read()
    # Sin la librería vendorizada no se sirve un HTML que dependa de la red.
    return "/* Chart.js no vendorizado: las gráficas se omiten (prohibido usar CDN). */"


def _tarjeta(titulo, valor):
    return f'<div class="kpi"><div class="t">{titulo}</div><div class="v">{valor}</div></div>'


def construir(datos, titulo, subtitulo, fuentes, kpis, avisos=None):
    """datos: {filas, serie_anual, aportaciones, catalogos}. Devuelve el HTML completo."""
    generado = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    payload = json.dumps(datos, ensure_ascii=False, default=str)
    tarjetas = "".join(_tarjeta(t, v) for t, v in kpis)
    lista_fuentes = "".join(f"<li>{f}</li>" for f in fuentes)
    bloque_avisos = ""
    if avisos:
        bloque_avisos = ('<div class="aviso"><strong>Advertencias:</strong><ul>'
                         + "".join(f"<li>{a}</li>" for a in avisos) + "</ul></div>")
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo}</title>
<style>{_CSS}</style>
</head>
<body>
<h1>{titulo}</h1>
<div class="sub">{subtitulo}</div>
{bloque_avisos}
<div class="kpis">{tarjetas}</div>

<h2>Filtros</h2>
<div class="filtros">
  <select id="f-anio"><option value="">Todos los años</option></select>
  <select id="f-municipio"><option value="">Todos los municipios</option></select>
  <select id="f-clasificacion"><option value="">Emergentes y Productividad</option></select>
</div>

<h2>Gráficas</h2>
<div class="graficas">
  <div class="grafica"><canvas id="g-anual" height="220"></canvas></div>
  <div class="grafica"><canvas id="g-aportaciones" height="220"></canvas></div>
</div>

<h2>Detalle</h2>
<table>
<thead><tr>
<th>Año</th><th>Región</th><th>Municipio</th><th>Programa</th><th>Clasificación</th>
<th>Apoyos</th><th>Federal</th><th>Estatal</th><th>Municipal</th>
<th>Beneficiario (productor)</th><th>Total</th><th>Origen</th>
</tr></thead>
<tbody id="cuerpo"></tbody>
</table>

<footer>
<p><strong>Fecha de generación:</strong> {generado} &nbsp;|&nbsp;
   <strong>Fecha de corte:</strong> {config.FECHA_CORTE}</p>
<p><strong>Fuentes</strong></p>
<ul>{lista_fuentes}</ul>
<p>Las celdas sin dato se muestran como «—»: vacío no es cero. Los conteos son de
apoyos (folios), no de personas únicas. Los montos son totales, no solo la
aportación estatal.</p>
</footer>

<script>window.__DATOS__ = {payload};</script>
<script>{_chartjs()}</script>
<script>{_JS}</script>
</body>
</html>
"""


def nombre_archivo(ambito, clave):
    hoy = datetime.date.today().strftime("%Y%m%d")
    limpio = "".join(ch if ch.isalnum() else "_" for ch in (clave or "TODO"))
    return f"SEDEA_{ambito}_{limpio}_{hoy}.html"
