// Detalle de una Solicitud de Apoyo (12.8.3). Solo lectura: la solicitud NO se
// edita ni se borra despues de guardada (D44). Lo unico mutable es el checklist
// de documentos: marcar recibido (E45) y adjuntar archivo (E46). Si un dato del
// beneficiario derivado esta mal, se corrige por /correcciones.
//
// Build 7 (§13.4.1):
//   B7-A  Visor inline PDF/imagen encima del enlace de descarga.
//   B7-C  Banner "Solicitud registrada" cuando ?nuevo=1 en la URL.
//   B7-D  Zona de drag & drop encima del input file de cada documento.
//   B7-E  Carátula imprimible (solo visible en @media print).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DECLARACIONES_ENCABEZADO,
  DECLARACIONES_INCISOS,
  ETIQUETAS_TIPO_PERSONA,
  type DetalleSolicitudApi,
  type TipoPersona
} from '@sedea/shared';
import { apiSolicitudes } from '../api/solicitudes';
import { ErrorPeticion, urlConToken } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

// ------------------------------------------------------------------
// Utilidad: devuelve la extensión en minúsculas de un nombre de archivo,
// o cadena vacía si no tiene extensión o el nombre es nulo.
// ------------------------------------------------------------------
function extDeNombre(nombre: string | null | undefined): string {
  if (!nombre) return '';
  const partes = nombre.split('.');
  return partes.length > 1 ? (partes[partes.length - 1]?.toLowerCase() ?? '') : '';
}

