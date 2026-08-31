// Padrón administrativo de beneficiarios. A diferencia de Beneficiarios.tsx,
// esta pantalla NO usa IndexedDB: cada consulta va al backend y refleja el
// estado vigente de PostgreSQL. Pensada para auditoría/gestión desde PC.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Beneficiario, PaginaBeneficiarios, RespuestaCatalogos } from '@sedea/shared';
import { useSesion } from '../App';
import { peticion, URL_API } from '../api/cliente';
import { obtenerSesion } from '../db/repositorios';
import { useEstadoRed } from '../sync/estadoRed';

const OPCIONES_POR_PAGINA = [25, 50, 100, 200] as const;
const POR_PAGINA_PREDETERMINADO = 50;

function descargarBlob(blob: Blob, nombre: string): void {
  const enlace = document.createElement('a');
  const url = URL.createObjectURL(blob);
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function cantidad(valor: number | null): string {
  if (valor === null || valor === undefined) return '—';
  const numero = Number(valor);
  return Number.isFinite(numero)
    ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(numero)
    : String(valor);
}

export default function BeneficiariosOnline() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [catalogos, setCatalogos] = useState<RespuestaCatalogos | null>(null);
  const [filas, setFilas] = useState<Beneficiario[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(POR_PAGINA_PREDETERMINADO);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [regionalId, setRegionalId] = useState(
    perfil?.regional_id ? String(perfil.regional_id) : ''
  );
  const [municipioId, setMunicipioId] = useState('');

  useEffect(() => {
    if (!enLinea) return;
    void (async () => {
      try {
        const respuesta = await peticion<RespuestaCatalogos>('/catalogos');
        setCatalogos(respuesta);
        // Un auditor Regional queda anclado por backend. Reflejamos ese alcance
        // en el filtro sin depender de lo que mande el navegador.
        if (perfil?.regional_id) setRegionalId(String(perfil.regional_id));
      } catch {
        setError('No se pudieron cargar los catálogos.');
      }
    })();
  }, [enLinea, perfil?.regional_id]);

  const municipiosVisibles = useMemo(() => {
    const municipios = catalogos?.municipios ?? [];
    if (!regionalId) return municipios;
    return municipios.filter((m) => Number(m.regional_id) === Number(regionalId));
  }, [catalogos, regionalId]);

  const armarParametros = useCallback(
    (paginaPedida: number, incluirPaginacion = true) => {
      const parametros = new URLSearchParams();
      if (incluirPaginacion) {
        parametros.set('page', String(paginaPedida));
        parametros.set('page_size', String(porPagina));
      }
      if (busqueda.trim()) parametros.set('q', busqueda.trim());
      if (regionalId) parametros.set('regional_id', regionalId);
      if (municipioId) parametros.set('municipio_id', municipioId);
      return parametros;
    },
    [busqueda, regionalId, municipioId, porPagina]
  );

  const cargarPagina = useCallback(
    async (paginaPedida: number) => {
      setCargando(true);
      setError(null);
      try {
        const parametros = armarParametros(paginaPedida);
        const resultado = await peticion<PaginaBeneficiarios>(
          `/beneficiarios?${parametros.toString()}`
        );
        setFilas(resultado.data);
        setTotal(resultado.total);
        setPagina(resultado.page);
      } catch {
        setError('No se pudo consultar el padrón de beneficiarios.');
      } finally {
        setCargando(false);
      }
    },
    [armarParametros]
  );

  // Los filtros consultan directamente al servidor. El debounce evita una
  // petición por tecla y cualquier cambio vuelve a la primera página.
  useEffect(() => {
    if (!enLinea) return;
    setPagina(1);
    const temporizador = setTimeout(() => void cargarPagina(1), 300);
    return () => clearTimeout(temporizador);
  }, [cargarPagina, enLinea]);

  const totalPaginas = total === 0 ? 0 : Math.ceil(total / porPagina);
  const primerRegistro = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const ultimoRegistro =
    total === 0 ? 0 : Math.min((pagina - 1) * porPagina + filas.length, total);

  const exportarCsv = async () => {
    if (!enLinea || exportando) return;
    setExportando(true);
    setError(null);
    try {
      const sesion = await obtenerSesion();
      const parametros = armarParametros(1, false);
      const respuesta = await fetch(`${URL_API}/beneficiarios/export.csv?${parametros.toString()}`, {
        headers: sesion?.token ? { Authorization: `Bearer ${sesion.token}` } : undefined
      });
      if (!respuesta.ok) throw new Error('export');
      descargarBlob(
        await respuesta.blob(),
        `beneficiarios_en_linea_${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      setError('No fue posible exportar el padrón.');
    } finally {
      setExportando(false);
    }
  };

  if (!enLinea) {
    return (
      <div className="tarjeta">
        <h1>Beneficiarios en línea</h1>
        <p className="vacio">
          Esta sección de Gestión consulta el padrón vigente del servidor y requiere conexión a
          internet.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Beneficiarios en línea</h1>
        <p className="dato">
          Consulta administrativa de solo lectura. Los resultados se obtienen directamente del
          servidor; no requieren sincronización ni se leen de la copia offline del dispositivo.
        </p>
        <p className="dato">
          {perfil?.regional_id
            ? `Alcance: ${perfil.regional_nombre ?? 'Dirección Regional asignada'}.`
            : 'Alcance: SEDEA Central / consulta estatal, sujeto a los permisos de la cuenta.'}
        </p>
      </div>

      <div className="tarjeta">
        <h2>Filtros</h2>
        <div className="campo">
          <label htmlFor="beneficiarios-online-busqueda">Nombre, CURP o folio</label>
          <input
            id="beneficiarios-online-busqueda"
            data-testid="input-beneficiarios-online-busqueda"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en el padrón vigente"
          />
        </div>

        <div className="rejilla">
          <div className="campo">
            <label htmlFor="beneficiarios-online-regional">Dirección Regional</label>
            <select
              id="beneficiarios-online-regional"
              data-testid="select-beneficiarios-online-regional"
              value={regionalId}
              disabled={Boolean(perfil?.regional_id)}
              onChange={(e) => {
                setRegionalId(e.target.value);
                setMunicipioId('');
              }}
            >
              <option value="">Todas</option>
              {(catalogos?.regionales ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="beneficiarios-online-municipio">Municipio</label>
            <select
              id="beneficiarios-online-municipio"
              data-testid="select-beneficiarios-online-municipio"
              value={municipioId}
              onChange={(e) => setMunicipioId(e.target.value)}
            >
              <option value="">Todos</option>
              {municipiosVisibles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="tarjeta">
        <div className="rejilla" style={{ alignItems: 'end' }}>
          <div>
            <h2>Padrón vigente ({total})</h2>
            <p className="dato" data-testid="resumen-beneficiarios-online">
              Mostrando {primerRegistro}–{ultimoRegistro} de {total} beneficiarios filtrados.
            </p>
          </div>

          <div className="campo">
            <label htmlFor="beneficiarios-online-por-pagina">Mostrar por página</label>
            <select
              id="beneficiarios-online-por-pagina"
              data-testid="select-beneficiarios-online-por-pagina"
              value={porPagina}
              onChange={(e) => setPorPagina(Number(e.target.value))}
            >
              {OPCIONES_POR_PAGINA.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="acciones" style={{ marginBottom: '12px' }}>
          <button
            type="button"
            className="secundario"
            data-testid="btn-exportar-beneficiarios-online"
            disabled={exportando || cargando}
            onClick={() => void exportarCsv()}
          >
            {exportando ? 'Exportando…' : '⬇️ Exportar CSV filtrado'}
          </button>
        </div>

        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
        {cargando && <p className="vacio">Consultando servidor…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && total > 0 && (
          <div className="acciones" style={{ marginBottom: '12px' }}>
            <button
              type="button"
              className="secundario"
              data-testid="btn-beneficiarios-online-anterior"
              disabled={pagina <= 1}
              onClick={() => void cargarPagina(pagina - 1)}
            >
              ‹ Anterior
            </button>
            <span className="dato" data-testid="pagina-beneficiarios-online-actual">
              Página {pagina} de {totalPaginas}
            </span>
            <button
              type="button"
              className="secundario"
              data-testid="btn-beneficiarios-online-siguiente"
              disabled={pagina >= totalPaginas}
              onClick={() => void cargarPagina(pagina + 1)}
            >
              Siguiente ›
            </button>
          </div>
        )}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-beneficiarios-online">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Beneficiario</th>
                  <th>CURP</th>
                  <th>Regional</th>
                  <th>Municipio</th>
                  <th>Localidad</th>
                  <th>Concepto de apoyo</th>
                  <th>Cantidad</th>
                  <th>Teléfono</th>
                  <th>Capturas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.folio}</td>
                    <td>{b.nombre_completo}</td>
                    <td className="mono">{b.curp || 'Sin CURP'}</td>
                    <td>{b.regional_nombre ?? '—'}</td>
                    <td>{b.municipio_nombre ?? '—'}</td>
                    <td>{b.localidad ?? '—'}</td>
                    <td>{b.tipo_apoyo_nombre ?? '—'}</td>
                    <td>{cantidad(b.cantidad_asignada)}</td>
                    <td>{b.telefono ?? '—'}</td>
                    <td>{Number(b.total_capturas ?? 0)}</td>
                    <td>
                      <Link
                        className="boton secundario"
                        to={`/auditoria/beneficiario/${b.id}`}
                        data-testid={`ver-beneficiario-online-${b.id}`}
                      >
                        Ver expediente
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
