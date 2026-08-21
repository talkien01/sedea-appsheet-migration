// Detalle de dictamen de una solicitud (SPEC 19.7.3).
//
// NO hay visor de expediente unico: el panel principal es la lista de los
// documentos individuales que ventanilla ya adjunto con E46. Cada archivo se
// abre en una pestana nueva con `?token=` (A19-15): no se incrustan `<img>` ni
// `<iframe>`.
//
// La precarga de los radios copia lo que dijo la IA, pero PRECARGAR NO ES
// CONFIRMAR (D19-8): mientras no se elija un `resultado` explicito y se pulse
// "Confirmar dictamen", no se escribe nada en `dictamenes`.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RespuestaDetalleDictamen, VeredictoDocumento } from '@sedea/shared';
import { api, urlConToken } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

const MIN_NOTA_NEGATIVA = 10;

/** Identificador estable del bloque de un documento en el DOM. */
function claveDocumento(doc: {
  documento_requerido_id: number | null;
  solicitud_documento_id: number;
}): string {
  return doc.documento_requerido_id !== null
    ? String(doc.documento_requerido_id)
    : `sd${doc.solicitud_documento_id}`;
}

/**
 * Precarga del control humano a partir del veredicto de la IA.
 *
 * `falta` se reserva a los documentos SIN archivo adjunto: si ventanilla si
 * adjunto algo y la IA no lo pudo dar por bueno, lo que procede es `ilegible`
 * (el papel existe, no se puede leer), no `falta`. Precargar NO es confirmar:
 * el humano puede contradecir esto sin restriccion.
 */
function veredictoSugerido(
  ia: { presente: boolean; legible: boolean } | null,
  archivoUrl: string | null
): VeredictoDocumento | '' {
  if (!ia) return '';
  if (ia.presente && ia.legible) return 'ok';
  return archivoUrl ? 'ilegible' : 'falta';
}

function chipDetalle(estado: string | null): { texto: string; clase: string } {
  if (estado === 'negativo') return { texto: 'Negativo', clase: 'chip chip-negativo' };
  if (estado === 'positivo') return { texto: 'Positivo', clase: 'chip chip-positivo' };
  if (estado === 'error') return { texto: 'Error', clase: 'chip chip-error' };
  return { texto: 'Sin revisar', clase: 'chip chip-neutro' };
}

