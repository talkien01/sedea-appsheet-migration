// Formulario modal de alta y edicion de usuarios.
// En edicion, el nombre de acceso se muestra bloqueado: es la clave con la que
// se lee el historial de capturas y auditoria, por eso es inmutable (D21).
import { useState, type FormEvent } from 'react';
import BloqueAlcance, { type ValoresAlcance } from './BloqueAlcance';
import {
  AYUDA_PASSWORD_MANUAL,
  ETIQUETAS_ROL,
  PATRON_USUARIO,
  validarPasswordManual,
  type ModoPassword,
  type UsuarioAdmin
} from '@sedea/shared';

interface RegionalOpcion {
  id: number;
  nombre: string;
}

interface Props {
  /** null = alta; con valor = edicion. */
  usuario: UsuarioAdmin | null;
  regionales: RegionalOpcion[];
  /** Catalogos del bloque de alcance (build 6, solo rol ventanilla). */
  municipios: { id: number; nombre: string }[];
  componentes: { id: number; clave: string; nombre: string }[];
  /** Alcance actual del usuario en edicion; en alta, "todos" por defecto. */
  alcanceInicial?: ValoresAlcance;
  /** Rol de quien opera: el editor de datos no puede asignar "Administrador". */
  rolActor: string;
  guardando: boolean;
  errorApi: string | null;
  alGuardar: (datos: {
    usuario: string;
    nombre_completo: string;
    rol: string;
    regional_id: number | null;
    /** Solo en alta: como se decide la contrasena inicial (D27). */
    modo_password?: ModoPassword;
    password_manual?: string;
    /** Solo para rol ventanilla: se persiste con E48 tras guardar. */
    alcance?: ValoresAlcance;
  }) => void;
  alCancelar: () => void;
}

const ALCANCE_TODOS: ValoresAlcance = {
  municipiosTodos: true,
  municipios: [],
  componentesTodos: true,
  componentes: []
};

