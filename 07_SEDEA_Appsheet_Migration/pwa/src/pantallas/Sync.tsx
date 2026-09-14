// Descarga del padron y los catalogos hacia IndexedDB.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErrorPeticion } from '../api/cliente';
import {
  contarBeneficiarios,
  contarPendientes,
  guardarBeneficiarios,
  guardarCatalogos,
  limpiarBeneficiariosLocal,
  marcarSincronizacion,
  obtenerSesion
} from '../db/repositorios';
import { reintentarTodasLasCapturas, reintentarTodasLasEntregas } from '../sync/cola';
import { sincronizarPendientes } from '../sync/motor';
import { useEstadoRed } from '../sync/estadoRed';

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

  const refrescar = useCallback(async () => {
    setTotalLocal(await contarBeneficiarios());
    setPendientes(await contarPendientes());
    const sesion = await obtenerSesion();
    setUltimaSync(sesion?.ultima_sincronizacion ?? null);
  }, []);

  useEffect(() => {
    void refrescar();
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
      const capturas = await reintentarTodasLasCapturas();
      const entregas = await reintentarTodasLasEntregas();
      await sincronizarPendientes();
      await refrescar();
      const total = capturas + entregas;
      setMensaje(
        total > 0
          ? `Se reencolaron ${total} pendiente(s) y se intento sincronizar de nuevo.`
          : 'No había capturas ni entregas en error. Se intentó sincronizar de todas formas.'
      );
    } catch {
      setError('No fue posible reintentar la sincronización.');
    } finally {
      setReintentando(false);
    }
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
        <div className="acciones">
          <button type="button" className="secundario" onClick={() => navegar('/beneficiarios')}>
            Ir al padrón
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-reintentar-sincronizacion"
            disabled={!enLinea || reintentando}
            onClick={() => void reintentarAhora()}
          >
            {reintentando ? 'Reintentando…' : 'Reintentar ahora'}
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
