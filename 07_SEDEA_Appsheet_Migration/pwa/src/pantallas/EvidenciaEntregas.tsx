// Visor de "Evidencia de entregas": listado filtrable de las fotos de entrega
// del apoyo (`entregas_apoyo`), con panel de detalle y exportacion a Excel.
// [data-testid="pantalla-evidencia-entregas"]
//
// Hasta ahora NO existia: las fotos de la Parte 2 se subian y guardaban pero
// ninguna pantalla las mostraba (a diferencia del Expediente de la Parte 1).
// Es una vista de REVISION -- guardada por rol de supervision (ver
// ROLES_VER_EVIDENCIA_ENTREGAS) y acotada a la Regional del usuario por el
// backend, igual que Reportes.
import { useCallback, useEffect, useState } from 'react';
import { LIMITE_EVIDENCIA_PANTALLA, type CatalogosEvidencia, type FilaEvidencia } from '@sedea/shared';
import { urlConToken } from '../api/cliente';
import { obtenerSesion } from '../db/repositorios';
import { armarQueryEvidencia, catalogosEvidencia, listarEvidencia } from '../api/evidenciaEntregas';

const formatoNumero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

function formatoFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function cantidad(f: FilaEvidencia): string {
  return `${formatoNumero.format(f.cantidad)}${f.unidad_medida ? ` ${f.unidad_medida}` : ''}`;
}