export default function FormUsuario({
  usuario,
  regionales,
  municipios,
  componentes,
  alcanceInicial,
  rolActor,
  guardando,
  errorApi,
  alGuardar,
  alCancelar
}: Props) {
  const esAlta = usuario === null;

  const [nombreAcceso, setNombreAcceso] = useState(usuario?.usuario ?? '');
  const [nombreCompleto, setNombreCompleto] = useState(usuario?.nombre_completo ?? '');
  const [rol, setRol] = useState<string>(usuario?.rol ?? 'capturista');
  const [regionalId, setRegionalId] = useState<string>(
    usuario?.regional_id ? String(usuario.regional_id) : ''
  );

  // Modo de contrasena: solo aplica al alta; por defecto, automatica (D27).
  const [modoPassword, setModoPassword] = useState<ModoPassword>('automatica');
  const [passwordManual, setPasswordManual] = useState('');

  // Alcance de ventanilla (12.8.4): vacio = todos.
  const [alcance, setAlcance] = useState<ValoresAlcance>(alcanceInicial ?? ALCANCE_TODOS);

  const [errorUsuario, setErrorUsuario] = useState<string | null>(null);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorRegional, setErrorRegional] = useState<string | null>(null);
  const [errorPasswordManual, setErrorPasswordManual] = useState<string | null>(null);

  /** Al volver a "automatica" el campo se oculta y se limpia (11.6.2). */
  const cambiarModoPassword = (nuevo: string) => {
    const modo = nuevo === 'manual' ? 'manual' : 'automatica';
    setModoPassword(modo);
    if (modo === 'automatica') {
      setPasswordManual('');
      setErrorPasswordManual(null);
    }
  };

  // La Regional solo aplica al capturista (D22).
  const regionalAplica = rol === 'capturista';

  const cambiarRol = (nuevo: string) => {
    setRol(nuevo);
    if (nuevo !== 'capturista') {
      setRegionalId('');
      setErrorRegional(null);
    }
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setErrorUsuario(null);
    setErrorNombre(null);
    setErrorRegional(null);
    setErrorPasswordManual(null);

    let valido = true;
    const acceso = nombreAcceso.trim().toLowerCase();
    const nombre = nombreCompleto.trim();

    if (esAlta) {
      if (acceso.length < 3 || acceso.length > 32) {
        setErrorUsuario('El nombre de acceso debe tener entre 3 y 32 caracteres.');
        valido = false;
      } else if (!PATRON_USUARIO.test(acceso)) {
        setErrorUsuario('Solo se permiten minúsculas, números, punto, guion y guion bajo.');
        valido = false;
      }
    }

    if (nombre.length < 3 || nombre.length > 120) {
      setErrorNombre('El nombre completo debe tener entre 3 y 120 caracteres.');
      valido = false;
    }

    if (regionalAplica && !regionalId) {
      setErrorRegional('Los capturistas deben tener una Dirección Regional asignada.');
      valido = false;
    }

    // La contrasena manual se valida con la misma politica del backend (D30).
    if (esAlta && modoPassword === 'manual') {
      const fallo = validarPasswordManual(passwordManual);
      if (fallo) {
        setErrorPasswordManual(fallo.mensaje);
        valido = false;
      }
    }

    // Si la validacion de cliente falla no se llama a la API.
    if (!valido) return;

    alGuardar({
      usuario: acceso,
      nombre_completo: nombre,
      rol,
      regional_id: regionalAplica ? Number(regionalId) : null,
      // En edicion no se manda modo alguno: la contrasena solo se cambia con
      // "Resetear contraseña" (campo_no_editable).
      ...(esAlta ? { modo_password: modoPassword } : {}),
      ...(esAlta && modoPassword === 'manual' ? { password_manual: passwordManual } : {}),
      // El alcance solo viaja para el rol ventanilla; el resto no lo tiene.
      ...(rol === 'ventanilla' ? { alcance } : {})
    });
  };

  const rolesDisponibles = Object.keys(ETIQUETAS_ROL).filter(
    (r) => rolActor === 'admin' || r !== 'admin'
  );

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true">
      <form className="modal tarjeta" data-testid="form-usuario" onSubmit={enviar}>
        <h2>{esAlta ? 'Nuevo usuario' : 'Editar usuario'}</h2>

        {errorApi && (
          <div className="mensaje error" role="alert" data-testid="error-form-usuario">
            {errorApi}
          </div>
        )}

        <div className="campo">
          <label htmlFor="input-usuario">Nombre de acceso</label>
          <input
            id="input-usuario"
            data-testid="input-usuario"
            type="text"
            value={nombreAcceso}
            onChange={(e) => setNombreAcceso(e.target.value)}
            readOnly={!esAlta}
            disabled={!esAlta}
          />
          {!esAlta && (
            <p className="dato">
              El nombre de acceso no se puede cambiar: es la clave del historial de capturas y
              auditoría.
            </p>
          )}
          {errorUsuario && (
            <p className="mensaje error" data-testid="error-usuario">
              {errorUsuario}
            </p>
          )}
        </div>

        <div className="campo">
          <label htmlFor="input-nombre-completo">Nombre completo</label>
          <input
            id="input-nombre-completo"
            data-testid="input-nombre-completo"
            type="text"
            value={nombreCompleto}
            onChange={(e) => setNombreCompleto(e.target.value)}
          />
          {errorNombre && (
            <p className="mensaje error" data-testid="error-nombre">
              {errorNombre}
            </p>
          )}
        </div>

        <div className="campo">
          <label htmlFor="select-rol">Rol</label>
          <select
            id="select-rol"
            data-testid="select-rol"
            value={rol}
            onChange={(e) => cambiarRol(e.target.value)}
          >
            {rolesDisponibles.map((valor) => (
              <option key={valor} value={valor}>
                {ETIQUETAS_ROL[valor]}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="select-regional">Dirección Regional</label>
          <select
            id="select-regional"
            data-testid="select-regional"
            value={regionalAplica ? regionalId : ''}
            disabled={!regionalAplica}
            onChange={(e) => setRegionalId(e.target.value)}
          >
            <option value="">{regionalAplica ? 'Selecciona una Regional' : 'No aplica'}</option>
            {regionalAplica &&
              regionales.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
          </select>
          {errorRegional && (
            <p className="mensaje error" data-testid="error-regional">
              {errorRegional}
            </p>
          )}
        </div>

        {/* Alcance: solo para el rol Ventanilla (12.8.4). */}
        {rol === 'ventanilla' && (
          <BloqueAlcance
            municipios={municipios}
            componentes={componentes}
            valores={alcance}
            cambiar={setAlcance}
          />
        )}

        {/* Modo de contrasena: solo en el alta (11.6.2). */}
        {esAlta && (
          <div className="campo">
            <label htmlFor="select-modo-password">Contraseña inicial</label>
            <select
              id="select-modo-password"
              data-testid="select-modo-password"
              value={modoPassword}
              onChange={(e) => cambiarModoPassword(e.target.value)}
            >
              <option value="automatica">Generar automática</option>
              <option value="manual">Escribir yo mismo</option>
            </select>

            {modoPassword === 'manual' && (
              <>
                <label htmlFor="input-password-manual">Contraseña para el usuario</label>
                <input
                  id="input-password-manual"
                  data-testid="input-password-manual"
                  type="password"
                  autoComplete="new-password"
                  value={passwordManual}
                  onChange={(e) => setPasswordManual(e.target.value)}
                />
                <p className="dato">{AYUDA_PASSWORD_MANUAL}</p>
              </>
            )}

            {errorPasswordManual && (
              <p className="mensaje error" data-testid="error-password-manual">
                {errorPasswordManual}
              </p>
            )}
          </div>
        )}

        <div className="acciones">
          <button type="submit" data-testid="btn-guardar-usuario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-cancelar-usuario"
            onClick={alCancelar}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
