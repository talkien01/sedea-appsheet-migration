// Comparacion lado a lado de la fila en revision contra sus candidatas.
// Los valores que difieren entre candidatos se resaltan para que el revisor
// vea de un vistazo por que dos filas no son identicas.
import type { MotivoRelacion } from '@sedea/shared';

const ETIQUETAS_MOTIVO: Record<string, string> = {
  folio: 'Mismo folio',
  curp_mismo_concepto: 'Misma CURP · mismo concepto',
  curp_concepto_distinto: 'Misma CURP · concepto distinto'
};

/** Campos que se comparan, en el orden en que se muestran. */
const CAMPOS: Array<{ clave: string; etiqueta: string }> = [
  { clave: 'folio', etiqueta: 'Folio' },
  { clave: 'curp', etiqueta: 'CURP' },
  { clave: 'nombre_completo', etiqueta: 'Nombre' },
  { clave: 'regional_nombre', etiqueta: 'Dirección Regional' },
  { clave: 'municipio_nombre', etiqueta: 'Municipio' },
  { clave: 'colonia', etiqueta: 'Colonia' },
  { clave: 'seccion', etiqueta: 'Sección' },
  { clave: 'localidad', etiqueta: 'Localidad' },
  { clave: 'domicilio', etiqueta: 'Domicilio' },
  { clave: 'telefono', etiqueta: 'Teléfono' },
  { clave: 'tipo_apoyo_nombre', etiqueta: 'Concepto de apoyo' },
  { clave: 'cantidad_asignada', etiqueta: 'Cantidad' }
];

export interface Candidata {
  id: number;
  origen: 'staging' | 'produccion';
  motivo_relacion?: MotivoRelacion | string;
  [clave: string]: unknown;
}

interface Props {
  fila: Record<string, unknown>;
  candidatas: Candidata[];
  /** Ids de staging seleccionados para fusionar. */
  seleccionadas: number[];
  alAlternar: (id: number) => void;
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  return String(valor);
}

export default function ComparadorDuplicados({
  fila,
  candidatas,
  seleccionadas,
  alAlternar
}: Props) {
  const columnas = [{ ...fila, id: fila.id as number, origen: 'actual' as const }, ...candidatas];

  // Un campo se resalta si no todos los candidatos coinciden en su valor.
  const difiere = (clave: string): boolean => {
    const valores = columnas.map((c) => texto((c as Record<string, unknown>)[clave]));
    return new Set(valores).size > 1;
  };

  return (
    <div className="comparador" data-testid="comparador">
      {columnas.map((columna, indice) => {
        const esActual = indice === 0;
        const id = columna.id as number;
        const origen = (columna as any).origen as string;
        return (
          <div
            key={`${origen}-${id}`}
            className={`tarjeta candidato ${esActual ? 'candidato-actual' : ''}`}
            data-testid="tarjeta-candidato"
          >
            <h3>
              {esActual
                ? 'Esta fila'
                : ETIQUETAS_MOTIVO[String((columna as any).motivo_relacion)] ?? 'Relacionada'}
            </h3>
            <p className="dato origen-candidato">
              {esActual
                ? 'En revisión'
                : origen === 'produccion'
                  ? 'Ya en producción'
                  : 'Staging'}
            </p>

            {!esActual && origen === 'staging' && (
              <label className="campo-inline">
                <input
                  type="checkbox"
                  data-testid="chk-candidata"
                  checked={seleccionadas.includes(id)}
                  onChange={() => alAlternar(id)}
                />
                Seleccionar para fusionar
              </label>
            )}

            <dl className="campos-candidato">
              {CAMPOS.map(({ clave, etiqueta }) => (
                <div key={clave} className={difiere(clave) ? 'campo-difiere' : ''}>
                  <dt>{etiqueta}</dt>
                  <dd>{texto((columna as Record<string, unknown>)[clave])}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
