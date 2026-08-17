// Paso 5: tabla repetible de conceptos de apoyo (12.8.2).
//
// El total de cada fila se autocalcula como estatal + productor, pero el
// usuario puede sobrescribirlo; una vez editado a mano, esa fila deja de
// autocalcularse (Assumption 48: el papel admite aportaciones de terceros).
import type { CatalogosVentanilla } from '@sedea/shared';

export interface FilaConcepto {
  tipo_apoyo_id: string;
  descripcion: string;
  cantidad: string;
  unidad_medida: string;
  monto_estatal: string;
  monto_productor: string;
  monto_total: string;
  /** true cuando el usuario escribio el total a mano. */
  total_manual: boolean;
}

export function filaConceptoVacia(): FilaConcepto {
  return {
    tipo_apoyo_id: '',
    descripcion: '',
    cantidad: '',
    unidad_medida: '',
    monto_estatal: '',
    monto_productor: '',
    monto_total: '',
    total_manual: false
  };
}

interface Props {
  filas: FilaConcepto[];
  tiposApoyo: CatalogosVentanilla['tipos_apoyo'];
  cambiar: (indice: number, campo: keyof FilaConcepto, valor: string | boolean) => void;
  agregar: () => void;
  quitar: (indice: number) => void;
}

const aNumero = (valor: string): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export default function TablaConceptos({ filas, tiposApoyo, cambiar, agregar, quitar }: Props) {
  const suma = (campo: keyof FilaConcepto) =>
    filas.reduce((acumulado, f) => acumulado + aNumero(String(f[campo])), 0);

  return (
    <div data-testid="seccion-conceptos">
      <h3>5. Conceptos de apoyo solicitados</h3>
      <p className="dato">
        Se creará un beneficiario por cada concepto capturado en esta tabla.
      </p>

      <div className="tabla-contenedor">
        <table data-testid="tabla-conceptos">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Descripción</th>
              <th>Cantidad</th>
              <th>Unidad</th>
              <th>Apoyo estatal</th>
              <th>Aportación del productor</th>
              <th>Inversión total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, indice) => (
              <tr key={indice} data-testid="fila-concepto">
                <td>
                  <select
                    data-testid="select-concepto"
                    aria-label="Concepto de apoyo"
                    value={fila.tipo_apoyo_id}
                    onChange={(e) => cambiar(indice, 'tipo_apoyo_id', e.target.value)}
                  >
                    <option value="">Selecciona un concepto</option>
                    {tiposApoyo.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    data-testid="input-concepto-descripcion"
                    aria-label="Descripción del concepto"
                    type="text"
                    value={fila.descripcion}
                    onChange={(e) => cambiar(indice, 'descripcion', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    data-testid="input-concepto-cantidad"
                    aria-label="Cantidad"
                    type="number"
                    step="0.001"
                    value={fila.cantidad}
                    onChange={(e) => cambiar(indice, 'cantidad', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    data-testid="input-concepto-unidad"
                    aria-label="Unidad de medida"
                    type="text"
                    value={fila.unidad_medida}
                    onChange={(e) => cambiar(indice, 'unidad_medida', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    data-testid="input-concepto-estatal"
                    aria-label="Apoyo estatal"
                    type="number"
                    step="0.01"
                    value={fila.monto_estatal}
                    onChange={(e) => cambiar(indice, 'monto_estatal', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    data-testid="input-concepto-productor"
                    aria-label="Aportación del productor"
                    type="number"
                    step="0.01"
                    value={fila.monto_productor}
                    onChange={(e) => cambiar(indice, 'monto_productor', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    data-testid="input-concepto-total"
                    aria-label="Inversión total"
                    type="number"
                    step="0.01"
                    value={fila.monto_total}
                    onChange={(e) => cambiar(indice, 'monto_total', e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="secundario"
                    data-testid="btn-quitar-concepto"
                    disabled={filas.length <= 1}
                    onClick={() => quitar(indice)}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="totales-conceptos">
              <td colSpan={4}>Totales</td>
              <td>{suma('monto_estatal').toFixed(2)}</td>
              <td>{suma('monto_productor').toFixed(2)}</td>
              <td>{suma('monto_total').toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button type="button" data-testid="btn-agregar-concepto" onClick={agregar}>
        Agregar concepto
      </button>
    </div>
  );
}
