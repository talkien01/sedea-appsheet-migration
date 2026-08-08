// Panel de auditoria: filtros, tabla, mapa Leaflet y exportacion CSV.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DireccionRegional, Municipio } from '@sedea/shared';
import { api, ErrorPeticion, URL_API } from '../api/cliente';
import MapaCapturas, { type PuntoCaptura } from '../componentes/MapaCapturas';
import { obtenerSesion } from '../db/repositorios';
import { formatearFecha } from './Sync';

interface FilaAuditoria {
  uuid: string;
  foto_url: string;
  lat: number;
  lng: number;
  precision_m: number;
  capturado_en: string;
  capturista: string | null;
  beneficiario: {
    id: number;
    folio: string;
    nombre_completo: string;
    curp: string | null;
    regional_nombre: string | null;
    municipio_nombre: string | null;
    municipio_id: number | null;
    colonia: string | null;
    seccion: string | null;
  };
}

const TAMANO_PAGINA = 50;

export default function Auditoria() {
  const [regionales, setRegionales] = useState<DireccionRegional[]>([]);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);

  const [regionalId, setRegionalId] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<FilaAuditoria[]>([]);
  const [total, setTotal] = useState(0);
  const [centro, setCentro] = useState<{ lat: number; lng: number } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const sesion = await obtenerSesion();
      setToken(sesion?.token ?? null);
      try {
        const catalogos = await api.catalogos();
        setRegionales(catalogos.regionales);
        setMunicipios(catalogos.municipios);
      } catch {
        setError('No fue posible cargar los catálogos.');
      }
    })();
  }, []);

  const parametros = useMemo(() => {
    const p = new URLSearchParams({ page: String(pagina), page_size: String(TAMANO_PAGINA) });
    if (regionalId) p.set('regional_id', regionalId);
    if (municipioId) p.set('municipio_id', municipioId);
    // El rango de fechas cubre el dia completo indicado.
    if (desde) p.set('desde', `${desde}T00:00:00.000Z`);
    if (hasta) p.set('hasta', `${hasta}T23:59:59.999Z`);
    if (texto.trim()) p.set('q', texto.trim());
    return p;
  }, [pagina, regionalId, municipioId, desde, hasta, texto]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const respuesta = await api.auditoriaCapturas(parametros);
      setFilas(respuesta.data as FilaAuditoria[]);
      setTotal(respuesta.total);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion ? fallo.message : 'No fue posible consultar las capturas.'
      );
      setFilas([]);
      setTotal(0);
    } finally {
      setCargando(false);
    }
  }, [parametros]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const municipiosVisibles = useMemo(
    () => (regionalId ? municipios.filter((m) => String(m.regional_id) === regionalId) : municipios),
    [municipios, regionalId]
  );

  const puntos: PuntoCaptura[] = filas.map((f) => ({
    uuid: f.uuid,
    lat: f.lat,
    lng: f.lng,
    titulo: f.beneficiario.nombre_completo,
    fecha: formatearFecha(f.capturado_en),
    fotoSrc: token ? `${f.foto_url}?token=${encodeURIComponent(token)}` : null
  }));

  const exportarCsv = async () => {
    const p = new URLSearchParams(parametros);
    p.delete('page');
    p.delete('page_size');
    try {
      const respuesta = await fetch(`${URL_API}/auditoria/export.csv?${p.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (!respuesta.ok) throw new Error('export');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = `capturas_sedea_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch {
      setError('No fue posible generar el archivo CSV.');
    }
  };

  return (
    <>
      <div className="tarjeta">
        <h1>Panel de auditoría</h1>

        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}

        <div className="rejilla">
          <div className="campo">
            <label htmlFor="f-regional">Dirección Regional</label>
            <select
              id="f-regional"
              data-testid="filtro-regional"
              value={regionalId}
              onChange={(e) => {
                setRegionalId(e.target.value);
                setMunicipioId('');
                setPagina(1);
              }}
            >
              <option value="">Todas</option>
              {regionales.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="f-municipio">Municipio</label>
            <select
              id="f-municipio"
              data-testid="filtro-municipio"
              value={municipioId}
              onChange={(e) => {
                setMunicipioId(e.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todos</option>
              {municipiosVisibles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="f-desde">Fecha desde</label>
            <input
              id="f-desde"
              type="date"
              data-testid="filtro-desde"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setPagina(1);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="f-hasta">Fecha hasta</label>
            <input
              id="f-hasta"
              type="date"
              data-testid="filtro-hasta"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setPagina(1);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="f-texto">Nombre o CURP</label>
            <input
              id="f-texto"
              type="search"
              data-testid="filtro-texto"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setPagina(1);
              }}
            />
          </div>
        </div>

        <div className="acciones">
          <button type="button" onClick={() => void exportarCsv()}>
            Exportar CSV
          </button>
          <button type="button" className="secundario" onClick={() => void cargar()}>
            Actualizar
          </button>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Mapa de capturas</h2>
        <MapaCapturas puntos={puntos} centro={centro} />
      </div>

      <div className="tarjeta">
        <h2>Capturas ({total})</h2>

        {cargando && <p className="dato">Consultando…</p>}

        {!cargando && filas.length === 0 ? (
          <p className="vacio" data-testid="sin-resultados">
            Sin resultados
          </p>
        ) : (
          <div className="tabla-contenedor">
            <table data-testid="tabla-auditoria">
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>Beneficiario</th>
                  <th>CURP</th>
                  <th>Regional</th>
                  <th>Municipio</th>
                  <th>Colonia</th>
                  <th>Sección</th>
                  <th>Lat/Lng</th>
                  <th>Precisión (m)</th>
                  <th>Fecha de captura</th>
                  <th>Capturista</th>
                  <th>Expediente</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={f.uuid}
                    data-testid="fila-auditoria"
                    onClick={() => setCentro({ lat: f.lat, lng: f.lng })}
                  >
                    <td>
                      {token && (
                        <img
                          className="miniatura"
                          src={`${f.foto_url}?token=${encodeURIComponent(token)}`}
                          alt={`Evidencia de ${f.beneficiario.nombre_completo}`}
                        />
                      )}
                    </td>
                    <td>{f.beneficiario.nombre_completo}</td>
                    <td>{f.beneficiario.curp || 'Sin CURP'}</td>
                    <td>{f.beneficiario.regional_nombre}</td>
                    <td>{f.beneficiario.municipio_nombre}</td>
                    <td>{f.beneficiario.colonia}</td>
                    <td>{f.beneficiario.seccion}</td>
                    <td>
                      {f.lat.toFixed(6)}, {f.lng.toFixed(6)}
                    </td>
                    <td>{Math.round(f.precision_m)}</td>
                    <td>{formatearFecha(f.capturado_en)}</td>
                    <td>{f.capturista}</td>
                    <td>
                      <Link to={`/auditoria/beneficiario/${f.beneficiario.id}`}>Ver</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="paginacion">
          <button
            type="button"
            className="secundario"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span>
            Página {pagina} de {Math.max(1, Math.ceil(total / TAMANO_PAGINA))}
          </span>
          <button
            type="button"
            className="secundario"
            disabled={pagina >= Math.ceil(total / TAMANO_PAGINA)}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
    </>
  );
}
