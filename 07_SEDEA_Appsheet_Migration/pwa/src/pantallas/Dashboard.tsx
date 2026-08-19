// Dashboard de seguimiento: 4 metricas agregadas con Chart.js.
// Pantalla en linea; cada bloque falla de forma independiente para que un
// endpoint caido no tumbe el resto del tablero.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  DireccionRegional,
  RespuestaApoyos,
  RespuestaAvance,
  RespuestaCobertura,
  RespuestaEstadisticasStaging
} from '@sedea/shared';
import { useSesion } from '../App';
import { api } from '../api/cliente';
import Grafica from '../componentes/Grafica';
import TarjetaMetrica from '../componentes/TarjetaMetrica';
import { useEstadoRed } from '../sync/estadoRed';
import { useColoresTema } from '../tema/colores';

/** Recorta una etiqueta larga para que quepa en el eje de la grafica. */
function recortar(texto: string, maximo = 40): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/** Formatea un periodo YYYY-MM-DD como DD/MM (o "Sem. DD/MM"). */
function etiquetaPeriodo(periodo: string, agrupacion: 'dia' | 'semana'): string {
  const [anio, mes, dia] = periodo.split('-');
  const corta = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit' }).format(
    new Date(Number(anio), Number(mes) - 1, Number(dia))
  );
  return agrupacion === 'semana' ? `Sem. ${corta}` : corta;
}

