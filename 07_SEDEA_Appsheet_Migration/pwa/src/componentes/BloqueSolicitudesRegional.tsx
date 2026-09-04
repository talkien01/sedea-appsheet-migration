import { useEffect, useMemo, useState } from 'react';
import TarjetaMetrica from './TarjetaMetrica';
import {
  obtenerResumenSolicitudes,
  type ResumenSolicitudesDashboard
} from '../api/estadisticasSolicitudes';

interface Props {
  regional: string;
  regionalNombre: string;
  version: number;
}

/** Formatea kg como toneladas (2 decimales) cuando el toggle esta en toneladas. */
function formatearCantidad(valor: number, unidad: string, enToneladas: boolean): string {
  if (enToneladas && unidad.toLowerCase() === 'kg') {
    return `${(valor / 1000).toLocaleString('es-MX', { maximumFractionDigits: 2 })} t`;
  }
  return `${valor.toLocaleString('es-MX', { maximumFractionDigits: 2 })} ${unidad}`;
}

export default function BloqueSolicitudesRegional({ regional, regionalNombre, version }: Props) {
  const [datos, setDatos] = useState<ResumenSolicitudesDashboard | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [enToneladas, setEnToneladas] = useState(false);

  // El toggle kg/toneladas solo tiene sentido si algun concepto usa kg.
  const hayConceptosEnKg = useMemo(
    () => (datos?.por_concepto ?? []).some((c) => c.unidad_medida?.toLowerCase() === 'kg'),
    [datos]
  );

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(false);
    setDatos(null);

    void obtenerResumenSolicitudes(regional || null)
      .then((respuesta) => {
        if (!vigente) return;
        setDatos(respuesta);
      })
      .catch(() => {
        if (!vigente) return;
        setError(true);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    return () => {
      vigente = false;
    };
  }, [regional, version]);

  return (
    <div className="tarjeta" data-testid="bloque-solicitudes-regional">
      <h2>Ingreso de solicitudes · {regionalNombre}</h2>
      <p className="dato">
        Corte operativo en tiempo real. La Regional se determina por el municipio del predio;
        una captura excepcional en SEDEA Central se contabiliza en la Regional responsable.
      </p>

      {cargando && !datos && <p className="vacio">Cargando solicitudes…</p>}
      {error && <p className="vacio">No se pudo cargar el resumen de solicitudes.</p>}

      {datos && (
        <>
          <div className="tarjetas-resumen">
            <TarjetaMetrica
              testId="solicitudes-hoy"
              etiqueta="Ingresadas hoy"
              valor={datos.ingresadas_hoy}
            />
            <TarjetaMetrica
              testId="solicitudes-total"
              etiqueta="Total acumulado"
              valor={datos.total_solicitudes}
            />
            <TarjetaMetrica
              testId="solicitudes-sin-dictamen"
              etiqueta="Sin dictamen"
              valor={datos.sin_dictamen}
            />
            <TarjetaMetrica
              testId="solicitudes-dictaminadas"
              etiqueta="Dictaminadas"
              valor={datos.dictaminadas}
            />
            <TarjetaMetrica
              testId="solicitudes-autorizadas"
              etiqueta="Autorizadas"
              valor={datos.autorizadas}
            />
            <TarjetaMetrica
              testId="solicitudes-pendiente-autorizacion"
              etiqueta="Pend. autorización"
              valor={datos.pendientes_autorizacion}
            />
          </div>

          {datos.capturadas_central > 0 && (
            <p className="dato" data-testid="solicitudes-central">
              Capturas excepcionales realizadas desde SEDEA Central: {datos.capturadas_central}. Ya
              están contabilizadas en la Regional del predio correspondiente.
            </p>
          )}

          {datos.por_concepto.length > 0 && (
            <div data-testid="bloque-cantidades-concepto">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <h3 style={{ margin: 0 }}>Distribución por concepto de apoyo</h3>
                {hayConceptosEnKg && (
                  <div role="group" aria-label="Unidad de despliegue" className="acciones">
                    <button
                      type="button"
                      className={enToneladas ? 'secundario' : ''}
                      data-testid="btn-unidad-kg"
                      onClick={() => setEnToneladas(false)}
                    >
                      kg
                    </button>
                    <button
                      type="button"
                      className={enToneladas ? '' : 'secundario'}
                      data-testid="btn-unidad-toneladas"
                      onClick={() => setEnToneladas(true)}
                    >
                      toneladas
                    </button>
                  </div>
                )}
              </div>
              {datos.por_concepto.map((concepto) => (
                <div key={concepto.tipo_apoyo_id} className="tarjetas-resumen" style={{ marginBottom: '12px' }}>
                  <TarjetaMetrica
                    testId={`concepto-${concepto.clave}-solicitado`}
                    etiqueta={`${concepto.nombre} · solicitado`}
                    valor={formatearCantidad(concepto.solicitado, concepto.unidad_medida, enToneladas)}
                  />
                  <TarjetaMetrica
                    testId={`concepto-${concepto.clave}-autorizado`}
                    etiqueta={`${concepto.nombre} · autorizado`}
                    valor={formatearCantidad(concepto.autorizado, concepto.unidad_medida, enToneladas)}
                  />
                  <TarjetaMetrica
                    testId={`concepto-${concepto.clave}-entregado`}
                    etiqueta={`${concepto.nombre} · entregado`}
                    valor={formatearCantidad(concepto.entregado, concepto.unidad_medida, enToneladas)}
                  />
                </div>
              ))}
            </div>
          )}

          <h3>Avance por municipio</h3>
          <div className="tabla-contenedor">
            <table data-testid="tabla-solicitudes-municipio">
              <thead>
                <tr>
                  <th>Municipio</th>
                  <th>Hoy</th>
                  <th>Total</th>
                  <th>Sin dictamen</th>
                  <th>Dictaminadas</th>
                  <th>Autorizadas</th>
                </tr>
              </thead>
              <tbody>
                {datos.por_municipio.map((fila) => (
                  <tr key={fila.municipio_id}>
                    <td data-etiqueta="Municipio">{fila.municipio}</td>
                    <td data-etiqueta="Hoy">{fila.hoy}</td>
                    <td data-etiqueta="Total">{fila.total}</td>
                    <td data-etiqueta="Sin dictamen">{fila.sin_dictamen}</td>
                    <td data-etiqueta="Dictaminadas">{fila.dictaminadas}</td>
                    <td data-etiqueta="Autorizadas">{fila.autorizadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.por_municipio.length === 0 && <p className="vacio">Aún no hay solicitudes.</p>}

          <h3>Captura de hoy por usuario</h3>
          <div className="tabla-contenedor">
            <table data-testid="tabla-solicitudes-capturista">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Solicitudes de hoy</th>
                </tr>
              </thead>
              <tbody>
                {datos.por_capturista_hoy.map((fila) => (
                  <tr key={fila.usuario_id}>
                    <td data-etiqueta="Usuario">{fila.nombre_completo || fila.usuario}</td>
                    <td data-etiqueta="Solicitudes de hoy">{fila.solicitudes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.por_capturista_hoy.length === 0 && (
            <p className="vacio">Hoy todavía no hay solicitudes capturadas.</p>
          )}
        </>
      )}
    </div>
  );
}
