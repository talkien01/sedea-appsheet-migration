// Heuristica de "apellido" a partir del nombre completo (E62: impresion de
// folios por rango de letra de apellido, para armar mesas de entrega).
//
// No existe un campo apellido_paterno/materno separado en el sistema — el
// nombre siempre se captura como un solo texto ("ANGELINA ORDOÑEZ GONZALEZ").
// La heuristica asume el patron mas comun de captura en Mexico: UN nombre de
// pila seguido de apellido(s), asi que el "apellido" para ordenar/filtrar es
// TODO lo que viene despues de la primera palabra. Casos raros (dos nombres
// de pila como "MARIA JOSE", apellidos con particula como "DE LA CRUZ") no
// se resuelven perfecto con ninguna heuristica posible sin un campo
// estructurado — esta es la aproximacion mas simple y predecible.
//
// IMPORTANTE: esta misma logica esta espejada en SQL en
// backend/src/rutas/beneficiarios.ts (`expresionApellido`). Si se cambia
// aqui, hay que cambiarla alla tambien para que la pantalla (offline, esta
// funcion) y el PDF impreso (backend, SQL) queden en el mismo orden.

/** Apellido "adivinado": todo despues de la primera palabra del nombre completo. */
export function apellidoDeNombre(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? '';
  return partes.slice(1).join(' ');
}

/** Primera letra del apellido, en mayusculas y sin acentos (para comparar contra A-Z). */
export function primeraLetraApellido(nombreCompleto: string): string {
  const apellido = apellidoDeNombre(nombreCompleto);
  const letra = apellido.charAt(0).toUpperCase();
  // Normaliza acentos (Á -> A) para que el filtro por letra coincida con lo
  // que ve el capturista, igual que unaccent() del lado del servidor.
  return letra.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** true si el nombre cae dentro del rango de letras de apellido [desde, hasta] (ambos incluidos). */
export function apellidoEnRango(
  nombreCompleto: string,
  desde: string | null | undefined,
  hasta: string | null | undefined
): boolean {
  if (!desde && !hasta) return true;
  const letra = primeraLetraApellido(nombreCompleto);
  if (desde && letra < desde.toUpperCase()) return false;
  if (hasta && letra > hasta.toUpperCase()) return false;
  return true;
}

/** Comparador para ordenar por apellido (localeCompare en español). */
export function compararPorApellido(a: string, b: string): number {
  return apellidoDeNombre(a).localeCompare(apellidoDeNombre(b), 'es', { sensitivity: 'base' });
}
