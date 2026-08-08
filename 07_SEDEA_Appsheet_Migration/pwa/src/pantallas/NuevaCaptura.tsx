// Captura de evidencia: foto + GPS + datos. No requiere red en ningun paso.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Beneficiario } from '@sedea/shared';
import CapturaFoto from '../componentes/CapturaFoto';
import CapturaGPS, { type Ubicacion } from '../componentes/CapturaGPS';
import { catalogosPorGrupo, obtenerBeneficiario } from '../db/repositorios';
import type { EntradaCatalogoLocal } from '../db/indexeddb';
import { encolarCaptura } from '../sync/cola';
import { sincronizarPendientes } from '../sync/motor';
import { estaEnLinea } from '../sync/estadoRed';

export default function NuevaCaptura() {
  const { id } = useParams();
  const navegar = useNavigate();
  const beneficiarioId = Number(id);

  const [beneficiario, setBeneficiario] = useState<Beneficiario | null>(null);
  const [tiposApoyo, setTiposApoyo] = useState<EntradaCatalogoLocal[]>([]);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [tipoApoyoId, setTipoApoyoId] = useState<string>('');
  const [cantidad, setCantidad] = useState<string>('');
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const registro = await obtenerBeneficiario(beneficiarioId);
      setBeneficiario(registro ?? null);
      const apoyos = await catalogosPorGrupo('tipo_apoyo');
      setTiposApoyo(apoyos);
      if (registro?.tipo_apoyo_id) setTipoApoyoId(String(registro.tipo_apoyo_id));
    })();
  }, [beneficiarioId]);

  const puedeGuardar = !!foto && !!ubicacion && !guardando;

  const guardar = async () => {
    if (!foto || !ubicacion) return;
    setGuardando(true);
    try {
      await encolarCaptura({
        beneficiario_id: beneficiarioId,
        foto,
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        precision_m: ubicacion.precision_m,
        tipo_apoyo_id: tipoApoyoId ? Number(tipoApoyoId) : null,
        cantidad_entregada: cantidad ? Number(cantidad) : null,
        observaciones: observaciones.trim() ? observaciones.trim().slice(0, 500) : null
      });

      setToast('Captura guardada localmente. Pendiente de sincronizar.');

      // Si hay red se intenta enviar de inmediato, sin bloquear la navegacion.
      if (estaEnLinea()) void sincronizarPendientes();

      setTimeout(() => navegar(`/beneficiarios/${beneficiarioId}`), 1200);
    } finally {
      setGuardando(false);
    }
  };

  if (!beneficiario) {
    return <p className="vacio">Beneficiario no encontrado en este dispositivo.</p>;
  }

  return (
    <>
      <div className="tarjeta">
        <h1>Capturar apoyo</h1>
        <p className="dato">
          <strong>Beneficiario:</strong> {beneficiario.nombre_completo}
        </p>
        <p className="dato">
          <strong>Folio:</strong> {beneficiario.folio} · <strong>CURP:</strong>{' '}
          {beneficiario.curp || 'Sin CURP'}
        </p>
      </div>

      <div className="tarjeta">
        <CapturaFoto onFoto={setFoto} />
      </div>

      <div className="tarjeta">
        <CapturaGPS onUbicacion={setUbicacion} />
      </div>

      <div className="tarjeta">
        <h2>Paso 3 · Datos de la entrega</h2>

        <div className="campo">
          <label htmlFor="tipo-apoyo">Tipo de apoyo</label>
          <select
            id="tipo-apoyo"
            value={tipoApoyoId}
            onChange={(e) => setTipoApoyoId(e.target.value)}
          >
            <option value="">Sin especificar</option>
            {tiposApoyo.map((t) => (
              <option key={t.clave} value={Number(t.datos?.id)}>
                {t.valor}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="cantidad">Cantidad entregada (opcional)</label>
          <input
            id="cantidad"
            type="number"
            step="0.001"
            min="0"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="observaciones">Observaciones (máx. 500 caracteres)</label>
          <textarea
            id="observaciones"
            rows={3}
            maxLength={500}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </div>

        <div className="acciones">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={!puedeGuardar}
            data-testid="guardar-captura"
          >
            Guardar captura
          </button>
          <button
            type="button"
            className="secundario"
            onClick={() => navegar(`/beneficiarios/${beneficiarioId}`)}
          >
            Cancelar
          </button>
        </div>

        {!puedeGuardar && (
          <p className="dato" style={{ marginTop: 10 }}>
            Necesitas una fotografía y coordenadas válidas para guardar la captura.
          </p>
        )}
      </div>

      {toast && (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      )}
    </>
  );
}
