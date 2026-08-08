// Badges de las alertas de depuracion. El color depende del nivel:
// rojo = alta, ambar = media, verde = sin alertas.
import { ETIQUETAS_FLAG } from '@sedea/shared';

/** Flags de nivel alto: indican una probable captura duplicada real. */
const FLAGS_ALTOS = new Set(['folio_duplicado', 'curp_duplicada_mismo_concepto', 'clave_duplicada']);

interface Props {
  /** Nombre del flag, o `null` para el badge "Sin alertas". */
  flag: string | null;
}

export default function BadgeAlerta({ flag }: Props) {
  if (!flag) {
    return (
      <span className="badge alerta-ninguna" data-testid="badge-alerta">
        Sin alertas
      </span>
    );
  }
  const nivel = FLAGS_ALTOS.has(flag) ? 'alta' : 'media';
  return (
    <span className={`badge alerta-${nivel}`} data-testid="badge-alerta">
      {ETIQUETAS_FLAG[flag] ?? flag}
    </span>
  );
}

/** Lista de badges de una fila: todos sus flags activos, o "Sin alertas". */
export function BadgesDeFila({ fila, flags }: { fila: Record<string, unknown>; flags: readonly string[] }) {
  const activos = flags.filter((f) => Boolean(fila[f]));
  if (activos.length === 0) return <BadgeAlerta flag={null} />;
  return (
    <>
      {activos.map((f) => (
        <BadgeAlerta key={f} flag={f} />
      ))}
    </>
  );
}
