// Catalogo unico de destinos de navegacion.
//
// Fuente unica de verdad para la barra lateral y para la barra inferior.
// Las condiciones de rol son EXACTAMENTE las que ya estaban en BarraEstado.tsx
// y en rutas.tsx: aqui no se relaja ni se endurece ningun permiso.
import type { ComponentType } from 'react';
import { puedeGestionarEntregas } from '@sedea/shared';
import {
  IconoDocumento,
  IconoEscudo,
  IconoFiltro,
  IconoGrafica,
  IconoLapiz,
  IconoLupa,
  IconoSincronizar,
  IconoUsuarios,
  IconoCapas,
  IconoSello,
  IconoCamara,
  IconoOjo
} from '../componentes/Iconos';

export type Grupo = 'Campo' | 'Gestión' | 'Ventanilla' | 'Administración';

export interface Destino {
  id: string;
  ruta: string;
  etiqueta: string;
  testId: string;
  roles: string[];
  grupo: Grupo;
  Icono: ComponentType<{ tamano?: number }>;
}

/** Orden fijo: el sidebar muestra los destinos del rol en este orden. */
export const DESTINOS: Destino[] = [
  {
    id: 'beneficiarios',
    ruta: '/beneficiarios',
    etiqueta: 'Beneficiarios',
    testId: 'nav-beneficiarios',
    roles: ['capturista', 'admin'],
    grupo: 'Campo',
    Icono: IconoUsuarios
  },
  {
    id: 'sync',
    ruta: '/sync',
    etiqueta: 'Sincronización',
    testId: 'nav-sync',
    roles: ['capturista', 'admin'],
    grupo: 'Campo',
    Icono: IconoSincronizar
  },
  // Registro de entrega del apoyo: precarga del evento para trabajar sin senal.
  {
    id: 'entregas',
    ruta: '/entregas/preparar',
    etiqueta: 'Entregas',
    testId: 'nav-entregas',
    roles: ['ventanilla', 'capturista', 'admin'],
    grupo: 'Campo',
    Icono: IconoSello
  },
  // Parte 2: la pantalla de campo. El nombre es explicito a proposito para que
  // no haya duda de cual se toca al llegar al evento con el apoyo en la camioneta.
  {
    id: 'entregar-apoyos',
    ruta: '/entregas/registrar',
    etiqueta: 'Entregar apoyos',
    testId: 'nav-entregar-apoyos',
    roles: ['ventanilla', 'capturista', 'admin'],
    grupo: 'Campo',
    Icono: IconoCamara
  },
  {
    id: 'dashboard',
    ruta: '/dashboard',
    etiqueta: 'Dashboard',
    testId: 'nav-dashboard',
    roles: ['admin', 'auditor', 'editor_datos'],
    grupo: 'Gestión',
    Icono: IconoGrafica
  },
  {
    id: 'auditoria',
    ruta: '/auditoria',
    etiqueta: 'Auditoría',
    testId: 'nav-auditoria',
    roles: ['auditor', 'admin'],
    grupo: 'Gestión',
    Icono: IconoLupa
  },
  {
    id: 'depuracion',
    ruta: '/depuracion',
    etiqueta: 'Depuración',
    testId: 'nav-depuracion',
    roles: ['editor_datos', 'admin'],
    grupo: 'Gestión',
    Icono: IconoFiltro
  },
  {
    id: 'correcciones',
    ruta: '/correcciones',
    etiqueta: 'Correcciones',
    testId: 'nav-correcciones',
    roles: ['editor_datos', 'admin'],
    grupo: 'Gestión',
    Icono: IconoLapiz
  },
  {
    id: 'solicitudes',
    ruta: '/solicitudes',
    etiqueta: 'Solicitudes',
    testId: 'nav-solicitudes',
    roles: ['ventanilla', 'capturista', 'admin'],
    grupo: 'Ventanilla',
    Icono: IconoDocumento
  },
  // Build 13: cola de pre-dictaminacion con IA y dictamen humano.
  {
    id: 'dictamen',
    ruta: '/dictamen',
    etiqueta: 'Dictamen',
    testId: 'nav-dictamen',
    roles: ['dictaminador', 'admin'],
    grupo: 'Ventanilla',
    Icono: IconoSello
  },
  {
    id: 'usuarios',
    ruta: '/usuarios',
    etiqueta: 'Usuarios',
    testId: 'nav-usuarios',
    roles: ['admin', 'editor_datos'],
    grupo: 'Administración',
    Icono: IconoEscudo
  },
  {
    id: 'catalogos',
    ruta: '/catalogos',
    etiqueta: 'Catálogos',
    testId: 'nav-catalogos',
    roles: ['admin', 'editor_datos'],
    grupo: 'Administración',
    Icono: IconoCapas
  },
  // Monitor de actividad en vivo. SOLO admin: es supervision de personas.
  {
    id: 'monitor',
    ruta: '/monitor',
    etiqueta: 'Monitor',
    testId: 'nav-monitor',
    roles: ['admin'],
    grupo: 'Administración',
    Icono: IconoOjo
  },
  // Edicion administrativa de solicitudes. SOLO admin: es la unica excepcion
  // a la inmutabilidad de solicitudes (D44), con motivo + reautenticacion.
  {
    id: 'edicion-admin-solicitudes',
    ruta: '/admin/solicitudes',
    etiqueta: 'Editar solicitudes',
    testId: 'nav-edicion-admin-solicitudes',
    roles: ['admin'],
    grupo: 'Administración',
    Icono: IconoLapiz
  }
];

