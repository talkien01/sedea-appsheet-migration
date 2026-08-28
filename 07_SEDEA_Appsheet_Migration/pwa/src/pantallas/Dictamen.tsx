// Bandeja de dictamen (SPEC 19.7.2). Pantalla de oficina, EN LINEA.
//
// El orden lo fija el backend (D19-7: negativo -> error -> sin pre-dictamen ->
// positivo). Aqui NO se reordena: la cola es la misma para todos.
//
// El disparo del pre-dictamen es MANUAL y en lote (D19-4/D19-9): un solo boton,
// checkbox por fila y checkbox de "seleccionar todo". No existe ningun control
// que apruebe automaticamente lo que dijo la IA (D19-8).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FilaBandejaDictamen, MetricasDictamen } from '@sedea/shared';
import { api } from '../api/cliente';
import { BotonIcono } from '../componentes/BotonIcono';
import { useEstadoRed } from '../sync/estadoRed';

/** Techo duro del lote, igual que en el backend (D19-9). */
const MAX_LOTE = 20;
const TAMANO_PAGINA = 50;

const OPCIONES_ESTADO = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'negativo', etiqueta: 'Negativo' },
  { valor: 'error', etiqueta: 'Error' },
  { valor: 'sin_predictamen', etiqueta: 'Sin pre-dictamen' },
  { valor: 'positivo', etiqueta: 'Positivo' },
  { valor: 'dictaminadas', etiqueta: 'Dictaminadas' }
];

/** Texto y clase del chip del pre-dictamen. `null` = nunca se genero. */
function chipPredictamen(estado: string | null): { texto: string; clase: string } {
  if (estado === 'negativo') return { texto: 'Negativo', clase: 'chip chip-negativo' };
  if (estado === 'positivo') return { texto: 'Positivo', clase: 'chip chip-positivo' };
  if (estado === 'error') return { texto: 'Error', clase: 'chip chip-error' };
  return { texto: 'Sin revisar', clase: 'chip chip-neutro' };
}

