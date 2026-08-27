// "Entregar apoyos" (Parte 2): la pantalla de campo, en el momento de poner
// el apoyo fisico en manos del productor.
//
// MODO DE CAMPO a proposito: vive FUERA del cascaron (sin barra lateral ni
// barra inferior) porque es una herramienta de un solo proposito que se usa de
// pie, en una bodega, con una mano ocupada. Lo unico que saca de aqui es el
// boton "Salir".
//
// SIN RED en todo el flujo: lee de IndexedDB lo que dejo /entregas/preparar y
// escribe en la cola offline. Lo que se lleva a la mesa no es la app, es el
// paquete descargado; si el folio no esta en el paquete, no se entrega.
//
// El ciclo esta pensado para repetirse decenas de veces seguidas:
//   escanear -> (elegir concepto) -> confirmar -> foto + GPS -> guardar -> escanear
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CapturaFoto from '../componentes/CapturaFoto';
import CapturaGPS, { type Ubicacion } from '../componentes/CapturaGPS';
import { useEscanerQr } from '../componentes/usoEscanerQr';
import type { ConceptoEntregaLocal, EventoEntregaLocal } from '../db/indexeddb';
import {
  buscarConceptosEntrega,
  conceptosPorFolio,
  conceptosYaEntregadosLocal,
  contarConceptosEntrega,
  contarEntregasDelEvento,
  contarEntregasPendientes,
  eventoEntregaLocal
} from '../db/repositorios';
import { encolarEntrega } from '../sync/cola';
import { alCambiarCola, sincronizarPendientes } from '../sync/motor';
import { estaEnLinea, useEstadoRed } from '../sync/estadoRed';

/** Pasos del flujo. `escanear` es el estado de reposo entre beneficiarios. */
type Paso = 'escanear' | 'elegir' | 'confirmar' | 'evidencia';

const AVISO_SIN_PAQUETE =
  'Este dispositivo no tiene ningún paquete de entrega descargado. Sal, entra a Entregas y descarga el evento con señal antes de empezar.';

function descripcionConcepto(c: ConceptoEntregaLocal): string {
  return c.concepto_descripcion?.trim() || c.tipo_apoyo_nombre;
}

function cantidadConUnidad(c: ConceptoEntregaLocal): string {
  return `${c.cantidad} ${c.unidad_medida ?? ''}`.trim();
}

