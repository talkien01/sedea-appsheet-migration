// Formulario de alta/edicion de catalogos (Build 10).
// [data-testid="form-catalogo"]
import type { NombreEntidad } from '@sedea/shared';

/**
 * Etiqueta legible en singular por entidad, con el articulo/adjetivo del genero
 * correcto. El nombre de la entidad es el de la tabla (plural tecnico), asi que
 * no sirve para armar el titulo del formulario.
 */
const ETIQUETAS_SINGULARES: Record<NombreEntidad, { nombre: string; nuevo: string }> = {
  programas: { nombre: 'programa', nuevo: 'Nuevo' },
  subprogramas: { nombre: 'subprograma', nuevo: 'Nuevo' },
  componentes: { nombre: 'componente', nuevo: 'Nuevo' },
  modalidades: { nombre: 'modalidad', nuevo: 'Nueva' },
  proyectos: { nombre: 'proyecto', nuevo: 'Nuevo' },
  tipos_apoyo: { nombre: 'concepto de apoyo', nuevo: 'Nuevo' },
  documentos_requeridos: { nombre: 'regla de documentos', nuevo: 'Nueva' }
};

interface Props {
  entidad: NombreEntidad;
  modo: 'alta' | 'edicion';
  registro: any | null;
  /** Etiqueta del registro origen cuando el alta viene de "Duplicar". */
  duplicadoDe?: string | null;
  referencias: any | null;
  guardando: boolean;
  errorApi: string | null;
  alGuardar: (datos: Record<string, unknown>) => void;
  alCancelar: () => void;
}

