// Detalle de una fila de staging: comparacion lado a lado con sus candidatas
// y las tres acciones de revision (aprobar, descartar, fusionar).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ETIQUETAS_ESTADO, FLAGS_BENEFICIARIO } from '@sedea/shared';
import { api, ErrorPeticion, type DetalleStaging } from '../api/cliente';
import { BadgesDeFila } from '../componentes/BadgeAlerta';
import ComparadorDuplicados, { type Candidata } from '../componentes/ComparadorDuplicados';
import { useEstadoRed } from '../sync/estadoRed';

/** Campos de la fila que se muestran en el panel superior. */
const CAMPOS: Array<[string, string]> = [
  ['folio', 'Folio'],
  ['curp', 'CURP'],
  ['nombre_completo', 'Nombre'],
  ['regional_nombre', 'Dirección Regional'],
  ['municipio_nombre', 'Municipio'],
  ['colonia', 'Colonia'],
  ['seccion', 'Sección'],
  ['localidad', 'Localidad'],
  ['domicilio', 'Domicilio'],
  ['telefono', 'Teléfono'],
  ['tipo_apoyo_nombre', 'Concepto de apoyo'],
  ['cantidad_asignada', 'Cantidad asignada'],
  ['lat_proyecto', 'Latitud del proyecto'],
  ['lng_proyecto', 'Longitud del proyecto'],
  ['archivo', 'Archivo de origen'],
  ['fila_origen', 'Fila en el archivo']
];