export default function Dashboard() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();
  // Los colores de las graficas salen de las variables CSS del modo activo:
  // al alternar el tema, `colores` cambia, los useMemo se recalculan y
  // Grafica vuelve a construir la instancia de Chart.js.
  const colores = useColoresTema();
  const regionalDelUsuario = perfil?.regional_id ?? null;

  // Filtros globales.
  const [regional, setRegional] = useState<string>(
    regionalDelUsuario ? String(regionalDelUsuario) : ''
  );
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [agrupacion, setAgrupacion] = useState<'dia' | 'semana'>('dia');
  // Se incrementa al pulsar "Aplicar filtros": dispara la recarga sin recargar la pagina.
  const [version, setVersion] = useState(0);

  const [regionales, setRegionales] = useState<DireccionRegional[]>([]);
  const [cobertura, setCobertura] = useState<RespuestaCobertura | null>(null);
  const [apoyos, setApoyos] = useState<RespuestaApoyos | null>(null);
  const [avance, setAvance] = useState<RespuestaAvance | null>(null);
  const [staging, setStaging] = useState<RespuestaEstadisticasStaging | null>(null);
  const [fallos, setFallos] = useState<Record<string, boolean>>({});
  const [cargando, setCargando] = useState(true);

  const puedeVerDepuracion = perfil?.rol === 'editor_datos' || perfil?.rol === 'admin';

  const parametros = useCallback(() => {
    const p = new URLSearchParams();
    if (regional) p.set('regional_id', regional);
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    return p;
  }, [regional, desde, hasta]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const nuevosFallos: Record<string, boolean> = {};

    await Promise.all([
      api
        .estadisticasCobertura(parametros())
        .then(setCobertura)
        .catch(() => {
          nuevosFallos.cobertura = true;
        }),
      api
        .estadisticasApoyos(parametros())
        .then(setApoyos)
        .catch(() => {
          nuevosFallos.apoyos = true;
        }),
      (() => {
        const p = parametros();
        p.set('agrupacion', agrupacion);
        return api
          .estadisticasAvance(p)
          .then(setAvance)
          .catch(() => {
            nuevosFallos.avance = true;
          });
      })(),
      api
        .estadisticasStaging()
        .then(setStaging)
        .catch(() => {
          nuevosFallos.staging = true;
        })
    ]);

    setFallos(nuevosFallos);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametros, agrupacion]);

  useEffect(() => {
    if (!enLinea) return;
    void api
      .catalogos()
      .then((c) => setRegionales(c.regionales))
      .catch(() => setRegionales([]));
  }, [enLinea]);

  useEffect(() => {
    if (enLinea) void cargar();
    // La recarga se dispara al montar, al cambiar la agrupacion y al pulsar
    // "Aplicar filtros" (los filtros de Regional y fecha no recargan solos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enLinea, version, agrupacion]);

  // ------------------------------------------------------------------------
  // Configuracion de las 4 graficas
  // ------------------------------------------------------------------------

  /** Ejes, rejilla y leyenda tematizados (se rehacen al cambiar de modo). */
  const ejes = useMemo(
    () => ({
      ticks: { color: colores.tenue },
      grid: { color: colores.borde },
      border: { color: colores.borde },
      title: { color: colores.tenue }
    }),
    [colores]
  );

  const leyenda = useMemo(
    () => ({ labels: { color: colores.tenue } }),
    [colores]
  );

  const datosCobertura = useMemo(
    () => ({
      labels: (cobertura?.por_regional ?? []).map((r) => r.regional),
      datasets: [
        {
          label: 'Con evidencia',
          data: (cobertura?.por_regional ?? []).map((r) => r.con_captura),
          backgroundColor: colores.acento
        },
        {
          label: 'Pendientes',
          data: (cobertura?.por_regional ?? []).map((r) => r.sin_captura),
          backgroundColor: colores.tenue
        }
      ]
    }),
    [cobertura, colores]
  );

  const opcionesCobertura = useMemo(
    () => ({
      indexAxis: 'y' as const,
      scales: {
        x: { stacked: true, beginAtZero: true, ...ejes },
        y: { stacked: true, ...ejes }
      },
      plugins: { legend: { position: 'bottom' as const, ...leyenda } }
    }),
    [ejes, leyenda]
  );

  const etiquetasApoyos = useMemo(() => {
    const base = (apoyos?.data ?? []).map((a) => a.nombre);
    if (apoyos?.otros) base.push(`Otros (${apoyos.otros.conceptos} conceptos)`);
    return base;
  }, [apoyos]);

  const datosApoyos = useMemo(() => {
    const valores = (apoyos?.data ?? []).map((a) => a.capturas);
    if (apoyos?.otros) valores.push(apoyos.otros.capturas);
    return {
      labels: etiquetasApoyos.map((e) => recortar(e)),
      datasets: [{ label: 'Capturas', data: valores, backgroundColor: colores.acento }]
    };
  }, [apoyos, etiquetasApoyos, colores]);

  const opcionesApoyos = useMemo(
    () => ({
      indexAxis: 'y' as const,
      scales: { x: { beginAtZero: true, ...ejes }, y: { ...ejes } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // El tooltip muestra el nombre completo, sin recortar.
            title: (elementos: any[]) => etiquetasApoyos[elementos[0]?.dataIndex] ?? ''
          }
        }
      }
    }),
    [etiquetasApoyos, ejes]
  );

  const datosAvance = useMemo(
    () => ({
      labels: (avance?.data ?? []).map((d) => etiquetaPeriodo(d.periodo, agrupacion)),
      datasets: [
        {
          label: 'Capturas por periodo',
          data: (avance?.data ?? []).map((d) => d.capturas),
          borderColor: colores.acento,
          backgroundColor: colores.acento,
          tension: 0.2
        },
        {
          label: 'Acumulado',
          data: (avance?.data ?? []).map((d) => d.acumulado),
          borderColor: colores.info,
          backgroundColor: colores.info,
          borderDash: [6, 4],
          yAxisID: 'y2',
          tension: 0.2
        }
      ]
    }),
    [avance, agrupacion, colores]
  );

  const opcionesAvance = useMemo(
    () => ({
      scales: {
        x: { ...ejes },
        y: {
          beginAtZero: true,
          ...ejes,
          title: { display: true, text: 'Capturas', color: colores.tenue }
        },
        y2: {
          position: 'right' as const,
          beginAtZero: true,
          ...ejes,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Acumulado', color: colores.tenue }
        }
      },
      plugins: { legend: { position: 'bottom' as const, ...leyenda } }
    }),
    [ejes, leyenda, colores]
  );

  const datosStaging = useMemo(
    () => ({
      labels: ['Pendientes', 'Aprobadas', 'Descartadas', 'Fusionadas'],
      datasets: [
        {
          label: 'Filas de staging',
          data: [
            staging?.beneficiarios.pendiente ?? 0,
            staging?.beneficiarios.aprobado ?? 0,
            staging?.beneficiarios.descartado ?? 0,
            staging?.beneficiarios.fusionado ?? 0
          ],
          backgroundColor: [colores.aviso, colores.exito, colores.tenue, colores.info],
          borderColor: colores.borde
        }
      ]
    }),
    [staging, colores]
  );

  const opcionesStaging = useMemo(
    () => ({ plugins: { legend: { position: 'bottom' as const, ...leyenda } } }),
    [leyenda]
  );

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <>
      <div className="tarjeta">
        <h1>Dashboard de seguimiento</h1>

        <div className="filtros">
          <label className="campo">
            <span>Dirección Regional</span>
            <select
              data-testid="select-regional-dashboard"
              value={regional}
              disabled={regionalDelUsuario !== null}
              onChange={(e) => setRegional(e.target.value)}
            >
              <option value="">Todas las Regionales</option>
              {regionales.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span>Desde</span>
            <input
              data-testid="input-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>

          <label className="campo">
            <span>Hasta</span>
            <input
              data-testid="input-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>

          <label className="campo">
            <span>Agrupación</span>
            <select
              data-testid="select-agrupacion"
              value={agrupacion}
              onChange={(e) => setAgrupacion(e.target.value as 'dia' | 'semana')}
            >
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
            </select>
          </label>

          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Aplicar filtros
          </button>
        </div>
      </div>

      {/* ---------------------- Metrica 1: cobertura ---------------------- */}
      <div className="tarjeta">
        <h2>Cobertura de captura</h2>
        {cargando && !cobertura && <p className="vacio">Cargando estadísticas…</p>}
        {fallos.cobertura && <p className="vacio">No se pudieron cargar los datos.</p>}

        {cobertura && (
          <>
            <div className="tarjetas-resumen">
              <TarjetaMetrica
                testId="tarjeta-total-beneficiarios"
                etiqueta="Beneficiarios"
                valor={cobertura.global.total_beneficiarios}
              />
              <TarjetaMetrica
                testId="tarjeta-con-captura"
                etiqueta="Con evidencia"
                valor={cobertura.global.con_captura}
              />
              <TarjetaMetrica
                testId="tarjeta-sin-captura"
                etiqueta="Pendientes"
                valor={cobertura.global.sin_captura}
              />
              <TarjetaMetrica
                testId="tarjeta-porcentaje"
                etiqueta="% de cobertura"
                valor={`${cobertura.global.porcentaje.toFixed(1)} %`}
              />
            </div>

            <Grafica
              tipo="bar"
              datos={datosCobertura}
              opciones={opcionesCobertura}
              testId="grafica-cobertura"
              altura={260}
            />

            <h3>Municipios más rezagados</h3>
            <div className="tabla-contenedor">
              <table data-testid="tabla-cobertura-municipio">
                <thead>
                  <tr>
                    <th>Municipio</th>
                    <th>Regional</th>
                    <th>Beneficiarios</th>
                    <th>Con evidencia</th>
                    <th>Pendientes</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {cobertura.por_municipio.map((m) => (
                    <tr key={m.municipio_id} data-testid="fila-cobertura">
                      <td data-etiqueta="Municipio">{m.municipio}</td>
                      <td data-etiqueta="Regional">{m.regional}</td>
                      <td data-etiqueta="Beneficiarios">{m.total_beneficiarios}</td>
                      <td data-etiqueta="Con evidencia">{m.con_captura}</td>
                      <td data-etiqueta="Pendientes">{m.sin_captura}</td>
                      <td data-etiqueta="%">{m.porcentaje.toFixed(1)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cobertura.por_municipio.length === 0 && <p className="vacio">Sin resultados</p>}
          </>
        )}
      </div>

      {/* ------------------ Metrica 2: tipos de apoyo --------------------- */}
      <div className="tarjeta">
        <h2>Distribución por tipo de apoyo</h2>
        {cargando && !apoyos && <p className="vacio">Cargando estadísticas…</p>}
        {fallos.apoyos && <p className="vacio">No se pudieron cargar los datos.</p>}
        {apoyos && (
          <>
            <p className="dato" data-testid="resumen-apoyos">
              Mostrando los {apoyos.data.length} conceptos con más capturas de un total de{' '}
              {apoyos.data.length + (apoyos.otros?.conceptos ?? 0)}.
            </p>
            <Grafica
              tipo="bar"
              datos={datosApoyos}
              opciones={opcionesApoyos}
              testId="grafica-apoyos"
              altura={340}
            />
          </>
        )}
      </div>

      {/* --------------------- Metrica 3: avance -------------------------- */}
      <div className="tarjeta">
        <h2>Avance en el tiempo</h2>
        {cargando && !avance && <p className="vacio">Cargando estadísticas…</p>}
        {fallos.avance && <p className="vacio">No se pudieron cargar los datos.</p>}
        {avance && (
          <>
            <p className="dato" data-testid="resumen-avance">
              {avance.data.length} periodos · {avance.total_capturas} capturas
            </p>
            {avance.total_capturas === 0 ? (
              <p className="vacio">Sin datos para el filtro seleccionado.</p>
            ) : (
              <Grafica
                tipo="line"
                datos={datosAvance}
                opciones={opcionesAvance}
                testId="grafica-avance"
                altura={300}
              />
            )}
          </>
        )}
      </div>

      {/* --------------------- Metrica 4: staging ------------------------- */}
      <div className="tarjeta">
        <h2>Estado del staging</h2>
        {cargando && !staging && <p className="vacio">Cargando estadísticas…</p>}
        {fallos.staging && <p className="vacio">No se pudieron cargar los datos.</p>}
        {staging && (
          <>
            <div className="tarjetas-resumen">
              <TarjetaMetrica
                testId="tarjeta-staging-pendiente"
                etiqueta="Pendientes"
                valor={staging.beneficiarios.pendiente}
              />
              <TarjetaMetrica
                testId="tarjeta-staging-aprobado"
                etiqueta="Aprobadas"
                valor={staging.beneficiarios.aprobado}
              />
              <TarjetaMetrica
                testId="tarjeta-staging-descartado"
                etiqueta="Descartadas"
                valor={staging.beneficiarios.descartado}
              />
              <TarjetaMetrica
                testId="tarjeta-staging-fusionado"
                etiqueta="Fusionadas"
                valor={staging.beneficiarios.fusionado}
              />
            </div>
            <p className="dato">
              Catálogos: {staging.catalogos.pendiente} pendientes /{' '}
              {staging.catalogos.aprobado} aprobados
            </p>
            <Grafica
              tipo="doughnut"
              datos={datosStaging}
              opciones={opcionesStaging}
              testId="grafica-staging"
              altura={260}
            />
            {puedeVerDepuracion && (
              <Link className="boton secundario" to="/depuracion">
                Ir a Depuración
              </Link>
            )}
          </>
        )}
      </div>
    </>
  );
}
