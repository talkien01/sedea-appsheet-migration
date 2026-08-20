// Boton de accion de fila: glifo SVG + nombre accesible (aria-label + title + .sr-solo).
// Unico punto de verdad para la clase .boton-icono (Build 11, SPEC 17.4).
import type { ReactNode } from 'react';
import {
  IconoLapiz, IconoLlave, IconoOjoTachado, IconoCheck, IconoBasura, IconoCopiar, IconoMas
} from './Iconos';

export type NombreIconoAccion =
  | 'lapiz' | 'llave' | 'ojo-tachado' | 'check' | 'basura' | 'copiar' | 'mas';

const MAPA: Record<NombreIconoAccion, (p: { tamano?: number }) => ReactNode> = {
  'lapiz': IconoLapiz,
  'llave': IconoLlave,
  'ojo-tachado': IconoOjoTachado,
  'check': IconoCheck,
  'basura': IconoBasura,
  'copiar': IconoCopiar,
  'mas': IconoMas
};

type Props = {
  icono: NombreIconoAccion;
  /** Nombre accesible. Es el MISMO string que mostraba el boton de texto anterior. */
  etiqueta: string;
  onClick: () => void;
  testId: string;
  tono?: 'neutro' | 'peligro';
  deshabilitado?: boolean;
};

export function BotonIcono({
  icono, etiqueta, onClick, testId, tono = 'neutro', deshabilitado = false
}: Props) {
  const Glifo = MAPA[icono];
  return (
    <button
      type="button"
      className={tono === 'peligro' ? 'boton-icono peligro' : 'boton-icono'}
      data-testid={testId}
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
    >
      <Glifo tamano={18} />
      <span className="sr-solo">{etiqueta}</span>
    </button>
  );
}
