// Vista previa e impresión de Folio de Entrega con QR (Build 12).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiSolicitudes } from '../api/solicitudes';
import { ETIQUETAS_NOMBRE_SOLICITANTE, type TipoPersona } from '@sedea/shared';

interface DatosFolio {
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  programa_nombre: string;
  proyecto_nombre: string;
  concepto_nombre: string;
  monto: number;
  regional_nombre: string;
  /** Solo para persona moral / grupo; null en persona fisica. */
  representante_etiqueta: string | null;
  representante_nombre: string | null;
}

/**
 * Forma real de `detalle.solicitud` (que el API tipa como Record<string, unknown>):
 * son las columnas de `solicitudes` mas los nombres resueltos por los JOIN de
 * obtenerSolicitud(). Los nombres deben coincidir con esa consulta — leer campos
 * inventados (p. ej. `beneficiario_nombre`) devuelve undefined y el folio sale en
 * blanco sin fallar.
 */
interface SolicitudFolio {
  folio: string;
  tipo_persona: string;
  nombre_solicitante: string;
  razon_social: string | null;
  curp: string | null;
  programa_nombre: string | null;
  proyecto_nombre: string | null;
  regional_nombre: string | null;
}

/** En BD varios de estos campos son cadena vacia, no NULL: ambos van a raya. */
function texto(valor: string | null | undefined): string {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? '—' : limpio;
}

