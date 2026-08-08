// Expediente de evidencia por beneficiario, con descarga en PDF y CSV.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Beneficiario } from '@sedea/shared';
import { api, ErrorPeticion, URL_API } from '../api/cliente';
import MapaCapturas, { type PuntoCaptura } from '../componentes/MapaCapturas';
import { obtenerSesion } from '../db/repositorios';
import { formatearFecha } from './Sync';

interface CapturaRemota {
  uuid: string;
  foto_url: string;
  lat: number;
  lng: number;
  precision_m: number;
  capturado_en: string;
  capturista: string | null;
  observaciones: string | null;
}

export default function Expediente() {
  const { id } = useParams();
  const beneficiarioId = Number(id);

  const [beneficiario, setBeneficiario] = useState<Beneficiario | null>(null);
  const [capturas, setCapturas] = useState<CapturaRemota[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const sesion = await obtenerSesion();
      setToken(sesion?.token ?? null);
      setBeneficiario(await api.beneficiario(beneficiarioId));
      const respuesta = await api.capturasDeBeneficiario(beneficiarioId);
      setCapturas(respuesta.data as CapturaRemota[]);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion ? fallo.message : 'No fue posible cargar el expediente.'
      );
    }
  }, [beneficiarioId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Descarga un archivo del expediente adjuntando el token en la cabecera. */
  const descargar = async (extension: 'pdf' | 'csv') => {
    try {
      const respuesta = await fetch(
        `${URL_API}/auditoria/expediente/${beneficiarioId}.${extension}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      if (!respuesta.ok) throw new Error('descarga');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = `expediente_${beneficiario?.folio ?? beneficiarioId}.${extension}`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch {
      setError(`No fue posible descargar el expediente en ${extension.toUpperCase()}.`);
    }
  };

  if (error) {
    return (
      <div className="tarjeta">
        <div className="mensaje error" role="alert">
          {error}
        </div>
        <Link className="boton secundario" to="/auditoria">
          Volver al panel
        </Link>
      </div>
    );
  }

  if (!beneficiario) {
    return <p className="vacio">Cargando expediente…</p>;
  }

  const puntos: PuntoCaptura[] = capturas.map((c) => ({
    uuid: c.uuid,
    lat: c.lat,
    lng: c.lng,
    titulo: beneficiario.nombre_completo,
    fecha: formatearFecha(c.capturado_en),
    fotoSrc: token ? `${c.foto_url}?token=${encodeURIComponent(token)}` : null
  }));

  return (
    <>
      <div className="tarjeta">
        <h1>Expediente de {beneficiario.nombre_completo}</h1>
        <p className="dato"><strong>Folio:</strong> {beneficiario.folio}</p>
        <p className="dato"><strong>CURP:</strong> {beneficiario.curp || 'Sin CURP'}</p>
        <p className="dato">
          <strong>Dirección Regional:</strong> {beneficiario.regional_nombre ?? 'Sin dato'}
        </p>
        <p className="dato">
          <strong>Municipio:</strong> {beneficiario.municipio_nombre ?? 'Sin dato'}
        </p>
        <p className="dato"><strong>Colonia:</strong> {beneficiario.colonia ?? 'Sin dato'}</p>
        <p className="dato"><strong>Sección:</strong> {beneficiario.seccion ?? 'Sin dato'}</p>
        <p className="dato">
          <strong>Tipo de apoyo:</strong> {beneficiario.tipo_apoyo_nombre ?? 'Sin dato'}
        </p>

        <div className="acciones">
          <button type="button" onClick={() => void descargar('pdf')}>
            Descargar expediente PDF
          </button>
          <button type="button" className="secundario" onClick={() => void descargar('csv')}>
            Descargar expediente CSV
          </button>
          <Link className="boton secundario" to="/auditoria">
            Volver al panel
          </Link>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Ubicación de las capturas</h2>
        <MapaCapturas puntos={puntos} alto="mini" />
      </div>

      <div className="tarjeta">
        <h2>Capturas registradas ({capturas.length})</h2>
        {capturas.length === 0 && <p className="vacio">Sin resultados</p>}

        {capturas.map((c) => (
          <div key={c.uuid} style={{ marginBottom: 20 }}>
            {token && (
              <img
                className="foto-grande"
                src={`${c.foto_url}?token=${encodeURIComponent(token)}`}
                alt={`Evidencia del ${formatearFecha(c.capturado_en)}`}
              />
            )}
            <p className="dato">
              <strong>Coordenadas:</strong> {c.lat.toFixed(6)}, {c.lng.toFixed(6)}
            </p>
            <p className="dato">
              <strong>Precisión:</strong> ±{Math.round(c.precision_m)} m
            </p>
            <p className="dato">
              <strong>Fecha:</strong> {formatearFecha(c.capturado_en)}
            </p>
            <p className="dato">
              <strong>Capturista:</strong> {c.capturista ?? 'Sin dato'}
            </p>
            {c.observaciones && (
              <p className="dato">
                <strong>Observaciones:</strong> {c.observaciones}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
