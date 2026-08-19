// Componente de arbol jerarquico para la pantalla de catalogos.
// [data-testid="arbol-catalogos"]
import type { NombreEntidad } from '@sedea/shared';

interface ArbolDatos {
  programas: any[];
  componentes: any[];
  proyectos_huerfanos: any[];
  conteos: Record<string, number>;
}

interface Props {
  arbol: ArbolDatos | null;
  cargando: boolean;
  incluirInactivos: boolean;
  onNuevo: (entidad: NombreEntidad) => void;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}

export default function ArbolCatalogos({
  arbol,
  cargando,
  incluirInactivos,
  onNuevo,
  onEditar,
  onCambiarEstado
}: Props) {
  if (cargando) {
    return (
      <div className="tarjeta" data-testid="arbol-catalogos">
        <p>Cargando árbol…</p>
      </div>
    );
  }

  if (!arbol) {
    return (
      <div className="tarjeta" data-testid="arbol-catalogos">
        <p className="vacio">Sin datos</p>
      </div>
    );
  }

  return (
    <div className="tarjeta arbol-contenedor" data-testid="arbol-catalogos">
      <section className="arbol-rama">
        <div className="arbol-encabezado">
          <h3>Programas</h3>
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-programas"
            onClick={() => onNuevo('programas')}
          >
            Nuevo programa
          </button>
        </div>
        {arbol.programas.map((prog) => (
          <NodoPrograma
            key={prog.id}
            programa={prog}
            incluirInactivos={incluirInactivos}
            onEditar={onEditar}
            onCambiarEstado={onCambiarEstado}
          />
        ))}
      </section>

      <section className="arbol-rama">
        <div className="arbol-encabezado">
          <h3>Componentes</h3>
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-componentes"
            onClick={() => onNuevo('componentes')}
          >
            Nuevo componente
          </button>
        </div>
        {arbol.componentes.map((comp) => (
          <NodoComponente
            key={comp.id}
            componente={comp}
            incluirInactivos={incluirInactivos}
            onEditar={onEditar}
            onCambiarEstado={onCambiarEstado}
          />
        ))}
      </section>

      <section className="arbol-rama">
        <div className="arbol-encabezado">
          <h3>Conceptos de apoyo ({arbol.conteos.tipos_apoyo})</h3>
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-tipos_apoyo"
            onClick={() => onNuevo('tipos_apoyo')}
          >
            Nuevo concepto
          </button>
        </div>
      </section>
    </div>
  );
}