export default function FolioEntrega() {
  const { id } = useParams<{ id: string }>();
  const [datos, setDatos] = useState<DatosFolio | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // Obtener datos de la solicitud
    apiSolicitudes.detalle(Number(id))
      .then(detalle => {
        const s = detalle.solicitud as unknown as SolicitudFolio;
        // Mismo criterio que la caratula de expediente: para persona moral o
        // grupo manda la razon social.
        const esMoralOGrupo = s.tipo_persona === 'moral' || s.tipo_persona === 'grupo';
        const nombre =
          esMoralOGrupo && s.razon_social ? s.razon_social : s.nombre_solicitante;
        // Para moral/grupo `nombre_solicitante` ES el representante (asi lo
        // etiqueta la captura); solo tiene sentido mostrarlo aparte cuando el
        // renglon "Nombre" ya lo ocupa la razon social. En persona fisica seria
        // una linea repetida, por eso queda en null.
        const mostrarRepresentante =
          esMoralOGrupo && !!s.razon_social && !!(s.nombre_solicitante ?? '').trim();
        // El apoyo se entrega por su valor total (estatal + productor).
        const concepto = detalle.conceptos[0];
        setDatos({
          folio: s.folio,
          beneficiario_nombre: texto(nombre),
          beneficiario_curp: texto(s.curp),
          programa_nombre: texto(s.programa_nombre),
          proyecto_nombre: texto(s.proyecto_nombre),
          concepto_nombre: texto(concepto?.tipo_apoyo),
          monto: concepto?.monto_total ?? 0,
          regional_nombre: texto(s.regional_nombre),
          representante_etiqueta: mostrarRepresentante
            ? ETIQUETAS_NOMBRE_SOLICITANTE[s.tipo_persona as TipoPersona]
            : null,
          representante_nombre: mostrarRepresentante ? s.nombre_solicitante : null
        });
        // Generar QR con el folio
        return import('qrcode').then(QRCode =>
          QRCode.default.toDataURL(s.folio, { width: 200 })
        );
      })
      .then(setQrDataUrl)
      .catch(() => setError('No se pudieron cargar los datos.'))
      .finally(() => setCargando(false));
  }, [id]);

  const imprimir = () => {
    window.print();
  };

  if (cargando) return <p className="vacio">Cargando folio...</p>;
  if (error) return <div className="mensaje error">{error}</div>;
  if (!datos) return null;

  return (
    <div className="tarjeta">
      <div className="folio-entrega-print" data-testid="folio-entrega">
        <div className="folio-header">
          <h1>SEDEA</h1>
          <p>Secretaría de Desarrollo Agropecuario</p>
          <h2>FOLIO DE ENTREGA DE APOYO</h2>
        </div>

        <div className="folio-folio">
          <strong>Folio:</strong> {datos.folio}
        </div>

        <div className="folio-seccion">
          <h3>DATOS DEL BENEFICIARIO</h3>
          <p><strong>Nombre:</strong> <span data-testid="folio-nombre">{datos.beneficiario_nombre}</span></p>
          {datos.representante_nombre && (
            <p>
              <strong>{datos.representante_etiqueta}:</strong>{' '}
              <span data-testid="folio-representante">{datos.representante_nombre}</span>
            </p>
          )}
          <p><strong>CURP:</strong> <span data-testid="folio-curp">{datos.beneficiario_curp}</span></p>
          <p><strong>Regional:</strong> <span data-testid="folio-regional">{datos.regional_nombre}</span></p>
        </div>

        <div className="folio-seccion">
          <h3>DATOS DEL APOYO</h3>
          <p><strong>Programa:</strong> {datos.programa_nombre}</p>
          <p><strong>Proyecto:</strong> {datos.proyecto_nombre}</p>
          <p><strong>Concepto:</strong> {datos.concepto_nombre}</p>
          <p><strong>Monto:</strong> <span data-testid="folio-monto">${datos.monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN</span></p>
        </div>

        <div className="folio-qr">
          {qrDataUrl && <img src={qrDataUrl} alt="QR con folio" className="qr-image" />}
          <p>Escanee este código QR para verificar la entrega del apoyo</p>
        </div>

        <div className="folio-footer">
          <p>Este documento debe presentarse al momento de recibir el apoyo</p>
        </div>
      </div>

      <div className="folio-acciones no-print">
        <button onClick={imprimir} className="btn-primario">
          📄 Imprimir Folio
        </button>
      </div>

      <style>{`
        .folio-entrega-print {
          max-width: 210mm;
          margin: 0 auto;
          padding: 20mm;
          background: white;
          color: black;
        }
        .folio-header {
          text-align: center;
          border-bottom: 2px solid #000;
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        .folio-header h1 {
          font-size: 24px;
          margin: 0;
          color: #FF5A1F;
        }
        .folio-header h2 {
          font-size: 18px;
          margin: 8px 0 0 0;
          text-transform: uppercase;
        }
        .folio-folio {
          font-size: 20px;
          text-align: center;
          padding: 16px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 24px;
        }
        .folio-seccion {
          margin-bottom: 20px;
        }
        .folio-seccion h3 {
          font-size: 14px;
          text-transform: uppercase;
          border-bottom: 1px solid #ccc;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .folio-seccion p {
          margin: 8px 0;
          font-size: 14px;
        }
        .folio-qr {
          text-align: center;
          margin: 32px 0;
        }
        .qr-image {
          width: 150px;
          height: 150px;
        }
        .folio-qr p {
          font-size: 12px;
          font-style: italic;
          margin-top: 8px;
        }
        .folio-footer {
          text-align: center;
          font-size: 11px;
          font-style: italic;
          border-top: 1px solid #ccc;
          padding-top: 16px;
          margin-top: 32px;
        }
        .folio-acciones {
          margin-top: 24px;
          text-align: center;
        }
        /* El reset del cascaron (rejilla con barra lateral y alturas de
           viewport) vive en styles/impresion.css, compartido con la caratula
           de expediente. Aqui solo lo especifico del folio. */
        @media print {
          .folio-acciones,
          nav,
          .migas,
          .vacio {
            display: none !important;
          }
          .tarjeta {
            display: block !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          /* El padding de 20mm se suma al margen de @page y empuja el folio
             fuera de la hoja; en papel el margen lo pone @page. */
          .folio-entrega-print {
            max-width: none;
            width: 100%;
            margin: 0;
            padding: 0;
          }
          .folio-folio {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .folio-qr,
          .folio-footer {
            break-inside: avoid;
          }
          .qr-image {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}
