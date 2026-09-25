// Copia un Blob guardado en IndexedDB a MEMORIA antes de subirlo.
//
// iOS Safari: un Blob leido de IndexedDB esta respaldado por un archivo del
// disco del navegador. Subirlo TAL CUAL con fetch/FormData puede fallar con
// "Load failed" (que la app muestra como "No hay conexion con el servidor") o
// quedarse colgado, aunque el Blob SI se pueda leer con arrayBuffer() y aunque
// una subida de datos creados en memoria funcione perfecto. Caso Jose Antonio
// (iPhone, 122 entregas, 2026-09-25): todas las pruebas de red pasaban, solo
// las fotos reales guardadas no subian.
export async function copiarBlobEnMemoria(blob: Blob, tipo = 'image/jpeg'): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type: blob.type && blob.type.startsWith('image/') ? blob.type : tipo });
}
