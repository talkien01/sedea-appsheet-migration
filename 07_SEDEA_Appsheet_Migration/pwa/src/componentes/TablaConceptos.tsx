// Paso 5: tabla repetible de conceptos de apoyo (12.8.2).
//
// El total de cada fila se autocalcula como estatal + productor, pero el
// usuario puede sobrescribirlo; una vez editado a mano, esa fila deja de
// autocalcularse (Assumption 48: el papel admite aportaciones de terceros).
import {
  CLAVE_PROYECTO_CASAS_EJIDALES,
  CLAVE_PROYECTO_TOPE_MONTO,
  TOPE_MONTO_PROYECTO_PEO,
  type CatalogosVentanilla,
  type ConflictoCurpConcepto
} from '@sedea/shared';
import { BotonIcono } from './BotonIcono';

export interface FilaConcepto {
  tipo_apoyo_id: string;
  /**
   * Descripcion homologada del concepto, copiada del catalogo al elegirlo.
   * Es de solo lectura en la tabla para todos los proyectos: a diferencia de
   * `cantidad` o `monto_total` (que varian legitimamente por solicitante y
   * por eso admiten captura a mano), la descripcion debe ser identica para
   * todos los solicitantes del mismo concepto, asi que solo se cambia
   * editando el catalogo. EXCEPCION: Casas Ejidales (proyecto PEO) — ahi SI
   * se escribe a mano, ver `CLAVE_PROYECTO_CASAS_EJIDALES`.
   */
  descripcion: string;
  cantidad: string;
  unidad_medida: string;
  monto_estatal: string;
  monto_productor: string;
  monto_total: string;
  /** true cuando el usuario escribio el total a mano. */
  total_manual: boolean;
  /**
   * true cuando el usuario escribio la cantidad a mano. Mismo criterio que
   * `total_manual`: a partir de ahi la cantidad ya no se autocalcula desde la
   * regla de cantidad maxima por superficie.
   */
  cantidad_manual: boolean;
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
    total_manual: false,
    cantidad_manual: false
  };
}

/**
 * Resultado de la regla de escalones para un concepto, ya resuelto con la
 * superficie capturada en la seccion 3.
 *  - `fijo`: la superficie cae en un escalon; esa es la cantidad permitida.
 *  - `no_elegible`: la superficie no llega al minimo del concepto.
 */
export type EstadoEscalonConcepto =
  | { tipo: 'fijo'; cantidad: number }
  | { tipo: 'no_elegible'; minimo: number };

interface Props {
  filas: FilaConcepto[];
  tiposApoyo: CatalogosVentanilla['tipos_apoyo'];
  /**
   * Escalon resuelto por `tipo_apoyo_id`. Solo se muestra como ayuda de
   * captura: el tope real lo impone el backend al guardar y al dictaminar.
   */
  escalones: Record<string, EstadoEscalonConcepto>;
  /**
   * Conceptos que la CURP capturada YA solicito antes, por `tipo_apoyo_id`.
   * A diferencia de `escalones`, esto SI bloquea el guardado: la misma CURP no
   * puede repetir el mismo concepto. Quitar la fila resuelve el conflicto.
   */
  conflictosCurp: Record<string, ConflictoCurpConcepto>;
  /**
   * Proyecto elegido en el Paso 1, o `null` si todavia no se elige. Recorta el
   * selector: un concepto con `proyecto_id` definido solo se ofrece cuando la
   * solicitud es de ESE proyecto. Los conceptos con `proyecto_id` null (la
   * mayoria del catalogo, sin relacion a proyecto todavia) se ofrecen siempre,
   * y sin proyecto elegido no se filtra nada.
   */
  proyectoId: number | null;
  /**
   * Clave del proyecto elegido (o null). Solo se usa para el aviso del tope
   * de monto por solicitud (hoy exclusivo de PEO/Casas Ejidales) — es un
   * aviso de ayuda; el bloqueo real lo hace el backend al guardar.
   */
  proyectoClave: string | null;
  cambiar: (indice: number, campo: keyof FilaConcepto, valor: string | boolean) => void;
  agregar: () => void;
  quitar: (indice: number) => void;
}

