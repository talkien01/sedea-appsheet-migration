import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorPeticion } from '../App';
import {
  apiConciliacion,
  type CatalogosConciliacion,
  type DetalleLoteConciliacion,
  type PaginaPendienteConciliacion,
  type ResumenLoteConciliacion
} from '../api/conciliacion';
import { useEstadoRed } from '../sync/estadoRed';

const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });

function etiquetaPendiente(estado: PaginaPendienteConciliacion['estado']): string {
  const etiquetas: Record<string, string> = {
    sin_qr: 'Sin QR',
    varios_qr: 'Varios QR',
    folio_no_encontrado: 'Folio no encontrado',
    municipio_distinto: 'Otro municipio',
    sin_concepto_lote: 'Apoyo no corresponde',
    duplicada: 'Duplicado',
    pendiente_manual: 'Captura manual',
    error: 'Error'
  };
  return etiquetas[estado] ?? estado;
}

export default function ConciliacionCamiones() {
  const enLinea = useEstadoRed();
  const refPdf = useRef<HTMLInputElement>(null);

  const [catalogos, setCatalogos] = useState<CatalogosConciliacion | null>(null);
  const [lotes, setLotes] = useState<ResumenLoteConciliacion[]>([]);
  const [detalle, setDetalle] = useState<DetalleLoteConciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);

  const [municipioId, setMunicipioId] = useState('');
  const [camion, setCamion] = useState('');
  const [tipoApoyoId, setTipoApoyoId] = useState('');
  const [creando, setCreando] = useState(false);

  const [archivoPdf, setArchivoPdf] = useState<File | null>(null);
  const [procesandoPdf, setProcesandoPdf] = useState(false);
  const [foliosPendientes, setFoliosPendientes] = useState<Record<number, string>>({});
  const [paginaProcesando, setPaginaProcesando] = useState<number | null>(null);
  const [reciboRetirando, setReciboRetirando] = useState<number | null>(null);
  const [cerrando, setCerrando] = useState(false);

  const cargarLista = useCallback(async () => {
    const respuesta = await apiConciliacion.lotes();
    setLotes(respuesta.data);
  }, []);

  useEffect(() => {
    if (!enLinea) {
      setCargando(false);
      return;
    }
    void (async () => {
      setCargando(true);
      setError(null);
      try {
        const [catalogosRespuesta, lotesRespuesta] = await Promise.all([
          apiConciliacion.catalogos(),
          apiConciliacion.lotes()
        ]);
        setCatalogos(catalogosRespuesta);
        setLotes(lotesRespuesta.data);
      } catch (fallo) {
        setError((fallo as Error).message);
      } finally {
        setCargando(false);
      }
    })();
  }, [enLinea]);

  const abrirLote = async (id: number) => {
    setAccionError(null);
    try {
      const respuesta = await apiConciliacion.detalle(id);
      setDetalle(respuesta);
      setArchivoPdf(null);
      setFoliosPendientes({});
      if (refPdf.current) refPdf.current.value = '';
    } catch (fallo) {
      setAccionError((fallo as Error).message);
    }
  };

  const crearLote = async () => {
    if (!municipioId || !camion.trim()) {
      setAccionError('Selecciona el municipio y escribe el identificador del camión.');
      return;
    }
    setCreando(true);
    setAccionError(null);
    try {
      const creado = await apiConciliacion.crearLote({
        municipio_id: Number(municipioId),
        camion: camion.trim(),
        tipo_apoyo_id: tipoApoyoId ? Number(tipoApoyoId) : null
      });
      setDetalle(creado);
      setCamion('');
      setTipoApoyoId('');
      await cargarLista();
    } catch (fallo) {
      setAccionError((fallo as Error).message);
    } finally {
      setCreando(false);
    }
  };

  const subirPdf = async () => {
    if (!detalle || !archivoPdf) return;
    setProcesandoPdf(true);
    setAccionError(null);
    try {
      const actualizado = await apiConciliacion.subirPdf(Number(detalle.lote.id), archivoPdf);
      setDetalle(actualizado);
      setArchivoPdf(null);
      if (refPdf.current) refPdf.current.value = '';
      await cargarLista();
    } catch (fallo) {
      const mensaje =
        fallo instanceof ErrorPeticion && fallo.codigo === 'lector_pdf_no_disponible'
          ? fallo.message
          : (fallo as Error).message;
      setAccionError(mensaje);
    } finally {
      setProcesandoPdf(false);
    }
  };

  const corregirPagina = async (pagina: number) => {
    if (!detalle) return;
    const folio = (foliosPendientes[pagina] ?? '').trim();
    if (!folio) {
      setAccionError(`Escribe el folio de la página ${pagina}.`);
      return;
    }
    setPaginaProcesando(pagina);
    setAccionError(null);
    try {
      const actualizado = await apiConciliacion.corregirPagina(
        Number(detalle.lote.id),
        pagina,
        folio
      );
      setDetalle(actualizado);
      setFoliosPendientes((previos) => {
        const copia = { ...previos };
        delete copia[pagina];
        return copia;
      });
      await cargarLista();
    } catch (fallo) {
      setAccionError((fallo as Error).message);
    } finally {
      setPaginaProcesando(null);
    }
  };

  const retirarRecibo = async (reciboId: number, folio: string) => {
    if (!detalle) return;
    if (!window.confirm(`¿Retirar la conciliación del folio ${folio}? La página quedará pendiente para corregirla.`)) {
      return;
    }
    setReciboRetirando(reciboId);
    setAccionError(null);
    try {
      const actualizado = await apiConciliacion.retirarRecibo(Number(detalle.lote.id), reciboId);
      setDetalle(actualizado);
      await cargarLista();
    } catch (fallo) {
      setAccionError((fallo as Error).message);
    } finally {
      setReciboRetirando(null);
    }
  };

  const cerrarLote = async () => {
    if (!detalle) return;
    if (!window.confirm(`¿Cerrar definitivamente el lote del ${detalle.lote.camion}?`)) return;
    setCerrando(true);
    setAccionError(null);
    try {
      const actualizado = await apiConciliacion.cerrarLote(Number(detalle.lote.id));
      setDetalle(actualizado);
      await cargarLista();
    } catch (fallo) {
      setAccionError((fallo as Error).message);
    } finally {
      setCerrando(false);
    }
  };

  if (!enLinea) {
    return (
      <div className="tarjeta pantalla-ancha">
        <h1>Conciliación de recibos de camiones</h1>
        <p className="vacio">Esta sección requiere conexión a internet.</p>
      </div>
    );
  }

  return (
    <div className="tarjeta pantalla-ancha">
      <h1>Conciliación de recibos de camiones</h1>
      <p className="dato">
        Carga el PDF multipágina generado por el escáner documental. Cada página se identifica por su QR y se concilia contra SISPACQ.
      </p>

      {error && (
        <div className="mensaje error" role="alert">
          {error}
        </div>
      )}
      {accionError && (
        <div className="mensaje error" role="alert">
          {accionError}
        </div>
      )}

      <section>
        <h2>Nuevo lote</h2>
        <div className="filtros">
          <select
            value={municipioId}
            onChange={(e) => setMunicipioId(e.target.value)}
            aria-label="Municipio del lote"
          >
            <option value="">Seleccionar municipio</option>
            {(catalogos?.municipios ?? []).map((municipio) => (
              <option key={municipio.id} value={municipio.id}>
                {municipio.nombre}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={camion}
            onChange={(e) => setCamion(e.target.value)}
            placeholder="Camión, ej. CAM-01"
            aria-label="Identificador del camión"
            maxLength={100}
          />

          <select
            value={tipoApoyoId}
            onChange={(e) => setTipoApoyoId(e.target.value)}
            aria-label="Apoyo del lote"
          >
            <option value="">Todos los apoyos del recibo</option>
            {(catalogos?.tipos_apoyo ?? []).map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.clave} — {tipo.nombre}
              </option>
            ))}
          </select>

          <button type="button" disabled={creando || !municipioId || !camion.trim()} onClick={() => void crearLote()}>
            {creando ? 'Creando…' : 'Crear lote'}
          </button>
        </div>
      </section>

      <section>
        <h2>Lotes recientes</h2>
        {cargando ? (
          <p className="vacio">Cargando…</p>
        ) : lotes.length === 0 ? (
          <p className="vacio">Aún no hay lotes de conciliación.</p>
        ) : (
          <div className="tabla-contenedor">
            <table>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Municipio</th>
                  <th>Camión</th>
                  <th>Apoyo</th>
                  <th>Recibos</th>
                  <th>Kg</th>
                  <th>Costales</th>
                  <th>Pendientes</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => (
                  <tr key={lote.id}>
                    <td data-etiqueta="Lote">#{lote.id}</td>
                    <td data-etiqueta="Municipio">{lote.municipio_nombre}</td>
                    <td data-etiqueta="Camión" className="mono">{lote.camion}</td>
                    <td data-etiqueta="Apoyo">{lote.tipo_apoyo_nombre ?? 'Todos'}</td>
                    <td data-etiqueta="Recibos">{lote.recibos}</td>
                    <td data-etiqueta="Kg">{numero.format(lote.kg_total ?? 0)}</td>
                    <td data-etiqueta="Costales">{numero.format(lote.costales_total ?? 0)}</td>
                    <td data-etiqueta="Pendientes">{lote.pendientes}</td>
                    <td data-etiqueta="Estado">
                      <span className={`badge ${lote.estado === 'cerrado' ? 'capturado' : 'pendiente'}`}>
                        {lote.estado === 'cerrado' ? 'Cerrado' : 'Abierto'}
                      </span>
                    </td>
                    <td data-etiqueta="Acción">
                      <button type="button" className="secundario" onClick={() => void abrirLote(Number(lote.id))}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detalle && (
        <section>
          <h2>
            Lote #{detalle.lote.id} · {detalle.lote.camion}
          </h2>
          <div className="mensaje aviso" role="status">
            {detalle.lote.municipio_nombre} · {detalle.lote.tipo_apoyo_nombre ?? 'Todos los apoyos del recibo'}
          </div>

          <div className="tabla-contenedor">
            <table>
              <thead>
                <tr>
                  <th>Recibos</th>
                  <th>Kg conciliados</th>
                  <th>Costales</th>
                  <th>Páginas PDF</th>
                  <th>Pendientes</th>
                  <th>Duplicados</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-etiqueta="Recibos"><strong>{detalle.lote.recibos}</strong></td>
                  <td data-etiqueta="Kg conciliados"><strong>{numero.format(detalle.lote.kg_total ?? 0)}</strong></td>
                  <td data-etiqueta="Costales"><strong>{numero.format(detalle.lote.costales_total ?? 0)}</strong></td>
                  <td data-etiqueta="Páginas PDF">{detalle.lote.paginas_pdf ?? '—'}</td>
                  <td data-etiqueta="Pendientes">{detalle.lote.pendientes}</td>
                  <td data-etiqueta="Duplicados">{detalle.lote.duplicados}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {detalle.lote.estado === 'abierto' && !detalle.lote.pdf_url && (
            <div className="filtros">
              <input
                ref={refPdf}
                type="file"
                accept="application/pdf,.pdf"
                aria-label="PDF de recibos del camión"
                onChange={(e) => {
                  setArchivoPdf(e.target.files?.[0] ?? null);
                  setAccionError(null);
                }}
              />
              <button type="button" disabled={!archivoPdf || procesandoPdf} onClick={() => void subirPdf()}>
                {procesandoPdf ? 'Procesando PDF…' : 'Cargar y procesar PDF'}
              </button>
            </div>
          )}

          {detalle.lote.pdf_url && (
            <div className="mensaje exito" role="status">
              PDF del escáner cargado: {detalle.lote.paginas_pdf ?? 0} página(s) procesada(s).
            </div>
          )}

          {detalle.pendientes.length > 0 && (
            <>
              <h3>Pendientes de conciliación</h3>
              <div className="tabla-contenedor">
                <table>
                  <thead>
                    <tr>
                      <th>Página</th>
                      <th>Estado</th>
                      <th>Folio detectado</th>
                      <th>Motivo</th>
                      <th>Folio correcto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.pendientes.map((pendiente) => (
                      <tr key={pendiente.id}>
                        <td data-etiqueta="Página">{pendiente.pagina}</td>
                        <td data-etiqueta="Estado">
                          <span className="badge alerta-media">{etiquetaPendiente(pendiente.estado)}</span>
                        </td>
                        <td data-etiqueta="Folio detectado" className="mono">
                          {pendiente.folio_detectado ?? '—'}
                        </td>
                        <td data-etiqueta="Motivo" className="celda-texto">{pendiente.mensaje ?? '—'}</td>
                        <td data-etiqueta="Folio correcto">
                          {detalle.lote.estado === 'abierto' ? (
                            <input
                              type="text"
                              value={foliosPendientes[pendiente.pagina] ?? ''}
                              onChange={(e) =>
                                setFoliosPendientes((previos) => ({
                                  ...previos,
                                  [pendiente.pagina]: e.target.value.toUpperCase()
                                }))
                              }
                              placeholder="CFA-..."
                              aria-label={`Folio correcto página ${pendiente.pagina}`}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-etiqueta="Acción">
                          {detalle.lote.estado === 'abierto' && (
                            <button
                              type="button"
                              disabled={paginaProcesando === pendiente.pagina}
                              onClick={() => void corregirPagina(pendiente.pagina)}
                            >
                              {paginaProcesando === pendiente.pagina ? 'Validando…' : 'Conciliar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h3>Recibos conciliados</h3>
          {detalle.recibos.length === 0 ? (
            <p className="vacio">Todavía no hay recibos conciliados en este lote.</p>
          ) : (
            <div className="tabla-contenedor">
              <table>
                <thead>
                  <tr>
                    <th>Página</th>
                    <th>Folio</th>
                    <th>Beneficiario</th>
                    <th>Apoyo</th>
                    <th>Kg</th>
                    <th>Costales</th>
                    <th>Origen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.recibos.map((recibo) => (
                    <tr key={recibo.id}>
                      <td data-etiqueta="Página">{recibo.pagina}</td>
                      <td data-etiqueta="Folio" className="mono">{recibo.folio}</td>
                      <td data-etiqueta="Beneficiario">{recibo.beneficiario}</td>
                      <td data-etiqueta="Apoyo">{recibo.apoyos}</td>
                      <td data-etiqueta="Kg">{numero.format(recibo.kg ?? 0)}</td>
                      <td data-etiqueta="Costales">{numero.format(recibo.costales ?? 0)}</td>
                      <td data-etiqueta="Origen">{recibo.origen === 'qr' ? 'QR' : 'Manual'}</td>
                      <td data-etiqueta="Acción">
                        {detalle.lote.estado === 'abierto' && (
                          <button
                            type="button"
                            className="secundario"
                            disabled={reciboRetirando === recibo.id}
                            onClick={() => void retirarRecibo(Number(recibo.id), recibo.folio)}
                          >
                            {reciboRetirando === recibo.id ? 'Retirando…' : 'Corregir'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detalle.lote.estado === 'abierto' && (
            <div className="acciones">
              <button
                type="button"
                disabled={
                  cerrando ||
                  !detalle.lote.paginas_pdf ||
                  detalle.lote.pendientes > 0 ||
                  detalle.lote.recibos === 0
                }
                onClick={() => void cerrarLote()}
              >
                {cerrando ? 'Cerrando…' : 'Cerrar lote'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
