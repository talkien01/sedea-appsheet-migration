// Alternador de modo claro/oscuro.
// El icono indica A DONDE VAS (sol cuando estas en oscuro, luna cuando estas
// en claro) y el aria-label describe la ACCION, no el estado.
// Puntos de montaje (exactamente uno visible por viewport, S15.6.3):
//   - pie de la barra lateral en tablet y escritorio,
//   - franja de estado en movil,
//   - esquina superior derecha de /login.
import { IconoLuna, IconoSol } from './Iconos';
import { useTema } from '../tema/tema';

interface Props {
  /** Clase extra (p. ej. `toggle-login` para la variante flotante). */
  clase?: string;
}

export default function ToggleTema({ clase = '' }: Props) {
  const { modo, alternar } = useTema();
  const etiqueta = modo === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

  return (
    <button
      type="button"
      data-testid="toggle-tema"
      className={`toggle-tema ${clase}`.trim()}
      aria-pressed={modo === 'light'}
      aria-label={etiqueta}
      title={etiqueta}
      onClick={alternar}
    >
      {modo === 'dark' ? <IconoSol tamano={18} /> : <IconoLuna tamano={18} />}
    </button>
  );
}
