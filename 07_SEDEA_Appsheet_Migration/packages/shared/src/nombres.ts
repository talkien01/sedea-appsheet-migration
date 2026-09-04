// Heuristica de "apellido" a partir del nombre completo (E62: impresion de
// folios por rango de letra de apellido, para armar mesas de entrega).
//
// No existe un campo apellido_paterno/materno separado en el sistema — el
// nombre siempre se captura como un solo texto ("ANGELINA ORDOÑEZ GONZALEZ").
//
// v1 asumia UN solo nombre de pila ("todo despues de la primera palabra") y
// salia muy desfasada: en Mexico el numero de NOMBRES varia (1 a 3), pero el
// numero de APELLIDOS es casi siempre 2 (paterno + materno). Con nombres
// compuestos ("JUAN CARLOS PEREZ LOPEZ") la v1 tomaba "CARLOS" como apellido
// y ordenaba por C en vez de P.
//
// v2: se cuenta desde el FINAL, no desde el inicio.
//   - 3+ palabras: las ULTIMAS DOS son apellido paterno + materno.
//   - 2 palabras: se asume que solo se capturo un apellido (la ultima).
//   - 1 palabra: no hay apellido que adivinar, se usa esa palabra.
// El apellido paterno (primera palabra del resultado) es el que se usa para
// ordenar/filtrar por letra — igual que en un directorio telefonico.
//
// Sigue sin ser perfecto: apellidos compuestos con particula ("DE LA CRUZ",
// "DEL RIO") pierden la particula, porque no hay forma de distinguirlos de
// un nombre de pila compuesto sin un campo estructurado. Es la mejor
// aproximacion disponible con el dato que existe.
//
// IMPORTANTE: esta misma logica esta espejada en SQL en
// backend/src/rutas/beneficiarios.ts (`expresionApellido`). Si se cambia
// aqui, hay que cambiarla alla tambien para que la pantalla (offline, esta
// funcion) y el PDF impreso (backend, SQL) queden en el mismo orden.

/** Apellido(s) "adivinados": las ultimas 1 o 2 palabras del nombre completo. */
export function apellidoDeNombre(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  const n = partes.length;
  if (n >= 3) return partes.slice(n - 2).join(' ');
  if (n === 2) return partes[1];
  return partes[0] ?? '';
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
