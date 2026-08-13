/* Dashboard SEDEA — JS vanilla, sin CDN.
   Regla transversal: lo que no tiene dato se pinta como «—» y NO se grafica
   como cero (R1/R4). */
const VACIO = '—';
const AZUL = '#366092', AZUL_CLARO = '#7fa8d4', ROJO = '#a6192e', AMBAR = '#f0a500',
      VERDE = '#2e7d32';
const graficas = {};

function dinero(v){
  if(v === null || v === undefined || v === '') return VACIO;
  return '$' + Number(v).toLocaleString('es-MX', {maximumFractionDigits: 0});
}
function numero(v){
  if(v === null || v === undefined || v === '') return VACIO;
  return Number(v).toLocaleString('es-MX');
}

function filtrosActuales(){
  const p = new URLSearchParams();
  [['anio','f-anio'],['region','f-region'],['municipio','f-municipio'],
   ['programa','f-programa'],['clasificacion','f-clasificacion']].forEach(([clave,id])=>{
    const el = document.getElementById(id);
    if(el && el.value) p.set(clave, el.value);
  });
  return p;
}

async function traer(ruta, params){
  const r = await fetch(ruta + (params.toString() ? '?' + params.toString() : ''));
  if(!r.ok) return {ok:false, data:[]};
  return await r.json();
}

function dibujar(id, config){
  const canvas = document.getElementById(id);
  if(!canvas || typeof Chart === 'undefined') return;
  if(graficas[id]) graficas[id].destroy();
  graficas[id] = new Chart(canvas, config);
}

function limpiarGrafica(id){
  if(graficas[id]){ graficas[id].destroy(); delete graficas[id]; }
}

