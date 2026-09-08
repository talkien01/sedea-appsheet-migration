// Modulo de Reportes (Beta): resumen agrupable de solicitudes vivas.
// [data-testid="pantalla-reportes"]
//
// Alcance deliberado de esta primera version -- ver comentario completo en
// packages/shared/src/reportes.ts. En corto: un solo nivel de agrupacion a la
// vez, solo datos vivos (nunca el historico de CATALOGOS/PIIPC), exporta a
// Excel con formato.
import { useCallback, useEffect, useState } from 'react';
import {
  DIMENSIONES_REPORTE,
  ETIQUETAS_DIMENSION,
  type DimensionReporte,
  type FilaReporte
} from '@sedea/shared';
import { urlConToken } from '../api/cliente';
import { armarQueryReporte, catalogosReporte, generarReporte, type CatalogosReporte } from '../api/reportes';

const formatoNumero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
});

export default function Reportes() {
  const [catalogos, setCatalogos] = useState<CatalogosReporte | null>(null);
  const [agruparPor, setAgruparPor] = useState<DimensionReporte>('regional');
  const [anio, setAnio] = useState('');
  const [regionalId, setRegionalId] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [programaId, setProgramaId] = useState('');
  const [conceptoId, setConceptoId] = useState('');

  const [filas, setFilas] = useState<FilaReporte[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void catalogosReporte()
      .then(setCatalogos)
      .catch(() => setError('No se pudieron cargar los catálogos de filtros.'));
  }, []);

  const filtrosActuales = useCallback(
    () => ({
      agrupar_por: agruparPor,
      anio: anio ? Number(anio) : undefined,
      regional_id: regionalId ? Number(regionalId) : undefined,
      municipio_id: municipioId ? Number(municipioId) : undefined,
      programa_id: programaId ? Number(programaId) : undefined,
      tipo_apoyo_id: conceptoId ? Number(conceptoId) : undefined
    }),
    [agruparPor, anio, regionalId, municipioId, programaId, conceptoId]
  );

  const generar = async () => {
    setCargando(true);
    setError(null);
    try {
      const respuesta = await generarReporte(filtrosActuales());
      setFilas(respuesta.filas);
    } catch {
      setError('No se pudo generar el reporte. Intenta de nuevo.');
      setFilas(null);
    } finally {
      setCargando(false);
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const query = armarQueryReporte(filtrosActuales());
      const url = await urlConToken(`/api/reportes/solicitudes/export.xlsx?${query}`);
      window.location.assign(url);
    } finally {
      setExportando(false);
    }
  };

  const totales = filas?.reduce(
    (acc, f) => ({
      solicitudes: acc.solicitudes + f.solicitudes,
      cantidad: acc.cantidad + f.cantidad,
      monto_autorizado: acc.monto_autorizado + f.monto_autorizado
    }),
    { solicitudes: 0, cantidad: 0, monto_autorizado: 0 }
  );

  return (
    <div data-testid="pantalla-reportes">
      <div className="tarjeta">
        <h1>Reportes</h1>
        <p className="dato">
          Resumen de solicitudes vivas, agrupado y exportable a Excel. Beta: un solo nivel de
          agrupación a la vez.
        </p>

        {error && (
          <div className="mensaje error" role="alert" data-testid="error-reportes">
            {error}
          </div>
        )}

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

        <div className="acciones">
          <button type="button" data-testid="btn-generar-reporte" onClick={() => void generar()} disabled={cargando}>
            {cargando ? 'Generando…' : 'Generar reporte'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-exportar-reporte"
            onClick={() => void exportar()}
            disabled={exportando || !filas}
          >
            {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      {filas && (
        <div className="tarjeta" data-testid="tabla-reporte">
          <table>
            <thead>
              <tr>
                <th>{ETIQUETAS_DIMENSION[agruparPor]}</th>
                <th>Solicitudes</th>
                <th>Cantidad</th>
                <th>Monto autorizado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={4} className="vacio">
                    Sin resultados para estos filtros.
                  </td>
                </tr>
              )}
              {filas.map((f) => (
                <tr key={f.etiqueta}>
                  <td>{f.etiqueta}</td>
                  <td>{formatoNumero.format(f.solicitudes)}</td>
                  <td>{formatoNumero.format(f.cantidad)}</td>
                  <td>{formatoMoneda.format(f.monto_autorizado)}</td>
                </tr>
              ))}
            </tbody>
            {totales && filas.length > 0 && (
              <tfoot>
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{formatoNumero.format(totales.solicitudes)}</strong>
                  </td>
                  <td>
                    <strong>{formatoNumero.format(totales.cantidad)}</strong>
                  </td>
                  <td>
                    <strong>{formatoMoneda.format(totales.monto_autorizado)}</strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
