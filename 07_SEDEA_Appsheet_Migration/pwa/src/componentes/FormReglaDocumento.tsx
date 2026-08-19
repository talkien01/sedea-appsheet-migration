// Formulario de reglas de documentacion (Build 10).
// [data-testid="form-regla-documento"]
interface Props {
  regla: any | null;
  guardando: boolean;
  errorApi: string | null;
  exito: string | null;
  alGuardar: (datos: Record<string, unknown>) => void;
  alCancelar: () => void;
}

export default function FormReglaDocumento({
  regla,
  guardando,
  errorApi,
  exito,
  alGuardar,
  alCancelar
}: Props) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const datos: Record<string, unknown> = {};

    datos.requisito = (formData.get('requisito') as string)?.trim();
    datos.orden = Number(formData.get('orden')) || 0;

    // Componentes seleccionados (null = todos)
    const componentes = formData.getAll('componentes') as string[];
    datos.componentes = componentes.length > 0 ? componentes : null;

    // Tipos de persona seleccionados (null = todos)
    const tiposPersona = formData.getAll('tipos_persona') as string[];
    datos.tipos_persona = tiposPersona.length > 0 ? tiposPersona : null;

    // Proyecto
    const proyectoId = formData.get('proyecto_id') as string;
    datos.proyecto_id = proyectoId ? Number(proyectoId) : null;

    // Concepto de apoyo
    const apoyoId = formData.get('apoyo_id') as string;
    datos.apoyo_id = apoyoId ? Number(apoyoId) : null;

    // Etiquetas
    const apoyoEtiquetas = (formData.get('apoyo_etiquetas') as string)?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    datos.apoyo_etiquetas = apoyoEtiquetas && apoyoEtiquetas.length > 0 ? apoyoEtiquetas : null;

    // Excepcion
    const apoyoExcluirId = formData.get('apoyo_excluir_id') as string;
    datos.apoyo_excluir_id = apoyoExcluirId ? Number(apoyoExcluirId) : null;

    const apoyoExcluirEtiquetas = (formData.get('apoyo_excluir_etiquetas') as string)?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    datos.apoyo_excluir_etiquetas = apoyoExcluirEtiquetas && apoyoExcluirEtiquetas.length > 0 ? apoyoExcluirEtiquetas : null;

    alGuardar(datos);
  };

  const esEdicion = !!regla;

  return (
    <div className="tarjeta modal-contenido" data-testid="form-regla-documento">
      <h2>{esEdicion ? 'Editar regla' : 'Nueva regla de documentación'}</h2>

      {errorApi && (
        <div className="mensaje error" role="alert" data-testid="error-regla">
          {errorApi}
        </div>
      )}

      {exito && (
        <div className="mensaje exito" role="status">
          {exito}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="campo">
          <label htmlFor="input-requisito">Requisito (documento)</label>
          <input
            type="text"
            id="input-requisito"
            name="requisito"
            data-testid="input-requisito"
            defaultValue={regla?.requisito ?? ''}
            required
            maxLength={300}
            placeholder="Ej. Acta de asamblea"
          />
        </div>

        <div className="campo">
          <label>Componentes</label>
          <div className="check-group">
            <label>
              <input type="checkbox" name="componentes" value="PET" defaultChecked={regla?.componentes?.includes('PET')} />
              PET (Proyectos Estratégicos Territoriales)
            </label>
            <label>
              <input type="checkbox" name="componentes" value="TR" defaultChecked={regla?.componentes?.includes('TR')} />
              TR (Tecnificación del Riego)
            </label>
            <label>
              <input type="checkbox" name="componentes" value="CAA" defaultChecked={regla?.componentes?.includes('CAA')} />
              CAA (Campos Agrícolas Automatizados)
            </label>
            <label>
              <input type="checkbox" name="componentes" value="DIN" defaultChecked={regla?.componentes?.includes('DIN')} />
              DIN (Distritos de Riego)
            </label>
          </div>
          <span className="leyenda" data-testid="leyenda-componentes-todos">
            Ninguno marcado = aplica a todos los componentes
          </span>
        </div>

        <div className="campo">
          <label>Tipos de persona</label>
          <div className="check-group">
            <label>
              <input type="checkbox" name="tipos_persona" value="fisica" defaultChecked={regla?.tipos_persona?.includes('fisica')} />
              Persona física
            </label>
            <label>
              <input type="checkbox" name="tipos_persona" value="moral" defaultChecked={regla?.tipos_persona?.includes('moral')} />
              Persona moral
            </label>
            <label>
              <input type="checkbox" name="tipos_persona" value="grupo" defaultChecked={regla?.tipos_persona?.includes('grupo')} />
              Grupo de productores
            </label>
          </div>
          <span className="leyenda">
            Ninguno marcado = aplica a todos los tipos
          </span>
        </div>

        <div className="campo">
          <label htmlFor="select-proyecto-regla">Proyecto (opcional)</label>
          <select
            id="select-proyecto-regla"
            name="proyecto_id"
            data-testid="select-proyecto-regla"
            defaultValue={regla?.proyecto_id ?? ''}
          >
            <option value="">Cualquier proyecto</option>
            <option value="1">PEO</option>
            <option value="2">DEM</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-apoyo">Concepto de apoyo (opcional)</label>
          <select
            id="select-apoyo"
            name="apoyo_id"
            data-testid="select-apoyo"
            defaultValue={regla?.apoyo_id ?? ''}
          >
            <option value="">Cualquier concepto</option>
            <option value="153">CASAS-EJIDALES</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-etiquetas-apoyo">Etiquetas del apoyo</label>
          <input
            type="text"
            id="input-etiquetas-apoyo"
            name="apoyo_etiquetas"
            data-testid="input-etiquetas-apoyo"
            defaultValue={regla?.apoyo_etiquetas?.join(', ') ?? ''}
            placeholder="Separadas por coma"
          />
        </div>

        <div className="campo">
          <label htmlFor="select-apoyo-excluir">Excepción (no pedir si es este apoyo)</label>
          <select
            id="select-apoyo-excluir"
            name="apoyo_excluir_id"
            data-testid="select-apoyo-excluir"
            defaultValue={regla?.apoyo_excluir_id ?? ''}
          >
            <option value="">Sin excepción</option>
            <option value="153">CASAS-EJIDALES</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-etiquetas-excluir">Etiquetas de excepción</label>
          <input
            type="text"
            id="input-etiquetas-excluir"
            name="apoyo_excluir_etiquetas"
            data-testid="input-etiquetas-excluir"
            defaultValue={regla?.apoyo_excluir_etiquetas?.join(', ') ?? ''}
            placeholder="Separadas por coma"
          />
        </div>

        <div className="campo">
          <label htmlFor="input-orden">Orden</label>
          <input
            type="number"
            id="input-orden"
            name="orden"
            data-testid="input-orden"
            defaultValue={regla?.orden ?? 0}
            min={0}
            max={9999}
          />
        </div>

        <div className="campo acciones">
          <button type="button" className="secundario" onClick={alCancelar}>
            Cancelar
          </button>
          <button type="submit" data-testid="btn-guardar-regla" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
