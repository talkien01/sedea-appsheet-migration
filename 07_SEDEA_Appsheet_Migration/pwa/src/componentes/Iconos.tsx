// Iconografia propia en SVG inline: cero dependencias npm, cero peticiones.
// Todos son 24x24 en el viewBox, trazo de 1.75 con currentColor, de modo que
// heredan el color del contexto (nav-item en reposo, activo, acento...).
import type { ReactNode, SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { tamano?: number };

function Base({ tamano = 20, children, ...resto }: Props & { children: ReactNode }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...resto}
    >
      {children}
    </svg>
  );
}

/** Padron de beneficiarios. */
export function IconoUsuarios(props: Props) {
  return (
    <Base {...props}>
      <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6" />
    </Base>
  );
}

/** Sincronizacion. */
export function IconoSincronizar(props: Props) {
  return (
    <Base {...props}>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3L21 15" />
      <path d="M21 20v-5h-5" />
    </Base>
  );
}

/** Dashboard / graficas. */
export function IconoGrafica(props: Props) {
  return (
    <Base {...props}>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6M20 16v-9" />
    </Base>
  );
}

/** Auditoria. */
export function IconoLupa(props: Props) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Base>
  );
}

/** Depuracion. */
export function IconoFiltro(props: Props) {
  return (
    <Base {...props}>
      <path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z" />
    </Base>
  );
}

/** Correcciones. */
export function IconoLapiz(props: Props) {
  return (
    <Base {...props}>
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </Base>
  );
}

/** Solicitudes de apoyo. */
export function IconoDocumento(props: Props) {
  return (
    <Base {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Base>
  );
}

/** Administracion de usuarios. */
export function IconoEscudo(props: Props) {
  return (
    <Base {...props}>
      <path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </Base>
  );
}

/** Catalogos / capas jerarquicas. */
export function IconoCapas(props: Props) {
  return (
    <Base {...props}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </Base>
  );
}

/** Mas opciones (hoja inferior de movil). */
export function IconoMas(props: Props) {
  return (
    <Base {...props}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Base>
  );
}

/** Modo claro (se muestra cuando el modo activo es oscuro). */
export function IconoSol(props: Props) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Base>
  );
}

/** Modo oscuro (se muestra cuando el modo activo es claro). */
export function IconoLuna(props: Props) {
  return (
    <Base {...props}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z" />
    </Base>
  );
}

/** Colapsar / expandir la barra lateral. */
export function IconoPanel(props: Props) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M10 4.5v15" />
    </Base>
  );
}

/** Sin permiso / candado. */
export function IconoCandado(props: Props) {
  return (
    <Base {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Base>
  );
}

/** Cambiar mi contrasena. */
export function IconoLlave(props: Props) {
  return (
    <Base {...props}>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.6 12.6L19 4.2M16.5 6.7l2 2M14 9.2l2 2" />
    </Base>
  );
}

/** Cerrar sesion. */
export function IconoSalir(props: Props) {
  return (
    <Base {...props}>
      <path d="M14 6V4.5A1.5 1.5 0 0 0 12.5 3h-6A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h6a1.5 1.5 0 0 0 1.5-1.5V18" />
      <path d="M18.5 12H9.5M16 9l3 3-3 3" />
    </Base>
  );
}

/** Estado vacio. */
export function IconoVacio(props: Props) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M3.5 11h17M9 5.5v13" />
    </Base>
  );
}
