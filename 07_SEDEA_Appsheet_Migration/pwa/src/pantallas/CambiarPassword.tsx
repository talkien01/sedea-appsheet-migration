// Cambio de contrasena para cualquier rol autenticado.
// Dos modos con el mismo componente:
//  - Obligatorio: debe_cambiar_password = true (contrasena temporal recien
//    entregada). La navegacion queda bloqueada hasta completarlo.
//  - Voluntario: desde el menu de usuario, en cualquier momento.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { validarFuerzaPassword } from '@sedea/shared';
import type { PerfilUsuario } from '@sedea/shared';
import { useSesion } from '../App';
import { api } from '../api/cliente';
import { contarBeneficiarios } from '../db/repositorios';

/** Destino tras el cambio, segun el rol (mismo criterio que el login). */
async function destinoPorRol(perfil: PerfilUsuario | null): Promise<string> {
  if (perfil?.rol === 'editor_datos') return '/depuracion';
  if (perfil?.rol === 'auditor') return '/auditoria';
  if (perfil?.rol === 'admin') return '/beneficiarios';
  const total = await contarBeneficiarios();
  return total === 0 ? '/sync' : '/beneficiarios';
}

export default function CambiarPassword() {
  const { perfil, refrescarPerfil } = useSesion();
  const navegar = useNavigate();

  const obligatorio = perfil?.debe_cambiar_password === true;

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);

    // Validacion en cliente: si falla, no se llama a la API.
    const debil = validarFuerzaPassword(nueva);
    if (debil) {
      setError(debil.mensaje);
      return;
    }
    if (nueva !== confirmar) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (nueva === actual) {
      setError('La nueva contraseña debe ser distinta de la actual.');
      return;
    }

    setEnviando(true);
    try {
      await api.cambiarMiPassword(actual, nueva);
      setExito(true);
      const actualizado = await refrescarPerfil();
      const destino = obligatorio ? await destinoPorRol(actualizado ?? perfil) : null;
      // Se deja ver el aviso de exito antes de salir de la pantalla.
      setTimeout(() => {
        if (destino) navegar(destino, { replace: true });
        else navegar(-1);
      }, 1200);
    } catch (fallo) {
      setError((fallo as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="tarjeta login-caja">
      <h1>Cambiar contraseña</h1>

      {obligatorio && (
        <div className="mensaje aviso" role="alert" data-testid="aviso-cambio-obligatorio">
          Por seguridad, debes cambiar tu contraseña temporal antes de usar el sistema.
        </div>
      )}

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-password">
          {error}
        </div>
      )}

      <form data-testid="form-cambio-password" onSubmit={(e) => void enviar(e)}>
        <div className="campo">
          <label htmlFor="input-password-actual">Contraseña actual</label>
          <input
            id="input-password-actual"
            data-testid="input-password-actual"
            type="password"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-password-nueva">Nueva contraseña</label>
          <input
            id="input-password-nueva"
            data-testid="input-password-nueva"
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
          <p className="dato">Mínimo 10 caracteres, con al menos una letra y un número.</p>
        </div>

        <div className="campo">
          <label htmlFor="input-password-confirmar">Confirmar nueva contraseña</label>
          <input
            id="input-password-confirmar"
            data-testid="input-password-confirmar"
            type="password"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
          />
        </div>

        <div className="acciones">
          <button type="submit" data-testid="btn-cambiar-password" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
          {!obligatorio && (
            <button
              type="button"
              className="secundario"
              data-testid="btn-cancelar-password"
              onClick={() => navegar(-1)}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      {exito && (
        <div className="toast" role="status" data-testid="toast-exito">
          Contraseña actualizada.
        </div>
      )}
    </div>
  );
}
