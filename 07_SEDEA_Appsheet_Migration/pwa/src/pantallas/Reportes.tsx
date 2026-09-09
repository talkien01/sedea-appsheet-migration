// Modulo de Reportes: resumen, matriz cruzada (2 dimensiones) y padron con
// monto exacto por beneficiario, todo agrupable/filtrable y exportable a
// Excel -- ver alcance completo en packages/shared/src/reportes.ts.
// [data-testid="pantalla-reportes"]
//
// Version 2 (2026-09-09): el usuario mostro la v1 (un solo nivel de
// agrupacion, sin "entregado", sin padron) y pidio explicitamente algo que
// permita comparar concepto contra concepto, montos por Regional/Municipio/
// concepto, y KPIs reales -- se comento el alcance y las limitaciones antes
// de construir (incluido un mockup) y esto es lo acordado.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DIMENSIONES_REPORTE,
  ETIQUETAS_DIMENSION,
  type DimensionReporte,
  type FilaPadron,
  type FilaReporte
} from '@sedea/shared';
import { urlConToken } from '../api/cliente';
import {
  armarQueryPadron,
  armarQueryReporte,
  catalogosReporte,
  generarPadron,
  generarReporte,
  type CatalogosReporte
} from '../api/reportes';
import Grafica from '../componentes/Grafica';
import { useColoresTema } from '../tema/colores';

type Vista = 'resumen' | 'matriz' | 'padron';
type MetricaValor = 'monto_autorizado' | 'monto_solicitado' | 'monto_entregado' | 'cantidad' | 'cantidad_entregada';

const ETIQUETAS_METRICA: Record<MetricaValor, string> = {
  monto_autorizado: 'Monto autorizado',
  monto_solicitado: 'Monto solicitado',
  monto_entregado: 'Monto entregado',
  cantidad: 'Cantidad solicitada',
  cantidad_entregada: 'Cantidad entregada'
};
const METRICAS_MONTO: ReadonlySet<MetricaValor> = new Set(['monto_autorizado', 'monto_solicitado', 'monto_entregado']);

const formatoNumero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
});
const formatoValor = (metrica: MetricaValor, valor: number) =>
  METRICAS_MONTO.has(metrica) ? formatoMoneda.format(valor) : formatoNumero.format(valor);