/** Orden de los encabezados de grupo en la barra lateral. */
export const GRUPOS: Grupo[] = ['Campo', 'Gestión', 'Ventanilla', 'Administración'];

/** Verifica si un multi-rol (ej. "capturista+ventanilla") tiene al menos uno de los roles requeridos. */
function tieneAlgunRol(multiRol: string, rolesRequeridos: string[]): boolean {
  const rolesUsuario = multiRol.split('+');
  return rolesRequeridos.some(r => rolesUsuario.includes(r));
}

/** Destinos visibles para un rol, en el orden del catalogo. Soporta multi-rol. */
export function destinosDeRol(rol: string | null | undefined): Destino[] {
  if (!rol) return [];
  const puedeEntregar = puedeGestionarEntregas(rol);
  return DESTINOS.filter((d) => {
    if (!tieneAlgunRol(rol, d.roles)) return false;
    if ((d.id === 'entregas' || d.id === 'entregar-apoyos') && !puedeEntregar) return false;
    return true;
  });
}

/** Agrupa los destinos del rol; los grupos vacios no se devuelven. */
export function gruposDeRol(rol: string | null | undefined): Array<{
  grupo: Grupo;
  destinos: Destino[];
}> {
  const visibles = destinosDeRol(rol);
  return GRUPOS.map((grupo) => ({
    grupo,
    destinos: visibles.filter((d) => d.grupo === grupo)
  })).filter((g) => g.destinos.length > 0);
}

/** Maximo de celdas de destino en la barra inferior (la quinta es "Más"). */
export const CELDAS_MOVIL = 4;

/** Reparto de la barra inferior: primeros 4 del rol; el resto va a "Más". */
export function repartoMovil(rol: string | null | undefined): {
  celdas: Destino[];
  enMas: Destino[];
} {
  const visibles = destinosDeRol(rol);
  return {
    celdas: visibles.slice(0, CELDAS_MOVIL),
    enMas: visibles.slice(CELDAS_MOVIL)
  };
}

/** Titulo de la ruta activa (lo muestra la franja en tablet/escritorio). */
export function tituloDeRuta(ruta: string): string {
  const destino = DESTINOS.filter((d) => ruta.startsWith(d.ruta)).sort(
    (a, b) => b.ruta.length - a.ruta.length
  )[0];
  if (destino) return destino.etiqueta;
  if (ruta.startsWith('/cambiar-password')) return 'Cambiar mi contraseña';
  if (ruta.startsWith('/sin-permiso')) return 'Sin permiso';
  return '';
}

/** true si el destino corresponde a la ruta actual (incluye subrutas). */
export function estaActivo(rutaDestino: string, rutaActual: string): boolean {
  return rutaActual === rutaDestino || rutaActual.startsWith(`${rutaDestino}/`);
}