const aNumero = (valor: string): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export default function TablaConceptos({
  filas,
  tiposApoyo,
  escalones,
  conflictosCurp,
  proyectoId,
  proyectoClave,
  cambiar,
  agregar,
  quitar
}: Props) {
  const suma = (campo: keyof FilaConcepto) =>
    filas.reduce((acumulado, f) => acumulado + aNumero(String(f[campo])), 0);

  // Conceptos ofrecibles en una solicitud de este proyecto: los que no tienen
  // proyecto definido (sin regla = sin restriccion) mas los de ESTE proyecto.
  // Sin proyecto elegido todavia, el selector se comporta como siempre.
  const tiposOfrecibles =
    proyectoId === null
      ? tiposApoyo
      : tiposApoyo.filter(
          (t) => t.proyecto_id === null || t.proyecto_id === undefined || t.proyecto_id === proyectoId
        );

  return (
    // `pantalla-ancha` libera el techo de ancho de `.contenido`; `conceptos-ancho`
    // deja que SOLO esta seccion lo aproveche (el resto del formulario sigue
    // en su columna estrecha, ver componentes.css).
    <div className="pantalla-ancha conceptos-ancho" data-testid="seccion-conceptos">
      <h3>5. Conceptos de apoyo solicitados</h3>
      <p className="dato">
        Se creará un beneficiario por cada concepto capturado en esta tabla.
      </p>

      <div className="tabla-contenedor">
        <table className="tabla-conceptos" data-testid="tabla-conceptos">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Descripción</th>
              <th className="col-num">Cantidad</th>
              <th>Unidad</th>
              <th className="col-num">Apoyo estatal</th>
              <th className="col-num">Aportación del productor</th>
              <th className="col-num">Inversión total</th>
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
                    {tiposOfrecibles.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                  {conflictosCurp[fila.tipo_apoyo_id] && (
                    <div
                      className="mensaje error aviso-curp-duplicada"
                      role="alert"
                      data-testid="aviso-curp-concepto-duplicado"
                    >
                      Esta CURP ya tiene una solicitud de este concepto (folio{' '}
                      {conflictosCurp[fila.tipo_apoyo_id].folio}). Quita el concepto para
                      continuar.
                    </div>
                  )}
                </td>
                {/*
                  La descripcion es de solo lectura (homologada desde el
                  catalogo) para TODOS los proyectos, EXCEPTO Casas Ejidales
                  (PEO): ahi el apoyo real varia por beneficiario (cubetas de
                  pintura, laminas, instalacion de bano...) y el catalogo hoy
                  solo tiene un concepto generico, asi que aqui SI se escribe
                  a mano. Se cambia editando el concepto en /catalogos SOLO
                  para los demas proyectos.
                */}
                <td>
                  {proyectoClave === CLAVE_PROYECTO_CASAS_EJIDALES ? (
                    <input
                      type="text"
                      className="descripcion-concepto"
                      data-testid="input-concepto-descripcion"
                      aria-label="Descripción del apoyo"
                      placeholder="Ej. Láminas para techo, cubetas de pintura, instalación de baño…"
                      value={fila.descripcion}
                      onChange={(e) => cambiar(indice, 'descripcion', e.target.value)}
                    />
                  ) : (
                    <span
                      className="descripcion-concepto"
                      data-testid="input-concepto-descripcion"
                      aria-label="Descripción del concepto"
                      title={fila.descripcion || undefined}
                    >
                      {fila.descripcion || '—'}
                    </span>
                  )}
                </td>
                <td className="col-num">
                  <input
                    className="num"
                    data-testid="input-concepto-cantidad"
                    aria-label="Cantidad"
                    type="number"
                    step="0.001"
                    value={fila.cantidad}
                    onChange={(e) => cambiar(indice, 'cantidad', e.target.value)}
                  />
                  {escalones[fila.tipo_apoyo_id]?.tipo === 'fijo' && (
                    <span className="dato ayuda-maximo" data-testid="ayuda-cantidad-maxima">
                      Máx. {(escalones[fila.tipo_apoyo_id] as { cantidad: number }).cantidad}
                    </span>
                  )}
                  {escalones[fila.tipo_apoyo_id]?.tipo === 'no_elegible' && (
                    <span className="dato ayuda-no-elegible" data-testid="aviso-no-elegible">
                      No elegible: superficie mínima{' '}
                      {(escalones[fila.tipo_apoyo_id] as { minimo: number }).minimo} ha
                    </span>
                  )}
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
                <td className="col-num">
                  <input
                    className="num"
                    data-testid="input-concepto-estatal"
                    aria-label="Apoyo estatal"
                    type="number"
                    step="0.01"
                    value={fila.monto_estatal}
                    onChange={(e) => cambiar(indice, 'monto_estatal', e.target.value)}
                  />
                </td>
                <td className="col-num">
                  <input
                    className="num"
                    data-testid="input-concepto-productor"
                    aria-label="Aportación del productor"
                    type="number"
                    step="0.01"
                    value={fila.monto_productor}
                    onChange={(e) => cambiar(indice, 'monto_productor', e.target.value)}
                  />
                </td>
                <td className="col-num">
                  <input
                    className="num"
                    data-testid="input-concepto-total"
                    aria-label="Inversión total"
                    type="number"
                    step="0.01"
                    value={fila.monto_total}
                    onChange={(e) => cambiar(indice, 'monto_total', e.target.value)}
                  />
                </td>
                <td>
                  <BotonIcono
                    icono="basura"
                    etiqueta="Quitar concepto"
                    tono="peligro"
                    testId="btn-quitar-concepto"
                    deshabilitado={filas.length <= 1}
                    onClick={() => quitar(indice)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="totales-conceptos">
              <td colSpan={4}>Totales</td>
              <td className="col-num">{suma('monto_estatal').toFixed(2)}</td>
              <td className="col-num">{suma('monto_productor').toFixed(2)}</td>
              <td className="col-num">{suma('monto_total').toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {proyectoClave === CLAVE_PROYECTO_TOPE_MONTO && suma('monto_total') > TOPE_MONTO_PROYECTO_PEO && (
        <p className="mensaje error" role="alert" data-testid="aviso-tope-monto">
          La suma de los conceptos ({suma('monto_total').toLocaleString('es-MX')}) excede el tope de{' '}
          {TOPE_MONTO_PROYECTO_PEO.toLocaleString('es-MX')} para este proyecto. El sistema no dejará
          guardar hasta ajustar los montos.
        </p>
      )}

      <button type="button" data-testid="btn-agregar-concepto" onClick={agregar}>
        Agregar concepto
      </button>
    </div>
  );
}
