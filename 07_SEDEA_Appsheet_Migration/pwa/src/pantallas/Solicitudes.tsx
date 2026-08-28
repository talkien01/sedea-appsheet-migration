// Listado de Solicitudes de Apoyo recibidas en ventanilla (12.8.1).
// Pantalla de oficina, EN LINEA: sin almacenamiento local ni cola offline.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CatalogosVentanilla, FilaSolicitud } from '@sedea/shared';
import { apiSolicitudes } from '../api/solicitudes';
import { useEstadoRed } from '../sync/estadoRed';

const TAMANO_PAGINA = 50;

export default function Solicitudes() {
  const enLinea = useEstadoRed();
  const [catalogos, setCatalogos] = useState<CatalogosVentanilla | null>(null);
  const [filas, setFilas] = useState<FilaSolicitud[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [componenteId, setComponenteId] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  useEffect(() => {
    if (!enLinea) return;
    void (async () => {
      try {
        setCatalogos(await apiSolicitudes.catalogos());
      } catch {
        setError('No se pudieron cargar los catálogos.');
      }
    })();
  }, [enLinea]);

  const armarParametros = useCallback(
    (paginaPedida: number) => {
      const parametros = new URLSearchParams({
        page: String(paginaPedida),
        page_size: String(TAMANO_PAGINA)
      });
      if (busqueda.trim()) parametros.set('q', busqueda.trim());
      if (componenteId) parametros.set('componente_id', componenteId);
      if (municipioId) parametros.set('municipio_id', municipioId);
      if (desde) parametros.set('desde', `${desde}T00:00:00Z`);
      if (hasta) parametros.set('hasta', `${hasta}T23:59:59Z`);
      return parametros;
    },
    [busqueda, componenteId, municipioId, desde, hasta]
  );

  // Nueva búsqueda: siempre vuelve a la página 1 y reemplaza los resultados.
  const buscar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const pagina = await apiSolicitudes.listar(armarParametros(1));
      setFilas(pagina.data);
      setTotal(pagina.total);
      setPagina(1);
    } catch {
      setError('No se pudieron cargar las solicitudes.');
    } finally {
      setCargando(false);
    }
  }, [armarParametros]);

  // "Cargar más": pide la siguiente página y la agrega al final, sin perder
  // lo que ya se ve (los filtros no cambiaron, solo se pide más).
  const cargarMas = useCallback(async () => {
    setCargandoMas(true);
    setError(null);
    try {
      const siguiente = pagina + 1;
      const pagina2 = await apiSolicitudes.listar(armarParametros(siguiente));
      setFilas((previas) => [...previas, ...pagina2.data]);
      setTotal(pagina2.total);
      setPagina(siguiente);
    } catch {
      setError('No se pudieron cargar más solicitudes.');
    } finally {
      setCargandoMas(false);
    }
  }, [armarParametros, pagina]);

  // Debounce de 300 ms para no golpear la API en cada tecla.
  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void buscar(), 300);
    return () => clearTimeout(temporizador);
  }, [buscar, enLinea]);

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Solicitudes de apoyo</h1>
        <p className="dato">
          Captura en ventanilla de la Solicitud de Apoyo. Al guardarla se genera el folio oficial
          y se da de alta un beneficiario por cada concepto solicitado.
        </p>
        {/* En movil esta accion pasa a FAB flotante sobre la barra inferior. */}
        <Link
          className="boton fab"
          to="/solicitudes/nueva"
          data-testid="btn-nueva-solicitud"
        >
          Nueva solicitud
        </Link>
      </div>

      <div className="tarjeta">
        <h2>Filtros</h2>
        <div className="campo">
          <label htmlFor="input-busqueda">Folio, nombre del solicitante o CURP</label>
          <input
            id="input-busqueda"
            data-testid="input-busqueda"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="select-componente">Componente</label>
          <select
            id="select-componente"
            data-testid="select-componente"
            value={componenteId}
            onChange={(e) => setComponenteId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.componentes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.clave} — {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-municipio">Municipio del apoyo</label>
          <select
            id="select-municipio"
            data-testid="select-municipio"
            value={municipioId}
            onChange={(e) => setMunicipioId(e.target.value)}
          >
            <option value="">Todos</option>
            {(catalogos?.municipios ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-desde">Desde</label>
          <input
            id="input-desde"
            data-testid="input-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-hasta">Hasta</label>
          <input
            id="input-hasta"
            data-testid="input-hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
      </div>

      <div className="tarjeta">
        <h2>Recibidas ({filas.length} de {total})</h2>
        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
        {cargando && <p className="vacio">Cargando…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-solicitudes">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha</th>
                  <th>Solicitante</th>
                  <th>Tipo de persona</th>
                  <th>Componente</th>
                  <th>Municipio</th>
                  <th>Capturada por</th>
                  <th>Conceptos</th>
                  <th>Documentos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} data-testid="fila-solicitud">
                    <td data-etiqueta="Folio" className="mono">{f.folio}</td>
                    <td data-etiqueta="Fecha">{new Date(f.recibida_en).toLocaleDateString('es-MX')}</td>
                    <td data-etiqueta="Solicitante">{f.nombre_solicitante}</td>
                    <td data-etiqueta="Tipo de persona">{f.tipo_persona}</td>
                    <td data-etiqueta="Componente">{f.componente}</td>
                    <td data-etiqueta="Municipio">{f.municipio ?? '—'}</td>
                    <td data-etiqueta="Capturada por">{f.capturado_por_nombre ?? '—'}</td>
                    <td data-etiqueta="Conceptos">{f.conceptos}</td>
                    <td data-etiqueta="Documentos">{f.documentos_recibidos}</td>
                    <td data-etiqueta="">
                      <Link to={`/solicitudes/${f.id}`}>Ver</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!cargando && filas.length > 0 && filas.length < total && (
          <button
            type="button"
            className="boton secundario"
            data-testid="btn-cargar-mas"
            onClick={() => void cargarMas()}
            disabled={cargandoMas}
          >
            {cargandoMas ? 'Cargando…' : `Cargar más (${total - filas.length} restantes)`}
          </button>
        )}
      </div>
    </>
  );
}
