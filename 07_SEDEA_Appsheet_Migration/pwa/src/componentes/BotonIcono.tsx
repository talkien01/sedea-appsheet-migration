// Boton de accion de fila: glifo SVG + nombre accesible (aria-label + title + .sr-solo).
// Unico punto de verdad para la clase .boton-icono (Build 11, SPEC 17.4).
import type { ReactNode } from 'react';
import {
  IconoLapiz, IconoLlave, IconoOjoTachado, IconoCheck, IconoBasura, IconoCopiar, IconoMas,
  IconoAgregar, IconoOjo, IconoRegresar
} from './Iconos';

export type NombreIconoAccion =
  | 'lapiz' | 'llave' | 'ojo-tachado' | 'check' | 'basura' | 'copiar' | 'mas' | 'ojo' | 'regresar';

const MAPA: Record<NombreIconoAccion, (p: { tamano?: number }) => ReactNode> = {
  'lapiz': IconoLapiz,
  'llave': IconoLlave,
  'ojo-tachado': IconoOjoTachado,
  'check': IconoCheck,
  'basura': IconoBasura,
  'copiar': IconoCopiar,
  'mas': IconoMas,
  'ojo': IconoOjo,
  'regresar': IconoRegresar
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
      data-tooltip={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
    >
      <Glifo tamano={18} />
      <span className="sr-solo">{etiqueta}</span>
    </button>
  );
}

/**
 * Hueco del ancho de un `BotonIcono`. Se usa en las filas del arbol que no
 * tienen "Duplicar" para que las columnas de accion (editar | duplicar |
 * desactivar) queden alineadas en TODAS las filas. No es un boton, no lleva
 * data-testid y esta oculto para el lector de pantalla.
 */
export function HuecoIcono() {
  return <span className="boton-icono-hueco" aria-hidden="true" />;
}

/**
 * Boton de alta de los encabezados del arbol: glifo "+" mas una etiqueta corta
 * visible (p. ej. "Programa"). El nombre accesible sigue siendo el texto largo
 * de siempre ("Nuevo programa") via aria-label, para no romper los selectores
 * por rol/nombre ni el contrato de accesibilidad de Build 11.
 */
export function BotonCrear({
  etiquetaCorta, etiqueta, onClick, testId
}: {
  /** Texto visible dentro del boton. */
  etiquetaCorta: string;
  /** Nombre accesible completo (aria-label + title). */
  etiqueta: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className="secundario boton-crear"
      data-testid={testId}
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
    >
      <IconoAgregar tamano={15} />
      <span>{etiquetaCorta}</span>
    </button>
  );
}