async function cargar(){
  const p = filtrosActuales();

  // KPIs
  const resumen = await traer('/api/resumen', p);
  const t = (resumen.data && resumen.data[0]) || {};
  document.getElementById('kpi-total').textContent = dinero(t.total);
  document.getElementById('kpi-apoyos').textContent = numero(t.numero_apoyos);
  document.getElementById('kpi-municipios').textContent = numero(t.municipios);
  document.getElementById('kpi-incidencias').textContent = numero(t.incidencias_abiertas);

  const hayDatos = t.total !== null && t.total !== undefined;
  document.getElementById('sin-datos').style.display = hayDatos ? 'none' : 'block';

  // Serie anual
  const serie = await traer('/api/series/inversion-anual', p);
  const puntos = (serie.data || []).filter(s => s.total !== null && s.total !== undefined);
  if(puntos.length){
    dibujar('chart-inversion-anual', {
      type:'line',
      data:{labels: puntos.map(s=>s.anio),
            datasets:[{label:'Inversión total', data: puntos.map(s=>s.total),
                       borderColor:AZUL, backgroundColor:'rgba(54,96,146,.15)',
                       fill:true, tension:.25, spanGaps:false}]},
      options:{responsive:true, scales:{y:{ticks:{callback:v=>dinero(v)}}}}
    });
  } else { limpiarGrafica('chart-inversion-anual'); }

  // Emergentes vs Productividad (barras apiladas por año)
  const ep = await traer('/api/emer-prod', p);
  const porAnio = {};
  (ep.data || []).forEach(f=>{
    if(f.total === null || f.total === undefined) return;
    porAnio[f.anio] = porAnio[f.anio] || {};
    porAnio[f.anio][f.clasificacion] = (porAnio[f.anio][f.clasificacion] || 0) + f.total;
  });
  const anios = Object.keys(porAnio).sort();
  if(anios.length){
    const clases = ['EMERGENTE','PRODUCTIVIDAD','NO_CLASIFICADO'];
    const colores = {EMERGENTE:ROJO, PRODUCTIVIDAD:AZUL, NO_CLASIFICADO:'#94a3b8'};
    dibujar('chart-emer-prod', {
      type:'bar',
      data:{labels:anios, datasets: clases.filter(c=>anios.some(a=>porAnio[a][c]!==undefined))
        .map(c=>({label:c, backgroundColor:colores[c],
                  data:anios.map(a=> porAnio[a][c] === undefined ? null : porAnio[a][c])}))},
      options:{responsive:true, scales:{x:{stacked:true}, y:{stacked:true,
               ticks:{callback:v=>dinero(v)}}}}
    });
  } else { limpiarGrafica('chart-emer-prod'); }

  // Aportaciones (dona)
  const ap = await traer('/api/aportaciones/resumen', p);
  const g = ap.grafica || {labels:[], valores:[]};
  if(g.valores && g.valores.length){
    dibujar('chart-aportaciones', {
      type:'doughnut',
      data:{labels:g.labels, datasets:[{data:g.valores,
            backgroundColor:[AZUL, AZUL_CLARO, ROJO, AMBAR]}]},
      options:{responsive:true}
    });
  } else { limpiarGrafica('chart-aportaciones'); }

  // Género (barras)
  const ge = await traer('/api/genero-edad', p);
  const resumenGenero = (ge.resumen || []).filter(x=>x.genero);
  if(resumenGenero.length){
    dibujar('chart-genero', {
      type:'bar',
      data:{labels: resumenGenero.map(x => x.genero === 'H' ? 'Hombres' : 'Mujeres'),
            datasets:[{label:'Personas (CURP distintas)', backgroundColor:[AZUL, VERDE],
                       data: resumenGenero.map(x=>x.personas)}]},
      options:{responsive:true, plugins:{legend:{display:false}}}
    });
  } else { limpiarGrafica('chart-genero'); }

  // Top municipios (barras horizontales)
  const top = await traer('/api/top-municipios', p);
  if((top.data || []).length){
    dibujar('chart-top-municipios', {
      type:'bar',
      data:{labels: top.data.map(x=>x.municipio),
            datasets:[{label:'Inversión total', backgroundColor:AZUL,
                       data: top.data.map(x=>x.total)}]},
      options:{indexAxis:'y', responsive:true, plugins:{legend:{display:false}},
               scales:{x:{ticks:{callback:v=>dinero(v)}}}}
    });
  } else { limpiarGrafica('chart-top-municipios'); }

  // Tabla resumen por municipio
  const matriz = await traer('/api/matriz', new URLSearchParams([...p, ['page_size','5000']]));
  const acc = {};
  (matriz.data || []).forEach(f=>{
    if(!f.municipio) return;
    const a = acc[f.municipio] = acc[f.municipio] ||
      {numero_apoyos:null, federal:null, estatal:null, municipal:null, beneficiario:null, total:null};
    ['numero_apoyos','federal','estatal','municipal','beneficiario','total'].forEach(k=>{
      if(f[k] !== null && f[k] !== undefined) a[k] = (a[k] || 0) + f[k];
    });
  });
  const cuerpo = document.getElementById('cuerpo-resumen');
  cuerpo.innerHTML = '';
  const nombres = Object.keys(acc).sort();
  if(!nombres.length){
    cuerpo.innerHTML = '<tr><td colspan="7">Sin datos para los filtros seleccionados</td></tr>';
  } else {
    nombres.forEach(m=>{
      const a = acc[m];
      const tr = document.createElement('tr');
      const celdas = [m, numero(a.numero_apoyos), dinero(a.federal), dinero(a.estatal),
                      dinero(a.municipal), dinero(a.beneficiario), dinero(a.total)];
      celdas.forEach((c,i)=>{
        const td = document.createElement('td');
        td.textContent = c;
        if(i > 0) td.className = 'num';
        if(c === VACIO) td.classList.add('vacio');
        tr.appendChild(td);
      });
      cuerpo.appendChild(tr);
    });
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const aplicar = document.getElementById('btn-aplicar');
  const limpiar = document.getElementById('btn-limpiar');
  if(aplicar) aplicar.addEventListener('click', cargar);
  if(limpiar) limpiar.addEventListener('click', ()=>{
    ['f-anio','f-region','f-municipio','f-programa','f-clasificacion'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.value = '';
    });
    cargar();
  });
  cargar();
});
