// Pantalla de administración del plazo de ingreso de solicitudes.
// [data-testid="pantalla-catalogo-plazos"]
// Tabla [data-testid="tabla-plazos"], filas [data-testid="fila-plazo"]
//
// El plazo activo es el que alimenta el aviso "Faltan X días para el cierre de
// ingreso de solicitudes" del paso 1 de Nueva Solicitud (TimerPlazo.tsx).
import { useCallback, useEffect, useState } from 'react';
import type { PlazoSolicitudes, PlazoVigente } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

/** Muestra `2026-08-21` como `21/08/2026` sin pasar por Date (evita el desfase de zona). */
function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

export default function CatalogoPlazos() {
  const enLinea = useEstadoRed();

  const [plazos, setPlazos] = useState<PlazoSolicitudes[]>([]);
  const [vigente, setVigente] = useState<PlazoVigente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [historial, actual] = await Promise.all([api.plazos(), api.plazoVigente()]);
      setPlazos(historial.datos ?? []);
      setVigente(actual);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion && fallo.estado === 0
          ? 'Esta sección requiere conexión a internet.'
          : (fallo as Error).message
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activo = plazos.find((p) => p.activo) ?? null;

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErrorForm(null);
    setExito(null);

    if (!fechaInicio || !fechaFin) {
      setErrorForm('Captura la fecha de inicio y la fecha de fin.');
      return;
    }
    // Misma regla que valida el backend; aquí solo se adelanta el aviso.
    if (fechaFin <= fechaInicio) {
      setErrorForm('La fecha de fin debe ser posterior a la fecha de inicio.');
      return;
    }

    setGuardando(true);
    try {
      await api.crearPlazo({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
      setFechaInicio('');
      setFechaFin('');
      setExito('Plazo actualizado. El anterior quedó desactivado.');
      await cargar();
    } catch (fallo) {
      setErrorForm((fallo as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const cerrarCaptura = async () => {
    if (!activo) return;
    setError(null);
    setExito(null);
    try {
      await api.cambiarEstadoPlazo(activo.id, false);
      setExito('Plazo cerrado. Ya no se muestra el aviso de cierre en Nueva Solicitud.');
      await cargar();
    } catch (fallo) {
      setError((fallo as Error).message);
    }
  };

  if (!enLinea) {
    return (
      <div className="tarjeta pantalla-ancha" data-testid="pantalla-catalogo-plazos">
        <h1>Plazo de ingreso de solicitudes</h1>
        <p className="vacio">Esta sección requiere conexión a internet.</p>
      </div>
    );
  }

  return (
    <div className="tarjeta pantalla-ancha" data-testid="pantalla-catalogo-plazos">
      <h1>Plazo de ingreso de solicitudes</h1>
      <p className="mensaje aviso">
        El plazo activo alimenta el aviso de días restantes que ve la ventanilla en el paso 1 de
        Nueva Solicitud. Solo puede haber un plazo activo: al dar de alta uno nuevo, el anterior
        se desactiva automáticamente y pasa al historial.
      </p>

      {exito && (
        <div className="mensaje exito" role="status" data-testid="exito-plazos">
          {exito}
        </div>
      )}

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-plazos">
          {error}
        </div>
      )}

      <h2>Plazo activo</h2>
      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : !activo ? (
        <p className="vacio" data-testid="sin-plazo-activo">
          No hay ningún plazo activo. La ventanilla no ve el aviso de cierre.
        </p>
      ) : (
        <div data-testid="plazo-activo">
          <p>
            Del <strong data-testid="plazo-activo-inicio">{formatearFecha(activo.fecha_inicio)}</strong> al{' '}
            <strong data-testid="plazo-activo-fin">{formatearFecha(activo.fecha_fin)}</strong>.
          </p>
          {vigente?.activo && vigente.dias_restantes !== undefined && (
            <p data-testid="plazo-activo-dias">
              {vigente.vencido || vigente.dias_restantes === 0
                ? 'El plazo ya venció.'
                : `Faltan ${vigente.dias_restantes} días para el cierre.`}
            </p>
          )}
          <div className="campo acciones">
            <button
              type="button"
              className="secundario"
              data-testid="btn-cerrar-plazo"
              onClick={cerrarCaptura}
            >
              Cerrar la captura ahora
            </button>
          </div>
        </div>
      )}

      <h2>Nuevo plazo</h2>
      <form onSubmit={guardar} data-testid="form-plazo">
        <div className="campo">
          <label htmlFor="plazo-fecha-inicio">Fecha de inicio</label>
          <input
            id="plazo-fecha-inicio"
            type="date"
            data-testid="input-fecha-inicio"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            required
          />
        </div>
        <div className="campo">
          <label htmlFor="plazo-fecha-fin">Fecha de fin</label>
          <input
            id="plazo-fecha-fin"
            type="date"
            data-testid="input-fecha-fin"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            required
          />
        </div>

        {errorForm && (
          <div className="mensaje error" role="alert" data-testid="error-form-plazo">
            {errorForm}
          </div>
        )}

        <div className="campo acciones">
          <button type="submit" data-testid="btn-guardar-plazo" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Activar este plazo'}
          </button>
        </div>
      </form>

      <h2>Historial</h2>
      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : plazos.length === 0 ? (
        <p className="vacio">Sin plazos registrados</p>
      ) : (
        <div className="tabla-contenedor">
          <table data-testid="tabla-plazos">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {plazos.map((plazo) => (
                <tr key={plazo.id} data-testid="fila-plazo">
                  <td data-etiqueta="Inicio">{formatearFecha(plazo.fecha_inicio)}</td>
                  <td data-etiqueta="Fin">{formatearFecha(plazo.fecha_fin)}</td>
                  <td data-etiqueta="Estado">
                    {plazo.activo ? (
                      <span className="badge capturado" data-testid="chip-plazo-activo">
                        Activo
                      </span>
                    ) : (
                      <span className="badge pendiente" data-testid="chip-plazo-inactivo">
                        Inactivo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