export default function DetalleSolicitud() {
  const { id } = useParams<{ id: string }>();
  const enLinea = useEstadoRed();
  const [detalle, setDetalle] = useState<DetalleSolicitudApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enlaces, setEnlaces] = useState<Record<number, string>>({});

  // B7-C: banner "Solicitud registrada"
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const [verBanner, setVerBanner] = useState(false);
  const timerBannerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al montar: si llega ?nuevo=1, activar banner y limpiar el param de la URL.
  useEffect(() => {
    if (searchParams.get('nuevo') === '1') {
      setVerBanner(true);
      // Reemplazar la entrada del historial sin el param para que el banner
      // no reaparezca al recargar ni al volver con "atrás".
      navegar(pathname, { replace: true });
      // Auto-desmontar el banner a los 10 s.
      timerBannerRef.current = setTimeout(() => setVerBanner(false), 10000);
    }
    return () => {
      if (timerBannerRef.current) clearTimeout(timerBannerRef.current);
    };
    // Solo se ejecuta una vez al montar (los params se leen de la URL inicial).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ocultarBanner = () => {
    setVerBanner(false);
    if (timerBannerRef.current) {
      clearTimeout(timerBannerRef.current);
      timerBannerRef.current = null;
    }
  };

  const cargar = useCallback(async () => {
    if (!id) return;
    try {
      const datos = await apiSolicitudes.detalle(Number(id));
      setDetalle(datos);
      // Los adjuntos se sirven por /media/* con token (E15).
      const mapa: Record<number, string> = {};
      for (const doc of datos.documentos) {
        if (doc.archivo_url) mapa[doc.id] = await urlConToken(doc.archivo_url);
      }
      setEnlaces(mapa);
    } catch (fallo) {
      setError(fallo instanceof ErrorPeticion ? fallo.message : 'No se pudo cargar la solicitud.');
    }
  }, [id]);

  useEffect(() => {
    if (!enLinea) return;
    void cargar();
  }, [cargar, enLinea]);

  const marcar = async (docId: number, recibido: boolean) => {
    if (!id) return;
    try {
      await apiSolicitudes.actualizarDocumento(Number(id), docId, { recibido });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorPeticion ? fallo.message : 'No se pudo actualizar.');
    }
  };

  const adjuntar = async (docId: number, archivo: File | null) => {
    if (!id || !archivo) return;
    try {
      await apiSolicitudes.subirArchivo(Number(id), docId, archivo);
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorPeticion ? fallo.message : 'No se pudo subir el archivo.');
    }
  };

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;
  if (error && !detalle) {
    return (
      <div className="tarjeta">
        <div className="mensaje error" role="alert">
          {error}
        </div>
        <Link to="/solicitudes">Volver a solicitudes</Link>
      </div>
    );
  }
  if (!detalle) return <p className="vacio">Cargando…</p>;

  const s = detalle.solicitud as Record<string, any>;

  // B7-E: nombre o razón social para la carátula según tipo de persona.
  const nombreCaratula: string =
    (s.tipo_persona === 'moral' || s.tipo_persona === 'grupo') && s.razon_social
      ? (s.razon_social as string)
      : (s.nombre_solicitante as string);

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Estilos para zona de drop (B7-D) y carátula imprimible (B7-E).      */}
      {/* El bloque @media print oculta todo el layout excepto .caratula.     */}
      {/* ------------------------------------------------------------------ */}
      <style>{`
        .zona-drop {
          border: 2px dashed var(--gris-borde, #d7dce3);
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 6px;
          color: var(--gris-medio, #5b6472);
          font-size: 0.875rem;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .zona-drop--activa {
          border-color: var(--verde, #0b6b3a);
          background: var(--verde-suave, #e6f2ea);
        }
        .banner-nuevo {
          background: var(--verde-suave, #e6f2ea);
          border: 1px solid var(--verde, #0b6b3a);
          color: var(--gris-texto, #1f2430);
          border-radius: 6px;
          padding: 10px 16px;
          margin-bottom: 12px;
          cursor: pointer;
          font-size: 0.95rem;
        }
        [data-testid="caratula-imprimible"] {
          display: none;
        }
        @media print {
          .tarjeta,
          .modal-fondo,
          nav,
          header,
          .barra-superior,
          .vacio {
            display: none !important;
          }
          [data-testid="caratula-imprimible"] {
            display: block !important;
            font-family: sans-serif;
            color: #000;
          }
          .caratula h1 { font-size: 1.2rem; margin-bottom: 4px; }
          .caratula .caratula-campo { margin-bottom: 8px; }
          .caratula table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
          .caratula th, .caratula td { border: 1px solid #000; padding: 4px 6px; font-size: 0.85rem; }
          .caratula ul { list-style: none; padding: 0; }
          .caratula li { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 0.85rem; }
        }
      `}</style>

      {/* B7-C: banner de confirmación post-guardado */}
      {verBanner && detalle && (
        <div
          data-testid="banner-nuevo"
          role="status"
          className="banner-nuevo"
          onClick={ocultarBanner}
        >
          Solicitud {s.folio} registrada. Adjunta los documentos requeridos.
        </div>
      )}

      <div className="tarjeta">
        <h1>Solicitud de apoyo</h1>
        <p className="folio-grande" data-testid="detalle-folio">
          {s.folio}
        </p>
        <p className="dato">
          Recibida el {new Date(s.recibida_en).toLocaleString('es-MX')} en {s.ventanilla_nombre} ·
          Componente {s.componente} · Proyecto {s.proyecto}
          {s.modalidad && (
            <>
              {' '}· Modalidad <span data-testid="dato-modalidad">{s.modalidad_nombre}</span>
            </>
          )}
        </p>
        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
        {/* B7-E: botón para imprimir la carátula del expediente */}
        <button
          type="button"
          data-testid="btn-imprimir-caratula"
          onClick={() => window.print()}
        >
          Imprimir carátula
        </button>
        <Link to="/solicitudes">Volver a solicitudes</Link>
      </div>

      <div className="tarjeta">
        <h2>Solicitante</h2>
        <p>
          <strong>{s.nombre_solicitante}</strong> ·{' '}
          {ETIQUETAS_TIPO_PERSONA[s.tipo_persona as TipoPersona]}
        </p>
        {s.razon_social && (
          <p className="dato">
            Razón social: {s.razon_social} · Integrantes: {s.num_integrantes ?? '—'}
          </p>
        )}
        <p className="dato">
          CURP: {s.curp ?? '—'} · Teléfono: {s.telefono ?? '—'} · Correo: {s.correo ?? '—'}
        </p>
        <h3>Domicilio particular</h3>
        <p className="dato">
          {s.dom_municipio ?? '—'} · {s.dom_localidad ?? '—'} · {s.dom_asentamiento ?? '—'} ·{' '}
          {s.dom_vialidad ?? '—'} · CP {s.dom_cp ?? '—'}
        </p>
      </div>

      <div className="tarjeta">
        <h2>Actividad económica</h2>
        <p className="dato">
          {[
            s.act_agricola ? 'Agrícola' : null,
            s.act_ganadera ? 'Ganadera' : null,
            s.act_acuicola ? 'Acuícola' : null,
            s.act_pesca ? 'Pesca' : null
          ]
            .filter(Boolean)
            .join(' · ') || 'Sin actividades declaradas'}
        </p>
      </div>

      <div className="tarjeta">
        <h2>Datos del apoyo</h2>
        <p>{s.descripcion_proyecto ?? '—'}</p>
        <p className="dato">
          Beneficiarios directos — Hombres: {s.ben_hombres_total} · Mujeres: {s.ben_mujeres_total}
        </p>
        <h3>Ubicación del apoyo</h3>
        <p className="dato">
          {s.ubi_municipio ?? '—'} · {s.ubi_localidad ?? '—'} · Ejido {s.ubi_ejido ?? '—'} ·
          Coordenadas declaradas: {s.ubi_coordenadas ?? '—'}
        </p>
      </div>

      <div className="tarjeta">
        <h2>Conceptos solicitados</h2>
        <div className="tabla-contenedor">
          <table data-testid="tabla-conceptos-detalle">
            <thead>
              <tr>
                <th>#</th>
                <th>Concepto</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Estatal</th>
                <th>Productor</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {detalle.conceptos.map((c) => (
                <tr key={c.id}>
                  <td>{c.orden}</td>
                  <td>{c.tipo_apoyo ?? '—'}</td>
                  <td>{c.cantidad}</td>
                  <td>{c.unidad_medida ?? '—'}</td>
                  <td>{c.monto_estatal}</td>
                  <td>{c.monto_productor}</td>
                  <td>{c.monto_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Beneficiarios creados</h2>
        <p className="dato">
          Se creó un beneficiario por concepto, con la ubicación del apoyo. Para corregir sus datos
          usa la sección de Correcciones.
        </p>
        <div className="tabla-contenedor">
          <table data-testid="tabla-beneficiarios-creados">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Concepto</th>
                <th>Municipio</th>
              </tr>
            </thead>
            <tbody>
              {detalle.beneficiarios.map((b) => (
                <tr key={b.id}>
                  <td>{b.folio}</td>
                  <td>{b.tipo_apoyo ?? '—'}</td>
                  <td>{b.municipio ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta">
        <h2>Documentos</h2>
        <ul data-testid="lista-documentos" className="lista-documentos">
          {detalle.documentos.map((d) => {
            const urlArchivo = d.archivo_url ? enlaces[d.id] : undefined;
            const ext = extDeNombre(d.archivo_nombre);
            const esPdf = ext === 'pdf';
            const esImagen = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

            return (
              <li key={d.id} data-testid="item-documento">
                <label className="casilla">
                  <input
                    type="checkbox"
                    data-testid="chk-documento-recibido"
                    checked={d.recibido}
                    onChange={(e) => void marcar(d.id, e.target.checked)}
                  />
                  {d.requisito}
                </label>

                {/* B7-D: zona de drag & drop encima del input file */}
                <div
                  data-testid="zona-drop-documento"
                  className="zona-drop"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('zona-drop--activa');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('zona-drop--activa');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('zona-drop--activa');
                    void adjuntar(d.id, e.dataTransfer.files[0] ?? null);
                  }}
                >
                  Arrastra aquí el archivo
                </div>

                <input
                  type="file"
                  data-testid="input-archivo-documento"
                  aria-label={`Adjuntar ${d.requisito}`}
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => void adjuntar(d.id, e.target.files?.[0] ?? null)}
                />

                {/* B7-A: visor inline — PDF con iframe, imagen con img */}
                {urlArchivo && esPdf && (
                  <iframe
                    data-testid="visor-pdf-documento"
                    src={urlArchivo}
                    title="Documento adjunto"
                    width="100%"
                    height="400px"
                    style={{ border: 'none', display: 'block', marginTop: '8px' }}
                  />
                )}
                {urlArchivo && esImagen && (
                  <img
                    data-testid="visor-imagen-documento"
                    src={urlArchivo}
                    alt="Documento adjunto"
                    style={{ maxWidth: '100%', display: 'block', marginTop: '8px' }}
                  />
                )}

                {/* Enlace de descarga: siempre presente cuando hay archivo (D49) */}
                {d.archivo_url && urlArchivo && (
                  <a
                    data-testid="enlace-archivo"
                    href={urlArchivo}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.archivo_nombre ?? 'Ver archivo'}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="tarjeta">
        <h2>Declaraciones aceptadas ({s.declaracion_version})</h2>
        <div className="declaraciones">
          <p>
            <strong>{DECLARACIONES_ENCABEZADO}</strong>
          </p>
          {DECLARACIONES_INCISOS.map((d) => (
            <p key={d.inciso}>
              <strong>{d.inciso}</strong> {d.texto}
            </p>
          ))}
        </div>
      </div>

      {/* B7-E: carátula imprimible — siempre en el DOM, oculta en pantalla,
               visible solo en @media print (ver bloque <style> arriba). */}
      <div data-testid="caratula-imprimible" className="caratula">
        <h1>Carátula de expediente</h1>

        <div className="caratula-campo">
          <strong>Folio:</strong>{' '}
          <span data-testid="caratula-folio">{s.folio}</span>
        </div>

        <div className="caratula-campo">
          <strong>Solicitante:</strong>{' '}
          <span data-testid="caratula-solicitante">{nombreCaratula}</span>
        </div>

        <div className="caratula-campo">
          <strong>Municipio de ubicación del apoyo:</strong>{' '}
          <span data-testid="caratula-municipio">{s.ubi_municipio ?? '—'}</span>
        </div>

        <div className="caratula-campo">
          <strong>Proyecto:</strong>{' '}
          <span data-testid="caratula-programa">{s.proyecto ?? s.componente ?? '—'}</span>
        </div>

        <div className="caratula-campo">
          <strong>Fecha de recepción:</strong>{' '}
          <span data-testid="caratula-fecha">
            {new Date(s.recibida_en).toLocaleDateString('es-MX')}
          </span>
        </div>

        <h2>Conceptos solicitados</h2>
        <table data-testid="caratula-conceptos">
          <thead>
            <tr>
              <th>#</th>
              <th>Concepto</th>
              <th>Cant.</th>
              <th>Unidad</th>
              <th>Monto estatal</th>
              <th>Monto productor</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {detalle.conceptos.map((c) => (
              <tr key={c.id} data-testid="caratula-fila-concepto">
                <td>{c.orden}</td>
                <td>{c.tipo_apoyo ?? '—'}</td>
                <td>{c.cantidad}</td>
                <td>{c.unidad_medida ?? '—'}</td>
                <td>{c.monto_estatal}</td>
                <td>{c.monto_productor}</td>
                <td>{c.monto_total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Documentos requeridos</h2>
        <ul data-testid="caratula-lista-documentos">
          {detalle.documentos.map((d) => (
            <li key={d.id} data-testid="caratula-item-documento">
              {/* Casilla vacía para marcar manualmente en papel */}
              <input type="checkbox" disabled />
              {d.requisito}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
