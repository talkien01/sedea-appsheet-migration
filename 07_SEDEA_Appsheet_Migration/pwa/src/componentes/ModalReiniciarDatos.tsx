// Modal de confirmacion del reinicio de datos de prueba.
//
// Es la unica operacion irreversible de la app, asi que la friccion es
// deliberada: hay que teclear la frase completa, letra por letra, con
// mayusculas. No se puede pegar por accidente ni confirmar con Enter distraido.
import { useState } from 'react';
import { FRASE_CONFIRMACION_REINICIO, TABLAS_REINICIO_DATOS_PRUEBA } from '@sedea/shared';

interface Props {
  ejecutando: boolean;
  /** Error devuelto por la API en el ultimo intento. */
  errorApi: string | null;
  alConfirmar: () => void;
  alCancelar: () => void;
}

export default function ModalReiniciarDatos({
  ejecutando,
  errorApi,
  alConfirmar,
  alCancelar
}: Props) {
  const [frase, setFrase] = useState('');

  // Comparacion EXACTA: sin trim, sin toUpperCase. Es la misma regla que aplica
  // el backend, para que lo que se ve en pantalla sea lo que de verdad pasa.
  const coincide = frase === FRASE_CONFIRMACION_REINICIO;

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true">
      <div className="modal tarjeta" data-testid="modal-reiniciar-datos">
        <h2>Reiniciar datos de prueba</h2>

        <div className="mensaje error" role="alert">
          <strong>Esta acción es irreversible.</strong> Se borrarán para siempre
          todos los datos capturados. No hay papelera ni forma de deshacerlo.
        </div>

        <p>Se vaciarán por completo estas {TABLAS_REINICIO_DATOS_PRUEBA.length} tablas:</p>
        <ul className="mono" data-testid="lista-tablas-reinicio">
          {TABLAS_REINICIO_DATOS_PRUEBA.map((tabla) => (
            <li key={tabla}>{tabla}</li>
          ))}
        </ul>

        <p className="dato">
          El catálogo del sistema (usuarios, regionales, municipios, programas,
          componentes, proyectos, tipos de apoyo, ventanillas) <strong>no se toca</strong>.
          El contador de folios vuelve a empezar en 0001. Los archivos de{' '}
          <span className="mono">/media</span> se quedan en el servidor y se limpian
          aparte, a mano.
        </p>

        {errorApi && (
          <div className="mensaje error" role="alert" data-testid="error-reiniciar-datos">
            {errorApi}
          </div>
        )}

        <div className="campo">
          <label htmlFor="input-confirmar-reinicio">
            Para continuar, escribe exactamente:{' '}
            <strong className="mono">{FRASE_CONFIRMACION_REINICIO}</strong>
          </label>
          <input
            id="input-confirmar-reinicio"
            data-testid="input-confirmar-reinicio"
            type="text"
            className="mono"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={frase}
            onChange={(e) => setFrase(e.target.value)}
          />
        </div>

        <div className="acciones">
          <button
            type="button"
            className="peligro"
            data-testid="btn-confirmar-reinicio"
            disabled={!coincide || ejecutando}
            onClick={alConfirmar}
          >
            {ejecutando ? 'Borrando…' : 'Borrar todos los datos'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-cancelar-reinicio"
            disabled={ejecutando}
            onClick={alCancelar}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
