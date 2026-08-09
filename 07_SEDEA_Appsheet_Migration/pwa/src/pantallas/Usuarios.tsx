// Administracion de usuarios reales (roles admin y editor_datos).
// Pantalla ONLINE-ONLY: nada se guarda en IndexedDB ni en la cola de sync.
// Las bajas se hacen desactivando la cuenta; no existe ningun control de
// borrado, para conservar la trazabilidad de capturas y auditoria (D16).
import { useCallback, useEffect, useState } from 'react';
import {
  ETIQUETAS_ROL,
  ROLES_USUARIO,
  type ModoPassword,
  type UsuarioAdmin
} from '@sedea/shared';
import { useSesion } from '../App';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import FormUsuario from '../componentes/FormUsuario';
import ModalPasswordTemporal from '../componentes/ModalPasswordTemporal';
import ModalResetPassword from '../componentes/ModalResetPassword';

interface RegionalOpcion {
  id: number;
  nombre: string;
}

export default function Usuarios() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [filas, setFilas] = useState<UsuarioAdmin[]>([]);
  const [regionales, setRegionales] = useState<RegionalOpcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroRol, setFiltroRol] = useState('');
  const [filtroRegional, setFiltroRegional] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');

  const [formAbierto, setFormAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<UsuarioAdmin | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  // La contrasena vive solo en este estado y se borra al cerrar el modal.
  const [passwordTemporal, setPasswordTemporal] = useState<{
    valor: string;
    usuario: string;
    modo: ModoPassword;
  } | null>(null);

  // Reseteo: fila elegida, estado de envio y error de la API (11.6.3).
  const [reseteando, setReseteando] = useState<UsuarioAdmin | null>(null);
  const [enviandoReset, setEnviandoReset] = useState(false);
  const [errorReset, setErrorReset] = useState<string | null>(null);

  // Debounce de 300 ms para no consultar en cada tecla.
  useEffect(() => {
    const temporizador = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 300);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ page: '1', page_size: '100' });
      if (filtroRol) parametros.set('rol', filtroRol);
      if (filtroRegional) parametros.set('regional_id', filtroRegional);
      if (filtroActivo) parametros.set('activo', filtroActivo);
      if (busquedaAplicada.length >= 2) parametros.set('q', busquedaAplicada);
      const pagina = await api.usuarios(parametros);
      setFilas(pagina.data);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion && fallo.estado === 0
          ? 'Esta sección requiere conexión a internet.'
          : (fallo as Error).message
      );
    } finally {
      setCargando(false);
    }
  }, [filtroRol, filtroRegional, filtroActivo, busquedaAplicada]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void (async () => {
      try {
        const catalogos = await api.catalogos();
        setRegionales(catalogos.regionales.map((r) => ({ id: r.id, nombre: r.nombre })));
      } catch {
        setRegionales([]);
      }
    })();
  }, []);

  const abrirAlta = () => {
    setEnEdicion(null);
    setErrorForm(null);
    setFormAbierto(true);
  };

  const abrirEdicion = (fila: UsuarioAdmin) => {
    setEnEdicion(fila);
    setErrorForm(null);
    setFormAbierto(true);
  };

  const guardar = async (datos: {
    usuario: string;
    nombre_completo: string;
    rol: string;
    regional_id: number | null;
    modo_password?: ModoPassword;
    password_manual?: string;
  }) => {
    setGuardando(true);
    setErrorForm(null);
    try {
      if (enEdicion) {
        await api.editarUsuario(enEdicion.id, {
          nombre_completo: datos.nombre_completo,
          rol: datos.rol,
          regional_id: datos.regional_id
        });
        setFormAbierto(false);
      } else {
        const respuesta = await api.crearUsuario(datos);
        setFormAbierto(false);
        setPasswordTemporal({
          valor: respuesta.password_temporal,
          usuario: respuesta.usuario.usuario,
          modo: respuesta.modo_password ?? 'automatica'
        });
      }
      await cargar();
    } catch (fallo) {
      setErrorForm((fallo as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const abrirReset = (fila: UsuarioAdmin) => {
    setErrorReset(null);
    setReseteando(fila);
  };

  const confirmarReset = async (opciones: {
    modo_password: ModoPassword;
    password_manual?: string;
  }) => {
    if (!reseteando) return;
    setEnviandoReset(true);
    setErrorReset(null);
    try {
      const respuesta = await api.resetearPassword(reseteando.id, opciones);
      setReseteando(null);
      setPasswordTemporal({
        valor: respuesta.password_temporal,
        usuario: respuesta.usuario,
        modo: respuesta.modo_password ?? 'automatica'
      });
      await cargar();
    } catch (fallo) {
      setErrorReset((fallo as Error).message);
    } finally {
      setEnviandoReset(false);
    }
  };

  const alternarActivo = async (fila: UsuarioAdmin) => {
    const confirmado = window.confirm(
      fila.activo
        ? `¿Desactivar la cuenta de ${fila.nombre_completo}? No podrá iniciar sesión, pero su historial se conserva.`
        : `¿Reactivar la cuenta de ${fila.nombre_completo}?`
    );
    if (!confirmado) return;
    setError(null);
    try {
      await api.cambiarActivoUsuario(fila.id, !fila.activo);
      await cargar();
    } catch (fallo) {
      setError((fallo as Error).message);
    }
  };

  if (!enLinea) {
    return (
      <div className="tarjeta">
        <h1>Administración de usuarios</h1>
        <p className="vacio">Esta sección requiere conexión a internet.</p>
      </div>
    );
  }

  return (
    <div className="tarjeta">
      <h1>Administración de usuarios</h1>

      <div className="mensaje aviso" role="status">
        Las bajas se hacen desactivando la cuenta: el historial de capturas y auditoría se
        conserva. Ningún usuario se elimina.
      </div>

      <div className="filtros">
        <select
          data-testid="select-filtro-rol"
          value={filtroRol}
          onChange={(e) => setFiltroRol(e.target.value)}
          aria-label="Filtrar por rol"
        >
          <option value="">Todos los roles</option>
          {ROLES_USUARIO.map((r) => (
            <option key={r} value={r}>
              {ETIQUETAS_ROL[r]}
            </option>
          ))}
        </select>

        <select
          data-testid="select-filtro-regional"
          value={filtroRegional}
          onChange={(e) => setFiltroRegional(e.target.value)}
          aria-label="Filtrar por Dirección Regional"
        >
          <option value="">Todas las Regionales</option>
          {regionales.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>

        <select
          data-testid="select-filtro-activo"
          value={filtroActivo}
          onChange={(e) => setFiltroActivo(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </select>

        <input
          data-testid="input-busqueda-usuarios"
          type="search"
          placeholder="Buscar por usuario o nombre"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar usuarios"
        />

        <button type="button" data-testid="btn-nuevo-usuario" onClick={abrirAlta}>
          Nuevo usuario
        </button>
      </div>

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-usuarios">
          {error}
        </div>
      )}

      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="vacio">Sin resultados</p>
      ) : (
        <div className="tabla-contenedor">
          <table data-testid="tabla-usuarios">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre completo</th>
                <th>Rol</th>
                <th>Regional</th>
                <th>Estado</th>
                <th>Contraseña</th>
                <th>Capturas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.id} data-testid="fila-usuario">
                  <td>{fila.usuario}</td>
                  <td>{fila.nombre_completo}</td>
                  <td>{ETIQUETAS_ROL[fila.rol] ?? fila.rol}</td>
                  <td>{fila.regional ?? '—'}</td>
                  <td>
                    <span
                      className={`badge ${fila.activo ? 'capturado' : 'pendiente'}`}
                      data-testid="badge-estado-usuario"
                    >
                      {fila.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    {fila.debe_cambiar_password && (
                      <span className="badge alerta-media" data-testid="badge-password-pendiente">
                        Cambio pendiente
                      </span>
                    )}
                  </td>
                  <td>{fila.capturas}</td>
                  <td className="acciones">
                    <button
                      type="button"
                      className="secundario"
                      data-testid="btn-editar-usuario"
                      onClick={() => abrirEdicion(fila)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="secundario"
                      data-testid="btn-reset-password"
                      onClick={() => abrirReset(fila)}
                    >
                      Resetear contraseña
                    </button>
                    <button
                      type="button"
                      className="secundario"
                      data-testid="btn-toggle-activo"
                      onClick={() => void alternarActivo(fila)}
                    >
                      {fila.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formAbierto && (
        <FormUsuario
          usuario={enEdicion}
          regionales={regionales}
          rolActor={perfil?.rol ?? 'editor_datos'}
          guardando={guardando}
          errorApi={errorForm}
          alGuardar={(datos) => void guardar(datos)}
          alCancelar={() => setFormAbierto(false)}
        />
      )}

      {reseteando && (
        <ModalResetPassword
          usuario={reseteando}
          enviando={enviandoReset}
          errorApi={errorReset}
          alConfirmar={(opciones) => void confirmarReset(opciones)}
          alCancelar={() => setReseteando(null)}
        />
      )}

      {passwordTemporal && (
        <ModalPasswordTemporal
          password={passwordTemporal.valor}
          usuario={passwordTemporal.usuario}
          modo={passwordTemporal.modo}
          // Al cerrar se borra del estado: no queda en el DOM ni se puede reabrir.
          alCerrar={() => setPasswordTemporal(null)}
        />
      )}
    </div>
  );
}
