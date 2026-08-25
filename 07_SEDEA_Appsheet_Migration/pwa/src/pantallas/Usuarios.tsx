// Administracion de usuarios reales (roles admin y editor_datos).
// Pantalla ONLINE-ONLY: nada se guarda en IndexedDB ni en la cola de sync.
// Las bajas se hacen desactivando la cuenta; no existe ningun control de
// borrado, para conservar la trazabilidad de capturas y auditoria (D16).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ETIQUETAS_ROL,
  ROLES_USUARIO,
  type ModoPassword,
  type ResultadoFilaLoteUsuario,
  type UsuarioAdmin
} from '@sedea/shared';
import { useSesion } from '../App';
import { api, ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import FormUsuario from '../componentes/FormUsuario';
import type { ValoresAlcance } from '../componentes/BloqueAlcance';
import { apiSolicitudes } from '../api/solicitudes';
import ModalPasswordTemporal from '../componentes/ModalPasswordTemporal';
import ModalResetPassword from '../componentes/ModalResetPassword';
import { BotonIcono } from '../componentes/BotonIcono';

interface RegionalOpcion {
  id: number;
  nombre: string;
}

/** Alcance "todos" (cero filas en BD) es el valor por defecto del alta. */
const ALCANCE_TODOS: ValoresAlcance = {
  municipiosTodos: true,
  municipios: [],
  componentesTodos: true,
  componentes: []
};

export default function Usuarios() {
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [filas, setFilas] = useState<UsuarioAdmin[]>([]);
  const [regionales, setRegionales] = useState<RegionalOpcion[]>([]);
  // Catalogos del bloque de alcance del rol ventanilla (build 6).
  const [municipios, setMunicipios] = useState<{ id: number; nombre: string }[]>([]);
  const [componentes, setComponentes] = useState<{ id: number; clave: string; nombre: string }[]>([]);
  const [alcanceInicial, setAlcanceInicial] = useState<ValoresAlcance>(ALCANCE_TODOS);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroRol, setFiltroRol] = useState('');
  const [filtroRegional, setFiltroRegional] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('');
  const [enPapelera, setEnPapelera] = useState(false);
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

  // Carga masiva: archivo elegido, resultados de la ultima corrida y errores.
  // Las contrasenas de `resultadosLote` viven SOLO en este estado: al recargar
  // la pantalla se pierden, igual que el modal del alta individual.
  const refArchivoLote = useRef<HTMLInputElement>(null);
  const [archivoLote, setArchivoLote] = useState<File | null>(null);
  const [subiendoLote, setSubiendoLote] = useState(false);
  const [resultadosLote, setResultadosLote] = useState<ResultadoFilaLoteUsuario[] | null>(null);
  const [errorLote, setErrorLote] = useState<string | null>(null);

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
      // Si estamos en papelera, pedir solo eliminados
      if (enPapelera) parametros.set('eliminado', 'true');
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
  }, [filtroRol, filtroRegional, filtroActivo, enPapelera, busquedaAplicada]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void (async () => {
      try {
        const catalogos = await api.catalogos();
        setRegionales(catalogos.regionales.map((r) => ({ id: r.id, nombre: r.nombre })));
        setMunicipios(catalogos.municipios.map((m) => ({ id: m.id, nombre: m.nombre })));
      } catch {
        setRegionales([]);
      }
      try {
        // Los componentes solo los sirve el modulo de ventanilla (E40); si el
        // actor no tiene acceso, el bloque de alcance queda sin opciones.
        setComponentes((await apiSolicitudes.catalogos()).componentes);
      } catch {
        setComponentes([]);
      }
    })();
  }, []);

  const abrirAlta = () => {
    setEnEdicion(null);
    setErrorForm(null);
    setAlcanceInicial(ALCANCE_TODOS);
    setFormAbierto(true);
  };

  const abrirEdicion = (fila: UsuarioAdmin) => {
    setEnEdicion(fila);
    setErrorForm(null);
    setAlcanceInicial(ALCANCE_TODOS);
    setFormAbierto(true);
    // El alcance vigente se lee con E47 (solo admin) al abrir la edicion.
    if (fila.rol === 'ventanilla') {
      void (async () => {
        try {
          const actual = await apiSolicitudes.alcance(fila.id);
          setAlcanceInicial({
            municipiosTodos: actual.municipios === 'todos',
            municipios: actual.municipios === 'todos' ? [] : actual.municipios.map((m) => m.id),
            componentesTodos: actual.componentes === 'todos',
            componentes: actual.componentes === 'todos' ? [] : actual.componentes.map((c) => c.id)
          });
        } catch {
          setAlcanceInicial(ALCANCE_TODOS);
        }
      })();
    }
  };

  /** Persiste el alcance con E48 despues de crear o editar (12.8.4). */
  const guardarAlcance = async (usuarioId: number, alcance: ValoresAlcance) => {
    await apiSolicitudes.guardarAlcance(usuarioId, {
      municipios: alcance.municipiosTodos ? 'todos' : alcance.municipios,
      componentes: alcance.componentesTodos ? 'todos' : alcance.componentes
    });
  };

  const guardar = async (datos: {
    usuario: string;
    nombre_completo: string;
    rol: string;
    regional_id: number | null;
    modo_password?: ModoPassword;
    password_manual?: string;
    alcance?: ValoresAlcance;
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
        if (datos.rol === 'ventanilla' && datos.alcance) {
          await guardarAlcance(enEdicion.id, datos.alcance);
        }
        setFormAbierto(false);
      } else {
        // El alcance no es una clave del alta (E35 es `.strict()`): se envia
        // aparte con E48 en cuanto existe el id del usuario.
        const { alcance, ...datosAlta } = datos;
        const respuesta = await api.crearUsuario(datosAlta);
        if (datos.rol === 'ventanilla' && alcance) {
          await guardarAlcance(respuesta.usuario.id, alcance);
        }
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

  /** Dispara la descarga de un CSV ya construido, sin dejar rastro en disco. */
  const descargarCsv = (contenido: Blob, nombre: string) => {
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(contenido);
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(enlace.href);
  };

  const descargarPlantilla = async () => {
    setErrorLote(null);
    try {
      descargarCsv(await api.plantillaUsuariosLote(), 'plantilla_usuarios_sedea.csv');
    } catch {
      setErrorLote('No fue posible descargar la plantilla.');
    }
  };

  const subirLote = async () => {
    if (!archivoLote) return;
    setSubiendoLote(true);
    setErrorLote(null);
    // Los resultados anteriores se descartan al iniciar otra corrida: sus
    // contrasenas ya no se pueden recuperar y no deben confundirse con las nuevas.
    setResultadosLote(null);
    try {
      const respuesta = await api.crearUsuariosLote(archivoLote);
      setResultadosLote(respuesta.resultados);
      // El archivo se limpia para que no se vuelva a subir por accidente: un
      // segundo envio del mismo CSV solo produciria `usuario_duplicado`.
      setArchivoLote(null);
      if (refArchivoLote.current) refArchivoLote.current.value = '';
      await cargar();
    } catch (fallo) {
      setErrorLote((fallo as Error).message);
    } finally {
      setSubiendoLote(false);
    }
  };

  /**
   * CSV de contrasenas de los usuarios creados en ESTA corrida. Se arma en el
   * navegador con lo que ya esta en memoria: las temporales nunca vuelven a
   * pedirse al servidor porque el servidor tampoco las tiene.
   */
  const descargarPasswordsLote = () => {
    const creados = (resultadosLote ?? []).filter((r) => r.estado === 'creado');
    if (creados.length === 0) return;
    const escapar = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lineas = ['usuario,password_temporal'];
    for (const fila of creados) {
      lineas.push(`${escapar(fila.usuario)},${escapar(fila.password_temporal ?? '')}`);
    }
    // BOM UTF-8 para que Excel en Windows lo abra sin romper los acentos.
    const contenido = new Blob(['﻿' + lineas.join('\r\n') + '\r\n'], {
      type: 'text/csv;charset=utf-8'
    });
    descargarCsv(contenido, `passwords_usuarios_${new Date().toISOString().slice(0, 10)}.csv`);
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

  const eliminarUsuario = async (fila: UsuarioAdmin) => {
    const confirmado = window.confirm(
      `¿Eliminar a ${fila.nombre_completo}? El usuario irá a la papelera y conservará su historial, pero no podrá iniciar sesión.`
    );
    if (!confirmado) return;
    setError(null);
    try {
      await api.eliminarUsuario(fila.id);
      await cargar();
    } catch (fallo) {
      setError((fallo as Error).message);
    }
  };

  const restaurarUsuario = async (fila: UsuarioAdmin) => {
    const confirmado = window.confirm(
      `¿Restaurar a ${fila.nombre_completo}? El usuario volverá a la lista activa.`
    );
    if (!confirmado) return;
    setError(null);
    try {
      await api.restaurarUsuario(fila.id);
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
    <div className="tarjeta pantalla-ancha">
      <h1>Administración de usuarios</h1>

      <div className="mensaje aviso" role="status">
        {enPapelera
          ? 'Papelera: usuarios eliminados. Restaurar para volver a la lista activa o eliminar permanentemente (solo admin, via SQL).'
          : 'Las bajas se hacen desactivando o eliminando la cuenta: el historial de capturas y auditoría se conserva.'}
      </div>

      <div className="filtros">
        <button
          type="button"
          className={enPapelera ? 'secundario activo' : 'secundario'}
          data-testid="btn-toggle-papelera"
          onClick={() => {
            setEnPapelera(!enPapelera);
            setFiltroActivo('');
          }}
        >
          {enPapelera ? '🗑️ Papelera' : 'Ver Papelera'}
        </button>

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
                <tr key={fila.id} data-testid="fila-usuario" className={fila.eliminado ? 'eliminada' : ''}>
                  <td data-etiqueta="Usuario" className="mono">{fila.usuario}</td>
                  <td data-etiqueta="Nombre completo" className="celda-texto">{fila.nombre_completo}</td>
                  <td data-etiqueta="Rol">{ETIQUETAS_ROL[fila.rol] ?? fila.rol}</td>
                  <td data-etiqueta="Regional">{fila.regional ?? '—'}</td>
                  <td data-etiqueta="Estado">
                    {fila.eliminado ? (
                      <span className="badge alerta-alta" data-testid="badge-eliminado">
                        Eliminado
                      </span>
                    ) : (
                      <span
                        className={`badge ${fila.activo ? 'capturado' : 'pendiente'}`}
                        data-testid="badge-estado-usuario"
                      >
                        {fila.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    )}
                  </td>
                  <td data-etiqueta="Contraseña">
                    {fila.debe_cambiar_password && !fila.eliminado && (
                      <span className="badge alerta-media" data-testid="badge-password-pendiente">
                        Cambio pendiente
                      </span>
                    )}
                  </td>
                  <td data-etiqueta="Capturas">{fila.capturas}</td>
                  <td data-etiqueta="Acciones" className="acciones">
                    {!fila.eliminado ? (
                      <>
                        <BotonIcono
                          icono="lapiz"
                          etiqueta="Editar"
                          testId="btn-editar-usuario"
                          onClick={() => abrirEdicion(fila)}
                        />
                        <BotonIcono
                          icono="llave"
                          etiqueta="Resetear contraseña"
                          testId="btn-reset-password"
                          onClick={() => abrirReset(fila)}
                        />
                        <BotonIcono
                          icono={fila.activo ? 'ojo-tachado' : 'check'}
                          etiqueta={fila.activo ? 'Desactivar' : 'Activar'}
                          tono={fila.activo ? 'peligro' : 'neutro'}
                          testId="btn-toggle-activo"
                          onClick={() => void alternarActivo(fila)}
                        />
                        {perfil?.rol === 'admin' && (
                          <BotonIcono
                            icono="basura"
                            etiqueta="Eliminar"
                            tono="peligro"
                            testId="btn-eliminar-usuario"
                            onClick={() => void eliminarUsuario(fila)}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <BotonIcono
                          icono="regresar"
                          etiqueta="Restaurar"
                          tono="neutro"
                          testId="btn-restaurar-usuario"
                          onClick={() => void restaurarUsuario(fila)}
                        />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Carga masiva: mismo criterio de acceso que el alta individual. */}
      <section className="bloque-carga-lote" data-testid="seccion-carga-lote">
        <h2>Carga masiva</h2>
        <p className="dato">
          Descarga la plantilla, llénala con un usuario por fila y súbela. Cada fila se valida
          por separado: si una tiene un error, las demás se crean igual. Las contraseñas
          temporales se muestran una sola vez, al terminar la carga.
        </p>

        <div className="filtros">
          <button
            type="button"
            className="secundario"
            data-testid="btn-descargar-plantilla-usuarios"
            onClick={() => void descargarPlantilla()}
          >
            Descargar plantilla CSV
          </button>

          <input
            ref={refArchivoLote}
            data-testid="input-archivo-lote"
            type="file"
            accept=".csv,text/csv"
            aria-label="Archivo CSV de usuarios"
            onChange={(e) => {
              setArchivoLote(e.target.files?.[0] ?? null);
              setErrorLote(null);
            }}
          />

          <button
            type="button"
            data-testid="btn-subir-lote"
            disabled={!archivoLote || subiendoLote}
            onClick={() => void subirLote()}
          >
            {subiendoLote ? 'Procesando…' : 'Subir archivo'}
          </button>
        </div>

        {errorLote && (
          <div className="mensaje error" role="alert" data-testid="error-lote">
            {errorLote}
          </div>
        )}

        {resultadosLote && (
          <>
            <div className="mensaje aviso" role="status" data-testid="resumen-lote">
              {resultadosLote.filter((r) => r.estado === 'creado').length} creados,{' '}
              {resultadosLote.filter((r) => r.estado === 'error').length} con error de{' '}
              {resultadosLote.length} filas. Cópialas ahora: no se volverán a mostrar.
            </div>

            {resultadosLote.some((r) => r.estado === 'creado') && (
              <button
                type="button"
                data-testid="btn-descargar-passwords-lote"
                onClick={descargarPasswordsLote}
              >
                Descargar contraseñas de los creados
              </button>
            )}

            <div className="tabla-contenedor">
              <table data-testid="tabla-resultados-lote">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Usuario</th>
                    <th>Estado</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {resultadosLote.map((resultado) => (
                    <tr key={resultado.fila} data-testid="fila-resultado-lote">
                      <td data-etiqueta="Fila">{resultado.fila}</td>
                      <td data-etiqueta="Usuario" className="mono">
                        {resultado.usuario || '—'}
                      </td>
                      <td data-etiqueta="Estado">
                        <span
                          className={`badge ${resultado.estado === 'creado' ? 'capturado' : 'alerta-alta'}`}
                          data-testid="chip-estado-lote"
                        >
                          {resultado.estado === 'creado' ? 'Creado' : 'Error'}
                        </span>
                      </td>
                      <td data-etiqueta="Motivo" className="celda-texto">
                        {resultado.motivo ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {formAbierto && (
        <FormUsuario
          usuario={enEdicion}
          regionales={regionales}
          municipios={municipios}
          componentes={componentes}
          alcanceInicial={alcanceInicial}
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
