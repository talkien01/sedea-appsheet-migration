// Ficha del beneficiario con su historial de capturas locales.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Beneficiario } from '@sedea/shared';
import { capturasDeBeneficiario, obtenerBeneficiario } from '../db/repositorios';
import type { CapturaLocal } from '../db/indexeddb';
import { reintentarCaptura } from '../sync/cola';
import { sincronizarPendientes } from '../sync/motor';
import { formatearFecha } from './Sync';

const ETIQUETAS: Record<CapturaLocal['estado'], string> = {
  pendiente: 'Pendiente de sincronizar',
  sincronizando: 'Sincronizando…',
  sincronizada: 'Sincronizada',
  error: 'Error al sincronizar'
};

export default function FichaBeneficiario() {
  const { id } = useParams();
  const beneficiarioId = Number(id);

  const [beneficiario, setBeneficiario] = useState<Beneficiario | null>(null);
  const [capturas, setCapturas] = useState<CapturaLocal[]>([]);

  const cargar = useCallback(async () => {
    setBeneficiario((await obtenerBeneficiario(beneficiarioId)) ?? null);
    setCapturas(await capturasDeBeneficiario(beneficiarioId));
  }, [beneficiarioId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!beneficiario) {
    return <p className="vacio">Beneficiario no encontrado en este dispositivo.</p>;
  }

  const reintentar = async (uuid: string) => {
    await reintentarCaptura(uuid);
    await sincronizarPendientes();
    await cargar();
  };

  return (
    <>
      <div className="tarjeta">
        <h1>{beneficiario.nombre_completo}</h1>
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
        <p className="dato"><strong>Localidad:</strong> {beneficiario.localidad ?? 'Sin dato'}</p>
        <p className="dato"><strong>Domicilio:</strong> {beneficiario.domicilio ?? 'Sin dato'}</p>
        <p className="dato"><strong>Teléfono:</strong> {beneficiario.telefono ?? 'Sin dato'}</p>
        <p className="dato">
          <strong>Tipo de apoyo:</strong> {beneficiario.tipo_apoyo_nombre ?? 'Sin dato'}
        </p>
        <p className="dato">
          <strong>Cantidad asignada:</strong> {beneficiario.cantidad_asignada ?? 'Sin dato'}
        </p>

        <div className="acciones">
          <Link className="boton" to={`/beneficiarios/${beneficiario.id}/captura`}>
            Capturar apoyo
          </Link>
          <Link className="boton secundario" to="/beneficiarios">
            Volver al padrón
          </Link>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Capturas en este dispositivo ({capturas.length})</h2>
        {capturas.length === 0 && <p className="vacio">Sin resultados</p>}

        {capturas.map((captura) => (
          <div key={captura.uuid} className="dato" style={{ marginBottom: 16 }}>
            {captura.foto && (
              <img
                className="previa"
                src={URL.createObjectURL(captura.foto)}
                alt="Evidencia capturada"
                style={{ maxHeight: 160 }}
              />
            )}
            <p className="dato">
              <strong>Fecha:</strong> {formatearFecha(captura.capturado_en)}
            </p>
            <p className="dato">
              <strong>Coordenadas:</strong> {captura.lat.toFixed(6)}, {captura.lng.toFixed(6)} ·
              Precisión: ±{captura.precision_m} m
            </p>
            <p className="dato">
              <strong>Estado:</strong> {ETIQUETAS[captura.estado]}
              {captura.error_msg ? ` — ${captura.error_msg}` : ''}
            </p>
            {captura.estado === 'error' && (
              <button type="button" onClick={() => void reintentar(captura.uuid)}>
                Reintentar
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