function NodoPrograma({
  programa,
  incluirInactivos,
  onEditar,
  onCambiarEstado
}: {
  programa: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  const [expandido, setExpandido] = useState(true);

  if (!incluirInactivos && !programa.activo) return null;

  return (
    <div className="arbol-nodo" data-testid={`nodo-programas-${programa.id}`}>
      <div className={`arbol-fila ${!programa.activo ? 'inactivo' : ''}`}>
        <button
          type="button"
          className="arbol-toggle"
          onClick={() => setExpandido(!expandido)}
          aria-expanded={expandido}
        >
          {expandido ? '▾' : '▸'}
        </button>
        <span className="arbol-texto">
          <strong>{programa.clave}</strong> · {programa.nombre}
        </span>
        {!programa.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones">
          <button
            type="button"
            className="secundario"
            data-testid={`btn-editar-programas-${programa.id}`}
            onClick={() => onEditar('programas', programa)}
          >
            editar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid={programa.activo ? `btn-desactivar-programas-${programa.id}` : `btn-reactivar-programas-${programa.id}`}
            onClick={() => onCambiarEstado('programas', programa.id, !programa.activo)}
          >
            {programa.activo ? 'desactivar' : 'reactivar'}
          </button>
        </div>
      </div>
      {expandido && programa.subprogramas && programa.subprogramas.length > 0 && (
        <div className="arbol-hijos">
          {programa.subprogramas.map((sub: any) => (
            <NodoSubprograma
              key={sub.id}
              subprograma={sub}
              incluirInactivos={incluirInactivos}
              onEditar={onEditar}
              onCambiarEstado={onCambiarEstado}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodoSubprograma({
  subprograma,
  incluirInactivos,
  onEditar,
  onCambiarEstado
}: {
  subprograma: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  if (!incluirInactivos && !subprograma.activo) return null;

  return (
    <div className="arbol-hijo" data-testid={`nodo-subprogramas-${subprograma.id}`}>
      <div className={`arbol-fila ${!subprograma.activo ? 'inactivo' : ''}`}>
        <span className="arbol-sangria">·</span>
        <span className="arbol-texto">
          {subprograma.clave} · {subprograma.nombre}
        </span>
        {!subprograma.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones">
          <button
            type="button"
            className="secundario"
            data-testid={`btn-editar-subprogramas-${subprograma.id}`}
            onClick={() => onEditar('subprogramas', subprograma)}
          >
            editar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid={subprograma.activo ? `btn-desactivar-subprogramas-${subprograma.id}` : `btn-reactivar-subprogramas-${subprograma.id}`}
            onClick={() => onCambiarEstado('subprogramas', subprograma.id, !subprograma.activo)}
          >
            {subprograma.activo ? 'desactivar' : 'reactivar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NodoComponente({
  componente,
  incluirInactivos,
  onEditar,
  onCambiarEstado
}: {
  componente: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  const [expandido, setExpandido] = useState(true);

  if (!incluirInactivos && !componente.activo) return null;

  return (
    <div className="arbol-nodo" data-testid={`nodo-componentes-${componente.id}`}>
      <div className={`arbol-fila ${!componente.activo ? 'inactivo' : ''}`}>
        <button
          type="button"
          className="arbol-toggle"
          onClick={() => setExpandido(!expandido)}
          aria-expanded={expandido}
        >
          {expandido ? '▾' : '▸'}
        </button>
        <span className="arbol-texto">
          <strong>{componente.clave}</strong> · {componente.nombre}
        </span>
        {!componente.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones">
          <button
            type="button"
            className="secundario"
            data-testid={`btn-editar-componentes-${componente.id}`}
            onClick={() => onEditar('componentes', componente)}
          >
            editar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid={componente.activo ? `btn-desactivar-componentes-${componente.id}` : `btn-reactivar-componentes-${componente.id}`}
            onClick={() => onCambiarEstado('componentes', componente.id, !componente.activo)}
          >
            {componente.activo ? 'desactivar' : 'reactivar'}
          </button>
        </div>
      </div>
      {expandido && componente.modalidades && componente.modalidades.length > 0 && (
        <div className="arbol-hijos">
          {componente.modalidades.map((mod: any) => (
            <NodoModalidad
              key={mod.id}
              modalidad={mod}
              incluirInactivos={incluirInactivos}
              onEditar={onEditar}
              onCambiarEstado={onCambiarEstado}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodoModalidad({
  modalidad,
  incluirInactivos,
  onEditar,
  onCambiarEstado
}: {
  modalidad: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  const [expandido, setExpandido] = useState(true);

  if (!incluirInactivos && !modalidad.activo) return null;

  return (
    <div className="arbol-hijo" data-testid={`nodo-modalidades-${modalidad.id}`}>
      <div className={`arbol-fila ${!modalidad.activo ? 'inactivo' : ''}`}>
        <button
          type="button"
          className="arbol-toggle"
          onClick={() => setExpandido(!expandido)}
          aria-expanded={expandido}
        >
          {expandido ? '▾' : '▸'}
        </button>
        <span className="arbol-texto">
          {modalidad.clave} · {modalidad.nombre}
        </span>
        {!modalidad.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones">
          <button
            type="button"
            className="secundario"
            data-testid={`btn-editar-modalidades-${modalidad.id}`}
            onClick={() => onEditar('modalidades', modalidad)}
          >
            editar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid={modalidad.activo ? `btn-desactivar-modalidades-${modalidad.id}` : `btn-reactivar-modalidades-${modalidad.id}`}
            onClick={() => onCambiarEstado('modalidades', modalidad.id, !modalidad.activo)}
          >
            {modalidad.activo ? 'desactivar' : 'reactivar'}
          </button>
        </div>
      </div>
      {expandido && modalidad.proyectos && modalidad.proyectos.length > 0 && (
        <div className="arbol-nietos">
          {modalidad.proyectos.map((proy: any) => (
            <NodoProyecto
              key={proy.id}
              proyecto={proy}
              incluirInactivos={incluirInactivos}
              onEditar={onEditar}
              onCambiarEstado={onCambiarEstado}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodoProyecto({
  proyecto,
  incluirInactivos,
  onEditar,
  onCambiarEstado
}: {
  proyecto: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  if (!incluirInactivos && !proyecto.activo) return null;

  return (
    <div className="arbol-nieto" data-testid={`nodo-proyectos-${proyecto.id}`}>
      <div className={`arbol-fila ${!proyecto.activo ? 'inactivo' : ''}`}>
        <span className="arbol-sangria-doble">·</span>
        <span className="arbol-texto">
          {proyecto.clave} · {proyecto.nombre}
        </span>
        {!proyecto.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones">
          <button
            type="button"
            className="secundario"
            data-testid={`btn-editar-proyectos-${proyecto.id}`}
            onClick={() => onEditar('proyectos', proyecto)}
          >
            editar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid={proyecto.activo ? `btn-desactivar-proyectos-${proyecto.id}` : `btn-reactivar-proyectos-${proyecto.id}`}
            onClick={() => onCambiarEstado('proyectos', proyecto.id, !proyecto.activo)}
          >
            {proyecto.activo ? 'desactivar' : 'reactivar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// useState local dentro del mismo archivo
import { useState } from 'react';
