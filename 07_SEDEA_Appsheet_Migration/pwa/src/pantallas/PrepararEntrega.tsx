// Preparar evento de entrega (Parte 1): descarga CON SEÑAL el paquete de
// conceptos por entregar y lo deja en IndexedDB.
//
// Deliberadamente minima: la experiencia de campo (camara, GPS, QR) es la
// Parte 2. Aqui solo se elige el concepto (+ Regional opcional) y se baja el
// paquete, igual que /sync baja el padron antes de salir a campo.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, ErrorPeticion } from '../api/cliente';
import {
  catalogosPorGrupo,
  contarConceptosEntrega,
  eventoEntregaLocal,
  guardarPaqueteEntrega,
  limpiarPaqueteEntrega
} from '../db/repositorios';
import type { EntradaCatalogoLocal, EventoEntregaLocal } from '../db/indexeddb';
import { useEstadoRed } from '../sync/estadoRed';
import { formatearFecha } from './Sync';

export default function PrepararEntrega() {
  const enLinea = useEstadoRed();

  const [tiposApoyo, setTiposApoyo] = useState<EntradaCatalogoLocal[]>([]);
  const [regionales, setRegionales] = useState<EntradaCatalogoLocal[]>([]);
  const [tipoApoyoId, setTipoApoyoId] = useState('');
  const [regionalId, setRegionalId] = useState('');

  const [evento, setEvento] = useState<EventoEntregaLocal | null>(null);
  const [enDispositivo, setEnDispositivo] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // QR que abre "Entregar apoyos" directo en el celular de quien va a campo,
  // sin pasar por el menu. Es solo un atajo de navegacion: el celular tiene
  // que bajar SU PROPIO paquete en /entregas/preparar (con senal) antes de
  // poder trabajar sin ella; el QR no transfiere el paquete de este equipo.
  const [imagenQrEntregas, setImagenQrEntregas] = useState<string | null>(null);
  const urlEntregas = `${window.location.origin}/entregas/registrar`;
  useEffect(() => {
    let vivo = true;
    void QRCode.toDataURL(urlEntregas, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(
      (imagen) => {
        if (vivo) setImagenQrEntregas(imagen);
      }
    );
    return () => {
      vivo = false;
    };
  }, [urlEntregas]);

  const refrescar = useCallback(async () => {
    setEvento((await eventoEntregaLocal()) ?? null);
    setEnDispositivo(await contarConceptosEntrega());
  }, []);

  useEffect(() => {
    void (async () => {
      setTiposApoyo(await catalogosPorGrupo('tipo_apoyo'));
      setRegionales(await catalogosPorGrupo('regional'));
      await refrescar();
    })();
  }, [refrescar]);

  const descargar = async () => {
    if (!tipoApoyoId) return;
    setError(null);
    setMensaje(null);
    setTrabajando(true);
    try {
      const paquete = await api.prepararEventoEntrega(
        Number(tipoApoyoId),
        regionalId ? Number(regionalId) : null
      );
      await guardarPaqueteEntrega(paquete);
      await refrescar();
      setMensaje(
        `Paquete descargado: ${paquete.total} concepto(s) por entregar de ${paquete.filtro.tipo_apoyo_nombre}.`
      );
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion
          ? `No se pudo preparar el evento: ${fallo.message}`
          : 'No se pudo preparar el evento.'
      );
    } finally {
      setTrabajando(false);
    }
  };

  const borrar = async () => {
    await limpiarPaqueteEntrega();
    await refrescar();
    setMensaje('Paquete local borrado.');
  };

  return (
    <>
      <div className="tarjeta">
        <h1>Preparar evento de entrega</h1>
        <p className="dato">
          Descarga los conceptos autorizados que faltan por entregar para poder
          trabajar sin señal. Solo entran las solicitudes con la autorización del
          Secretario capturada y sin entrega previa de ese concepto.
        </p>

        {error && (
          <div className="mensaje error" role="alert" data-testid="entrega-error">
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mensaje info" role="status" data-testid="entrega-mensaje">
            {mensaje}
          </div>
        )}
        {!enLinea && (
          <div className="mensaje aviso" role="status">
            Sin conexión: el paquete se prepara con señal, antes de salir a campo.
          </div>
        )}

        <div className="campo">
          <label htmlFor="entrega-tipo-apoyo">Concepto a entregar</label>
          <select
            id="entrega-tipo-apoyo"
            data-testid="entrega-tipo-apoyo"
            value={tipoApoyoId}
            onChange={(e) => setTipoApoyoId(e.target.value)}
          >
            <option value="">Selecciona un concepto…</option>
            {tiposApoyo.map((t) => (
              <option key={t.clave} value={Number(t.datos?.id)}>
                {t.valor}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="entrega-regional">Dirección Regional (opcional)</label>
          <select
            id="entrega-regional"
            data-testid="entrega-regional"
            value={regionalId}
            onChange={(e) => setRegionalId(e.target.value)}
          >
            <option value="">Todas las que me correspondan</option>
            {regionales.map((r) => (
              <option key={r.clave} value={Number(r.datos?.id)}>
                {r.valor}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          data-testid="entrega-descargar"
          onClick={() => void descargar()}
          disabled={!enLinea || trabajando || !tipoApoyoId}
        >
          {trabajando ? 'Descargando…' : 'Descargar paquete del evento'}
        </button>
      </div>

      <div className="tarjeta">
        <h2>Paquete en el dispositivo</h2>
        <p className="dato" data-testid="entrega-total-local">
          <strong>Conceptos por entregar guardados:</strong> {enDispositivo}
        </p>
        <p className="dato" data-testid="entrega-concepto-local">
          <strong>Concepto:</strong> {evento?.tipo_apoyo_nombre ?? 'Ninguno'}
        </p>
        <p className="dato" data-testid="entrega-regional-local">
          <strong>Regional:</strong> {evento?.regional_nombre ?? 'Todas'}
        </p>
        <p className="dato" data-testid="entrega-descargado-en">
          <strong>Descargado:</strong> {formatearFecha(evento?.descargado_en ?? null)}
        </p>
        {enDispositivo > 0 && (
          <div className="acciones">
            <button type="button" className="secundario" onClick={() => void borrar()}>
              Borrar paquete local
            </button>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <h2>Abrir en el celular</h2>
        <p className="dato">
          Escanea este código con el celular de quien va a entregar el apoyo:
          abre "Entregar apoyos" directo, sin buscarlo en el menú. Si el
          celular no tiene sesión iniciada, después de entrar cae ahí mismo.
        </p>
        {imagenQrEntregas && (
          <img
            src={imagenQrEntregas}
            alt="Código QR para abrir Entregar apoyos en el celular"
            data-testid="qr-entregas-directo"
            style={{ display: 'block', margin: '0 auto', width: 220, height: 220 }}
          />
        )}
        <p className="dato" style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>
          Si la cámara no lo lee, abre esta dirección en el celular:{' '}
          <code data-testid="url-entregas-directo">{urlEntregas}</code>
        </p>
        <p className="dato" style={{ fontSize: '0.85em' }}>
          Nota: el QR solo abre la pantalla. El celular debe descargar su
          propio paquete aquí mismo, en "Preparar evento de entrega", con
          señal, antes de poder trabajar sin conexión.
        </p>
      </div>
    </>
  );
}