export default function FormCatalogo({
  entidad,
  modo,
  registro,
  duplicadoDe = null,
  referencias,
  guardando,
  errorApi,
  alGuardar,
  alCancelar
}: Props) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const datos: Record<string, unknown> = {};

    // Campos comunes
    if (entidad !== 'documentos_requeridos') {
      const clave = formData.get('clave') as string;
      const nombre = formData.get('nombre') as string;
      if (clave) datos.clave = clave.trim().toUpperCase();
      if (nombre) datos.nombre = nombre.trim();
    }

    // Campos especificos por entidad
    if (entidad === 'subprogramas') {
      datos.programa_id = formData.get('programa_id') ? Number(formData.get('programa_id')) : null;
    }

    if (entidad === 'modalidades') {
      datos.componente_id = formData.get('componente_id') ? Number(formData.get('componente_id')) : null;
    }

    if (entidad === 'proyectos') {
      const componenteId = formData.get('componente_id') ? Number(formData.get('componente_id')) : null;
      const modalidadId = formData.get('modalidad_id') ? Number(formData.get('modalidad_id')) : null;
      datos.componente_id = componenteId;
      datos.modalidad_id = modalidadId;
      if (modo === 'alta') {
        datos.prefijo_folio = (formData.get('prefijo_folio') as string)?.trim().toUpperCase();
      }
      // En edicion los inputs de clave/prefijo van `disabled`, asi que no
      // llegan por FormData y hay que recuperarlos del registro. En alta (y en
      // el alta que nace de "Duplicar") mandan los valores capturados en el
      // formulario, que ya vienen resueltos arriba.
      if (modo === 'edicion') {
        if (registro?.nombre) datos.nombre = registro.nombre;
        if (registro?.clave) datos.clave = registro.clave;
      }
    }

    if (entidad === 'tipos_apoyo') {
      datos.categoria = formData.get('categoria') || null;
      datos.unidad_medida = formData.get('unidad_medida') || null;
    }

    alGuardar(datos);
  };

  const esEdicion = modo === 'edicion';
  const etiqueta = ETIQUETAS_SINGULARES[entidad];
  // "Duplicar" reusa el modo alta, pero conviene nombrarlo por lo que es.
  const titulo = esEdicion
    ? `Editar ${etiqueta.nombre}`
    : duplicadoDe
      ? `Duplicar ${etiqueta.nombre}`
      : `${etiqueta.nuevo} ${etiqueta.nombre}`;

  return (
    <div className="tarjeta" data-testid="form-catalogo">
      <h2>{titulo}</h2>

      {duplicadoDe && (
        <div className="mensaje aviso" data-testid="aviso-duplicado">
          Duplicando <strong>{duplicadoDe}</strong>. Se copiaron sus datos; captura una clave
          {entidad === 'proyectos' ? ' y un prefijo de folio nuevos' : ' nueva'} para guardar un
          registro independiente. El original no se modifica.
        </div>
      )}

      {errorApi && (
        <div className="mensaje error" role="alert" data-testid="error-catalogo">
          {errorApi}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {entidad !== 'documentos_requeridos' && (
          <>
            <div className="campo">
              <label htmlFor="input-clave">Clave</label>
              <input
                type="text"
                id="input-clave"
                name="clave"
                data-testid="input-clave"
                defaultValue={registro?.clave ?? ''}
                readOnly={esEdicion}
                disabled={esEdicion}
                aria-readonly={esEdicion}
                required
                maxLength={40}
                pattern="[A-Z0-9][A-Z0-9-]*"
              />
              {esEdicion && (
                <span className="leyenda" data-testid="leyenda-clave-inmutable">
                  La clave no se puede modificar.
                </span>
              )}
            </div>

            <div className="campo">
              <label htmlFor="input-nombre">Nombre</label>
              <input
                type="text"
                id="input-nombre"
                name="nombre"
                data-testid="input-nombre"
                defaultValue={registro?.nombre ?? ''}
                required
                maxLength={300}
              />
            </div>
          </>
        )}

        {entidad === 'proyectos' && (
          <>
            <div className="campo">
              <label htmlFor="input-prefijo-folio">Prefijo de folio (2-5 letras)</label>
              <input
                type="text"
                id="input-prefijo-folio"
                name="prefijo_folio"
                data-testid="input-prefijo-folio"
                defaultValue={registro?.prefijo_folio ?? ''}
                readOnly={esEdicion}
                disabled={esEdicion}
                aria-readonly={esEdicion}
                required
                maxLength={5}
                pattern="[A-Z]{2,5}"
                style={{ textTransform: 'uppercase' }}
              />
              {esEdicion && (
                <span className="leyenda" data-testid="leyenda-prefijo-inmutable">
                  El prefijo de folio no se puede modificar. Desactiva el proyecto y da de alta uno nuevo.
                </span>
              )}
            </div>

            <div className="campo">
              <label htmlFor="select-padre-componente">Componente</label>
              <select
                id="select-padre-componente"
                name="componente_id"
                data-testid="select-padre-componente"
                defaultValue={registro?.componente_id ?? ''}
              >
                <option value="">Seleccionar componente</option>
                {referencias?.componentes?.map((c: any) => (
                  <option key={c.id} value={c.id} disabled={!c.activo}>
                    {c.clave} · {c.nombre} {c.activo ? '' : '(inactivo)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo">
              <label htmlFor="select-padre-modalidad">Modalidad</label>
              <select
                id="select-padre-modalidad"
                name="modalidad_id"
                data-testid="select-padre-modalidad"
                defaultValue={registro?.modalidad_id ?? ''}
              >
                <option value="">Cualquier proyecto</option>
                {referencias?.modalidades?.map((m: any) => (
                  <option key={m.id} value={m.id} disabled={!m.activo}>
                    {m.clave} · {m.nombre} {m.activo ? '' : '(inactivo)'}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {entidad === 'subprogramas' && (
          <div className="campo">
            <label htmlFor="select-padre-programa">Programa</label>
            <select
              id="select-padre-programa"
              name="programa_id"
              data-testid="select-padre-programa"
              defaultValue={registro?.programa_id ?? ''}
              required
            >
              <option value="">Seleccionar programa</option>
              {referencias?.programas?.map((p: any) => (
                <option key={p.id} value={p.id} disabled={!p.activo}>
                  {p.clave} · {p.nombre} {p.activo ? '' : '(inactivo)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {entidad === 'modalidades' && (
          <div className="campo">
            <label htmlFor="select-padre-componente">Componente</label>
            <select
              id="select-padre-componente"
              name="componente_id"
              data-testid="select-padre-componente"
              defaultValue={registro?.componente_id ?? ''}
              required
            >
              <option value="">Seleccionar componente</option>
              {referencias?.componentes?.map((c: any) => (
                <option key={c.id} value={c.id} disabled={!c.activo}>
                  {c.clave} · {c.nombre} {c.activo ? '' : '(inactivo)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {entidad === 'tipos_apoyo' && (
          <>
            <div className="campo">
              <label htmlFor="input-categoria">Categoría</label>
              <input
                type="text"
                id="input-categoria"
                name="categoria"
                data-testid="input-categoria"
                defaultValue={registro?.categoria ?? ''}
                maxLength={200}
              />
            </div>

            <div className="campo">
              <label htmlFor="input-unidad-medida">Unidad de medida</label>
              <input
                type="text"
                id="input-unidad-medida"
                name="unidad_medida"
                data-testid="input-unidad-medida"
                defaultValue={registro?.unidad_medida ?? ''}
                maxLength={100}
              />
            </div>
          </>
        )}

        <div className="campo acciones">
          <button type="button" className="secundario" data-testid="btn-cancelar-catalogo" onClick={alCancelar}>
            Cancelar
          </button>
          <button type="submit" data-testid="btn-guardar-catalogo" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
