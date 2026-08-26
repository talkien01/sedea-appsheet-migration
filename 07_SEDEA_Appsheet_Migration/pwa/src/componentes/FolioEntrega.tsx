// Vista previa e impresión de Folio de Entrega con QR (Build 12).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiSolicitudes } from '../api/solicitudes';
import { ETIQUETAS_NOMBRE_SOLICITANTE, type TipoPersona } from '@sedea/shared';

/** Un renglon del apoyo entregado: que es y cuanto, en unidades fisicas. */
interface ConceptoFolio {
  nombre: string;
  cantidad: string;
  unidad: string;
}

interface DatosFolio {
  folio: string;
  beneficiario_nombre: string;
  beneficiario_curp: string;
  programa_nombre: string;
  proyecto_nombre: string;
  conceptos: ConceptoFolio[];
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

/**
 * `cantidad` viene de un NUMERIC(_,3): 1.000 debe leerse "1" y 1.500 "1.5".
 * Sin esto el folio diria "Obra: 1.000" y el productor lo lee como mil.
 */
function cantidadTexto(valor: number | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', { maximumFractionDigits: 3 });
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
        // El folio de entrega documenta el apoyo FISICO que recibe el
        // productor (cantidad + unidad), no su valor en dinero: se firma al
        // recibir costales/obra, y el monto solo confundia en ventanilla.
        // Se listan TODOS los conceptos, no solo el primero.
        const conceptos: ConceptoFolio[] = detalle.conceptos.map(c => ({
          nombre: texto(c.tipo_apoyo),
          cantidad: cantidadTexto(c.cantidad),
          unidad: texto(c.unidad_medida)
        }));
        setDatos({
          folio: s.folio,
          beneficiario_nombre: texto(nombre),
          beneficiario_curp: texto(s.curp),
          programa_nombre: texto(s.programa_nombre),
          proyecto_nombre: texto(s.proyecto_nombre),
          conceptos,
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

        {/* En Carta horizontal el ancho sobra y el alto escasea: los dos
            bloques de datos van lado a lado y el QR ocupa la tercera columna,
            en vez de apilarse como en la version vertical. */}
        <div className="folio-cuerpo">
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
            <table className="folio-conceptos" data-testid="folio-conceptos">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="folio-col-cant">Cantidad</th>
                  <th>Unidad de medida</th>
                </tr>
              </thead>
              <tbody>
                {datos.conceptos.length === 0 && (
                  <tr><td colSpan={3}>Sin conceptos registrados</td></tr>
                )}
                {datos.conceptos.map((c, i) => (
                  <tr key={i} data-testid="folio-concepto">
                    <td>{c.nombre}</td>
                    <td className="folio-col-cant" data-testid="folio-cantidad">{c.cantidad}</td>
                    <td data-testid="folio-unidad">{c.unidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="folio-qr">
            {qrDataUrl && <img src={qrDataUrl} alt="QR con folio" className="qr-image" />}
            <p>Escanee este código QR para verificar la entrega del apoyo</p>
          </div>
        </div>

        <div className="folio-footer">
          <p>Este documento debe presentarse al momento de recibir el apoyo</p>
        </div>
      </div>

      {/* Pagina 2: solo el folio, tan grande como quepa a lo ancho de la hoja.
          Sirve como separador visible del expediente en la mesa de entrega.
          `--folio-chars` deja que el tamano se ajuste al largo real del folio
          (el prefijo de proyecto y el consecutivo pueden crecer). */}
      <div
        className="folio-pagina2"
        data-testid="folio-pagina2"
        style={{ '--folio-chars': datos.folio.length } as React.CSSProperties}
      >
        <span className="folio-gigante" data-testid="folio-gigante">{datos.folio}</span>
      </div>

      <div className="folio-acciones no-print">
        <button onClick={imprimir} className="btn-primario">
          📄 Imprimir Folio
        </button>
      </div>

      <style>{`
        /* Carta horizontal: 279.4mm x 215.9mm. En pantalla se muestra a ese
           ancho para que la vista previa se parezca al papel. */
        .folio-entrega-print {
          max-width: 279mm;
          margin: 0 auto;
          padding: 12mm;
          background: white;
          color: black;
        }
        .folio-cuerpo {
          display: grid;
          grid-template-columns: 1fr 1.4fr auto;
          gap: 16px;
          align-items: start;
        }
        .folio-conceptos {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        .folio-conceptos th,
        .folio-conceptos td {
          border: 1px solid #999;
          padding: 4px 6px;
          font-size: 12px;
          text-align: left;
          vertical-align: top;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .folio-conceptos th {
          background: #f5f5f5;
          text-transform: uppercase;
          font-size: 11px;
        }
        .folio-conceptos .folio-col-cant {
          text-align: right;
          white-space: nowrap;
        }
        /* Pagina 2 (folio gigante): en pantalla es solo una vista previa; el
           tamano real lo fija el bloque @media print. */
        .folio-pagina2 {
          margin-top: 24px;
          padding: 24px 12mm;
          border-top: 2px dashed #ccc;
          text-align: center;
          background: white;
          color: black;
        }
        .folio-gigante {
          display: block;
          font-family: var(--font-mono);
          font-weight: 700;
          letter-spacing: 0;
          white-space: nowrap;
          /* Monoespaciada: cada glifo avanza ~0.6em, asi que N caracteres
             miden 0.6 * N * font-size. Despejando para que ocupen el ancho
             util deseado sale el factor 1.5 (deja ~10% de aire). */
          font-size: calc(240mm / var(--folio-chars, 19) * 1.5);
          line-height: 1.1;
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
          /* styles/impresion.css declara @page con size A4 para TODAS las
             pantallas imprimibles (la caratula de expediente depende de eso).
             @page no se puede acotar con un selector, pero este <style> solo
             existe en el DOM mientras la ruta del folio esta montada, asi que
             el override viaja con la pantalla y no toca a la caratula. */
          @page {
            size: letter landscape;
            margin: 10mm;
          }
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
          .folio-conceptos th {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .folio-conceptos tr {
            break-inside: avoid;
          }
          /* Pagina 2: hoja aparte, solo el folio, centrado vertical y
             horizontalmente. El alto util es 215.9mm - 20mm de margen. */
          .folio-pagina2 {
            break-before: page;
            margin: 0;
            padding: 0;
            border-top: none;
            height: 195mm;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .folio-gigante {
            /* Ancho util de Carta horizontal con margenes de 10mm:
               279.4 - 20 = 259.4mm. Se calcula sobre 240mm para dejar
               holgura ante fallbacks de fuente mas anchos que JetBrains Mono. */
            font-size: calc(240mm / var(--folio-chars, 19) * 1.5);
          }
        }
      `}</style>
    </div>
  );
}
