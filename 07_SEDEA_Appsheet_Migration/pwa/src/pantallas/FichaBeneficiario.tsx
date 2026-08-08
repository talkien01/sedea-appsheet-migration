// Ficha del beneficiario. El mismo componente sirve a dos rutas:
//  - /beneficiarios/:id            -> capturista/admin, datos de IndexedDB (offline-first)
//  - /correcciones/beneficiarios/:id -> editor_datos/admin, datos de la API (solo en linea)
// El panel de edicion aparece unicamente para editor_datos y admin.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Beneficiario, EntradaHistorialCorreccion } from '@sedea/shared';
import { useSesion } from '../App';
import { api } from '../api/cliente';
import { capturasDeBeneficiario, guardarBeneficiarios, obtenerBeneficiario } from '../db/repositorios';
import type { CapturaLocal } from '../db/indexeddb';
import { reintentarCaptura } from '../sync/cola';
import { sincronizarPendientes } from '../sync/motor';
import { useEstadoRed } from '../sync/estadoRed';
import FormEdicionBeneficiario, {
  type MunicipioDisponible
} from '../componentes/FormEdicionBeneficiario';
import { formatearFecha } from './Sync';

const ETIQUETAS: Record<CapturaLocal['estado'], string> = {
  pendiente: 'Pendiente de sincronizar',
  sincronizando: 'Sincronizando…',
  sincronizada: 'Sincronizada',
  error: 'Error al sincronizar'
};

interface Props {
  /** `campo` lee de IndexedDB; `correccion` lee de la API. */
  modo?: 'campo' | 'correccion';
}

