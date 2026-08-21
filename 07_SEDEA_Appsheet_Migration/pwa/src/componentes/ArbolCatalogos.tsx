// Catalogos por PESTANAS: una pestana por entidad raiz, cada una con una tabla
// a todo el ancho (Build 12). Sustituye al arbol vertical unico de Build 10.
//
// La jerarquia no se pinta con sangrias sino con una columna "Jerarquia" que
// nombra al padre (p. ej. "↳ PRG-2026" o "PET → MOD-PEPFO"), asi la tabla
// aprovecha el ancho completo de la pantalla.
//
// [data-testid="arbol-catalogos"] se conserva: es el contenedor de la vista y
// varias specs lo usan como senal de "catalogos ya cargo".
import { useMemo, useState } from 'react';
import type { NombreEntidad } from '@sedea/shared';
import { BotonIcono, BotonCrear, HuecoIcono } from './BotonIcono';

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
  onIncluirInactivos: (valor: boolean) => void;
  conceptos: ListaConceptos;
  onBuscarConceptos: (q: string) => void;
  onPaginaConceptos: (pagina: number) => void;
  onNuevo: (entidad: NombreEntidad) => void;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}

/** Una fila plana de la tabla: el registro mas su contexto jerarquico. */
interface Fila {
  entidad: NombreEntidad;
  registro: any;
  /** 0 = raiz, 1 = hijo, 2 = nieto. Solo tine efecto visual leve en la clave. */
  nivel: number;
  /** Texto de la columna "Jerarquia" (cadena vacia = raiz). */
  jerarquia: string;
  duplicable: boolean;
}

type ClavePestana = 'programas' | 'componentes' | 'tipos_apoyo';

const PESTANAS: { clave: ClavePestana; titulo: string }[] = [
  { clave: 'programas', titulo: 'Programas' },
  { clave: 'componentes', titulo: 'Componentes' },
  { clave: 'tipos_apoyo', titulo: 'Conceptos de apoyo' }
];

/** Filtro de texto del buscador local (clave o nombre). */
function coincide(registro: any, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (t.length === 0) return true;
  return (
    String(registro.clave ?? '').toLowerCase().includes(t) ||
    String(registro.nombre ?? '').toLowerCase().includes(t)
  );
}