export default function DepuracionDetalle() {
  const { id } = useParams();
  const filaId = Number(id);
  const enLinea = useEstadoRed();

  const [detalle, setDetalle] = useState<DetalleStaging | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<number[]>([]);
  const [motivo, setMotivo] = useState('');
  const [promoverAlFusionar, setPromoverAlFusionar] = useState(false);
  const [verExtra, setVerExtra] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDetalle(await api.stagingBeneficiario(filaId));
      setError(null);
    } catch {
      setError('No se pudieron cargar los datos.');
    } finally {
      setCargando(false);
    }
  }, [filaId]);

  useEffect(() => {
    if (enLinea) void cargar();
  }, [cargar, enLinea]);

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;
  if (cargando) return <p className="vacio">Cargando…</p>;
  if (error || !detalle) return <p className="vacio">{error ?? 'Fila no encontrada.'}</p>;

  const fila = detalle.fila as unknown as Record<string, unknown>;
  const candidatas: Candidata[] = [
    ...detalle.relacionadas.staging.map((c) => ({ ...c, origen: 'staging' as const })),
    ...detalle.relacionadas.produccion.map((c) => ({ ...c, origen: 'produccion' as const }))
  ];
  const hayConceptoDistinto = candidatas.some(
    (c) => c.motivo_relacion === 'curp_concepto_distinto'
  );
  const pendiente = fila.estado_revision === 'pendiente';

  /** Traduce los errores del backend a mensajes en espanol. */
  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setError(null);
    setAviso(null);
    try {
      await accion();
      setAviso(exito);
      setSeleccionadas([]);
      await cargar();
    } catch (fallo) {
      if (fallo instanceof ErrorPeticion && fallo.estado === 409) {
        setError('Esta fila ya fue revisada.');
      } else if (fallo instanceof ErrorPeticion) {
        setError(fallo.message);
      } else {
        setError('No se pudo completar la acción.');
      }
      await cargar();
    }
  };

  const aprobar = async () => {
    if (!window.confirm('¿Aprobar esta fila y promoverla al padrón de producción?')) return;
    await ejecutar(
      () => api.stagingAprobar(filaId, motivo),
      'Fila aprobada y promovida a producción.'
    );
  };

  const descartar = async () => {
    if (!window.confirm('¿Descartar esta fila? No se escribirá en producción.')) return;
    await ejecutar(() => api.stagingDescartar(filaId, motivo), 'Fila descartada.');
  };

  const fusionar = async () => {
    if (seleccionadas.length === 0) return;
    if (!window.confirm(`¿Fusionar ${seleccionadas.length} fila(s) en esta como principal?`)) return;
    await ejecutar(
      () =>
        api.stagingFusionar({
          principal_id: filaId,
          secundarios_ids: seleccionadas,
          promover: promoverAlFusionar,
          motivo: motivo || null
        }),
      'Filas fusionadas.'
    );
  };

  const datosExtra = (fila.datos_extra ?? {}) as Record<string, unknown>;

  return (
    <>
      <div className="tarjeta">
        <h1>Revisión de fila de staging #{detalle.fila.id}</h1>
        <p className="dato">
          <strong>Estado:</strong>{' '}
          <span data-testid="estado-revision">
            {ETIQUETAS_ESTADO[detalle.fila.estado_revision]}
          </span>
        </p>
        <p className="dato">
          <BadgesDeFila fila={fila} flags={FLAGS_BENEFICIARIO} />
        </p>

        {aviso && (
          <div className="mensaje exito" role="status" data-testid="toast-exito">
            {aviso}
          </div>
        )}
        {error && (
          <div className="mensaje error" role="alert" data-testid="error-accion">
            {error}
          </div>
        )}

        {hayConceptoDistinto && (
          <div className="mensaje aviso" role="status">
            Un beneficiario puede recibir apoyos distintos. Confirma antes de descartar.
          </div>
        )}

        <dl className="campos-candidato">
          {CAMPOS.map(([clave, etiqueta]) => (
            <div key={clave}>
              <dt>{etiqueta}</dt>
              <dd>{fila[clave] === null || fila[clave] === undefined || fila[clave] === '' ? '—' : String(fila[clave])}</dd>
            </div>
          ))}
        </dl>

        <button type="button" className="secundario" onClick={() => setVerExtra(!verExtra)}>
          {verExtra ? 'Ocultar' : 'Ver'} columnas no mapeadas ({Object.keys(datosExtra).length})
        </button>
        {verExtra && (
          <div className="tabla-contenedor">
            <table>
              <thead>
                <tr>
                  <th>Columna del archivo</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(datosExtra).map(([clave, valor]) => (
                  <tr key={clave}>
                    <td>{clave}</td>
                    <td>{String(valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="campo">
          <label htmlFor="motivo-revision">Motivo de la revisión (opcional)</label>
          <input
            id="motivo-revision"
            data-testid="input-motivo-revision"
            type="text"
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        <div className="acciones">
          <button type="button" data-testid="btn-aprobar" disabled={!pendiente} onClick={() => void aprobar()}>
            Aprobar y promover a producción
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-descartar"
            disabled={!pendiente}
            onClick={() => void descartar()}
          >
            Descartar
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-fusionar"
            disabled={!pendiente || seleccionadas.length === 0}
            onClick={() => void fusionar()}
          >
            Fusionar seleccionadas
          </button>
          <label className="campo-inline">
            <input
              type="checkbox"
              data-testid="chk-promover-al-fusionar"
              checked={promoverAlFusionar}
              onChange={(e) => setPromoverAlFusionar(e.target.checked)}
            />
            Promover a producción tras fusionar
          </label>
          <Link className="boton secundario" to="/depuracion">
            Volver a la lista
          </Link>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Comparación con filas relacionadas ({candidatas.length})</h2>
        {candidatas.length === 0 && (
          <p className="vacio">Sin filas relacionadas por folio ni por CURP.</p>
        )}
        {candidatas.length > 0 && (
          <ComparadorDuplicados
            fila={fila}
            candidatas={candidatas}
            seleccionadas={seleccionadas}
            alAlternar={(idCandidata) =>
              setSeleccionadas((previas) =>
                previas.includes(idCandidata)
                  ? previas.filter((x) => x !== idCandidata)
                  : [...previas, idCandidata]
              )
            }
          />
        )}
      </div>
    </>
  );
}
