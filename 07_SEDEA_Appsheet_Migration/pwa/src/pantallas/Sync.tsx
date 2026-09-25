// Descarga del padron y los catalogos hacia IndexedDB.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErrorPeticion } from '../api/cliente';
import {
  contarBeneficiarios,
  contarEntregasPendientes,
  contarPendientes,
  guardarBeneficiarios,
  guardarCatalogos,
  limpiarBeneficiariosLocal,
  marcarSincronizacion,
  obtenerSesion,
  detalleColaEnvio,
  resumenEnvioPendiente,
  ultimoErrorSincronizacion
} from '../db/repositorios';
import { reintentarTodasLasCapturas, reintentarTodasLasEntregas } from '../sync/cola';
import { alCambiarCola, obtenerEstadoMotor, reiniciarMotor, sincronizarPendientes } from '../sync/motor';
import { useEstadoRed } from '../sync/estadoRed';
import { fijarEnvioPausado, useEnvioPausado } from '../sync/pausaEnvio';

function formatearPeso(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TAMANO_PAGINA = 500;

/** Formatea una fecha ISO al formato es-MX DD/MM/AAAA HH:mm. */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return 'Nunca';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'Nunca';
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const aaaa = fecha.getFullYear();
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${aaaa} ${hh}:${mi}`;
}

export default function Sync() {
  const enLinea = useEstadoRed();
  const navegar = useNavigate();

  const [totalLocal, setTotalLocal] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [descargados, setDescargados] = useState(0);
  const [totalRemoto, setTotalRemoto] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);
  const [entregasPend, setEntregasPend] = useState(0);
  // Diagnostico de campo: el motivo real del ultimo intento fallido, aunque
  // el item siga 'pendiente' (reencolado en silencio -- ver motor.ts). Sin
  // esto un atasco por, ej., un 401 nunca se podia ver desde la pantalla.
  const [ultimoError, setUltimoError] = useState<string | null>(null);
  // Diagnostico en vivo del motor de envio (ver sync/motor.ts, guardian).
  const [detalleCola, setDetalleCola] = useState<Awaited<ReturnType<typeof detalleColaEnvio>> | null>(null);
  const [, setLatidoUI] = useState(0);
  const pausado = useEnvioPausado();
  // Confirmacion antes de subir con el envio pausado (puede usar datos moviles).
  const [confirmandoEnvio, setConfirmandoEnvio] = useState<{
    capturas: number;
    entregas: number;
    bytes: number;
  } | null>(null);

  const refrescar = useCallback(async () => {
    setTotalLocal(await contarBeneficiarios());
    setPendientes(await contarPendientes());
    setEntregasPend(await contarEntregasPendientes());
    setUltimoError(await ultimoErrorSincronizacion());
    setDetalleCola(await detalleColaEnvio());
    const sesion = await obtenerSesion();
    setUltimaSync(sesion?.ultima_sincronizacion ?? null);
  }, []);

  useEffect(() => {
    void refrescar();
    const quitar = alCambiarCola(() => void refrescar());
    const t = setInterval(() => setLatidoUI((n) => n + 1), 2000);
    return () => {
      quitar();
      clearInterval(t);
    };
  }, [refrescar]);

  const descargar = async () => {
    setError(null);
    setMensaje(null);
    setTrabajando(true);
    setDescargados(0);

    try {
      const catalogos = await api.catalogos();
      await guardarCatalogos(catalogos);

      // Se limpia UNA SOLA VEZ, aqui, justo antes de la primera pagina: ya se
      // confirmo que hay red (el catalogo se acaba de bajar bien). Si el
      // padron local no se vacia, un servidor que se vacio de verdad (ej.
      // "Reiniciar datos de prueba") sincroniza "0 descargados" pero deja el
      // padron viejo intacto para siempre -- bug real detectado en produccion.
      await limpiarBeneficiariosLocal();

      let pagina = 1;
      let acumulado = 0;
      let hayMas = true;

      while (hayMas) {
        const respuesta = await api.beneficiarios(pagina, TAMANO_PAGINA);
        await guardarBeneficiarios(respuesta.data);
        acumulado += respuesta.data.length;
        setDescargados(acumulado);
        setTotalRemoto(respuesta.total);
        hayMas = respuesta.has_more;
        pagina++;
      }

      const ahora = new Date().toISOString();
      await marcarSincronizacion(ahora);
      await refrescar();
      setMensaje(`Sincronización completa: ${acumulado} beneficiarios descargados.`);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion
          ? `No se pudo sincronizar: ${fallo.message}`
          : 'No se pudo sincronizar.'
      );
    } finally {
      setTrabajando(false);
    }
  };

  /**
   * Boton de rescate para capturas/entregas atoradas en 'error' (ej. cuando
   * agotaron reintentos por una falla transitoria y quedaron esperando
   * intervencion humana antes del fix de motor.ts que reencola sola). Sin
   * esto, el usuario solo veia el contador de "Pendientes" subir y no tenia
   * forma de forzar nada sin ir ficha por ficha.
   */
  const reintentarAhora = async () => {
    setReintentando(true);
    setMensaje(null);
    setError(null);
    try {
      await reintentarTodasLasCapturas();
      await reintentarTodasLasEntregas();
      // Llega aqui solo con el envio activo o ya confirmado por el usuario:
      // `forzar` es lo unico que salta la pausa.
      const resultado = await sincronizarPendientes({ forzar: true });
      await refrescar();
      const subidas = resultado.enviadas + resultado.duplicadas;
      const siguenPendientes = (await contarPendientes()) + (await contarEntregasPendientes());
      // El mensaje ahora refleja lo que en verdad paso -- antes siempre decia
      // "se intento sincronizar" aunque nada se hubiera subido en realidad
      // (ej. token vencido: se reintenta en silencio para siempre, sin error
      // visible). `siguenPendientes` se lee de IndexedDB, no del resultado del
      // propio ciclo, porque si ya habia una sincronizacion en curso este
      // ciclo no hace nada y `resultado` sale en ceros sin avisarlo.
      if (subidas > 0 && siguenPendientes === 0) {
        setMensaje(`Se subieron ${subidas} pendiente(s). Todo al día.`);
      } else if (subidas > 0) {
        setMensaje(`Se subieron ${subidas} pendiente(s). Aún faltan ${siguenPendientes}.`);
      } else if (siguenPendientes > 0) {
        const detalle = await ultimoErrorSincronizacion();
        setError(
          `No se pudo subir nada (siguen ${siguenPendientes} pendiente(s)).` +
            (detalle ? ` Motivo: ${detalle}` : ' Vuelve a intentar en unos minutos.')
        );
      } else {
        setMensaje('No había nada pendiente por subir.');
      }
    } catch {
      setError('No fue posible reintentar la sincronización.');
    } finally {
      setReintentando(false);
    }
  };

  /** Con el envio pausado, primero se muestra cuanto se subiria y se pide OK. */
  const pedirEnvio = async () => {
    if (!pausado) {
      await reintentarAhora();
      return;
    }
    setConfirmandoEnvio(await resumenEnvioPendiente());
  };

  const confirmarEnvio = async () => {
    setConfirmandoEnvio(null);
    await reintentarAhora();
  };

  const porcentaje = totalRemoto > 0 ? Math.min(100, Math.round((descargados / totalRemoto) * 100)) : 0;

  return (
    <>
      <div className="tarjeta">
        <h1>Sincronización</h1>
        <p className="dato">
          Descarga el padrón y los catálogos para trabajar sin señal en campo.
        </p>

        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mensaje info" role="status">
            {mensaje}
          </div>
        )}
        {!enLinea && (
          <div className="mensaje aviso" role="status">
            Sin conexión: no es posible descargar el padrón en este momento.
          </div>
        )}

        <button type="button" onClick={() => void descargar()} disabled={!enLinea || trabajando}>
          {trabajando ? 'Descargando…' : 'Descargar padrón y catálogos'}
        </button>

        {(trabajando || descargados > 0) && (
          <div style={{ marginTop: 14 }}>
            <div className="progreso">
              <div style={{ width: `${porcentaje}%` }} />
            </div>
            <p className="dato" data-testid="progreso-descarga">
              {descargados} de {totalRemoto || descargados} beneficiarios descargados
            </p>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <h2>Estado local del dispositivo</h2>
        <p className="dato" data-testid="total-local">
          <strong>Beneficiarios en el dispositivo:</strong> {totalLocal}
        </p>
        <p className="dato" data-testid="ultima-sincronizacion">
          <strong>Última sincronización:</strong> {formatearFecha(ultimaSync)}
        </p>
        <p className="dato">
          <strong>Capturas pendientes de enviar:</strong> {pendientes}
        </p>
        <p className="dato" data-testid="entregas-pendientes-enviar">
          <strong>Entregas pendientes de enviar:</strong> {entregasPend}
        </p>

        {(pendientes > 0 || entregasPend > 0) && (
          <details className="mensaje info" data-testid="diagnostico-envio" open>
            <summary>
              <strong>Diagnóstico del envío</strong>
            </summary>
            {(() => {
              const m = obtenerEstadoMotor();
              const seg = (t: number) => Math.round((Date.now() - t) / 1000);
              return (
                <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                  <li>
                    Motor: <strong>{m.ocupado ? 'ocupado' : 'libre'}</strong>
                    {m.ocupado && m.desde ? ` desde hace ${seg(m.desde)} s` : ''}
                  </li>
                  <li>
                    Paso actual: {m.paso}
                    {m.ocupado && m.latido ? ` (sin avance hace ${seg(m.latido)} s)` : ''}
                  </li>
                  <li>Destrabes automáticos: {m.recuperaciones}</li>
                  {detalleCola && (
                    <>
                      <li>
                        En cola:{' '}
                        {Object.entries(detalleCola.porEstado)
                          .map(([e, n]) => `${e} ${n}`)
                          .join(' · ') || 'nada'}
                      </li>
                      <li>
                        Foto más pesada: {detalleCola.fotoMayorKB} KB · sobre 4 MB:{' '}
                        {detalleCola.fotosSobreTopeMB4}
                      </li>
                      {detalleCola.primeras.map((f) => (
                        <li key={f.uuid}>
                          {f.tipo} {f.uuid}: {f.estado}, {f.kb} KB, intentos {f.intentos}
                          {f.error ? ` — ${f.error}` : ''}
                        </li>
                      ))}
                    </>
                  )}
                  <li>Versión de la app: {__APP_VERSION__}</li>
                </ul>
              );
            })()}
            <button
              type="button"
              className="secundario"
              data-testid="btn-reiniciar-envio"
              onClick={() => {
                reiniciarMotor();
                void reintentarAhora();
              }}
            >
              Reiniciar envío
            </button>
          </details>
        )}

        {(pendientes > 0 || entregasPend > 0) && ultimoError && (
          <div className="mensaje aviso" role="status" data-testid="ultimo-error-sync">
            <strong>Motivo del último intento fallido:</strong> {ultimoError}
          </div>
        )}

        <label className="casilla" style={{ display: 'block', margin: '12px 0' }}>
          <input
            type="checkbox"
            data-testid="chk-pausar-envio"
            checked={pausado}
            onChange={(e) => {
              fijarEnvioPausado(e.target.checked);
              setConfirmandoEnvio(null);
            }}
            style={{ marginRight: 8 }}
          />
          Pausar el envío de fotos (ahorra datos móviles)
        </label>
        <p className="dato">
          {pausado
            ? 'Envío PAUSADO: las capturas y entregas se guardan en este teléfono pero no se suben solas. Bajar el padrón y el paquete de entrega sigue funcionando normal. Usa "Enviar ahora" cuando quieras subirlas.'
            : 'Envío activo: las fotos se suben solas en cuanto hay conexión. Actívalo si no quieres gastar tus datos móviles y súbelas después con WiFi.'}
        </p>

        {confirmandoEnvio && (
          <div className="mensaje aviso" role="alert" data-testid="confirmar-envio">
            Se van a subir {confirmandoEnvio.capturas} captura(s) y {confirmandoEnvio.entregas}{' '}
            entrega(s), ≈ {formatearPeso(confirmandoEnvio.bytes)} de fotos. Esto puede usar tus datos
            móviles si no estás en WiFi. ¿Continuar?
            <div className="acciones" style={{ marginTop: 8 }}>
              <button
                type="button"
                data-testid="btn-confirmar-envio"
                onClick={() => void confirmarEnvio()}
              >
                Sí, enviar ahora
              </button>
              <button
                type="button"
                className="secundario"
                onClick={() => setConfirmandoEnvio(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="acciones">
          <button type="button" className="secundario" onClick={() => navegar('/beneficiarios')}>
            Ir al padrón
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-reintentar-sincronizacion"
            disabled={!enLinea || reintentando}
            onClick={() => void pedirEnvio()}
          >
            {reintentando ? 'Enviando…' : pausado ? 'Enviar ahora' : 'Reintentar ahora'}
          </button>
        </div>
        <p className="dato" style={{ marginTop: 8 }}>
          Si hay capturas o entregas atoradas (con foto ya tomada pero sin subir), este botón las
          vuelve a poner en fila y fuerza un nuevo intento de envío.
        </p>
      </div>
    </>
  );
}