export default function FichaBeneficiario({ modo = 'campo' }: Props) {
  const { id } = useParams();
  const beneficiarioId = Number(id);
  const { perfil } = useSesion();
  const enLinea = useEstadoRed();

  const [beneficiario, setBeneficiario] = useState<any | null>(null);
  const [municipios, setMunicipios] = useState<MunicipioDisponible[]>([]);
  const [capturas, setCapturas] = useState<CapturaLocal[]>([]);
  const [historial, setHistorial] = useState<EntradaHistorialCorreccion[]>([]);
  const [editando, setEditando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const puedeEditar = perfil?.rol === 'editor_datos' || perfil?.rol === 'admin';

  const cargar = useCallback(async () => {
    setCargando(true);
    if (modo === 'correccion') {
      try {
        const ficha = await api.correccionesBeneficiario(beneficiarioId);
        setBeneficiario(ficha);
        setMunicipios(ficha.municipios_disponibles ?? []);
      } catch {
        setBeneficiario(null);
      }
    } else {
      setBeneficiario((await obtenerBeneficiario(beneficiarioId)) ?? null);
      setCapturas(await capturasDeBeneficiario(beneficiarioId));
      // El admin tambien puede corregir desde la ficha de campo: necesita el
      // catalogo de municipios para el select.
      if (puedeEditar && enLinea) {
        try {
          const ficha = await api.correccionesBeneficiario(beneficiarioId);
          setMunicipios(ficha.municipios_disponibles ?? []);
        } catch {
          setMunicipios([]);
        }
      }
    }

    if (puedeEditar && enLinea) {
      try {
        setHistorial((await api.correccionesHistorial(beneficiarioId)).data);
      } catch {
        setHistorial([]);
      }
    }
    setCargando(false);
  }, [beneficiarioId, modo, puedeEditar, enLinea]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (modo === 'correccion' && !enLinea) {
    return <p className="vacio">Esta sección requiere conexión a internet.</p>;
  }
  if (cargando) return <p className="vacio">Cargando…</p>;
  if (!beneficiario) {
    return (
      <p className="vacio">
        {modo === 'correccion'
          ? 'El beneficiario ya no existe.'
          : 'Beneficiario no encontrado en este dispositivo.'}
      </p>
    );
  }

  const reintentar = async (uuid: string) => {
    await reintentarCaptura(uuid);
    await sincronizarPendientes();
    await cargar();
  };

  /** Tras guardar, se refresca la ficha y la copia local si existe. */
  const alGuardar = async (actualizado: any) => {
    setEditando(false);
    setExito('Datos actualizados.');
    const local = await obtenerBeneficiario(beneficiarioId);
    if (local) {
      await guardarBeneficiarios([
        {
          ...(local as Beneficiario),
          colonia: actualizado.colonia,
          domicilio: actualizado.domicilio,
          telefono: actualizado.telefono,
          seccion: actualizado.seccion,
          municipio_id: actualizado.municipio_id,
          municipio_nombre: actualizado.municipio,
          regional_id: actualizado.regional_id,
          regional_nombre: actualizado.regional
        } as Beneficiario
      ]);
    }
    await cargar();
  };

  // La ficha de campo usa *_nombre; la de correccion usa regional/municipio.
  const regional = beneficiario.regional_nombre ?? beneficiario.regional ?? 'Sin dato';
  const municipio = beneficiario.municipio_nombre ?? beneficiario.municipio ?? 'Sin dato';

  return (
    <>
      <div className="tarjeta">
        <h1>{beneficiario.nombre_completo}</h1>

        {exito && (
          <div className="mensaje exito" role="status" data-testid="toast-exito">
            {exito}
          </div>
        )}

        <p className="dato"><strong>Folio:</strong> {beneficiario.folio}</p>
        <p className="dato"><strong>CURP:</strong> {beneficiario.curp || 'Sin CURP'}</p>
        <p className="dato"><strong>Dirección Regional:</strong> {regional}</p>
        <p className="dato"><strong>Municipio:</strong> {municipio}</p>
        <p className="dato"><strong>Colonia:</strong> {beneficiario.colonia ?? 'Sin dato'}</p>
        <p className="dato"><strong>Sección:</strong> {beneficiario.seccion ?? 'Sin dato'}</p>
        <p className="dato"><strong>Localidad:</strong> {beneficiario.localidad ?? 'Sin dato'}</p>
        <p className="dato"><strong>Domicilio:</strong> {beneficiario.domicilio ?? 'Sin dato'}</p>
        <p className="dato"><strong>Teléfono:</strong> {beneficiario.telefono ?? 'Sin dato'}</p>
        <p className="dato">
          <strong>Tipo de apoyo:</strong>{' '}
          {beneficiario.tipo_apoyo_nombre ?? 'Sin dato'}
        </p>
        <p className="dato">
          <strong>Cantidad asignada:</strong> {beneficiario.cantidad_asignada ?? 'Sin dato'}
        </p>

        <div className="acciones">
          {modo === 'campo' && (
            <Link className="boton" to={`/beneficiarios/${beneficiario.id}/captura`}>
              Capturar apoyo
            </Link>
          )}
          {/* El capturista nunca ve este boton: no se renderiza en absoluto. */}
          {puedeEditar && !editando && (
            <button
              type="button"
              data-testid="btn-editar-datos"
              onClick={() => {
                setExito(null);
                setEditando(true);
              }}
            >
              Editar datos de contacto/ubicación
            </button>
          )}
          <Link
            className="boton secundario"
            to={modo === 'correccion' ? '/correcciones' : '/beneficiarios'}
          >
            {modo === 'correccion' ? 'Volver al buscador' : 'Volver al padrón'}
          </Link>
        </div>

        {puedeEditar && editando && (
          <FormEdicionBeneficiario
            beneficiario={beneficiario}
            municipios={municipios}
            alGuardar={alGuardar}
            alCancelar={() => setEditando(false)}
          />
        )}
      </div>

      {puedeEditar && (
        <div className="tarjeta" data-testid="historial-correcciones">
          <h2>Historial de correcciones</h2>
          {historial.length === 0 && <p className="vacio">Sin correcciones registradas.</p>}
          {historial.map((entrada, indice) => (
            <div key={`${entrada.fecha}-${indice}`} className="dato">
              <p className="dato">
                <strong>{formatearFecha(entrada.fecha)}</strong> — {entrada.usuario ?? 'Sistema'}
                {entrada.motivo ? ` · ${entrada.motivo}` : ''}
              </p>
              <ul>
                {entrada.cambios.map((cambio, i) => (
                  <li key={i}>
                    {cambio.campo}: {String(cambio.anterior ?? '—')} →{' '}
                    {String(cambio.nuevo ?? '—')}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {modo === 'campo' && (
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
      )}
    </>
  );
}
