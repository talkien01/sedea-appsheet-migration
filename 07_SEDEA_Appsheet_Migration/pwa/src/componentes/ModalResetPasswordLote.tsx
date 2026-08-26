// Modal del reseteo de contrasena EN LOTE (E37b): una MISMA contrasena
// temporal para todos los usuarios seleccionados.
//
// A diferencia del reseteo individual, aqui no se ofrece el modo "automatica":
// el sentido de la operacion es justamente que todos queden con la misma
// contrasena para facilitar el primer ingreso. La politica que se aplica es la
// misma (`validarPasswordManual`, D30) y, como siempre, cada usuario deberá
// cambiarla al entrar (D28).
import { useState, type FormEvent } from 'react';
import { AYUDA_PASSWORD_MANUAL, validarPasswordManual } from '@sedea/shared';

interface Props {
  /** Cuantos usuarios se van a resetear (solo para el texto del modal). */
  cantidad: number;
  enviando: boolean;
  /** Error devuelto por la API en el ultimo intento. */
  errorApi: string | null;
  alConfirmar: (password: string) => void;
  alCancelar: () => void;
}

export default function ModalResetPasswordLote({
  cantidad,
  enviando,
  errorApi,
  alConfirmar,
  alCancelar
}: Props) {
  const [password, setPassword] = useState('');
  const [errorPassword, setErrorPassword] = useState<string | null>(null);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setErrorPassword(null);
    // Misma politica que el backend (D30): si falla, no se llama a la API.
    const fallo = validarPasswordManual(password);
    if (fallo) {
      setErrorPassword(fallo.mensaje);
      return;
    }
    alConfirmar(password);
  };

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true">
      <form
        className="modal tarjeta"
        data-testid="modal-reset-password-lote"
        onSubmit={enviar}
      >
        <h2>
          Resetear contraseña de {cantidad} usuario{cantidad === 1 ? '' : 's'}
        </h2>

        <div className="mensaje aviso" role="alert">
          Los {cantidad} usuarios seleccionados quedarán con esta MISMA contraseña
          y cada uno deberá cambiarla en su primer inicio de sesión.
        </div>

        {errorApi && (
          <div className="mensaje error" role="alert" data-testid="error-reset-lote">
            {errorApi}
          </div>
        )}

        <div className="campo">
          <label htmlFor="input-password-lote-reset">Contraseña común</label>
          <input
            id="input-password-lote-reset"
            data-testid="input-password-lote-reset"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrorPassword(null);
            }}
          />
          <p className="dato">{AYUDA_PASSWORD_MANUAL}</p>

          {errorPassword && (
            <p className="mensaje error" role="alert" data-testid="error-password-lote-reset">
              {errorPassword}
            </p>
          )}
        </div>

        <div className="acciones">
          <button type="submit" data-testid="btn-confirmar-reset-lote" disabled={enviando}>
            {enviando ? 'Reseteando…' : 'Resetear contraseña'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-cancelar-reset-lote"
            onClick={alCancelar}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
