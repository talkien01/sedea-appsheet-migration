// Paso A de la captura: fotografia desde la camara del dispositivo.
// Se comprime en el cliente a 1600 px de lado mayor y JPEG calidad 0.75 para
// que el Blob quepa en IndexedDB y la subida funcione con mala senal.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface Props {
  onFoto: (blob: Blob | null) => void;
  /**
   * Encabezado del bloque. La captura de campo lo numera como "Paso 1"; la
   * pantalla de entrega del apoyo reusa el componente con su propio texto.
   */
  titulo?: string;
}

const LADO_MAXIMO = 1600;
const CALIDAD = 0.75;

/** Redimensiona y recomprime la imagen en un canvas. */
async function comprimir(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext('2d');
  if (!contexto) return archivo;
  contexto.drawImage(bitmap, 0, 0, ancho, alto);

  return new Promise<Blob>((resolver) => {
    lienzo.toBlob(
      (blob) => resolver(blob ?? archivo),
      'image/jpeg',
      CALIDAD
    );
  });
}

export default function CapturaFoto({ onFoto, titulo }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  const alSeleccionar = async (evento: ChangeEvent<HTMLInputElement>) => {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setError(null);
    setProcesando(true);
    try {
      let blob: Blob;
      try {
        blob = await comprimir(archivo);
      } catch {
        // Si el navegador no puede recomprimir, se envia el archivo original:
        // el servidor lo normaliza igualmente antes de guardarlo.
        blob = archivo;
      }
      if (previa) URL.revokeObjectURL(previa);
      setPrevia(URL.createObjectURL(blob));
      onFoto(blob);
    } catch {
      setError('No fue posible procesar la fotografía. Intenta tomarla de nuevo.');
      onFoto(null);
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div>
      <h2>{titulo ?? 'Paso 1 · Fotografía de evidencia'}</h2>

      {error && (
        <div className="mensaje error" role="alert">
          {error}
        </div>
      )}

      {previa && <img className="previa" src={previa} alt="Vista previa de la evidencia" />}

      <input
        ref={entrada}
        id="foto"
        data-testid="input-foto"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void alSeleccionar(e)}
        style={{ marginBottom: 10 }}
      />

      {previa && (
        <button type="button" className="secundario" onClick={() => entrada.current?.click()}>
          Tomar otra
        </button>
      )}

      {procesando && <p className="dato">Procesando fotografía…</p>}
    </div>
  );
}
