// Edicion administrativa de solicitudes. SOLO admin (D44: la unica excepcion
// a la inmutabilidad de solicitudes). El folio NUNCA es editable — si esta
// mal, la via es anular y volver a capturar, no editarlo aqui.
//
// Cada guardado exige: motivo obligatorio + reautenticacion con la propia
// contraseña del admin (defensa en profundidad contra una sesion abierta sin
// vigilancia). Los conceptos existentes se pueden corregir (cantidad/monto);
// no se agregan ni quitan aqui — eso crea/borra beneficiarios y queda fuera
// de esta v1.
import { useCallback, useEffect, useState } from 'react';
import type {
  ConceptoSolicitud,
  FilaSolicitud,
  Municipio,
  DireccionRegional,
  TipoPersona
} from '@sedea/shared';
import { TIPOS_PERSONA, ETIQUETAS_TIPO_PERSONA } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';
import { apiSolicitudes } from '../api/solicitudes';
import { useEstadoRed } from '../sync/estadoRed';

interface CamposEditables {
  nombre_solicitante: string;
  tipo_persona: TipoPersona;
  curp: string;
  telefono: string;
  ubi_municipio_id: number;
  ubi_localidad: string;
}

export default function EdicionAdminSolicitudes() {
  const enLinea = useEstadoRed();
  const [busqueda, setBusqueda] = useState('');
  const [capturadoPorId, setCapturadoPorId] = useState('');
  const [regionalId, setRegionalId] = useState('');
  const [municipioId, setMunicipioId] = useState('');

  const [filas, setFilas] = useState<FilaSolicitud[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [regionales, setRegionales] = useState<DireccionRegional[]>([]);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: number; nombre_completo: string }[]>([]);

  const [idEditando, setIdEditando] = useState<number | null>(null);

  useEffect(() => {
    if (!enLinea) return;
    void api.catalogos().then((c) => {
      setRegionales(c.regionales);
      setMunicipios(c.municipios);
    });
    void api
      .usuarios(new URLSearchParams({ page_size: '200' }))
      .then((p) => setUsuarios(p.data.filter((u) => u.activo && !u.eliminado)));
  }, [enLinea]);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ page: '1', page_size: '50' });
      if (busqueda.trim()) parametros.set('q', busqueda.trim());
      if (capturadoPorId) parametros.set('capturado_por_id', capturadoPorId);
      if (regionalId) parametros.set('regional_id', regionalId);
      if (municipioId) parametros.set('municipio_id', municipioId);
      const resultado = await apiSolicitudes.listar(parametros);
      setFilas(resultado.data);
      setTotal(resultado.total);
    } catch {
      setError('No se pudieron cargar las solicitudes.');
    } finally {
      setCargando(false);
    }
  }, [busqueda, capturadoPorId, regionalId, municipioId]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void buscar(), 300);
    return () => clearTimeout(temporizador);
  }, [buscar, enLinea]);

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Edición administrativa de solicitudes</h1>
        <p className="dato">
          Corrige datos capturados incorrectamente (nombre, CURP, teléfono, conceptos...). El
          folio nunca es editable.
        </p>
      </div>

      <div className="tarjeta">
        <h2>Filtros</h2>
        <div className="filtros">
          <label className="campo">
            <span>Folio, nombre o CURP</span>
            <input
              data-testid="input-busqueda-edicion-admin"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </label>
          <label className="campo">
            <span>Capturada por</span>
            <select
              data-testid="select-capturado-por-edicion-admin"
              value={capturadoPorId}
              onChange={(e) => setCapturadoPorId(e.target.value)}
            >
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre_completo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Regional</span>
            <select
              data-testid="select-regional-edicion-admin"
              value={regionalId}
              onChange={(e) => setRegionalId(e.target.value)}
            >
              <option value="">Todas</option>
              {regionales.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Municipio</span>
            <select
              data-testid="select-municipio-edicion-admin"
              value={municipioId}
              onChange={(e) => setMunicipioId(e.target.value)}
            >
              <option value="">Todos</option>
              {municipios.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Resultados ({total})</h2>
        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
        {cargando && <p className="vacio">Cargando…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-edicion-admin">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Solicitante</th>
                  <th>Capturada por</th>
                  <th>Regional</th>
                  <th>Municipio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} data-testid="fila-edicion-admin">
                    <td className="mono">{f.folio}</td>
                    <td>{f.nombre_solicitante}</td>
                    <td>{f.capturado_por_nombre ?? '—'}</td>
                    <td>{f.regional ?? '—'}</td>
                    <td>{f.municipio ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="boton secundario"
                        data-testid={`btn-editar-admin-${f.id}`}
                        onClick={() => setIdEditando(f.id)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {idEditando !== null && (
        <ModalEdicionAdmin
          id={idEditando}
          municipios={municipios}
          onCerrar={() => setIdEditando(null)}
          onGuardado={() => {
            setIdEditando(null);
            void buscar();
          }}
        />
      )}
    </>
  );
}

interface PropsModal {
  id: number;
  municipios: Municipio[];
  onCerrar: () => void;
  onGuardado: () => void;
}

function ModalEdicionAdmin({ id, municipios, onCerrar, onGuardado }: PropsModal) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [folio, setFolio] = useState('');
  const [campos, setCampos] = useState<CamposEditables | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoSolicitud[]>([]);
  const [motivo, setMotivo] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const detalle = await apiSolicitudes.detalle(id);
        const s = detalle.solicitud as Record<string, any>;
        setFolio(s.folio);
        setCampos({
          nombre_solicitante: s.nombre_solicitante ?? '',
          tipo_persona: s.tipo_persona,
          curp: s.curp ?? '',
          telefono: s.telefono ?? '',
          ubi_municipio_id: s.ubi_municipio_id,
          ubi_localidad: s.ubi_localidad ?? ''
        });
        setConceptos(detalle.conceptos);
      } catch {
        setError('No se pudo cargar la solicitud.');
      } finally {
        setCargando(false);
      }
    })();
  }, [id]);

  const cambiarCampo = <K extends keyof CamposEditables>(clave: K, valor: CamposEditables[K]) => {
    setCampos((previo) => (previo ? { ...previo, [clave]: valor } : previo));
  };

  const cambiarConcepto = (conceptoId: number, clave: 'cantidad' | 'monto_total', valor: number) => {
    setConceptos((previos) =>
      previos.map((c) => (c.id === conceptoId ? { ...c, [clave]: valor } : c))
    );
  };

  const guardar = async () => {
    if (!campos) return;
    if (motivo.trim().length < 5) {
      setError('Escribe el motivo de la corrección (mínimo 5 caracteres).');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña para confirmar.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await apiSolicitudes.editarAdmin(id, {
        motivo: motivo.trim(),
        password,
        campos: {
          nombre_solicitante: campos.nombre_solicitante,
          tipo_persona: campos.tipo_persona,
          curp: campos.curp,
          telefono: campos.telefono,
          ubi_municipio_id: Number(campos.ubi_municipio_id),
          ubi_localidad: campos.ubi_localidad
        },
        conceptos: conceptos.map((c) => ({
          id: c.id,
          cantidad: Number(c.cantidad),
          monto_total: Number(c.monto_total)
        }))
      });
      onGuardado();
    } catch (fallo) {
      setError(fallo instanceof ErrorPeticion ? fallo.message : 'No se pudo guardar el cambio.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" data-testid="modal-edicion-admin">
      <div className="modal tarjeta">
        <h3>Editar solicitud</h3>

        {cargando && <p className="vacio">Cargando…</p>}

        {!cargando && campos && (
          <>
            <p className="dato">
              Folio: <strong className="mono" data-testid="folio-edicion-admin">{folio}</strong>{' '}
              <span className="pill">🔒 no editable</span>
            </p>

            <div className="rejilla">
              <label className="campo">
                <span>Nombre del solicitante</span>
                <input
                  data-testid="campo-nombre-edicion-admin"
                  value={campos.nombre_solicitante}
                  onChange={(e) => cambiarCampo('nombre_solicitante', e.target.value)}
                />
              </label>
              <label className="campo">
                <span>Tipo de persona</span>
                <select
                  data-testid="campo-tipo-persona-edicion-admin"
                  value={campos.tipo_persona}
                  onChange={(e) => cambiarCampo('tipo_persona', e.target.value as TipoPersona)}
                >
                  {TIPOS_PERSONA.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETAS_TIPO_PERSONA[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>CURP</span>
                <input
                  data-testid="campo-curp-edicion-admin"
                  className="mono"
                  value={campos.curp}
                  onChange={(e) => cambiarCampo('curp', e.target.value.toUpperCase())}
                />
              </label>
              <label className="campo">
                <span>Teléfono</span>
                <input
                  data-testid="campo-telefono-edicion-admin"
                  value={campos.telefono}
                  onChange={(e) => cambiarCampo('telefono', e.target.value)}
                />
              </label>
              <label className="campo">
                <span>Municipio del apoyo</span>
                <select
                  data-testid="campo-municipio-edicion-admin"
                  value={campos.ubi_municipio_id}
                  onChange={(e) => cambiarCampo('ubi_municipio_id', Number(e.target.value))}
                >
                  {municipios.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>Localidad / Ejido</span>
                <input
                  data-testid="campo-localidad-edicion-admin"
                  value={campos.ubi_localidad}
                  onChange={(e) => cambiarCampo('ubi_localidad', e.target.value)}
                />
              </label>
            </div>

            {conceptos.length > 0 && (
              <>
                <h4>Conceptos solicitados</h4>
                <table data-testid="tabla-conceptos-edicion-admin">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Cantidad</th>
                      <th>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conceptos.map((c) => (
                      <tr key={c.id} data-testid={`fila-concepto-edicion-admin-${c.id}`}>
                        <td>{c.tipo_apoyo ?? `Concepto ${c.tipo_apoyo_id}`}</td>
                        <td>
                          <input
                            type="number"
                            data-testid={`campo-cantidad-edicion-admin-${c.id}`}
                            className="mono"
                            style={{ width: 100 }}
                            value={c.cantidad}
                            onChange={(e) => cambiarConcepto(c.id, 'cantidad', Number(e.target.value))}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            data-testid={`campo-monto-edicion-admin-${c.id}`}
                            className="mono"
                            style={{ width: 120 }}
                            value={c.monto_total}
                            onChange={(e) =>
                              cambiarConcepto(c.id, 'monto_total', Number(e.target.value))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="dato">
                  No se agregan ni quitan conceptos desde aquí — solo se corrige lo ya capturado.
                </p>
              </>
            )}

            <label className="campo">
              <span>Motivo de la corrección (obligatorio)</span>
              <textarea
                data-testid="campo-motivo-edicion-admin"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej. Error de captura manual del nombre, CURP no fue escaneada…"
              />
            </label>

            <div className="mensaje aviso">
              <label className="campo">
                <span>Confirma tu contraseña para guardar</span>
                <input
                  type="password"
                  data-testid="campo-password-edicion-admin"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          </>
        )}

        {error && (
          <div className="mensaje error" role="alert" data-testid="error-edicion-admin">
            {error}
          </div>
        )}

        <div className="acciones-modal">
          <button type="button" className="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          {!cargando && campos && (
            <button
              type="button"
              className="boton"
              data-testid="btn-guardar-edicion-admin"
              aria-busy={guardando ? 'true' : undefined}
              disabled={guardando}
              onClick={() => void guardar()}
            >
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
