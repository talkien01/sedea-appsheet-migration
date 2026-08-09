// Modal de reseteo de contrasena (11.6.3). Reemplaza al confirm() de texto
// plano del build 4 para poder elegir el modo de contrasena: generarla
// automaticamente o escribirla a mano (D27).
// En ambos modos el usuario reseteado queda obligado a cambiarla al entrar (D28).
import { useState, type FormEvent } from 'react';
import {
  AYUDA_PASSWORD_MANUAL,
  validarPasswordManual,
  type ModoPassword,
  type UsuarioAdmin
} from '@sedea/shared';

interface Props {
  usuario: UsuarioAdmin;
  enviando: boolean;
  /** Error devuelto por la API en el ultimo intento. */
  errorApi: string | null;
  alConfirmar: (opciones: { modo_password: ModoPassword; password_manual?: string }) => void;
  alCancelar: () => void;
}

export default function ModalResetPassword({
  usuario,
  enviando,
  errorApi,
  alConfirmar,
  alCancelar
}: Props) {
  const [modo, setModo] = useState<ModoPassword>('automatica');
  const [passwordManual, setPasswordManual] = useState('');
  const [errorPassword, setErrorPassword] = useState<string | null>(null);

  /** Al volver a "automatica" el campo se oculta y se limpia. */
  const cambiarModo = (nuevo: string) => {
    const valor: ModoPassword = nuevo === 'manual' ? 'manual' : 'automatica';
    setModo(valor);
    if (valor === 'automatica') {
      setPasswordManual('');
      setErrorPassword(null);
    }
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setErrorPassword(null);

    // Misma politica que el backend (D30): si falla, no se llama a la API.
    if (modo === 'manual') {
      const fallo = validarPasswordManual(passwordManual);
      if (fallo) {
        setErrorPassword(fallo.mensaje);
        return;
      }
      alConfirmar({ modo_password: 'manual', password_manual: passwordManual });
      return;
    }
    alConfirmar({ modo_password: 'automatica' });
  };

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true">
      <form className="modal tarjeta" data-testid="modal-reset-password" onSubmit={enviar}>
        <h2>Resetear contraseña de {usuario.usuario}</h2>

        <div className="mensaje aviso" role="alert">
          Se asignará una contraseña nueva y el usuario deberá cambiarla al entrar.
        </div>

        {errorApi && (
          <div className="mensaje error" role="alert" data-testid="error-reset-password">
            {errorApi}
          </div>
        )}

        <div className="campo">
          <label htmlFor="select-modo-password-reset">Contraseña nueva</label>
          <select
            id="select-modo-password-reset"
            data-testid="select-modo-password-reset"
            value={modo}
            onChange={(e) => cambiarModo(e.target.value)}
          >
            <option value="automatica">Generar automática</option>
            <option value="manual">Escribir yo mismo</option>
          </select>

          {modo === 'manual' && (
            <>
              <label htmlFor="input-password-manual-reset">Contraseña para el usuario</label>
              <input
                id="input-password-manual-reset"
                data-testid="input-password-manual-reset"
                type="password"
                autoComplete="new-password"
                value={passwordManual}
                onChange={(e) => setPasswordManual(e.target.value)}
              />
              <p className="dato">{AYUDA_PASSWORD_MANUAL}</p>
            </>
          )}

          {errorPassword && (
            <p className="mensaje error" data-testid="error-password-manual">
              {errorPassword}
            </p>
          )}
        </div>

        <div className="acciones">
          <button type="submit" data-testid="btn-confirmar-reset" disabled={enviando}>
            {enviando ? 'Reseteando…' : 'Resetear contraseña'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-cancelar-reset"
            onClick={alCancelar}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
