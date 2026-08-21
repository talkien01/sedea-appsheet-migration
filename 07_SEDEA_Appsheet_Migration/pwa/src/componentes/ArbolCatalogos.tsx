// Componente de arbol jerarquico para la pantalla de catalogos.
// [data-testid="arbol-catalogos"]
import type { NombreEntidad } from '@sedea/shared';
import { BotonIcono } from './BotonIcono';

interface ArbolDatos {
  programas: any[];
  componentes: any[];
  proyectos_huerfanos: any[];
  conteos: Record<string, number>;
}

/** Lista paginada de conceptos de apoyo (E50 sobre tipos_apoyo). */
interface ListaConceptos {
  datos: any[];
  total: number;
  pagina: number;
  porPagina: number;
  busqueda: string;
}

interface Props {
  arbol: ArbolDatos | null;
  cargando: boolean;
  incluirInactivos: boolean;
  conceptos: ListaConceptos;
  onBuscarConceptos: (q: string) => void;
  onPaginaConceptos: (pagina: number) => void;
  onNuevo: (entidad: NombreEntidad) => void;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}

export default function ArbolCatalogos({
  arbol,
  cargando,
  incluirInactivos,
  conceptos,
  onBuscarConceptos,
  onPaginaConceptos,
  onNuevo,
  onEditar,
  onDuplicar,
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
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-subprogramas"
            onClick={() => onNuevo('subprogramas')}
          >
            Nuevo subprograma
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
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-modalidades"
            onClick={() => onNuevo('modalidades')}
          >
            Nueva modalidad
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-nuevo-proyectos"
            onClick={() => onNuevo('proyectos')}
          >
            Nuevo proyecto
          </button>
        </div>
        {arbol.componentes.map((comp) => (
          <NodoComponente
            key={comp.id}
            componente={comp}
            incluirInactivos={incluirInactivos}
            onEditar={onEditar}
            onDuplicar={onDuplicar}
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

        <div className="campo">
          <label htmlFor="input-buscar-conceptos" className="sr-solo">
            Buscar concepto de apoyo
          </label>
          <input
            type="search"
            id="input-buscar-conceptos"
            data-testid="input-buscar-tipos_apoyo"
            placeholder="Buscar concepto (clave o nombre)"
            value={conceptos.busqueda}
            onChange={(e) => onBuscarConceptos(e.target.value)}
          />
        </div>

        {conceptos.datos.length === 0 && <p className="vacio">Sin conceptos que coincidan.</p>}

        {conceptos.datos.map((concepto) => (
          <NodoTipoApoyo
            key={concepto.id}
            concepto={concepto}
            onEditar={onEditar}
            onDuplicar={onDuplicar}
            onCambiarEstado={onCambiarEstado}
          />
        ))}

        {conceptos.total > conceptos.porPagina && (
          <div className="campo acciones" data-testid="paginacion-tipos_apoyo">
            <button
              type="button"
              className="secundario"
              data-testid="btn-conceptos-anterior"
              disabled={conceptos.pagina <= 1}
              onClick={() => onPaginaConceptos(conceptos.pagina - 1)}
            >
              Anterior
            </button>
            <span className="leyenda">
              Página {conceptos.pagina} de {Math.ceil(conceptos.total / conceptos.porPagina)}
            </span>
            <button
              type="button"
              className="secundario"
              data-testid="btn-conceptos-siguiente"
              disabled={conceptos.pagina * conceptos.porPagina >= conceptos.total}
              onClick={() => onPaginaConceptos(conceptos.pagina + 1)}
            >
              Siguiente
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function NodoTipoApoyo({
  concepto,
  onEditar,
  onDuplicar,
  onCambiarEstado
}: {
  concepto: any;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  return (
    <div className="arbol-hijo" data-testid={`nodo-tipos_apoyo-${concepto.id}`}>
      <div className={`arbol-fila ${!concepto.activo ? 'inactivo' : ''}`}>
        <span className="arbol-sangria">·</span>
        <span className="arbol-texto">
          {concepto.clave} · {concepto.nombre}
        </span>
        {!concepto.activo && (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-tipos_apoyo-${concepto.id}`}
            onClick={() => onEditar('tipos_apoyo', concepto)}
          />
          <BotonIcono
            icono="copiar"
            etiqueta="Duplicar"
            testId={`btn-duplicar-tipos_apoyo-${concepto.id}`}
            onClick={() => onDuplicar('tipos_apoyo', concepto)}
          />
          <BotonIcono
            icono={concepto.activo ? 'ojo-tachado' : 'check'}
            etiqueta={concepto.activo ? 'Desactivar' : 'Reactivar'}
            tono={concepto.activo ? 'peligro' : 'neutro'}
            testId={
              concepto.activo
                ? `btn-desactivar-tipos_apoyo-${concepto.id}`
                : `btn-reactivar-tipos_apoyo-${concepto.id}`
            }
            onClick={() => onCambiarEstado('tipos_apoyo', concepto.id, !concepto.activo)}
          />
        </div>
      </div>
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
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-programas-${programa.id}`}
            onClick={() => onEditar('programas', programa)}
          />
          <BotonIcono
            icono={programa.activo ? 'ojo-tachado' : 'check'}
            etiqueta={programa.activo ? 'Desactivar' : 'Reactivar'}
            tono={programa.activo ? 'peligro' : 'neutro'}
            testId={programa.activo ? `btn-desactivar-programas-${programa.id}` : `btn-reactivar-programas-${programa.id}`}
            onClick={() => onCambiarEstado('programas', programa.id, !programa.activo)}
          />
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
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-subprogramas-${subprograma.id}`}
            onClick={() => onEditar('subprogramas', subprograma)}
          />
          <BotonIcono
            icono={subprograma.activo ? 'ojo-tachado' : 'check'}
            etiqueta={subprograma.activo ? 'Desactivar' : 'Reactivar'}
            tono={subprograma.activo ? 'peligro' : 'neutro'}
            testId={subprograma.activo ? `btn-desactivar-subprogramas-${subprograma.id}` : `btn-reactivar-subprogramas-${subprograma.id}`}
            onClick={() => onCambiarEstado('subprogramas', subprograma.id, !subprograma.activo)}
          />
        </div>
      </div>
    </div>
  );
}

function NodoComponente({
  componente,
  incluirInactivos,
  onEditar,
  onDuplicar,
  onCambiarEstado
}: {
  componente: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
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
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-componentes-${componente.id}`}
            onClick={() => onEditar('componentes', componente)}
          />
          <BotonIcono
            icono={componente.activo ? 'ojo-tachado' : 'check'}
            etiqueta={componente.activo ? 'Desactivar' : 'Reactivar'}
            tono={componente.activo ? 'peligro' : 'neutro'}
            testId={componente.activo ? `btn-desactivar-componentes-${componente.id}` : `btn-reactivar-componentes-${componente.id}`}
            onClick={() => onCambiarEstado('componentes', componente.id, !componente.activo)}
          />
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
              onDuplicar={onDuplicar}
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
  onDuplicar,
  onCambiarEstado
}: {
  modalidad: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
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
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-modalidades-${modalidad.id}`}
            onClick={() => onEditar('modalidades', modalidad)}
          />
          <BotonIcono
            icono={modalidad.activo ? 'ojo-tachado' : 'check'}
            etiqueta={modalidad.activo ? 'Desactivar' : 'Reactivar'}
            tono={modalidad.activo ? 'peligro' : 'neutro'}
            testId={modalidad.activo ? `btn-desactivar-modalidades-${modalidad.id}` : `btn-reactivar-modalidades-${modalidad.id}`}
            onClick={() => onCambiarEstado('modalidades', modalidad.id, !modalidad.activo)}
          />
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
              onDuplicar={onDuplicar}
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
  onDuplicar,
  onCambiarEstado
}: {
  proyecto: any;
  incluirInactivos: boolean;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
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
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-proyectos-${proyecto.id}`}
            onClick={() => onEditar('proyectos', proyecto)}
          />
          <BotonIcono
            icono="copiar"
            etiqueta="Duplicar"
            testId={`btn-duplicar-proyectos-${proyecto.id}`}
            onClick={() => onDuplicar('proyectos', proyecto)}
          />
          <BotonIcono
            icono={proyecto.activo ? 'ojo-tachado' : 'check'}
            etiqueta={proyecto.activo ? 'Desactivar' : 'Reactivar'}
            tono={proyecto.activo ? 'peligro' : 'neutro'}
            testId={proyecto.activo ? `btn-desactivar-proyectos-${proyecto.id}` : `btn-reactivar-proyectos-${proyecto.id}`}
            onClick={() => onCambiarEstado('proyectos', proyecto.id, !proyecto.activo)}
          />
        </div>
      </div>
    </div>
  );
}

// useState local dentro del mismo archivo
import { useState } from 'react';
