// Paso A de la captura: fotografia desde la camara del dispositivo.
// Se comprime en el cliente a 1600 px de lado mayor y JPEG calidad 0.75 para
// que el Blob quepa en IndexedDB y la subida funcione con mala senal (ver
// utilidades/comprimirImagen.ts, compartido con el motor de sync).
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { comprimirImagen } from '../utilidades/comprimirImagen';

interface Props {
  onFoto: (blob: Blob | null) => void;
  /**
   * Encabezado del bloque. La captura de campo lo numera como "Paso 1"; la
   * pantalla de entrega del apoyo reusa el componente con su propio texto.
   */
  titulo?: string;
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
      const blob = await comprimirImagen(archivo);
      if (previa) URL.revokeObjectURL(previa);
      setPrevia(URL.createObjectURL(blob));
      onFoto(blob);
    } catch (fallo) {
      setError(
        fallo instanceof Error && fallo.message === 'La fotografía sigue pesando demasiado incluso comprimida.'
          ? 'La fotografía pesa demasiado incluso comprimida. Vuelve a tomarla más de cerca o con menos zoom.'
          : 'No fue posible procesar la fotografía. Intenta tomarla de nuevo.'
      );
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
