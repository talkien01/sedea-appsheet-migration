// Digitalizacion V1 / Fase 3: preparación de lotes y carátulas QR.
// Online-only. La revisión móvil y la carga del PDF del escáner llegan en fases posteriores.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiDigitalizacion,
  type CatalogosDigitalizacion,
  type LoteDigitalizacion,
  type SolicitudDigitalizacion
} from '../api/digitalizacion';
import { ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

const CANTIDADES = [10, 20, 30, 50, 100, 200] as const;

function fechaHora(valor: string): string {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleString('es-MX');
}

function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Digitalizacion() {
  const enLinea = useEstadoRed();
  const [catalogos, setCatalogos] = useState<CatalogosDigitalizacion | null>(null);
  const [solicitudes, setSolicitudes] = useState<SolicitudDigitalizacion[]>([]);
  const [lotes, setLotes] = useState<LoteDigitalizacion[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);

  const [regionalId, setRegionalId] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());
  const [nombreLote, setNombreLote] = useState('');

  const [cargando, setCargando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [generandoLoteId, setGenerandoLoteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const filtros = useMemo(
    () => ({
      regionalId: regionalId || undefined,
      municipioId: municipioId || undefined,
      q: busqueda
    }),
    [regionalId, municipioId, busqueda]
  );

  const municipiosVisibles = useMemo(() => {
    const todos = catalogos?.municipios ?? [];
    return regionalId ? todos.filter((m) => String(m.regional_id) === regionalId) : todos;
  }, [catalogos, regionalId]);

  const cargarCatalogos = useCallback(async () => {
    const datos = await apiDigitalizacion.catalogos();
    setCatalogos(datos);
    if (datos.regional_forzada_id !== null) {
      setRegionalId(String(datos.regional_forzada_id));
    }
  }, []);

  const cargarLotes = useCallback(async () => {
    const datos = await apiDigitalizacion.lotes(regionalId || undefined);
    setLotes(datos.items);
  }, [regionalId]);

  const cargarSolicitudes = useCallback(
    async (paginaPedida = 1) => {
      setCargando(true);
      try {
        const datos = await apiDigitalizacion.solicitudes(filtros, paginaPedida, 50);
        setSolicitudes(datos.items);
        setTotal(datos.total);
        setPagina(datos.pagina);
        setPaginas(datos.paginas);
      } finally {
        setCargando(false);
      }
    },
    [filtros]
  );

  useEffect(() => {
    if (!enLinea) return;
    void cargarCatalogos().catch(() =>
      setError('No se pudieron cargar los catálogos de Digitalización.')
    );
  }, [cargarCatalogos, enLinea]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => {
      setError(null);
      void Promise.all([cargarSolicitudes(1), cargarLotes()]).catch((e) => {
        setError(e instanceof Error ? e.message : 'No se pudo cargar Digitalización.');
      });
    }, 250);
    return () => clearTimeout(temporizador);
  }, [cargarLotes, cargarSolicitudes, enLinea]);

  useEffect(() => {
    if (municipioId && !municipiosVisibles.some((m) => String(m.id) === municipioId)) {
      setMunicipioId('');
    }
  }, [municipioId, municipiosVisibles]);

  const alternarSolicitud = (solicitud: SolicitudDigitalizacion) => {
    if (solicitud.en_lote) return;
    const id = Number(solicitud.id);
    setSeleccionadas((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  };

  const seleccionarVisible = () => {
    setSeleccionadas((actual) => {
      const siguiente = new Set(actual);
      solicitudes.filter((s) => !s.en_lote).forEach((s) => siguiente.add(Number(s.id)));
      return siguiente;
    });
  };

  const seleccionarCantidad = async (
    cantidad: (typeof CANTIDADES)[number] | 'todas'
  ) => {
    setError(null);
    setMensaje(null);
    try {
      const resultado = await apiDigitalizacion.seleccion(filtros, cantidad);
      setSeleccionadas(new Set(resultado.solicitud_ids));
      setMensaje(
        cantidad === 'todas'
          ? `${resultado.seleccionadas} solicitudes sin lote seleccionadas.`
          : `${resultado.seleccionadas} de ${resultado.total_filtradas} solicitudes disponibles seleccionadas.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver la selección.');
    }
  };

  const crearLote = async () => {
    if (nombreLote.trim().length < 3) {
      setError('Escribe un nombre para identificar el lote.');
      return;
    }
    if (seleccionadas.size === 0) {
      setError('Selecciona al menos una solicitud.');
      return;
    }

    setCreando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await apiDigitalizacion.crearLote({
        nombre: nombreLote.trim(),
        solicitudIds: [...seleccionadas],
        regionalId: regionalId || undefined,
        municipioId: municipioId || undefined,
        criterios: { q: busqueda.trim() || null }
      });
      setMensaje(`Lote ${resultado.codigo} creado con ${resultado.solicitudes} solicitudes.`);
      setNombreLote('');
      setSeleccionadas(new Set());
      await Promise.all([cargarSolicitudes(1), cargarLotes()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el lote.');
    } finally {
      setCreando(false);
    }
  };

  const generarCaratulas = async (lote: LoteDigitalizacion) => {
    const loteId = Number(lote.id);
    setGenerandoLoteId(loteId);
    setError(null);
    setMensaje(null);
    try {
      const pdf = await apiDigitalizacion.caratulas(loteId);
      descargarBlob(pdf, `CARATULAS_${lote.codigo}.pdf`);
      setMensaje(`Carátulas de ${lote.codigo} generadas correctamente.`);
      await cargarLotes();
    } catch (e) {
      if (e instanceof ErrorPeticion && e.codigo === 'demasiadas_caratulas') {
        setError(
          'Este lote supera 500 carátulas por PDF. La división automática en varios PDF queda para la siguiente iteración de esta pantalla.'
        );
      } else {
        setError(e instanceof Error ? e.message : 'No se pudieron generar las carátulas.');
      }
    } finally {
      setGenerandoLoteId(null);
    }
  };

  if (!enLinea) {
    return <p className="vacio">Digitalización requiere conexión a internet en esta fase.</p>;
  }

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Digitalización</h1>
        <p className="dato">
          Prepara lotes de expedientes, genera sus carátulas QR tamaño carta y da seguimiento a lo pendiente de digitalizar.
        </p>
      </div>

      {error && <div className="mensaje error" role="alert">{error}</div>}
      {mensaje && <div className="mensaje exito" role="status">{mensaje}</div>}

      <div className="tarjeta">
        <h2>1. Filtrar expedientes</h2>
        <div className="rejilla">
          <div className="campo">
            <label htmlFor="dig-regional">Regional</label>
            <select
              id="dig-regional"
              data-testid="dig-regional"
              value={regionalId}
              disabled={catalogos?.regional_forzada_id !== null && catalogos !== null}
              onChange={(e) => setRegionalId(e.target.value)}
            >
              <option value="">Todas</option>
              {(catalogos?.regionales ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="dig-municipio">Municipio</label>
            <select
              id="dig-municipio"
              data-testid="dig-municipio"
              value={municipioId}
              onChange={(e) => setMunicipioId(e.target.value)}
            >
              <option value="">Todos</option>
              {municipiosVisibles.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="dig-busqueda">Folio, beneficiario o CURP</label>
            <input
              id="dig-busqueda"
              data-testid="dig-busqueda"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
        <p className="dato">{total} solicitudes pendientes de digitalizar con los filtros actuales.</p>
      </div>

      <div className="tarjeta">
        <h2>2. Seleccionar para el lote</h2>
        <div className="acciones" style={{ flexWrap: 'wrap' }}>
          {CANTIDADES.map((cantidad) => (
            <button
              key={cantidad}
              type="button"
              className="secundario"
              onClick={() => void seleccionarCantidad(cantidad)}
            >
              Primeras {cantidad}
            </button>
          ))}
          <button type="button" className="secundario" onClick={() => void seleccionarCantidad('todas')}>
            Todas las filtradas
          </button>
          <button type="button" className="secundario" onClick={seleccionarVisible}>
            Seleccionar página visible
          </button>
          <button type="button" className="secundario" onClick={() => setSeleccionadas(new Set())}>
            Limpiar selección
          </button>
        </div>
        <p className="dato"><strong>{seleccionadas.size}</strong> solicitudes seleccionadas para el nuevo lote.</p>

        {cargando && <p className="vacio">Cargando solicitudes…</p>}
        {!cargando && solicitudes.length === 0 && (
          <p className="vacio">No hay solicitudes pendientes con estos filtros.</p>
        )}

        {!cargando && solicitudes.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Sel.</th>
                  <th style={{ textAlign: 'left' }}>Folio</th>
                  <th style={{ textAlign: 'left' }}>Beneficiario</th>
                  <th style={{ textAlign: 'left' }}>Municipio</th>
                  <th style={{ textAlign: 'left' }}>Regional</th>
                  <th style={{ textAlign: 'left' }}>Preparación</th>
                </tr>
              </thead>
              <tbody>
                {solicitudes.map((s) => {
                  const id = Number(s.id);
                  return (
                    <tr key={id}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={s.en_lote}
                          checked={seleccionadas.has(id)}
                          onChange={() => alternarSolicitud(s)}
                          aria-label={`Seleccionar ${s.folio}`}
                        />
                      </td>
                      <td>{s.folio}</td>
                      <td>{s.nombre_solicitante}</td>
                      <td>{s.municipio}</td>
                      <td>{s.regional}</td>
                      <td>{s.en_lote ? 'Ya asignado a lote' : s.caratula_generada ? 'Carátula generada' : 'Disponible'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="acciones" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="secundario"
              disabled={pagina <= 1 || cargando}
              onClick={() => void cargarSolicitudes(pagina - 1)}
            >
              ‹ Anterior
            </button>
            <span className="dato">Página {pagina} de {paginas}</span>
            <button
              type="button"
              className="secundario"
              disabled={pagina >= paginas || cargando}
              onClick={() => void cargarSolicitudes(pagina + 1)}
            >
              Siguiente ›
            </button>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <h2>3. Crear lote</h2>
        <div className="campo">
          <label htmlFor="dig-nombre-lote">Nombre operativo del lote</label>
          <input
            id="dig-nombre-lote"
            data-testid="dig-nombre-lote"
            value={nombreLote}
            maxLength={120}
            placeholder="Ej. Amealco septiembre lote 01"
            onChange={(e) => setNombreLote(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="boton"
          disabled={creando || seleccionadas.size === 0}
          onClick={() => void crearLote()}
        >
          {creando ? 'Creando…' : `Crear lote con ${seleccionadas.size} expedientes`}
        </button>
      </div>

      <div className="tarjeta">
        <h2>4. Lotes de preparación</h2>
        {lotes.length === 0 && <p className="vacio">Todavía no hay lotes de preparación.</p>}
        {lotes.map((lote) => {
          const loteId = Number(lote.id);
          return (
            <div key={loteId} className="tarjeta" style={{ marginBottom: 12 }}>
              <h3>{lote.codigo} — {lote.nombre}</h3>
              <p className="dato">
                {lote.solicitudes} expedientes · {lote.caratulas_generadas} carátulas generadas · {lote.digitalizados} digitalizados · {lote.incidencias} incidencias
              </p>
              <p className="dato">Creado por {lote.creado_por_nombre} · {fechaHora(lote.creado_en)}</p>
              <div className="acciones">
                <button
                  type="button"
                  className="boton"
                  disabled={generandoLoteId !== null}
                  onClick={() => void generarCaratulas(lote)}
                >
                  {generandoLoteId === loteId ? 'Generando PDF…' : 'Generar / reimprimir carátulas QR'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
