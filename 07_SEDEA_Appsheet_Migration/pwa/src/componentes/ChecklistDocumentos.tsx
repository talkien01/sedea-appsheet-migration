// Paso 6: lista de documentos requeridos calculada por el backend (E41) y
// texto fijo de las declaraciones (12.9). Los adjuntos NO se suben aqui: se
// suben despues de guardar, desde el detalle de la solicitud (E46).
import {
  DECLARACIONES_ENCABEZADO,
  DECLARACIONES_INCISOS,
  DECLARACION_ACEPTACION,
  type DocumentoRequeridoCalculado
} from '@sedea/shared';

interface Props {
  documentos: DocumentoRequeridoCalculado[];
  recibidos: Record<string, boolean>;
  calculando: boolean;
  declaracion: boolean;
  alMarcar: (requisito: string, recibido: boolean) => void;
  alAceptarDeclaracion: (aceptada: boolean) => void;
}

export default function ChecklistDocumentos({
  documentos,
  recibidos,
  calculando,
  declaracion,
  alMarcar,
  alAceptarDeclaracion
}: Props) {
  const total = documentos.length;
  const cuantosRecibidos = documentos.filter((d) => recibidos[d.requisito]).length;

  return (
    <div data-testid="seccion-documentos">
      <h3>6. Documentos y declaraciones</h3>

      <p className="dato" data-testid="contador-documentos">
        Recibidos: {cuantosRecibidos} de {total}
      </p>
      {calculando && <p className="vacio">Actualizando la lista de documentos…</p>}

      <ul data-testid="lista-documentos" className="lista-documentos">
        {documentos.map((d) => (
          <li key={d.requisito} data-testid="item-documento">
            <label className="casilla">
              <input
                type="checkbox"
                data-testid="chk-documento-recibido"
                checked={recibidos[d.requisito] === true}
                onChange={(e) => alMarcar(d.requisito, e.target.checked)}
              />
              {d.requisito}
            </label>
          </li>
        ))}
        {total === 0 && !calculando && (
          <li className="vacio">
            Selecciona componente y tipo de persona para ver los documentos requeridos.
          </li>
        )}
      </ul>

      <div data-testid="texto-declaraciones" className="declaraciones">
        <p>
          <strong>{DECLARACIONES_ENCABEZADO}</strong>
        </p>
        {DECLARACIONES_INCISOS.map((d) => (
          <p key={d.inciso}>
            <strong>{d.inciso}</strong> {d.texto}
          </p>
        ))}
      </div>

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-declaracion"
          checked={declaracion}
          onChange={(e) => alAceptarDeclaracion(e.target.checked)}
        />
        {DECLARACION_ACEPTACION}
      </label>
    </div>
  );
}
