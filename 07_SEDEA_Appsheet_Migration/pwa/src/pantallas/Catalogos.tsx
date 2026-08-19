// Pantalla de administracion de catalogos jerarquicos (Build 10).
// [data-testid="pantalla-catalogos"]
// Layout de 2 columnas en >=1024px (arbol 40% / panel 60%), apiladas en movil.
import { useCallback, useEffect, useState } from 'react';
import { useSesion } from '../App';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import ArbolCatalogos from '../componentes/ArbolCatalogos';
import FormCatalogo from '../componentes/FormCatalogo';
import type { NombreEntidad } from '@sedea/shared';

interface ArbolDatos {
  programas: any[];
  componentes: any[];
  proyectos_huerfanos: any[];
  conteos: Record<string, number>;
}

interface Referencias {
  programas: any[];
  componentes: any[];
  modalidades: any[];
  proyectos: any[];
  tipos_apoyo: any[];
  tipos_persona: any[];
}

export default function Catalogos() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [arbol, setArbol] = useState<ArbolDatos | null>(null);
  const [referencias, setReferencias] = useState<Referencias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guardia de rol: solo admin y editor_datos pueden acceder a catálogos (F-09)
  useEffect(() => {
    if (perfil && perfil.rol !== 'admin' && perfil.rol !== 'editor_datos') {
      window.location.href = '/sin-permiso';
    }
  }, [perfil]);

  const [entidadSeleccionada, setEntidadSeleccionada] = useState<NombreEntidad | null>(null);
  const [registroSeleccionado, setRegistroSeleccionado] = useState<any | null>(null);
  const [modoForm, setModoForm] = useState<'alta' | 'edicion' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const cargarArbol = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (incluirInactivos) params.set('incluir_inactivos', 'true');
      const data = await (api as any).catalogosArbol(params);
      setArbol(data);
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

  const cargarReferencias = useCallback(async () => {
    try {
      const data = await (api as any).catalogosReferencias();
      setReferencias(data);
    } catch {
      setReferencias(null);
    }
  }, []);

  useEffect(() => {
    void cargarArbol();
    void cargarReferencias();
  }, [cargarArbol, cargarReferencias]);

  const abrirAlta = (entidad: NombreEntidad) => {
    setEntidadSeleccionada(entidad);
    setRegistroSeleccionado(null);
    setModoForm('alta');
    setErrorForm(null);
    setExito(null);
  };

  const abrirEdicion = (entidad: NombreEntidad, registro: any) => {
    setEntidadSeleccionada(entidad);
    setRegistroSeleccionado(registro);
    setModoForm('edicion');
    setErrorForm(null);
    setExito(null);
  };

  const cerrarForm = () => {
    setModoForm(null);
    setErrorForm(null);
    setExito(null);
  };

  const guardar = async (datos: Record<string, unknown>) => {
    setGuardando(true);
    setErrorForm(null);
    setExito(null);
    try {
      if (modoForm === 'alta') {
        await (api as any).crearCatalogo(entidadSeleccionada!, datos);
        setExito('Registro creado correctamente.');
      } else {
        await (api as any).editarCatalogo(entidadSeleccionada!, registroSeleccionado.id, datos);
        setExito('Registro actualizado correctamente.');
      }
      await cargarArbol();
      await cargarReferencias();
      cerrarForm();
    } catch (fallo) {
      setErrorForm((fallo as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (entidad: NombreEntidad, id: number, activo: boolean) => {
    try {
      await (api as any).cambiarEstadoCatalogo(entidad, id, activo);
      await cargarArbol();
    } catch (fallo) {
      setError((fallo as Error).message);
    }
  };

  if (!enLinea) {
    return (
      <div className="tarjeta" data-testid="pantalla-catalogos">
        <h1>Catálogos del programa</h1>
        <p className="vacio" data-testid="aviso-sin-conexion">
          Esta sección requiere conexión a internet.
        </p>
      </div>
    );
  }

  return (
    <div className="pantalla-catalogos" data-testid="pantalla-catalogos">
      <header className="catalogos-header">
        <h1>Catálogos del programa</h1>
        <div className="catalogos-acciones">
          <label className="toggle-campo">
            <input
              type="checkbox"
              data-testid="toggle-incluir-inactivos"
              checked={incluirInactivos}
              onChange={(e) => setIncluirInactivos(e.target.checked)}
            />
            Mostrar desactivados
          </label>
          <a href="/catalogos/documentos" data-testid="link-reglas-documentos" className="boton secundario">
            Reglas de documentos
          </a>
        </div>
        <p className="mensaje aviso">
          Los componentes cuelgan del programa a nivel de solicitud; el catálogo los administra
          como dos ramas independientes.
        </p>
      </header>

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-catalogos">
          {error.includes('rol') ? 'Tu cuenta no cuenta con el rol necesario para administrar catálogos.' : error}
        </div>
      )}

      <div className="catalogos-layout">
        <aside className="catalogos-arbol">
          <ArbolCatalogos
            arbol={arbol}
            cargando={cargando}
            incluirInactivos={incluirInactivos}
            onNuevo={abrirAlta}
            onEditar={abrirEdicion}
            onCambiarEstado={cambiarEstado}
          />
        </aside>

        <main className="catalogos-panel">
          {modoForm && entidadSeleccionada && (
            <FormCatalogo
              entidad={entidadSeleccionada}
              modo={modoForm}
              registro={registroSeleccionado}
              referencias={referencias}
              guardando={guardando}
              errorApi={errorForm}
              exito={exito}
              alGuardar={guardar}
              alCancelar={cerrarForm}
            />
          )}
          {!modoForm && (
            <div className="mensaje aviso">
              Selecciona un nodo del árbol o pulsa "Nuevo" para crear un registro.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
