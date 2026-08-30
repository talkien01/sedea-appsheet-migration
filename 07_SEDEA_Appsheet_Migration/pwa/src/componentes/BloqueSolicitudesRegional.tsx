import { useEffect, useState } from 'react';
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

export default function BloqueSolicitudesRegional({ regional, regionalNombre, version }: Props) {
  const [datos, setDatos] = useState<ResumenSolicitudesDashboard | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

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
        una captura excepcional en SEDEA Central conserva la Regional responsable.
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
