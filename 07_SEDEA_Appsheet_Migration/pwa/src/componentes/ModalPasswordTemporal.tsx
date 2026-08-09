// Modal que muestra UNA SOLA VEZ la contrasena temporal recien generada.
// Al cerrarlo, quien lo abrio borra el valor de su estado: no se guarda en
// localStorage ni en IndexedDB y no hay forma de volver a consultarlo.
import { useState } from 'react';

interface Props {
  password: string;
  usuario: string;
  alCerrar: () => void;
}

export default function ModalPasswordTemporal({ password, usuario, alCerrar }: Props) {
  const [copiada, setCopiada] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopiada(true);
    } catch {
      // Fallback: si el navegador bloquea el portapapeles se selecciona el
      // texto para que el usuario copie a mano con Ctrl+C.
      const nodo = document.querySelector('[data-testid="texto-password-temporal"]');
      if (nodo) {
        const rango = document.createRange();
        rango.selectNodeContents(nodo);
        const seleccion = window.getSelection();
        seleccion?.removeAllRanges();
        seleccion?.addRange(rango);
      }
      setCopiada(false);
    }
  };

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true">
      <div className="modal tarjeta" data-testid="modal-password-temporal">
        <h2>Contraseña temporal generada</h2>

        <div className="mensaje aviso" role="alert">
          Cópiala ahora: no se volverá a mostrar. Entrégasela al usuario por un canal seguro;
          deberá cambiarla al iniciar sesión.
        </div>

        <p className="dato">
          Usuario: <strong>{usuario}</strong>
        </p>

        <p className="password-temporal" data-testid="texto-password-temporal">
          {password}
        </p>

        <div className="acciones">
          <button type="button" data-testid="btn-copiar-password" onClick={() => void copiar()}>
            Copiar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-cerrar-modal-password"
            onClick={alCerrar}
          >
            Ya la copié, cerrar
          </button>
        </div>

        {copiada && <p className="dato">Copiada al portapapeles</p>}
      </div>
    </div>
  );
}