export default function Dictamen() {
  const enLinea = useEstadoRed();
  const navegar = useNavigate();

  const [filas, setFilas] = useState<FilaBandejaDictamen[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [metricas, setMetricas] = useState<MetricasDictamen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('todas');
  const [seleccion, setSeleccion] = useState<number[]>([]);
  const [corriendo, setCorriendo] = useState(false);

  const armarParametros = useCallback(
    (paginaPedida: number) => {
      const parametros = new URLSearchParams({
        pagina: String(paginaPedida),
        por_pagina: String(TAMANO_PAGINA),
        estado
      });
      if (busqueda.trim().length >= 2) parametros.set('q', busqueda.trim());
      return parametros;
    },
    [busqueda, estado]
  );

  // Nueva búsqueda/filtro: vuelve a la página 1 y reemplaza los resultados.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [bandeja, tarjetas] = await Promise.all([
        api.dictamenBandeja(armarParametros(1)),
        api.dictamenMetricas()
      ]);
      setFilas(bandeja.filas);
      setTotal(bandeja.total);
      setPagina(1);
      setMetricas(tarjetas);
    } catch {
      setError('No se pudo cargar la bandeja de dictamen.');
    } finally {
      setCargando(false);
    }
  }, [armarParametros]);

  // "Cargar más": trae la siguiente página y la agrega al final.
  const cargarMas = useCallback(async () => {
    setCargandoMas(true);
    setError(null);
    try {
      const siguiente = pagina + 1;
      const bandeja = await api.dictamenBandeja(armarParametros(siguiente));
      setFilas((previas) => [...previas, ...bandeja.filas]);
      setTotal(bandeja.total);
      setPagina(siguiente);
    } catch {
      setError('No se pudieron cargar más solicitudes.');
    } finally {
      setCargandoMas(false);
    }
  }, [armarParametros, pagina]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void cargar(), 300);
    return () => clearTimeout(temporizador);
  }, [cargar, enLinea]);

  const alternar = (solicitudId: number) => {
    setSeleccion((previa) =>
      previa.includes(solicitudId)
        ? previa.filter((id) => id !== solicitudId)
        : [...previa, solicitudId]
    );
  };

  const todosMarcados = filas.length > 0 && seleccion.length === filas.length;

  const alternarTodos = () => {
    setSeleccion(todosMarcados ? [] : filas.map((f) => f.solicitud_id));
  };

  const predictaminar = async () => {
    if (seleccion.length === 0 || seleccion.length > MAX_LOTE) return;
    setCorriendo(true);
    setError(null);
    setMensaje(null);
    try {
      const respuesta = await api.predictaminar(seleccion);
      setMensaje(`Pre-dictamen generado para ${respuesta.resultados.length} solicitud(es).`);
      setSeleccion([]);
      await cargar();
    } catch {
      setError('No se pudo generar el pre-dictamen.');
    } finally {
      setCorriendo(false);
    }
  };

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <div data-testid="pantalla-dictamen">
      <div className="tarjeta pantalla-ancha">
        <h1>Dictamen</h1>
        <p className="dato">
          Cola priorizada de solicitudes por dictaminar. La IA solo pre-dictamina: el veredicto
          final siempre lo confirma una persona.
        </p>

        <div className="metricas-dictamen">
          <div className="tarjeta-metrica" data-testid="metrica-negativos">
            <span className="valor">{metricas?.negativos ?? 0}</span>
            <span className="etiqueta">Negativos</span>
          </div>
          <div className="tarjeta-metrica" data-testid="metrica-sin-predictamen">
            <span className="valor">{metricas?.sin_predictamen ?? 0}</span>
            <span className="etiqueta">Sin pre-dictamen</span>
          </div>
          <div className="tarjeta-metrica" data-testid="metrica-positivos">
            <span className="valor">{metricas?.positivos ?? 0}</span>
            <span className="etiqueta">Positivos</span>
          </div>
          <div className="tarjeta-metrica" data-testid="metrica-dictaminadas">
            <span className="valor">{metricas?.dictaminadas ?? 0}</span>
            <span className="etiqueta">Dictaminadas</span>
          </div>
        </div>
      </div>

      <div className="tarjeta pantalla-ancha">
        <div className="barra-filtros-dictamen">
          <div className="campo">
            <label htmlFor="input-buscar-dictamen">Folio o solicitante</label>
            <input
              id="input-buscar-dictamen"
              data-testid="input-buscar-dictamen"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="select-filtro-estado">Pre-dictamen</label>
            <select
              id="select-filtro-estado"
              data-testid="select-filtro-estado"
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setSeleccion([]);
              }}
            >
              {OPCIONES_ESTADO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="boton"
            data-testid="btn-predictaminar"
            aria-busy={corriendo ? 'true' : undefined}
            disabled={corriendo || seleccion.length === 0 || seleccion.length > MAX_LOTE}
            onClick={() => void predictaminar()}
          >
            {corriendo ? 'Pre-dictaminando…' : `Pre-dictaminar (${seleccion.length})`}
          </button>
        </div>

        {mensaje && (
          <p className="mensaje exito" data-testid="mensaje-predictamen">
            {mensaje}
          </p>
        )}
        {error && (
          <p className="mensaje error" role="alert">
            {error}
          </p>
        )}
        {seleccion.length > MAX_LOTE && (
          <p className="mensaje aviso">
            Selecciona como máximo {MAX_LOTE} solicitudes por lote.
          </p>
        )}

        {filas.length > 0 && (
          <p className="dato" data-testid="contador-dictamen">
            Mostrando {filas.length} de {total}
          </p>
        )}

        {cargando && filas.length === 0 ? (
          <p className="vacio">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="vacio" data-testid="vacio-dictamen">
            No hay solicitudes por dictaminar.
          </p>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla" data-testid="tabla-dictamen">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      data-testid="chk-dictamen-todos"
                      aria-label="Seleccionar todas"
                      checked={todosMarcados}
                      onChange={alternarTodos}
                    />
                  </th>
                  <th scope="col">Folio</th>
                  <th scope="col">Solicitante</th>
                  <th scope="col">Documentos</th>
                  <th scope="col">Pre-dictamen IA</th>
                  <th scope="col">Recibida</th>
                  <th scope="col">Dictamen humano</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const chip = chipPredictamen(fila.predictamen?.estado ?? null);
                  return (
                    <tr key={fila.solicitud_id} data-testid={`fila-dictamen-${fila.solicitud_id}`}>
                      <td>
                        <input
                          type="checkbox"
                          data-testid={`chk-dictamen-${fila.solicitud_id}`}
                          aria-label={`Seleccionar ${fila.folio}`}
                          checked={seleccion.includes(fila.solicitud_id)}
                          onChange={() => alternar(fila.solicitud_id)}
                        />
                      </td>
                      <td>{fila.folio}</td>
                      <td>{fila.solicitante}</td>
                      <td data-testid={`docs-dictamen-${fila.solicitud_id}`}>
                        {fila.documentos_con_archivo}/{fila.documentos_total}
                      </td>
                      <td>
                        <span
                          className={chip.clase}
                          data-testid={`chip-predictamen-${fila.solicitud_id}`}
                          title={fila.predictamen?.resumen ?? undefined}
                        >
                          {chip.texto}
                        </span>
                      </td>
                      <td>{new Date(fila.recibida_en).toLocaleDateString('es-MX')}</td>
                      <td>
                        <span
                          className={
                            fila.dictamen
                              ? `chip chip-${fila.dictamen.resultado}`
                              : 'chip chip-neutro'
                          }
                          data-testid={`chip-dictamen-${fila.solicitud_id}`}
                        >
                          {fila.dictamen
                            ? fila.dictamen.resultado === 'positivo'
                              ? 'Positivo'
                              : 'Negativo'
                            : 'Pendiente'}
                        </span>
                      </td>
                      <td className="acciones">
                        <BotonIcono
                          icono="ojo"
                          etiqueta="Ver detalle"
                          testId={`btn-ver-dictamen-${fila.solicitud_id}`}
                          onClick={() => navegar(`/dictamen/${fila.solicitud_id}`)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!cargando && filas.length > 0 && filas.length < total && (
          <button
            type="button"
            className="boton secundario"
            data-testid="btn-cargar-mas-dictamen"
            onClick={() => void cargarMas()}
            disabled={cargandoMas}
          >
            {cargandoMas ? 'Cargando…' : `Cargar más (${total - filas.length} restantes)`}
          </button>
        )}
      </div>
    </div>
  );
}
