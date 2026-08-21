// Vista previa e impresión de Folio de Entrega con QR (Build 12).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { peticion } from '../api/cliente';
import { apiSolicitudes } from '../api/solicitudes';

interface DatosFolio {
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  programa_nombre: string;
  proyecto_nombre: string;
  concepto_nombre: string;
  monto: number;
  regional_nombre: string;
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
      .then(solicitud => {
        setDatos({
          folio: solicitud.solicitud.folio,
          beneficiario_nombre: solicitud.solicitud.beneficiario_nombre,
          beneficiario_curp: solicitud.solicitud.beneficiario_curp,
          programa_nombre: solicitud.solicitud.programa_nombre,
          proyecto_nombre: solicitud.solicitud.proyecto_nombre,
          concepto_nombre: solicitud.conceptos[0]?.tipo_apoyo ?? '',
          monto: solicitud.conceptos[0]?.monto_estatal ?? 0,
          regional_nombre: solicitud.solicitud.regional_nombre
        });
        // Generar QR con el folio
        return import('qrcode').then(QRCode =>
          QRCode.default.toDataURL(solicitud.solicitud.folio, { width: 200 })
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
          <p><strong>Nombre:</strong> {datos.beneficiario_nombre}</p>
          <p><strong>CURP:</strong> {datos.beneficiario_curp}</p>
          <p><strong>Regional:</strong> {datos.regional_nombre}</p>
        </div>

        <div className="folio-seccion">
          <h3>DATOS DEL APOYO</h3>
          <p><strong>Programa:</strong> {datos.programa_nombre}</p>
          <p><strong>Proyecto:</strong> {datos.proyecto_nombre}</p>
          <p><strong>Concepto:</strong> {datos.concepto_nombre}</p>
          <p><strong>Monto:</strong> ${datos.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</p>
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
