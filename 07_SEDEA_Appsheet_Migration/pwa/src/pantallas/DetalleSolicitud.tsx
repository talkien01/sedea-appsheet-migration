// Detalle de una Solicitud de Apoyo (12.8.3). Solo lectura: la solicitud NO se
// edita ni se borra despues de guardada (D44). Lo unico mutable es el checklist
// de documentos: marcar recibido (E45) y adjuntar archivo (E46). Si un dato del
// beneficiario derivado esta mal, se corrige por /correcciones.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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

export default function DetalleSolicitud() {
  const { id } = useParams<{ id: string }>();
  const enLinea = useEstadoRed();
  const [detalle, setDetalle] = useState<DetalleSolicitudApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enlaces, setEnlaces] = useState<Record<number, string>>({});

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

  return (
    <>
      <div className="tarjeta">
        <h1>Solicitud de apoyo</h1>
        <p className="folio-grande" data-testid="detalle-folio">
          {s.folio}
        </p>
        <p className="dato">
          Recibida el {new Date(s.recibida_en).toLocaleString('es-MX')} en {s.ventanilla_nombre} ·
          Componente {s.componente} · Proyecto {s.proyecto}
        </p>
        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}
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
          {detalle.documentos.map((d) => (
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
              <input
                type="file"
                data-testid="input-archivo-documento"
                aria-label={`Adjuntar ${d.requisito}`}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => void adjuntar(d.id, e.target.files?.[0] ?? null)}
              />
              {d.archivo_url && enlaces[d.id] && (
                <a
                  data-testid="enlace-archivo"
                  href={enlaces[d.id]}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.archivo_nombre ?? 'Ver archivo'}
                </a>
              )}
            </li>
          ))}
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
    </>
  );
}