export default function EvidenciaEntregas() {
  const [token, setToken] = useState<string | null>(null);
  const [catalogos, setCatalogos] = useState<CatalogosEvidencia | null>(null);
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null);

  const [regionalId, setRegionalId] = useState('');
  const [conceptoId, setConceptoId] = useState('');
  const [entregadorId, setEntregadorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [filas, setFilas] = useState<FilaEvidencia[] | null>(null);
  const [resumen, setResumen] = useState<{
    total: number;
    con_gps: number;
    sin_gps: number;
    ultimas_24h: number;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<FilaEvidencia | null>(null);

  useEffect(() => {
    void (async () => {
      setToken((await obtenerSesion())?.token ?? null);
      try {
        setCatalogos(await catalogosEvidencia());
      } catch {
        setErrorCatalogos('No se pudieron cargar los catálogos de filtros.');
      }
    })();
  }, []);

  const filtrosActuales = useCallback(
    () => ({
      regional_id: regionalId ? Number(regionalId) : undefined,
      tipo_apoyo_id: conceptoId ? Number(conceptoId) : undefined,
      entregado_por: entregadorId ? Number(entregadorId) : undefined,
      desde: desde || undefined,
      hasta: hasta || undefined
    }),
    [regionalId, conceptoId, entregadorId, desde, hasta]
  );

  const generar = useCallback(
    async (mas = false) => {
      setCargando(true);
      setError(null);
      try {
        const inicio = mas ? offset : 0;
        const respuesta = await listarEvidencia({
          ...filtrosActuales(),
          offset: inicio || undefined
        });
        setResumen({
          total: respuesta.total,
          con_gps: respuesta.con_gps,
          sin_gps: respuesta.sin_gps,
          ultimas_24h: respuesta.ultimas_24h
        });
        setFilas(mas ? [...(filas ?? []), ...respuesta.filas] : respuesta.filas);
        setOffset(inicio + respuesta.filas.length);
        if (!mas) setSeleccion(null);
      } catch {
        setError('No se pudo cargar la evidencia. Intenta de nuevo.');
        if (!mas) setFilas(null);
      } finally {
        setCargando(false);
      }
    },
    [filtrosActuales, offset, filas]
  );

  const exportar = async () => {
    setExportando(true);
    try {
      const query = armarQueryEvidencia(filtrosActuales());
      const url = await urlConToken(`/api/entregas/evidencia/export.xlsx${query ? `?${query}` : ''}`);
      window.location.assign(url);
    } finally {
      setExportando(false);
    }
  };

  const fotoSrc = (u: string) => (token ? `${u}?token=${encodeURIComponent(token)}` : u);
  const hayMas = resumen !== null && filas !== null && filas.length < resumen.total;

  return (
    <div data-testid="pantalla-evidencia-entregas">
      <div className="tarjeta">
        <h1>Evidencia de entregas</h1>
        <p className="dato">
          Fotos de la entrega física del apoyo, con folio, beneficiario, GPS y fecha. Filtrable y
          exportable a Excel.
        </p>

        {errorCatalogos && (
          <div className="mensaje error" role="alert" data-testid="error-catalogos-evidencia">
            {errorCatalogos}
          </div>
        )}
        {error && (
          <div className="mensaje error" role="alert" data-testid="error-evidencia">
            {error}
          </div>
        )}

        <div className="campo">
          <label htmlFor="select-regional-evidencia">Dirección Regional</label>
          <select
            id="select-regional-evidencia"
            data-testid="select-regional-evidencia"
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
          <label htmlFor="select-concepto-evidencia">Concepto de apoyo</label>
          <select
            id="select-concepto-evidencia"
            data-testid="select-concepto-evidencia"
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

        <div className="campo">
          <label htmlFor="select-entregador-evidencia">Registró la entrega</label>
          <select
            id="select-entregador-evidencia"
            data-testid="select-entregador-evidencia"
            value={entregadorId}
            onChange={(e) => setEntregadorId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.entregadores ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-desde-evidencia">Entregado desde</label>
          <input
            id="input-desde-evidencia"
            data-testid="input-desde-evidencia"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-hasta-evidencia">Entregado hasta</label>
          <input
            id="input-hasta-evidencia"
            data-testid="input-hasta-evidencia"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>

        <div className="acciones">
          <button
            type="button"
            data-testid="btn-generar-evidencia"
            onClick={() => void generar(false)}
            disabled={cargando}
          >
            {cargando ? 'Cargando…' : 'Ver evidencia'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-exportar-evidencia"
            onClick={() => void exportar()}
            disabled={exportando || !filas}
          >
            {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      {resumen && (
        <div
          className="tarjetas-resumen"
          data-testid="resumen-evidencia"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}
        >
          <div className="tarjeta">
            <p className="dato">Con ubicación GPS</p>
            <strong style={{ fontSize: 22 }}>{formatoNumero.format(resumen.con_gps)}</strong>
          </div>
          <div className="tarjeta">
            <p className="dato">Sin GPS (marcado)</p>
            <strong style={{ fontSize: 22 }}>{formatoNumero.format(resumen.sin_gps)}</strong>
          </div>
          <div className="tarjeta">
            <p className="dato">Últimas 24 horas</p>
            <strong style={{ fontSize: 22 }}>{formatoNumero.format(resumen.ultimas_24h)}</strong>
          </div>
        </div>
      )}

      {seleccion && (
        <div className="tarjeta" data-testid="detalle-evidencia">
          <img
            src={fotoSrc(seleccion.foto_url)}
            alt={`Evidencia de la entrega a ${seleccion.beneficiario}`}
            style={{ width: '100%', maxHeight: '55vh', objectFit: 'contain', borderRadius: 12, background: 'var(--bg-elev-2)' }}
          />
          <table style={{ width: '100%', marginTop: 12 }}>
            <tbody>
              <tr>
                <td className="dato">Beneficiario</td>
                <td>{seleccion.beneficiario}</td>
              </tr>
              <tr>
                <td className="dato">Folio</td>
                <td>{seleccion.folio}</td>
              </tr>
              <tr>
                <td className="dato">Concepto</td>
                <td>
                  {seleccion.concepto} · {cantidad(seleccion)}
                </td>
              </tr>
              <tr>
                <td className="dato">Regional / Municipio</td>
                <td>
                  {seleccion.regional}
                  {seleccion.municipio ? ` · ${seleccion.municipio}` : ''}
                </td>
              </tr>
              <tr>
                <td className="dato">Entregado</td>
                <td>{formatoFecha(seleccion.entregado_en)}</td>
              </tr>
              <tr>
                <td className="dato">Registró</td>
                <td>{seleccion.entregado_por}</td>
              </tr>
              <tr>
                <td className="dato">Ubicación</td>
                <td>
                  {seleccion.sin_gps || seleccion.lat === null || seleccion.lng === null ? (
                    'Sin GPS (marcado en campo)'
                  ) : (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${seleccion.lat}&mlon=${seleccion.lng}#map=17/${seleccion.lat}/${seleccion.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {seleccion.lat.toFixed(5)}, {seleccion.lng.toFixed(5)}
                      {seleccion.precision_m !== null ? ` · ±${Math.round(seleccion.precision_m)} m` : ''}
                    </a>
                  )}
                </td>
              </tr>
              {seleccion.observaciones && (
                <tr>
                  <td className="dato">Observaciones</td>
                  <td>{seleccion.observaciones}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="acciones">
            <a
              className="boton secundario"
              href={fotoSrc(seleccion.foto_url)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="btn-abrir-foto-evidencia"
            >
              Abrir foto en tamaño real
            </a>
            <button type="button" className="secundario" onClick={() => setSeleccion(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {filas && (
        <div className="tarjeta" data-testid="grilla-evidencia">
          {filas.length === 0 ? (
            <p className="vacio">Sin entregas con evidencia para estos filtros.</p>
          ) : (
            <>
              <p className="dato">
                {formatoNumero.format(filas.length)} de {formatoNumero.format(resumen?.total ?? filas.length)}{' '}
                entregas con evidencia
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {filas.map((f) => (
                  <button
                    key={f.uuid}
                    type="button"
                    data-testid={`evidencia-tarjeta-${f.uuid}`}
                    onClick={() => setSeleccion(f)}
                    style={{
                      textAlign: 'left',
                      padding: 0,
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--bg-elev-2)',
                      cursor: 'pointer'
                    }}
                  >
                    <img
                      src={fotoSrc(f.foto_url)}
                      alt={`Evidencia de ${f.beneficiario}`}
                      loading="lazy"
                      style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: '8px 10px 10px' }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{f.beneficiario}</p>
                      <p className="dato" style={{ margin: '2px 0 0', fontSize: 11 }}>
                        {f.folio}
                      </p>
                      <p className="dato" style={{ margin: '2px 0 0', fontSize: 11 }}>
                        {f.concepto} · {cantidad(f)}
                      </p>
                      <p className="dato" style={{ margin: '2px 0 6px', fontSize: 11 }}>
                        {f.municipio ?? f.regional} · {formatoFecha(f.entregado_en)}
                      </p>
                      <span
                        className={`badge ${f.sin_gps ? 'alerta-media' : 'capturado'}`}
                        data-testid={`evidencia-gps-${f.uuid}`}
                      >
                        {f.sin_gps ? 'sin GPS' : 'GPS'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {hayMas && (
                <div className="acciones">
                  <button
                    type="button"
                    className="secundario"
                    data-testid="btn-cargar-mas-evidencia"
                    onClick={() => void generar(true)}
                    disabled={cargando}
                  >
                    {cargando ? 'Cargando…' : `Cargar más (${LIMITE_EVIDENCIA_PANTALLA})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
