// Correccion controlada de datos en produccion.
// Beneficiarios conserva su flujo existente; Solicitudes agrega una lista blanca
// urgente para nombre y CURP, siempre con motivo y bitacora en backend.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPeticion, peticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

interface SolicitudCorreccion {
  id: number;
  folio: string;
  nombre_solicitante: string;
  curp: string | null;
  tipo_persona: string;
  recibida_en: string;
  municipio: string | null;
  regional: string | null;
  beneficiarios: number;
  historial?: Array<{
    fecha: string;
    usuario: string | null;
    motivo: string | null;
    cambios: Array<{ campo: string; anterior: unknown; nuevo: unknown }>;
    beneficiarios_actualizados: number;
  }>;
}

type Modo = 'solicitudes' | 'beneficiarios';

function mensajeError(error: unknown): string {
  return error instanceof ErrorPeticion ? error.message : 'No se pudo completar la operación.';
}

export default function Correcciones() {
  const enLinea = useEstadoRed();
  const [modo, setModo] = useState<Modo>('solicitudes');

  // Beneficiarios: flujo ya existente.
  const [busquedaBeneficiario, setBusquedaBeneficiario] = useState('');
  const [beneficiarios, setBeneficiarios] = useState<any[]>([]);
  const [cargandoBeneficiarios, setCargandoBeneficiarios] = useState(false);
  const [errorBeneficiarios, setErrorBeneficiarios] = useState<string | null>(null);

  // Solicitudes: correccion controlada.
  const [busquedaSolicitud, setBusquedaSolicitud] = useState('');
  const [solicitudes, setSolicitudes] = useState<SolicitudCorreccion[]>([]);
  const [cargandoSolicitudes, setCargandoSolicitudes] = useState(false);
  const [errorSolicitudes, setErrorSolicitudes] = useState<string | null>(null);
  const [seleccionada, setSeleccionada] = useState<SolicitudCorreccion | null>(null);
  const [nombre, setNombre] = useState('');
  const [curp, setCurp] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);

  const buscarBeneficiarios = useCallback(async (texto: string) => {
    setCargandoBeneficiarios(true);
    setErrorBeneficiarios(null);
    try {
      const parametros = new URLSearchParams({ page_size: '50' });
      if (texto.trim().length >= 2) parametros.set('q', texto.trim());
      const r = await peticion<{ data: any[] }>(`/correcciones/beneficiarios?${parametros.toString()}`);
      setBeneficiarios(r.data);
    } catch (error) {
      setErrorBeneficiarios(mensajeError(error));
    } finally {
      setCargandoBeneficiarios(false);
    }
  }, []);

  const buscarSolicitudes = useCallback(async (texto: string) => {
    setCargandoSolicitudes(true);
    setErrorSolicitudes(null);
    try {
      const parametros = new URLSearchParams({ page_size: '50' });
      if (texto.trim().length >= 2) parametros.set('q', texto.trim());
      const r = await peticion<{ data: SolicitudCorreccion[] }>(
        `/correcciones/solicitudes?${parametros.toString()}`
      );
      setSolicitudes(r.data);
    } catch (error) {
      setErrorSolicitudes(mensajeError(error));
    } finally {
      setCargandoSolicitudes(false);
    }
  }, []);

  useEffect(() => {
    if (!enLinea || modo !== 'beneficiarios') return;
    const temporizador = setTimeout(() => void buscarBeneficiarios(busquedaBeneficiario), 300);
    return () => clearTimeout(temporizador);
  }, [busquedaBeneficiario, buscarBeneficiarios, enLinea, modo]);

  useEffect(() => {
    if (!enLinea || modo !== 'solicitudes') return;
    const temporizador = setTimeout(() => void buscarSolicitudes(busquedaSolicitud), 300);
    return () => clearTimeout(temporizador);
  }, [busquedaSolicitud, buscarSolicitudes, enLinea, modo]);

  const abrirSolicitud = async (id: number) => {
    setErrorSolicitudes(null);
    setExito(null);
    try {
      const detalle = await peticion<SolicitudCorreccion>(`/correcciones/solicitudes/${id}`);
      setSeleccionada(detalle);
      setNombre(detalle.nombre_solicitante ?? '');
      setCurp(detalle.curp ?? '');
      setMotivo('');
    } catch (error) {
      setErrorSolicitudes(mensajeError(error));
    }
  };

  const guardarSolicitud = async () => {
    if (!seleccionada) return;
    setGuardando(true);
    setErrorSolicitudes(null);
    setExito(null);
    try {
      const r = await peticion<{
        ok: true;
        solicitud: SolicitudCorreccion;
        cambios: Array<{ campo: string; anterior: unknown; nuevo: unknown }>;
        beneficiarios_actualizados: number;
      }>(`/correcciones/solicitudes/${seleccionada.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre_solicitante: nombre.trim().toUpperCase(),
          curp: curp.trim().toUpperCase() || null,
          motivo: motivo.trim()
        })
      });
      setExito(
        r.cambios.length === 0
          ? 'No había cambios que aplicar.'
          : `Corrección guardada. Beneficiarios derivados actualizados: ${r.beneficiarios_actualizados}.`
      );
      await buscarSolicitudes(busquedaSolicitud);
      await abrirSolicitud(seleccionada.id);
    } catch (error) {
      setErrorSolicitudes(mensajeError(error));
    } finally {
      setGuardando(false);
    }
  };

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Correcciones en producción</h1>
        <div className="mensaje aviso" role="status">
          Solo editor de datos y administrador. Toda corrección queda registrada en bitácora.
          Folios, conceptos y montos no se editan desde esta pantalla.
        </div>
        <div className="acciones">
          <button
            type="button"
            className={modo === 'solicitudes' ? 'primario' : 'secundario'}
            onClick={() => setModo('solicitudes')}
          >
            Solicitudes
          </button>
          <button
            type="button"
            className={modo === 'beneficiarios' ? 'primario' : 'secundario'}
            onClick={() => setModo('beneficiarios')}
          >
            Beneficiarios
          </button>
        </div>
      </div>

      {modo === 'solicitudes' && (
        <>
          <div className="tarjeta pantalla-ancha">
            <h2>Corregir solicitud</h2>
            <div className="mensaje aviso" role="status">
              En esta primera versión solo se permite corregir <strong>Nombre del solicitante</strong> y
              <strong> CURP</strong>. Si la solicitud generó beneficiarios, el cambio se replica en ellos
              dentro de la misma transacción.
            </div>
            <div className="campo">
              <label htmlFor="input-busqueda-solicitud">Buscar por folio, CURP o nombre</label>
              <input
                id="input-busqueda-solicitud"
                type="search"
                placeholder="Mínimo 2 caracteres"
                value={busquedaSolicitud}
                onChange={(e) => setBusquedaSolicitud(e.target.value)}
              />
            </div>
            {errorSolicitudes && <div className="mensaje error" role="alert">{errorSolicitudes}</div>}
            {exito && <div className="mensaje exito" role="status">{exito}</div>}
          </div>

          <div className="tarjeta">
            <h2>Solicitudes ({solicitudes.length})</h2>
            {cargandoSolicitudes && <p className="vacio">Cargando…</p>}
            {!cargandoSolicitudes && solicitudes.length === 0 && <p className="vacio">Sin resultados</p>}
            {!cargandoSolicitudes && solicitudes.length > 0 && (
              <div className="tabla-contenedor">
                <table>
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>CURP</th>
                      <th>Nombre</th>
                      <th>Tipo</th>
                      <th>Regional</th>
                      <th>Municipio</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {solicitudes.map((s) => (
                      <tr key={s.id}>
                        <td data-etiqueta="Folio" className="mono">{s.folio}</td>
                        <td data-etiqueta="CURP" className="mono">
                          {s.curp || <strong>— SIN CURP —</strong>}
                        </td>
                        <td data-etiqueta="Nombre" className="celda-texto">{s.nombre_solicitante}</td>
                        <td data-etiqueta="Tipo">{s.tipo_persona}</td>
                        <td data-etiqueta="Regional">{s.regional ?? '—'}</td>
                        <td data-etiqueta="Municipio">{s.municipio ?? '—'}</td>
                        <td data-etiqueta="">
                          <button type="button" className="secundario" onClick={() => void abrirSolicitud(s.id)}>
                            Corregir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {seleccionada && (
            <div className="tarjeta pantalla-ancha">
              <h2>{seleccionada.folio}</h2>
              <p className="dato">
                {seleccionada.tipo_persona} · {seleccionada.regional ?? 'Sin Regional'} ·{' '}
                {seleccionada.municipio ?? 'Sin municipio'}
              </p>
              {seleccionada.tipo_persona === 'fisica' && !seleccionada.curp && (
                <div className="mensaje error" role="alert">
                  Esta solicitud es de persona física y está sin CURP. Captura la CURP correcta antes de guardar.
                </div>
              )}
              <div className="campo">
                <label htmlFor="input-correccion-nombre">Nombre del solicitante</label>
                <input
                  id="input-correccion-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value.toUpperCase())}
                />
              </div>
              <div className="campo">
                <label htmlFor="input-correccion-curp">CURP</label>
                <input
                  id="input-correccion-curp"
                  maxLength={18}
                  value={curp}
                  onChange={(e) => setCurp(e.target.value.toUpperCase())}
                />
              </div>
              <div className="campo">
                <label htmlFor="input-correccion-motivo">Motivo de la corrección</label>
                <textarea
                  id="input-correccion-motivo"
                  maxLength={500}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. Corrección contra documentación física del expediente"
                />
              </div>
              <div className="acciones">
                <button
                  type="button"
                  className="primario"
                  disabled={guardando || nombre.trim() === '' || motivo.trim().length < 5}
                  onClick={() => void guardarSolicitud()}
                >
                  {guardando ? 'Guardando…' : 'Guardar corrección'}
                </button>
                <button type="button" className="secundario" onClick={() => setSeleccionada(null)}>
                  Cancelar
                </button>
              </div>

              {(seleccionada.historial?.length ?? 0) > 0 && (
                <div>
                  <h3>Historial de correcciones</h3>
                  <div className="tabla-contenedor">
                    <table>
                      <thead>
                        <tr><th>Fecha</th><th>Usuario</th><th>Motivo</th><th>Cambios</th></tr>
                      </thead>
                      <tbody>
                        {seleccionada.historial!.map((h, i) => (
                          <tr key={`${h.fecha}-${i}`}>
                            <td>{new Date(h.fecha).toLocaleString('es-MX')}</td>
                            <td>{h.usuario ?? '—'}</td>
                            <td>{h.motivo ?? '—'}</td>
                            <td>
                              {h.cambios.map((c) => `${c.campo}: ${String(c.anterior ?? '—')} → ${String(c.nuevo ?? '—')}`).join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {modo === 'beneficiarios' && (
        <>
          <div className="tarjeta pantalla-ancha">
            <h2>Corrección de datos — Beneficiarios en producción</h2>
            <div className="mensaje aviso" role="status">
              Aquí se corrigen datos de contacto y ubicación de beneficiarios ya promovidos. CURP y
              Folio no se editan en este flujo.
            </div>
            <div className="campo">
              <label htmlFor="input-busqueda-correcciones">Buscar por folio, CURP o nombre</label>
              <input
                id="input-busqueda-correcciones"
                data-testid="input-busqueda-correcciones"
                type="search"
                placeholder="Mínimo 2 caracteres"
                value={busquedaBeneficiario}
                onChange={(e) => setBusquedaBeneficiario(e.target.value)}
              />
            </div>
          </div>

          <div className="tarjeta">
            <h2>Resultados ({beneficiarios.length})</h2>
            {errorBeneficiarios && <div className="mensaje error" role="alert">{errorBeneficiarios}</div>}
            {cargandoBeneficiarios && <p className="vacio">Cargando…</p>}
            {!cargandoBeneficiarios && beneficiarios.length === 0 && <p className="vacio">Sin resultados</p>}
            {!cargandoBeneficiarios && beneficiarios.length > 0 && (
              <div className="tabla-contenedor">
                <table data-testid="tabla-correcciones">
                  <thead>
                    <tr>
                      <th>Folio</th><th>CURP</th><th>Nombre</th><th>Regional</th>
                      <th>Municipio</th><th>Colonia</th><th>Teléfono</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {beneficiarios.map((fila) => (
                      <tr key={fila.id} data-testid="fila-correccion">
                        <td data-etiqueta="Folio" className="mono">{fila.folio}</td>
                        <td data-etiqueta="CURP" className="mono">{fila.curp ?? '—'}</td>
                        <td data-etiqueta="Nombre" className="celda-texto">{fila.nombre_completo}</td>
                        <td data-etiqueta="Regional">{fila.regional ?? '—'}</td>
                        <td data-etiqueta="Municipio">{fila.municipio ?? '—'}</td>
                        <td data-etiqueta="Colonia">{fila.colonia ?? '—'}</td>
                        <td data-etiqueta="Teléfono">{fila.telefono ?? '—'}</td>
                        <td data-etiqueta="">
                          <Link className="boton secundario" to={`/correcciones/beneficiarios/${fila.id}`}>
                            Corregir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