export default function ArbolCatalogos({
  arbol,
  cargando,
  incluirInactivos,
  onIncluirInactivos,
  conceptos,
  onBuscarConceptos,
  onPaginaConceptos,
  onNuevo,
  onEditar,
  onDuplicar,
  onCambiarEstado
}: Props) {
  const [pestana, setPestana] = useState<ClavePestana>('programas');
  const [busquedaProgramas, setBusquedaProgramas] = useState('');
  const [busquedaComponentes, setBusquedaComponentes] = useState('');

  const visible = (r: any) => incluirInactivos || r.activo;

  // Rama programas -> subprogramas, aplanada.
  const filasProgramas = useMemo<Fila[]>(() => {
    if (!arbol) return [];
    const filas: Fila[] = [];
    for (const prog of arbol.programas) {
      if (!visible(prog)) continue;
      filas.push({ entidad: 'programas', registro: prog, nivel: 0, jerarquia: '', duplicable: false });
      for (const sub of prog.subprogramas ?? []) {
        if (!visible(sub)) continue;
        filas.push({
          entidad: 'subprogramas',
          registro: sub,
          nivel: 1,
          jerarquia: `↳ ${prog.clave}`,
          duplicable: false
        });
      }
    }
    return filas;
  }, [arbol, incluirInactivos]);

  // Rama componentes -> modalidades -> proyectos, aplanada.
  const filasComponentes = useMemo<Fila[]>(() => {
    if (!arbol) return [];
    const filas: Fila[] = [];
    for (const comp of arbol.componentes) {
      if (!visible(comp)) continue;
      filas.push({ entidad: 'componentes', registro: comp, nivel: 0, jerarquia: '', duplicable: false });
      for (const mod of comp.modalidades ?? []) {
        if (!visible(mod)) continue;
        filas.push({
          entidad: 'modalidades',
          registro: mod,
          nivel: 1,
          jerarquia: `↳ ${comp.clave}`,
          duplicable: false
        });
        for (const proy of mod.proyectos ?? []) {
          if (!visible(proy)) continue;
          filas.push({
            entidad: 'proyectos',
            registro: proy,
            nivel: 2,
            jerarquia: `${comp.clave} → ${mod.clave}`,
            duplicable: true
          });
        }
      }
      // Proyectos colgados del componente sin modalidad: el arbol anterior no
      // los mostraba y quedaban invisibles en la pantalla.
      for (const proy of comp.proyectos_sin_modalidad ?? []) {
        if (!visible(proy)) continue;
        filas.push({
          entidad: 'proyectos',
          registro: proy,
          nivel: 2,
          jerarquia: `${comp.clave} → (sin modalidad)`,
          duplicable: true
        });
      }
    }
    for (const proy of arbol.proyectos_huerfanos ?? []) {
      if (!visible(proy)) continue;
      filas.push({
        entidad: 'proyectos',
        registro: proy,
        nivel: 2,
        jerarquia: '(sin componente)',
        duplicable: true
      });
    }
    return filas;
  }, [arbol, incluirInactivos]);

  const filasConceptos = useMemo<Fila[]>(
    () =>
      conceptos.datos.map((c) => ({
        entidad: 'tipos_apoyo' as NombreEntidad,
        registro: c,
        nivel: 0,
        // Los conceptos de apoyo son planos: no cuelgan de ninguna entidad.
        jerarquia: '',
        duplicable: true
      })),
    [conceptos.datos]
  );

  const conteos = arbol?.conteos ?? {};
  const totales: Record<ClavePestana, number> = {
    programas: (conteos.programas ?? 0) + (conteos.subprogramas ?? 0),
    componentes: (conteos.componentes ?? 0) + (conteos.modalidades ?? 0) + (conteos.proyectos ?? 0),
    tipos_apoyo: conteos.tipos_apoyo ?? 0
  };

  if (cargando) {
    return (
      <div className="tarjeta" data-testid="arbol-catalogos">
        <p>Cargando catálogos…</p>
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

  const filas =
    pestana === 'programas'
      ? filasProgramas.filter((f) => coincide(f.registro, busquedaProgramas))
      : pestana === 'componentes'
        ? filasComponentes.filter((f) => coincide(f.registro, busquedaComponentes))
        : filasConceptos;

  const busqueda =
    pestana === 'programas'
      ? busquedaProgramas
      : pestana === 'componentes'
        ? busquedaComponentes
        : conceptos.busqueda;

  const alBuscar = (q: string) => {
    if (pestana === 'programas') setBusquedaProgramas(q);
    else if (pestana === 'componentes') setBusquedaComponentes(q);
    else onBuscarConceptos(q);
  };

  return (
    <div className="catalogos-vista" data-testid="arbol-catalogos">
      <div className="catalogos-pestanas" role="tablist" aria-label="Catálogos">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            id={`tab-${p.clave}`}
            aria-selected={pestana === p.clave}
            aria-controls={`panel-${p.clave}`}
            className={pestana === p.clave ? 'catalogos-pestana activa' : 'catalogos-pestana'}
            data-testid={`tab-${p.clave}`}
            onClick={() => setPestana(p.clave)}
          >
            {p.titulo}
            <span className="catalogos-pestana-conteo" data-testid={`conteo-${p.clave}`}>
              {totales[p.clave]}
            </span>
          </button>
        ))}
      </div>

      <section
        className="tarjeta catalogos-panel-pestana"
        role="tabpanel"
        id={`panel-${pestana}`}
        aria-labelledby={`tab-${pestana}`}
        data-testid={`panel-${pestana}`}
      >
        <div className="catalogos-barra">
          <div className="catalogos-barra-buscador">
            <label htmlFor="input-buscar-catalogo" className="sr-solo">
              Buscar en {PESTANAS.find((p) => p.clave === pestana)!.titulo}
            </label>
            <input
              type="search"
              id="input-buscar-catalogo"
              data-testid={`input-buscar-${pestana}`}
              placeholder="Buscar por clave o nombre"
              value={busqueda}
              onChange={(e) => alBuscar(e.target.value)}
            />
          </div>

          <div className="catalogos-barra-altas">
            {pestana === 'programas' && (
              <>
                <BotonCrear
                  etiquetaCorta="Nuevo programa"
                  etiqueta="Nuevo programa"
                  testId="btn-nuevo-programas"
                  onClick={() => onNuevo('programas')}
                />
                <BotonCrear
                  etiquetaCorta="Nuevo subprograma"
                  etiqueta="Nuevo subprograma"
                  testId="btn-nuevo-subprogramas"
                  onClick={() => onNuevo('subprogramas')}
                />
              </>
            )}
            {pestana === 'componentes' && (
              <>
                <BotonCrear
                  etiquetaCorta="Nuevo componente"
                  etiqueta="Nuevo componente"
                  testId="btn-nuevo-componentes"
                  onClick={() => onNuevo('componentes')}
                />
                <BotonCrear
                  etiquetaCorta="Nueva modalidad"
                  etiqueta="Nueva modalidad"
                  testId="btn-nuevo-modalidades"
                  onClick={() => onNuevo('modalidades')}
                />
                <BotonCrear
                  etiquetaCorta="Nuevo proyecto"
                  etiqueta="Nuevo proyecto"
                  testId="btn-nuevo-proyectos"
                  onClick={() => onNuevo('proyectos')}
                />
              </>
            )}
            {pestana === 'tipos_apoyo' && (
              <BotonCrear
                etiquetaCorta="Nuevo concepto"
                etiqueta="Nuevo concepto"
                testId="btn-nuevo-tipos_apoyo"
                onClick={() => onNuevo('tipos_apoyo')}
              />
            )}
          </div>

          <label className="toggle-campo catalogos-barra-toggle">
            <input
              type="checkbox"
              data-testid="toggle-incluir-inactivos"
              checked={incluirInactivos}
              onChange={(e) => onIncluirInactivos(e.target.checked)}
            />
            Mostrar desactivados
          </label>
        </div>

        {filas.length === 0 ? (
          <p className="vacio" data-testid="tabla-vacia">
            No hay registros que coincidan.
          </p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla-catalogos">
              <thead>
                <tr>
                  <th scope="col">Clave</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Jerarquía</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="col-acciones">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <FilaCatalogo
                    key={`${fila.entidad}-${fila.registro.id}`}
                    fila={fila}
                    onEditar={onEditar}
                    onDuplicar={onDuplicar}
                    onCambiarEstado={onCambiarEstado}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pestana === 'tipos_apoyo' && conceptos.total > conceptos.porPagina && (
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

/**
 * Fila de la tabla. Mantiene los data-testid de siempre:
 * `nodo-<entidad>-<id>` en la fila y `btn-<accion>-<entidad>-<id>` en cada boton.
 * La columna de acciones conserva la clase `.arbol-acciones` y el orden fijo
 * editar | duplicar | desactivar (SPEC crit. 533): las filas sin "Duplicar"
 * pintan un hueco para que las tres ranuras caigan alineadas.
 */
function FilaCatalogo({
  fila,
  onEditar,
  onDuplicar,
  onCambiarEstado
}: {
  fila: Fila;
  onEditar: (entidad: NombreEntidad, registro: any) => void;
  onDuplicar: (entidad: NombreEntidad, registro: any) => void;
  onCambiarEstado: (entidad: NombreEntidad, id: number, activo: boolean) => void;
}) {
  const { entidad, registro, nivel, jerarquia, duplicable } = fila;

  return (
    <tr
      className={`fila-catalogo nivel-${nivel} ${registro.activo ? '' : 'inactivo'}`}
      data-testid={`nodo-${entidad}-${registro.id}`}
    >
      <td data-etiqueta="Clave">
        <span className="celda-clave">{registro.clave}</span>
      </td>
      <td data-etiqueta="Nombre">
        <span className="celda-nombre">{registro.nombre}</span>
      </td>
      <td data-etiqueta="Jerarquía">
        <span className="celda-jerarquia">{jerarquia || '—'}</span>
      </td>
      <td data-etiqueta="Estado">
        {registro.activo ? (
          <span className="badge capturado" data-testid="chip-activo">
            Activo
          </span>
        ) : (
          <span className="badge pendiente" data-testid="chip-inactivo">
            Desactivado
          </span>
        )}
      </td>
      <td data-etiqueta="Acciones" className="col-acciones">
        <div className="arbol-acciones acciones en-fila">
          <BotonIcono
            icono="lapiz"
            etiqueta="Editar"
            testId={`btn-editar-${entidad}-${registro.id}`}
            onClick={() => onEditar(entidad, registro)}
          />
          {duplicable ? (
            <BotonIcono
              icono="copiar"
              etiqueta="Duplicar"
              testId={`btn-duplicar-${entidad}-${registro.id}`}
              onClick={() => onDuplicar(entidad, registro)}
            />
          ) : (
            <HuecoIcono />
          )}
          <BotonIcono
            icono={registro.activo ? 'ojo-tachado' : 'check'}
            etiqueta={registro.activo ? 'Desactivar' : 'Reactivar'}
            tono={registro.activo ? 'peligro' : 'neutro'}
            testId={
              registro.activo
                ? `btn-desactivar-${entidad}-${registro.id}`
                : `btn-reactivar-${entidad}-${registro.id}`
            }
            onClick={() => onCambiarEstado(entidad, registro.id, !registro.activo)}
          />
        </div>
      </td>
    </tr>
  );
}