export default function DictamenDetalle() {
  const enLinea = useEstadoRed();
  const parametros = useParams<{ id: string }>();
  const solicitudId = Number(parametros.id);

  const [datos, setDatos] = useState<RespuestaDetalleDictamen | null>(null);
  const [enlaces, setEnlaces] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [veredictos, setVeredictos] = useState<Record<string, VeredictoDocumento | ''>>({});
  const [resultado, setResultado] = useState<'' | 'positivo' | 'negativo'>('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [editando, setEditando] = useState(true);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const detalle = await api.dictamenDetalle(solicitudId);
      setDatos(detalle);

      // Precarga de los radios con lo que dijo la IA (o con el dictamen previo).
      const inicial: Record<string, VeredictoDocumento | ''> = {};
      for (const doc of detalle.documentos) {
        const clave = claveDocumento(doc);
        inicial[clave] =
          (doc.humano?.veredicto as VeredictoDocumento) ??
          veredictoSugerido(doc.ia, doc.archivo_url);
      }
      setVeredictos(inicial);

      // Ya dictaminada: el formulario arranca en modo lectura.
      setEditando(detalle.dictamen === null);

      const mapa: Record<string, string> = {};
      for (const doc of detalle.documentos) {
        if (doc.archivo_url) mapa[claveDocumento(doc)] = await urlConToken(doc.archivo_url);
      }
      setEnlaces(mapa);
    } catch {
      setError('No se pudo cargar el detalle del dictamen.');
    }
  }, [solicitudId]);

  useEffect(() => {
    if (!enLinea) return;
    void cargar();
  }, [cargar, enLinea]);

  const confirmar = async () => {
    setErrorFormulario(null);
    if (resultado === '') return;

    // Validacion en cliente: con nota corta NO se llama al backend.
    if (resultado === 'negativo' && nota.trim().length < MIN_NOTA_NEGATIVA) {
      setErrorFormulario(
        `Un dictamen negativo necesita una nota de al menos ${MIN_NOTA_NEGATIVA} caracteres.`
      );
      return;
    }

    setEnviando(true);
    try {
      const detalle = (datos?.documentos ?? [])
        .filter((d) => d.documento_requerido_id !== null)
        .map((d) => ({
          documento_requerido_id: d.documento_requerido_id as number,
          veredicto: (veredictos[claveDocumento(d)] || 'ok') as VeredictoDocumento
        }));

      await api.confirmarDictamen(solicitudId, {
        resultado,
        nota: nota.trim() ? nota.trim() : null,
        detalle
      });
      setMensaje('Dictamen registrado.');
      setEditando(false);
      await cargar();
    } catch {
      setErrorFormulario('No se pudo registrar el dictamen.');
    } finally {
      setEnviando(false);
    }
  };

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;
  if (error) return <p className="mensaje error" role="alert">{error}</p>;
  if (!datos) return <p className="vacio">Cargando...</p>;

  const conArchivo = datos.documentos.filter((d) => d.archivo_url !== null).length;
  const chip = chipDetalle(datos.predictamen?.estado ?? null);

  return (
    <div data-testid="pantalla-dictamen-detalle">
      <div className="tarjeta pantalla-ancha">
        <Link to="/dictamen" className="enlace-volver">
          ← Volver a la bandeja
        </Link>
        <h1>{datos.solicitud.folio}</h1>
        <p className="dato">{datos.solicitud.solicitante}</p>
        <p className="dato">
          CURP capturada:{' '}
          <strong data-testid="texto-curp-capturada">{datos.solicitud.curp ?? 'No capturada'}</strong>
        </p>
        <p>
          <span className={chip.clase} data-testid="chip-predictamen-detalle">
            {chip.texto}
          </span>
        </p>
        {datos.predictamen?.resumen && <p className="dato">{datos.predictamen.resumen}</p>}
        <p className="dato" data-testid="resumen-documentos">
          {conArchivo}/{datos.documentos.length} documentos con archivo
        </p>
      </div>

      <div className="tarjeta pantalla-ancha">
        <h2>Documentos</h2>
        <ul className="lista lista-documentos" data-testid="lista-documentos-dictamen">
          {datos.documentos.map((doc) => {
            const clave = claveDocumento(doc);
            const enlace = enlaces[clave];
            return (
              <li key={clave} className="doc-dictamen" data-testid={`doc-dictamen-${clave}`}>
                <p>
                  <strong>{doc.requisito}</strong>
                </p>

                {doc.archivo_url && enlace ? (
                  <p>
                    <a
                      href={enlace}
                      target="_blank"
                      rel="noopener"
                      data-testid={`enlace-archivo-${clave}`}
                    >
                      {doc.archivo_nombre || 'Ver archivo'}
                    </a>
                  </p>
                ) : (
                  <p className="dato" data-testid={`sin-archivo-${clave}`}>
                    Sin archivo adjunto.
                  </p>
                )}

                {doc.ia ? (
                  <p className="badges-ia">
                    <span
                      className={doc.ia.presente ? 'chip chip-positivo' : 'chip chip-negativo'}
                      data-testid={`ia-presente-${clave}`}
                    >
                      {doc.ia.presente ? 'Presente' : 'Falta'}
                    </span>
                    <span
                      className={doc.ia.legible ? 'chip chip-positivo' : 'chip chip-negativo'}
                      data-testid={`ia-legible-${clave}`}
                    >
                      {doc.ia.legible ? 'Legible' : 'Ilegible'}
                    </span>
                    {doc.ia.curp_coincide !== null && (
                      <span
                        className={doc.ia.curp_coincide ? 'chip chip-positivo' : 'chip chip-negativo'}
                        data-testid={`ia-curp-${clave}`}
                        title={doc.ia.curp_leida ?? ''}
                      >
                        {doc.ia.curp_coincide ? 'CURP coincide' : 'CURP no coincide'}
                      </span>
                    )}
                    {doc.ia.observacion && <span className="dato">{doc.ia.observacion}</span>}
                  </p>
                ) : (
                  <p className="dato" data-testid={`ia-pendiente-${clave}`}>
                    Sin revisar por IA.
                  </p>
                )}

                <fieldset className="veredicto-humano">
                  <legend className="sr-solo">Veredicto de {doc.requisito}</legend>
                  {(['ok', 'falta', 'ilegible'] as VeredictoDocumento[]).map((opcion) => (
                    <label key={opcion} className="opcion-radio">
                      <input
                        type="radio"
                        name={`veredicto-${clave}`}
                        data-testid={`veredicto-${opcion}-${clave}`}
                        value={opcion}
                        disabled={!editando}
                        checked={veredictos[clave] === opcion}
                        onChange={() =>
                          setVeredictos((previos) => ({ ...previos, [clave]: opcion }))
                        }
                      />
                      <span>
                        {opcion === 'ok' ? 'Correcto' : opcion === 'falta' ? 'Falta' : 'Ilegible'}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="tarjeta pantalla-ancha">
        <h2>Veredicto</h2>

        {mensaje && (
          <p className="mensaje exito" data-testid="mensaje-dictamen">
            {mensaje}
          </p>
        )}
        {errorFormulario && (
          <p className="mensaje error" role="alert" data-testid="error-dictamen">
            {errorFormulario}
          </p>
        )}

        <div className="campo">
          <label htmlFor="select-resultado-dictamen">Resultado</label>
          <select
            id="select-resultado-dictamen"
            data-testid="select-resultado-dictamen"
            value={resultado}
            disabled={!editando}
            onChange={(e) => setResultado(e.target.value as '' | 'positivo' | 'negativo')}
          >
            <option value="">Elige el resultado</option>
            <option value="positivo">Positivo</option>
            <option value="negativo">Negativo</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="textarea-nota-dictamen">
            Nota (obligatoria si el dictamen es negativo)
          </label>
          <textarea
            id="textarea-nota-dictamen"
            data-testid="textarea-nota-dictamen"
            rows={3}
            value={nota}
            disabled={!editando}
            onChange={(e) => setNota(e.target.value)}
          />
        </div>

        {editando ? (
          <button
            type="button"
            className="boton"
            data-testid="btn-confirmar-dictamen"
            disabled={resultado === '' || enviando}
            onClick={() => void confirmar()}
          >
            Confirmar dictamen
          </button>
        ) : (
          <button
            type="button"
            className="secundario"
            data-testid="btn-redictaminar"
            onClick={() => {
              setEditando(true);
              setMensaje(null);
              setResultado('');
              setNota('');
            }}
          >
            Re-dictaminar
          </button>
        )}
      </div>
    </div>
  );
}