export default function Reportes() {
  const colores = useColoresTema();
  const [catalogos, setCatalogos] = useState<CatalogosReporte | null>(null);
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('resumen');

  // Filtros compartidos por las 3 vistas.
  const [anio, setAnio] = useState('');
  const [regionalId, setRegionalId] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [programaId, setProgramaId] = useState('');
  const [conceptoId, setConceptoId] = useState('');

  // Resumen: 1 dimension.
  const [agruparPor, setAgruparPor] = useState<DimensionReporte>('regional');
  const [ordenDescendente, setOrdenDescendente] = useState(true);
  const [filasResumen, setFilasResumen] = useState<FilaReporte[] | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [exportandoResumen, setExportandoResumen] = useState(false);

  // Matriz: 2 dimensiones + que metrica se pivotea.
  const [filasMatrizDim, setFilasMatrizDim] = useState<DimensionReporte>('regional');
  const [columnasMatrizDim, setColumnasMatrizDim] = useState<DimensionReporte>('concepto');
  const [metricaMatriz, setMetricaMatriz] = useState<MetricaValor>('monto_autorizado');
  const [filasMatriz, setFilasMatriz] = useState<FilaReporte[] | null>(null);
  const [cargandoMatriz, setCargandoMatriz] = useState(false);
  const [exportandoMatriz, setExportandoMatriz] = useState(false);

  // Padron: sin dimension, un renglon por beneficiario+concepto.
  const [filasPadron, setFilasPadron] = useState<FilaPadron[] | null>(null);
  const [padronTruncado, setPadronTruncado] = useState(false);
  const [cargandoPadron, setCargandoPadron] = useState(false);
  const [exportandoPadron, setExportandoPadron] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void catalogosReporte()
      .then(setCatalogos)
      .catch(() => setErrorCatalogos('No se pudieron cargar los catálogos de filtros.'));
  }, []);

  const filtrosComunes = useCallback(
    () => ({
      anio: anio ? Number(anio) : undefined,
      regional_id: regionalId ? Number(regionalId) : undefined,
      municipio_id: municipioId ? Number(municipioId) : undefined,
      programa_id: programaId ? Number(programaId) : undefined,
      tipo_apoyo_id: conceptoId ? Number(conceptoId) : undefined
    }),
    [anio, regionalId, municipioId, programaId, conceptoId]
  );

  const generarResumen = async () => {
    setCargandoResumen(true);
    setError(null);
    try {
      const respuesta = await generarReporte({ agrupar_por: agruparPor, ...filtrosComunes() });
      setFilasResumen(respuesta.filas);
    } catch {
      setError('No se pudo generar el reporte. Intenta de nuevo.');
      setFilasResumen(null);
    } finally {
      setCargandoResumen(false);
    }
  };

  const exportarResumen = async () => {
    setExportandoResumen(true);
    try {
      const query = armarQueryReporte({ agrupar_por: agruparPor, ...filtrosComunes() });
      const url = await urlConToken(`/api/reportes/solicitudes/export.xlsx?${query}`);
      window.location.assign(url);
    } finally {
      setExportandoResumen(false);
    }
  };

  const generarMatriz = async () => {
    if (filasMatrizDim === columnasMatrizDim) {
      setError('Filas y columnas de la matriz deben ser dimensiones distintas.');
      return;
    }
    setCargandoMatriz(true);
    setError(null);
    try {
      const respuesta = await generarReporte({
        agrupar_por: filasMatrizDim,
        agrupar_por_2: columnasMatrizDim,
        ...filtrosComunes()
      });
      setFilasMatriz(respuesta.filas);
    } catch {
      setError('No se pudo generar la matriz. Intenta de nuevo.');
      setFilasMatriz(null);
    } finally {
      setCargandoMatriz(false);
    }
  };

  const exportarMatriz = async () => {
    setExportandoMatriz(true);
    try {
      const query = armarQueryReporte({
        agrupar_por: filasMatrizDim,
        agrupar_por_2: columnasMatrizDim,
        ...filtrosComunes()
      });
      const url = await urlConToken(`/api/reportes/solicitudes/export.xlsx?${query}`);
      window.location.assign(url);
    } finally {
      setExportandoMatriz(false);
    }
  };

  const generarPadronReporte = async () => {
    setCargandoPadron(true);
    setError(null);
    try {
      const respuesta = await generarPadron(filtrosComunes());
      setFilasPadron(respuesta.filas);
      setPadronTruncado(respuesta.truncado);
    } catch {
      setError('No se pudo generar el padrón. Intenta de nuevo.');
      setFilasPadron(null);
    } finally {
      setCargandoPadron(false);
    }
  };

  const exportarPadron = async () => {
    setExportandoPadron(true);
    try {
      const query = armarQueryPadron(filtrosComunes());
      const url = await urlConToken(`/api/reportes/padron/export.xlsx?${query}`);
      window.location.assign(url);
    } finally {
      setExportandoPadron(false);
    }
  };

  // --- Resumen: orden + totales + datos de la grafica ---------------------
  const filasResumenOrdenadas = useMemo(() => {
    if (!filasResumen) return null;
    const copia = [...filasResumen];
    copia.sort((a, b) =>
      ordenDescendente ? b.monto_autorizado - a.monto_autorizado : a.etiqueta.localeCompare(b.etiqueta)
    );
    return copia;
  }, [filasResumen, ordenDescendente]);

  const totalesResumen = filasResumen?.reduce(
    (acc, f) => ({
      solicitudes: acc.solicitudes + f.solicitudes,
      cantidad: acc.cantidad + f.cantidad,
      cantidad_entregada: acc.cantidad_entregada + f.cantidad_entregada,
      monto_solicitado: acc.monto_solicitado + f.monto_solicitado,
      monto_autorizado: acc.monto_autorizado + f.monto_autorizado,
      monto_entregado: acc.monto_entregado + f.monto_entregado
    }),
    {
      solicitudes: 0,
      cantidad: 0,
      cantidad_entregada: 0,
      monto_solicitado: 0,
      monto_autorizado: 0,
      monto_entregado: 0
    }
  );

  const datosGraficaResumen = useMemo(
    () => ({
      labels: (filasResumenOrdenadas ?? []).map((f) => f.etiqueta),
      datasets: [
        {
          label: 'Monto autorizado',
          data: (filasResumenOrdenadas ?? []).map((f) => f.monto_autorizado),
          backgroundColor: colores.acento,
          borderColor: colores.acento,
          tension: 0.2
        }
      ]
    }),
    [filasResumenOrdenadas, colores]
  );

  // --- Matriz: pivoteo + datos de la grafica -------------------------------
  const paletaSerie = useMemo(
    () => [colores.acento, colores.info, colores.exito, colores.aviso, colores.tenue],
    [colores]
  );

  const matrizPivoteada = useMemo(() => {
    if (!filasMatriz) return null;
    const filasUnicas = Array.from(new Set(filasMatriz.map((f) => f.etiqueta)));
    const columnasUnicas = Array.from(new Set(filasMatriz.map((f) => f.etiqueta2 ?? '')));
    const mapa = new Map(filasMatriz.map((f) => [`${f.etiqueta} ${f.etiqueta2 ?? ''}`, f]));
    const valor = (fila: string, columna: string): number => {
      const f = mapa.get(`${fila} ${columna}`);
      return f ? (f[metricaMatriz] as number) : 0;
    };
    return { filasUnicas, columnasUnicas, valor };
  }, [filasMatriz, metricaMatriz]);

  const datosGraficaMatriz = useMemo(() => {
    if (!matrizPivoteada) return null;
    return {
      labels: matrizPivoteada.filasUnicas,
      datasets: matrizPivoteada.columnasUnicas.map((columna, indice) => ({
        label: columna,
        data: matrizPivoteada.filasUnicas.map((fila) => matrizPivoteada.valor(fila, columna)),
        backgroundColor: paletaSerie[indice % paletaSerie.length]
      }))
    };
  }, [matrizPivoteada, paletaSerie]);

  return (
    <div data-testid="pantalla-reportes">
      <div className="tarjeta">
        <h1>Reportes</h1>
        <p className="dato">
          Resumen, matriz cruzada y padrón con montos de solicitudes vivas — exportables a Excel.
        </p>

        {errorCatalogos && (
          <div className="mensaje error" role="alert" data-testid="error-catalogos-reportes">
            {errorCatalogos}
          </div>
        )}
        {error && (
          <div className="mensaje error" role="alert" data-testid="error-reportes">
            {error}
          </div>
        )}

        <div className="chips" data-testid="vistas-reportes">
          {(
            [
              ['resumen', 'Resumen'],
              ['matriz', 'Matriz cruzada'],
              ['padron', 'Padrón con montos']
            ] as Array<[Vista, string]>
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              className={`chip ${vista === valor ? 'activo' : ''}`}
              data-testid={`vista-reportes-${valor}`}
              onClick={() => setVista(valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <div className="campo">
          <label htmlFor="select-anio">Año</label>
          <select id="select-anio" data-testid="select-anio" value={anio} onChange={(e) => setAnio(e.target.value)}>
            <option value="">Todos</option>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-regional-reporte">Dirección Regional</label>
          <select
            id="select-regional-reporte"
            data-testid="select-regional-reporte"
            value={regionalId}
            onChange={(e) => setRegionalId(e.target.value)}
          >
            <option value="">Todas (dentro de tu alcance)</option>
            {(catalogos?.regionales ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-municipio-reporte">Municipio</label>
          <select
            id="select-municipio-reporte"
            data-testid="select-municipio-reporte"
            value={municipioId}
            onChange={(e) => setMunicipioId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.municipios ?? [])
              .filter((m) => !regionalId || String(m.regional_id) === regionalId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-programa-reporte">Programa</label>
          <select
            id="select-programa-reporte"
            data-testid="select-programa-reporte"
            value={programaId}
            onChange={(e) => setProgramaId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.programas ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-concepto-reporte">Concepto de apoyo</label>
          <select
            id="select-concepto-reporte"
            data-testid="select-concepto-reporte"
            value={conceptoId}
            onChange={(e) => setConceptoId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.conceptos ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {vista === 'resumen' && (
          <>
            <div className="campo">
              <label htmlFor="select-agrupar-por">Agrupar por</label>
              <select
                id="select-agrupar-por"
                data-testid="select-agrupar-por"
                value={agruparPor}
                onChange={(e) => setAgruparPor(e.target.value as DimensionReporte)}
              >
                {DIMENSIONES_REPORTE.map((d) => (
                  <option key={d} value={d}>
                    {ETIQUETAS_DIMENSION[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="select-orden-resumen">Ordenar por</label>
              <select
                id="select-orden-resumen"
                data-testid="select-orden-resumen"
                value={ordenDescendente ? 'monto' : 'nombre'}
                onChange={(e) => setOrdenDescendente(e.target.value === 'monto')}
              >
                <option value="monto">Monto autorizado (mayor a menor)</option>
                <option value="nombre">Nombre</option>
              </select>
            </div>
            <div className="acciones">
              <button
                type="button"
                data-testid="btn-generar-reporte"
                onClick={() => void generarResumen()}
                disabled={cargandoResumen}
              >
                {cargandoResumen ? 'Generando…' : 'Generar reporte'}
              </button>
              <button
                type="button"
                className="secundario"
                data-testid="btn-exportar-reporte"
                onClick={() => void exportarResumen()}
                disabled={exportandoResumen || !filasResumen}
              >
                {exportandoResumen ? 'Exportando…' : 'Exportar a Excel'}
              </button>
            </div>
          </>
        )}

        {vista === 'matriz' && (
          <>
            <div className="campo">
              <label htmlFor="select-matriz-filas">Filas</label>
              <select
                id="select-matriz-filas"
                data-testid="select-matriz-filas"
                value={filasMatrizDim}
                onChange={(e) => setFilasMatrizDim(e.target.value as DimensionReporte)}
              >
                {DIMENSIONES_REPORTE.map((d) => (
                  <option key={d} value={d}>
                    {ETIQUETAS_DIMENSION[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="select-matriz-columnas">Columnas</label>
              <select
                id="select-matriz-columnas"
                data-testid="select-matriz-columnas"
                value={columnasMatrizDim}
                onChange={(e) => setColumnasMatrizDim(e.target.value as DimensionReporte)}
              >
                {DIMENSIONES_REPORTE.map((d) => (
                  <option key={d} value={d}>
                    {ETIQUETAS_DIMENSION[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="select-matriz-valor">Valor</label>
              <select
                id="select-matriz-valor"
                data-testid="select-matriz-valor"
                value={metricaMatriz}
                onChange={(e) => setMetricaMatriz(e.target.value as MetricaValor)}
              >
                {(Object.keys(ETIQUETAS_METRICA) as MetricaValor[]).map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_METRICA[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="acciones">
              <button
                type="button"
                data-testid="btn-generar-matriz"
                onClick={() => void generarMatriz()}
                disabled={cargandoMatriz}
              >
                {cargandoMatriz ? 'Generando…' : 'Generar matriz'}
              </button>
              <button
                type="button"
                className="secundario"
                data-testid="btn-exportar-matriz"
                onClick={() => void exportarMatriz()}
                disabled={exportandoMatriz || !filasMatriz}
              >
                {exportandoMatriz ? 'Exportando…' : 'Exportar a Excel'}
              </button>
            </div>
          </>
        )}

        {vista === 'padron' && (
          <div className="acciones">
            <button
              type="button"
              data-testid="btn-generar-padron"
              onClick={() => void generarPadronReporte()}
              disabled={cargandoPadron}
            >
              {cargandoPadron ? 'Generando…' : 'Generar padrón'}
            </button>
            <button
              type="button"
              className="secundario"
              data-testid="btn-exportar-padron"
              onClick={() => void exportarPadron()}
              disabled={exportandoPadron || !filasPadron}
            >
              {exportandoPadron ? 'Exportando…' : 'Exportar a Excel'}
            </button>
          </div>
        )}
      </div>

      {vista === 'resumen' && filasResumenOrdenadas && (
        <>
          <div className="tarjeta">
            <Grafica
              tipo={agruparPor === 'anio' ? 'line' : 'bar'}
              datos={datosGraficaResumen}
              testId="grafica-resumen-reportes"
            />
          </div>
          <div className="tarjeta" data-testid="tabla-reporte">
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{ETIQUETAS_DIMENSION[agruparPor]}</th>
                    <th>Solicitudes</th>
                    <th>Cantidad</th>
                    <th>Solicitado</th>
                    <th>Autorizado</th>
                    <th>Entregado</th>
                    <th>% avance</th>
                    <th>% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {filasResumenOrdenadas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="vacio">
                        Sin resultados para estos filtros.
                      </td>
                    </tr>
                  )}
                  {filasResumenOrdenadas.map((f) => {
                    const avance = f.monto_autorizado > 0 ? (f.monto_entregado / f.monto_autorizado) * 100 : 0;
                    const delTotal =
                      totalesResumen && totalesResumen.monto_autorizado > 0
                        ? (f.monto_autorizado / totalesResumen.monto_autorizado) * 100
                        : 0;
                    return (
                      <tr key={f.etiqueta}>
                        <td>{f.etiqueta}</td>
                        <td>{formatoNumero.format(f.solicitudes)}</td>
                        <td>{formatoNumero.format(f.cantidad)}</td>
                        <td>{formatoMoneda.format(f.monto_solicitado)}</td>
                        <td>{formatoMoneda.format(f.monto_autorizado)}</td>
                        <td>{formatoMoneda.format(f.monto_entregado)}</td>
                        <td>{formatoNumero.format(avance)}%</td>
                        <td>{formatoNumero.format(delTotal)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                {totalesResumen && filasResumenOrdenadas.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td>
                        <strong>{formatoNumero.format(totalesResumen.solicitudes)}</strong>
                      </td>
                      <td>
                        <strong>{formatoNumero.format(totalesResumen.cantidad)}</strong>
                      </td>
                      <td>
                        <strong>{formatoMoneda.format(totalesResumen.monto_solicitado)}</strong>
                      </td>
                      <td>
                        <strong>{formatoMoneda.format(totalesResumen.monto_autorizado)}</strong>
                      </td>
                      <td>
                        <strong>{formatoMoneda.format(totalesResumen.monto_entregado)}</strong>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {vista === 'matriz' && matrizPivoteada && datosGraficaMatriz && (
        <>
          <div className="tarjeta">
            <Grafica tipo="bar" datos={datosGraficaMatriz} testId="grafica-matriz-reportes" />
          </div>
          <div className="tarjeta" data-testid="tabla-matriz-reportes">
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{ETIQUETAS_DIMENSION[filasMatrizDim]}</th>
                    {matrizPivoteada.columnasUnicas.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrizPivoteada.filasUnicas.length === 0 && (
                    <tr>
                      <td colSpan={matrizPivoteada.columnasUnicas.length + 2} className="vacio">
                        Sin resultados para estos filtros.
                      </td>
                    </tr>
                  )}
                  {matrizPivoteada.filasUnicas.map((fila) => {
                    const valores = matrizPivoteada.columnasUnicas.map((c) => matrizPivoteada.valor(fila, c));
                    const total = valores.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={fila}>
                        <td>{fila}</td>
                        {valores.map((v, i) => (
                          <td key={matrizPivoteada.columnasUnicas[i]}>{formatoValor(metricaMatriz, v)}</td>
                        ))}
                        <td>
                          <strong>{formatoValor(metricaMatriz, total)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {vista === 'padron' && filasPadron && (
        <div className="tarjeta" data-testid="tabla-padron-reportes">
          {padronTruncado && (
            <p className="dato">
              Mostrando los primeros {filasPadron.length} renglones en pantalla — exporta a Excel para ver el
              padrón completo.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Beneficiario</th>
                  <th>Municipio</th>
                  <th>Concepto</th>
                  <th>Cantidad</th>
                  <th>Monto</th>
                  <th>Entregado</th>
                </tr>
              </thead>
              <tbody>
                {filasPadron.length === 0 && (
                  <tr>
                    <td colSpan={6} className="vacio">
                      Sin resultados para estos filtros.
                    </td>
                  </tr>
                )}
                {filasPadron.map((f, indice) => (
                  <tr key={`${f.curp ?? f.beneficiario}-${indice}`}>
                    <td>{f.beneficiario}</td>
                    <td>{f.municipio}</td>
                    <td>{f.concepto}</td>
                    <td>
                      {formatoNumero.format(f.cantidad)}
                      {f.unidad_medida ? ` ${f.unidad_medida}` : ''}
                    </td>
                    <td>{formatoMoneda.format(f.monto_estatal)}</td>
                    <td>{f.entregado ? 'Sí' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
