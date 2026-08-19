// Pantalla de reglas de documentacion requerida (Build 10).
// [data-testid="pantalla-catalogo-documentos"]
// Tabla [data-testid="tabla-reglas-documentos"], filas [data-testid="fila-regla-documento"]
import { useCallback, useEffect, useState } from 'react';
import { useSesion } from '../App';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import FormReglaDocumento from '../componentes/FormReglaDocumento';
import { apiSolicitudes } from '../api/solicitudes';

interface ReglaDocumento {
  id: number;
  requisito: string;
  componentes: string[] | null;
  tipos_persona: string[] | null;
  proyecto_id: number | null;
  apoyo_id: number | null;
  apoyo_etiquetas: string[] | null;
  apoyo_excluir_id: number | null;
  apoyo_excluir_etiquetas: string[] | null;
  orden: number;
  activo: boolean;
  apoyo_clave: string | null;
  proyecto_clave: string | null;
}

export default function CatalogoDocumentos() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [reglas, setReglas] = useState<ReglaDocumento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroComponente, setFiltroComponente] = useState('');
  const [filtroTipoPersona, setFiltroTipoPersona] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);

  const [formAbierto, setFormAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<ReglaDocumento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [simulacion, setSimulacion] = useState<{
    componente_id?: number;
    tipo_persona?: string;
    proyecto_id?: number | null;
    tipos_apoyo_ids?: number[];
  } | null>(null);
  const [resultadoSimulacion, setResultadoSimulacion] = useState<string[] | null>(null);

  const cargarReglas = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (incluirInactivos) params.set('incluir_inactivos', 'true');
      const pagina = await (api as any).catalogosEntidad('documentos_requeridos', params);
      setReglas(pagina.datos || []);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion && fallo.estado === 0
          ? 'Esta sección requiere conexión a internet.'
          : (fallo as Error).message
      );
    } finally {
      setCargando(false);
    }
  }, [incluirInactivos]);

  useEffect(() => {
    void cargarReglas();
  }, [cargarReglas]);

  const abrirAlta = () => {
    setEnEdicion(null);
    setFormAbierto(true);
    setErrorForm(null);
    setExito(null);
  };

  const abrirEdicion = (regla: ReglaDocumento) => {
    setEnEdicion(regla);
    setFormAbierto(true);
    setErrorForm(null);
    setExito(null);
  };

  const guardar = async (datos: Record<string, unknown>) => {
    setGuardando(true);
    setErrorForm(null);
    setExito(null);
    try {
      if (enEdicion) {
        await (api as any).editarCatalogo('documentos_requeridos', enEdicion.id, datos);
        setExito('Regla actualizada correctamente.');
      } else {
        await (api as any).crearCatalogo('documentos_requeridos', datos);
        setExito('Regla creada correctamente.');
      }
      setFormAbierto(false);
      await cargarReglas();
    } catch (fallo) {
      setErrorForm((fallo as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (id: number, activo: boolean) => {
    try {
      await (api as any).cambiarEstadoCatalogo('documentos_requeridos', id, activo);
      await cargarReglas();
    } catch (fallo) {
      setError((fallo as Error).message);
    }
  };

  const ejecutarSimulacion = async () => {
    if (!simulacion || !simulacion.componente_id || !simulacion.tipo_persona) {
      setResultadoSimulacion(['Seleccione componente y tipo de persona.']);
      return;
    }
    try {
      const resultado = await apiSolicitudes.documentosRequeridos({
        componente_id: simulacion.componente_id,
        tipo_persona: simulacion.tipo_persona as any,
        proyecto_id: simulacion.proyecto_id ?? null,
        tipos_apoyo_ids: simulacion.tipos_apoyo_ids ?? []
      });
      setResultadoSimulacion(resultado.documentos.map((d: any) => d.requisito));
    } catch (fallo) {
      setResultadoSimulacion([(fallo as Error).message]);
    }
  };

  // Filtrado local
  const reglasFiltradas = reglas.filter((r) => {
    if (!incluirInactivos && !r.activo) return false;
    if (filtroComponente && r.componentes && !r.componentes.includes(filtroComponente)) return false;
    if (filtroTipoPersona && r.tipos_persona && !r.tipos_persona.includes(filtroTipoPersona)) return false;
    if (busqueda && !r.requisito.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  if (!enLinea) {
    return (
      <div className="tarjeta" data-testid="pantalla-catalogo-documentos">
        <h1>Reglas de documentación requerida</h1>
        <p className="vacio">Esta sección requiere conexión a internet.</p>
      </div>
    );
  }

  return (
    <div className="tarjeta" data-testid="pantalla-catalogo-documentos">
      <h1>Reglas de documentación requerida</h1>

      <div className="filtros">
        <select
          data-testid="filtro-componente-regla"
          value={filtroComponente}
          onChange={(e) => setFiltroComponente(e.target.value)}
          aria-label="Filtrar por componente"
        >
          <option value="">Todos los componentes</option>
          <option value="PET">PET</option>
          <option value="TR">TR</option>
          <option value="CAA">CAA</option>
          <option value="DIN">DIN</option>
        </select>

        <select
          data-testid="filtro-tipo-persona-regla"
          value={filtroTipoPersona}
          onChange={(e) => setFiltroTipoPersona(e.target.value)}
          aria-label="Filtrar por tipo de persona"
        >
          <option value="">Todos los tipos</option>
          <option value="fisica">Persona física</option>
          <option value="moral">Persona moral</option>
          <option value="grupo">Grupo de productores</option>
        </select>

        <input
          data-testid="input-buscar-regla"
          type="search"
          placeholder="Buscar requisito"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar reglas"
        />

        <label className="toggle-campo">
          <input
            type="checkbox"
            data-testid="toggle-incluir-inactivos"
            checked={incluirInactivos}
            onChange={(e) => setIncluirInactivos(e.target.checked)}
          />
          Mostrar desactivados
        </label>

        <button type="button" data-testid="btn-nueva-regla" onClick={abrirAlta}>
          Nueva regla
        </button>
      </div>

      {error && (
        <div className="mensaje error" role="alert">
          {error}
        </div>
      )}

      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : reglasFiltradas.length === 0 ? (
        <p className="vacio">Sin resultados</p>
      ) : (
        <div className="tabla-contenedor">
          <table data-testid="tabla-reglas-documentos">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Requisito</th>
                <th>Componentes</th>
                <th>Tipos de persona</th>
                <th>Proyecto</th>
                <th>Concepto</th>
                <th>Excepción</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reglasFiltradas.map((regla) => (
                <tr key={regla.id} data-testid="fila-regla-documento">
                  <td data-etiqueta="Orden">{regla.orden}</td>
                  <td data-etiqueta="Requisito">{regla.requisito}</td>
                  <td data-etiqueta="Componentes">
                    {regla.componentes ? regla.componentes.join(', ') : 'Todos'}
                  </td>
                  <td data-etiqueta="Tipos de persona">
                    {regla.tipos_persona ? regla.tipos_persona.join(', ') : 'Todos'}
                  </td>
                  <td data-etiqueta="Proyecto">{regla.proyecto_clave ?? 'Cualquiera'}</td>
                  <td data-etiqueta="Concepto">{regla.apoyo_clave ?? 'Cualquiera'}</td>
                  <td data-etiqueta="Excepción">
                    {regla.apoyo_excluir_id ? `Excepto ${regla.apoyo_excluir_id}` : '—'}
                  </td>
                  <td data-etiqueta="Estado">
                    {regla.activo ? (
                      <span className="badge capturado">Activo</span>
                    ) : (
                      <span className="badge pendiente" data-testid="chip-inactivo">
                        Desactivado
                      </span>
                    )}
                  </td>
                  <td data-etiqueta="Acciones" className="acciones">
                    <button
                      type="button"
                      className="secundario"
                      data-testid="btn-editar-regla"
                      onClick={() => abrirEdicion(regla)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="secundario"
                      data-testid="btn-toggle-estado-regla"
                      onClick={() => cambiarEstado(regla.id, !regla.activo)}
                    >
                      {regla.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formAbierto && (
        <FormReglaDocumento
          regla={enEdicion}
          guardando={guardando}
          errorApi={errorForm}
          exito={exito}
          alGuardar={guardar}
          alCancelar={() => setFormAbierto(false)}
        />
      )}

      <div className="tarjeta" style={{ marginTop: 'var(--espacio-4)' }}>
        <h2>Simulador de checklist</h2>
        <p className="mensaje aviso">
          Prueba cómo funciona el motor de coincidencia con los filtros seleccionados.
        </p>
        <div className="filtros">
          <select
            value={simulacion?.componente_id ?? ''}
            onChange={(e) => setSimulacion({ ...simulacion, componente_id: Number(e.target.value) || undefined })}
          >
            <option value="">Seleccionar componente</option>
            <option value="1">PET</option>
            <option value="2">TR</option>
            <option value="3">CAA</option>
            <option value="4">DIN</option>
          </select>
          <select
            value={simulacion?.tipo_persona ?? ''}
            onChange={(e) => setSimulacion({ ...simulacion, tipo_persona: e.target.value || undefined })}
          >
            <option value="">Seleccionar tipo de persona</option>
            <option value="fisica">Persona física</option>
            <option value="moral">Persona moral</option>
            <option value="grupo">Grupo de productores</option>
          </select>
          <button type="button" onClick={ejecutarSimulacion}>
            Simular
          </button>
        </div>
        {resultadoSimulacion && (
          <div data-testid="preview-checklist" className="mensaje">
            <strong>Documentos requeridos:</strong>
            <ul>
              {resultadoSimulacion.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
