// Formulario de edicion correctiva. Solo los 5 campos de la lista blanca son
// editables; CURP y folio se muestran bloqueados con su explicacion, porque
// son la identidad legal del expediente (decision D8).
import { useState, type FormEvent } from 'react';
import { LONGITUDES_MAXIMAS, normalizarTelefono } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';

export interface MunicipioDisponible {
  id: number;
  nombre: string;
  regional_id: number;
  regional?: string | null;
}

interface Props {
  beneficiario: any;
  municipios: MunicipioDisponible[];
  alGuardar: (beneficiarioActualizado: any) => void | Promise<void>;
  alCancelar: () => void;
}

/** Convierte un valor de la ficha a texto de input (null -> ""). */
function aTexto(valor: unknown): string {
  return valor === null || valor === undefined ? '' : String(valor);
}

export default function FormEdicionBeneficiario({
  beneficiario,
  municipios,
  alGuardar,
  alCancelar
}: Props) {
  const [colonia, setColonia] = useState(aTexto(beneficiario.colonia));
  const [domicilio, setDomicilio] = useState(aTexto(beneficiario.domicilio));
  const [telefono, setTelefono] = useState(aTexto(beneficiario.telefono));
  const [seccion, setSeccion] = useState(aTexto(beneficiario.seccion));
  const [municipioId, setMunicipioId] = useState(aTexto(beneficiario.municipio_id));
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  /** Validacion en cliente: si falla, no se llama a la API. */
  const validar = (): boolean => {
    const nuevos: Record<string, string> = {};
    if (telefono.trim() && !normalizarTelefono(telefono)) {
      nuevos.telefono = 'El teléfono debe tener 10 dígitos.';
    }
    for (const [campo, valor] of [
      ['colonia', colonia],
      ['domicilio', domicilio],
      ['seccion', seccion]
    ] as const) {
      const maximo = LONGITUDES_MAXIMAS[campo];
      if (maximo && valor.trim().length > maximo) {
        nuevos[campo] = `El campo ${campo} excede la longitud máxima (${maximo}).`;
      }
    }
    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setErrorApi(null);
    if (!validar()) return;

    // Solo se envian los campos que realmente cambiaron.
    const cambios: Record<string, unknown> = {};
    const comparar = (campo: string, actual: string, original: unknown) => {
      const limpio = actual.trim();
      const previo = aTexto(original);
      if (limpio !== previo) cambios[campo] = limpio === '' ? null : limpio;
    };
    comparar('colonia', colonia, beneficiario.colonia);
    comparar('domicilio', domicilio, beneficiario.domicilio);
    comparar('telefono', telefono, beneficiario.telefono);
    comparar('seccion', seccion, beneficiario.seccion);
    if (municipioId !== aTexto(beneficiario.municipio_id)) {
      cambios.municipio_id = municipioId ? Number(municipioId) : null;
    }
    if (motivo.trim()) cambios.motivo = motivo.trim();

    if (Object.keys(cambios).filter((k) => k !== 'motivo').length === 0) {
      setErrorApi('No se envió ningún campo editable.');
      return;
    }

    setGuardando(true);
    try {
      const respuesta = await api.editarBeneficiario(beneficiario.id, cambios);
      await alGuardar(respuesta.beneficiario);
    } catch (fallo) {
      if (fallo instanceof ErrorPeticion) {
        setErrorApi(fallo.estado === 404 ? 'El beneficiario ya no existe.' : fallo.message);
      } else {
        setErrorApi('No se pudieron guardar los cambios.');
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form data-testid="form-edicion" onSubmit={(e) => void enviar(e)}>
      <h3>Editar datos de contacto y ubicación</h3>

      {errorApi && (
        <div className="mensaje error" role="alert" data-testid="error-edicion">
          {errorApi}
        </div>
      )}

      <div className="campo">
        <label htmlFor="input-colonia">Colonia</label>
        <input
          id="input-colonia"
          data-testid="input-colonia"
          type="text"
          maxLength={120}
          value={colonia}
          onChange={(e) => setColonia(e.target.value)}
        />
        {errores.colonia && (
          <span className="mensaje error" data-testid="error-colonia">
            {errores.colonia}
          </span>
        )}
      </div>

      <div className="campo">
        <label htmlFor="input-domicilio">Domicilio</label>
        <input
          id="input-domicilio"
          data-testid="input-domicilio"
          type="text"
          maxLength={200}
          value={domicilio}
          onChange={(e) => setDomicilio(e.target.value)}
        />
        {errores.domicilio && (
          <span className="mensaje error" data-testid="error-domicilio">
            {errores.domicilio}
          </span>
        )}
      </div>

      <div className="campo">
        <label htmlFor="input-telefono">Teléfono</label>
        <input
          id="input-telefono"
          data-testid="input-telefono"
          type="text"
          inputMode="tel"
          maxLength={20}
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
        {errores.telefono && (
          <span className="mensaje error" data-testid="error-telefono">
            {errores.telefono}
          </span>
        )}
      </div>

      <div className="campo">
        <label htmlFor="input-seccion">Sección</label>
        <input
          id="input-seccion"
          data-testid="input-seccion"
          type="text"
          maxLength={20}
          value={seccion}
          onChange={(e) => setSeccion(e.target.value)}
        />
        {errores.seccion && (
          <span className="mensaje error" data-testid="error-seccion">
            {errores.seccion}
          </span>
        )}
      </div>

      <div className="campo">
        <label htmlFor="select-municipio">Municipio</label>
        <select
          id="select-municipio"
          data-testid="select-municipio"
          value={municipioId}
          onChange={(e) => setMunicipioId(e.target.value)}
        >
          <option value="">Sin municipio</option>
          {municipios.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.nombre}
              {m.regional ? ` — ${m.regional}` : ''}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="campos-bloqueados">
        <legend>Campos no editables</legend>
        <div className="campo">
          <label htmlFor="input-curp">CURP</label>
          <input
            id="input-curp"
            data-testid="input-curp"
            type="text"
            value={aTexto(beneficiario.curp)}
            readOnly
            disabled
          />
        </div>
        <div className="campo">
          <label htmlFor="input-folio">Folio</label>
          <input
            id="input-folio"
            data-testid="input-folio"
            type="text"
            value={aTexto(beneficiario.folio)}
            readOnly
            disabled
          />
        </div>
        <p className="dato">
          CURP y Folio no son editables: son la identidad legal del expediente. Si están mal,
          corrige el padrón de origen y reimporta desde Depuración.
        </p>
      </fieldset>

      <div className="campo">
        <label htmlFor="input-motivo">Motivo del cambio (opcional)</label>
        <input
          id="input-motivo"
          data-testid="input-motivo"
          type="text"
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      <div className="acciones">
        <button type="submit" data-testid="btn-guardar-edicion" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button
          type="button"
          className="secundario"
          data-testid="btn-cancelar-edicion"
          onClick={alCancelar}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