export default function RegistrarEntrega() {
  const navegar = useNavigate();
  const enLinea = useEstadoRed();

  const [paso, setPaso] = useState<Paso>('escanear');
  const [evento, setEvento] = useState<EventoEntregaLocal | null>(null);
  const [totalPaquete, setTotalPaquete] = useState(0);
  const [registradas, setRegistradas] = useState(0);
  const [porSubir, setPorSubir] = useState(0);

  // Resultado del escaneo o de la busqueda manual.
  const [candidatos, setCandidatos] = useState<ConceptoEntregaLocal[]>([]);
  const [elegido, setElegido] = useState<ConceptoEntregaLocal | null>(null);
  const [yaEntregados, setYaEntregados] = useState<Set<number>>(new Set());

  const [busquedaAbierta, setBusquedaAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ConceptoEntregaLocal[]>([]);

  const [foto, setFoto] = useState<Blob | null>(null);
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const refrescarContadores = useCallback(async () => {
    setEvento((await eventoEntregaLocal()) ?? null);
    setTotalPaquete(await contarConceptosEntrega());
    setRegistradas(await contarEntregasDelEvento());
    setPorSubir(await contarEntregasPendientes());
    setYaEntregados(await conceptosYaEntregadosLocal());
  }, []);

  useEffect(() => {
    void refrescarContadores();
    // El motor avisa cuando una entrega sale de la cola: el contador de
    // "por subir" baja solo, sin que el operador tenga que hacer nada.
    return alCambiarCola(() => void refrescarContadores());
  }, [refrescarContadores]);

  /** Vuelve al estado de reposo, listo para el siguiente beneficiario. */
  const reiniciar = useCallback(() => {
    setPaso('escanear');
    setCandidatos([]);
    setElegido(null);
    setFoto(null);
    setUbicacion(null);
    setObservaciones('');
    setBusquedaAbierta(false);
    setTexto('');
    setResultados([]);
  }, []);

  /**
   * Toma una lista de conceptos de un folio y decide a que paso ir.
   * Devuelve `true` cuando encontro algo entregable (apaga la camara).
   */
  const abrirConceptos = useCallback(
    (lista: ConceptoEntregaLocal[], etiquetaBusqueda: string): boolean => {
      if (lista.length === 0) {
        setAviso(
          `No se encontró ${etiquetaBusqueda} en el paquete descargado. Puede ser de otro evento, de otro concepto, o no estar autorizado.`
        );
        return false;
      }
      const pendientes = lista.filter((c) => !yaEntregados.has(c.solicitud_concepto_id));
      if (pendientes.length === 0) {
        setAviso(
          `Todos los conceptos de ${etiquetaBusqueda} ya tienen entrega registrada en este dispositivo.`
        );
        return false;
      }
      setAviso(null);
      setExito(null);
      setCandidatos(lista);
      // Un solo concepto pendiente: no hay nada que elegir, va directo a
      // confirmar. Varios (avena y garbanzo del mismo folio) exigen decir cual
      // se esta entregando AHORA: son entregas independientes.
      if (pendientes.length === 1) {
        setElegido(pendientes[0]);
        setPaso('confirmar');
      } else {
        setPaso('elegir');
      }
      return true;
    },
    [yaEntregados]
  );

  /** Lo que trae el QR del Folio de entrega es el folio, tal cual. */
  const alLeerQr = useCallback(
    (textoQr: string): boolean => {
      const folio = textoQr.trim();
      if (!folio) return false;
      // La busqueda es sincrona para el escaner (que espera un boolean), asi
      // que se resuelve la promesa aparte y se apaga la camara siempre: el QR
      // ya se leyo, no tiene caso seguir mirando el mismo papel.
      void (async () => {
        const lista = await conceptosPorFolio(folio);
        abrirConceptos(lista, `el folio ${folio}`);
      })();
      return true;
    },
    [abrirConceptos]
  );

  const { refVideo, refLienzo, errorCamara } = useEscanerQr({
    alTexto: alLeerQr,
    seamPrueba: '__sedeaEscanerFolio',
    activo: paso === 'escanear' && !busquedaAbierta
  });

  const buscarManual = async (valor: string) => {
    setTexto(valor);
    if (valor.trim().length < 3) {
      setResultados([]);
      return;
    }
    setResultados((await buscarConceptosEntrega(valor)).slice(0, 20));
  };

  const guardar = async () => {
    if (!elegido || !foto || !ubicacion) return;
    setGuardando(true);
    try {
      await encolarEntrega({
        solicitud_concepto_id: elegido.solicitud_concepto_id,
        folio: elegido.folio,
        beneficiario_nombre: elegido.beneficiario_nombre,
        concepto_nombre: descripcionConcepto(elegido),
        foto,
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        precision_m: ubicacion.precision_m,
        observaciones: observaciones.trim() ? observaciones.trim().slice(0, 500) : null
      });

      const habiaSenal = estaEnLinea();
      setExito(
        habiaSenal
          ? `Entrega registrada y sincronizada: ${elegido.beneficiario_nombre}.`
          : `Entrega registrada, se subirá cuando haya señal: ${elegido.beneficiario_nombre}.`
      );
      // Con senal se intenta de inmediato, sin bloquear el regreso al escaneo.
      if (habiaSenal) void sincronizarPendientes();

      await refrescarContadores();
      reiniciar();
    } finally {
      setGuardando(false);
    }
  };

  const pendientesDelFolio = useMemo(
    () => candidatos.filter((c) => !yaEntregados.has(c.solicitud_concepto_id)),
    [candidatos, yaEntregados]
  );

  const puedeGuardar = !!foto && !!ubicacion && !guardando;

  return (
    <main className="campo-entrega" data-testid="pantalla-registrar-entrega">
      <header className="campo-entrega-barra">
        <div>
          <strong>Entregar apoyos</strong>
          <span className="campo-entrega-evento" data-testid="entrega-evento-nombre">
            {evento ? evento.tipo_apoyo_nombre : 'Sin paquete'}
          </span>
        </div>
        <button
          type="button"
          className="secundario"
          data-testid="entrega-salir"
          onClick={() => navegar('/entregas/preparar')}
        >
          Salir
        </button>
      </header>

      {/* Contador del avance del evento: cuanto falta del paquete descargado. */}
      <p className="campo-entrega-contador" data-testid="entrega-contador">
        {registradas} de {totalPaquete} entregas registradas de este evento
      </p>
      {porSubir > 0 && (
        <p className="campo-entrega-porsubir" data-testid="entrega-por-subir">
          {porSubir} por subir
        </p>
      )}
      {!enLinea && (
        <p className="campo-entrega-porsubir" data-testid="entrega-sin-senal">
          Sin señal: todo se guarda en el dispositivo y se sube al reconectar.
        </p>
      )}

      {exito && (
        <div className="mensaje exito" role="status" data-testid="entrega-exito">
          {exito}
        </div>
      )}
      {aviso && (
        <div className="mensaje aviso" role="alert" data-testid="entrega-aviso">
          {aviso}
        </div>
      )}

      {/* ------------------------------------------------ Paso: escanear */}
      {paso === 'escanear' && (
        <section className="campo-entrega-cuerpo">
          {totalPaquete === 0 ? (
            <div className="mensaje error" role="alert" data-testid="entrega-sin-paquete">
              {AVISO_SIN_PAQUETE}
            </div>
          ) : busquedaAbierta ? (
            <>
              <h2>Buscar sin QR</h2>
              <p className="dato">
                Si el código QR del folio no se puede leer, escribe el nombre, el folio o el
                CURP.
              </p>
              <div className="campo">
                <label htmlFor="entrega-busqueda">Nombre, folio o CURP</label>
                <input
                  id="entrega-busqueda"
                  data-testid="entrega-busqueda"
                  autoComplete="off"
                  value={texto}
                  onChange={(e) => void buscarManual(e.target.value)}
                />
              </div>
              <ul className="campo-entrega-lista" data-testid="entrega-resultados">
                {resultados.map((c) => (
                  <li key={c.solicitud_concepto_id}>
                    <button
                      type="button"
                      data-testid={`entrega-resultado-${c.solicitud_concepto_id}`}
                      onClick={() =>
                        void (async () =>
                          abrirConceptos(
                            await conceptosPorFolio(c.folio),
                            `el folio ${c.folio}`
                          ))()
                      }
                    >
                      <strong>{c.beneficiario_nombre}</strong>
                      <span>
                        Folio {c.folio} · {descripcionConcepto(c)}
                      </span>
                    </button>
                  </li>
                ))}
                {texto.trim().length >= 3 && resultados.length === 0 && (
                  <li className="vacio" data-testid="entrega-busqueda-vacia">
                    Nadie coincide en el paquete descargado.
                  </li>
                )}
              </ul>
              <button
                type="button"
                className="secundario"
                data-testid="entrega-cerrar-busqueda"
                onClick={() => {
                  setBusquedaAbierta(false);
                  setTexto('');
                  setResultados([]);
                }}
              >
                Volver a la cámara
              </button>
            </>
          ) : (
            <>
              <h2>Escanear folio</h2>
              <p className="dato">
                Encuadra el código QR del Folio de entrega impreso que trae el productor.
              </p>
              {errorCamara && (
                <div className="mensaje error" role="alert" data-testid="entrega-error-camara">
                  {errorCamara} Busca al beneficiario por nombre.
                </div>
              )}
              <video
                ref={refVideo}
                data-testid="entrega-video"
                playsInline
                muted
                className="campo-entrega-video"
              />
              <canvas ref={refLienzo} style={{ display: 'none' }} />
              <button
                type="button"
                className="secundario"
                data-testid="entrega-abrir-busqueda"
                onClick={() => setBusquedaAbierta(true)}
              >
                No se puede leer el QR — buscar por nombre
              </button>
            </>
          )}
        </section>
      )}

      {/* ------------------------------------------------- Paso: elegir */}
      {paso === 'elegir' && (
        <section className="campo-entrega-cuerpo">
          <h2>¿Qué concepto se está entregando?</h2>
          <p className="dato">
            Folio {candidatos[0]?.folio} · {candidatos[0]?.beneficiario_nombre}. Cada concepto se
            entrega por separado.
          </p>
          <ul className="campo-entrega-lista" data-testid="entrega-conceptos">
            {candidatos.map((c) => {
              const entregado = yaEntregados.has(c.solicitud_concepto_id);
              return (
                <li key={c.solicitud_concepto_id}>
                  <button
                    type="button"
                    disabled={entregado}
                    data-testid={`entrega-concepto-${c.solicitud_concepto_id}`}
                    onClick={() => {
                      setElegido(c);
                      setPaso('confirmar');
                    }}
                  >
                    <strong>{descripcionConcepto(c)}</strong>
                    <span>
                      {cantidadConUnidad(c)}
                      {entregado ? ' · ya entregado' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="dato">{pendientesDelFolio.length} concepto(s) por entregar de este folio.</p>
          <button type="button" className="secundario" onClick={reiniciar}>
            Cancelar
          </button>
        </section>
      )}

      {/* ---------------------------------------------- Paso: confirmar */}
      {paso === 'confirmar' && elegido && (
        <section className="campo-entrega-cuerpo" data-testid="entrega-confirmacion">
          <h2>Confirma antes de entregar</h2>
          <dl className="campo-entrega-datos">
            <dt>Nombre</dt>
            <dd data-testid="entrega-dato-nombre">{elegido.beneficiario_nombre}</dd>
            <dt>Folio</dt>
            <dd data-testid="entrega-dato-folio">{elegido.folio}</dd>
            <dt>Concepto</dt>
            <dd data-testid="entrega-dato-concepto">{descripcionConcepto(elegido)}</dd>
            <dt>Cantidad</dt>
            <dd data-testid="entrega-dato-cantidad">{cantidadConUnidad(elegido)}</dd>
            <dt>Municipio</dt>
            <dd data-testid="entrega-dato-municipio">{elegido.municipio_nombre ?? 'Sin dato'}</dd>
          </dl>
          <div className="acciones">
            <button
              type="button"
              data-testid="entrega-tomar-foto"
              onClick={() => setPaso('evidencia')}
            >
              Tomar foto
            </button>
            <button type="button" className="secundario" onClick={reiniciar}>
              No es este
            </button>
          </div>
          <p className="dato">
            La foto debe mostrar al beneficiario, el apoyo y el folio impreso juntos.
          </p>
        </section>
      )}

      {/* ---------------------------------------------- Paso: evidencia */}
      {paso === 'evidencia' && elegido && (
        <section className="campo-entrega-cuerpo" data-testid="entrega-evidencia">
          <p className="dato">
            <strong>{elegido.beneficiario_nombre}</strong> · {descripcionConcepto(elegido)} ·{' '}
            {cantidadConUnidad(elegido)}
          </p>

          <CapturaFoto onFoto={setFoto} titulo="Foto: beneficiario, apoyo y folio impreso" />
          <CapturaGPS onUbicacion={setUbicacion} titulo="Ubicación de la entrega" />

          <div className="campo">
            <label htmlFor="entrega-observaciones">Observaciones (opcional)</label>
            <textarea
              id="entrega-observaciones"
              data-testid="entrega-observaciones"
              rows={2}
              maxLength={500}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>

          <div className="acciones">
            <button
              type="button"
              data-testid="entrega-confirmar"
              disabled={!puedeGuardar}
              onClick={() => void guardar()}
            >
              {guardando ? 'Guardando…' : 'Confirmar entrega'}
            </button>
            <button type="button" className="secundario" onClick={reiniciar}>
              Cancelar
            </button>
          </div>

          {!puedeGuardar && !guardando && (
            <p className="dato">Faltan la fotografía y/o las coordenadas para poder confirmar.</p>
          )}
        </section>
      )}
    </main>
  );
}
