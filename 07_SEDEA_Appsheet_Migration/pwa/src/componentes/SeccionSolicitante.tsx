// Paso 2 del formulario: datos del solicitante (2.1) y su domicilio
// particular (2.2). Los campos de persona moral / grupo solo se renderizan
// cuando el tipo de persona lo exige (12.8.2).
import {
  ETIQUETAS_NOMBRE_SOLICITANTE,
  ETIQUETAS_TIPO_PERSONA,
  TIPOS_ASENTAMIENTO,
  TIPOS_PERSONA,
  TIPOS_VIALIDAD,
  type DatosCurpQr,
  type MunicipioVentanilla,
  type TipoPersona
} from '@sedea/shared';
import { useState, type ReactNode } from 'react';
import { ESTILO_MAYUSCULAS, aMayusculas } from './campoMayusculas';
import EscanerCurpQr from './EscanerCurpQr';
import VincularCelular from './VincularCelular';

export interface DatosSolicitante {
  tipo_persona: TipoPersona;
  /**
   * Nombre completo combinado: nombre_pila + apellido_paterno +
   * apellido_materno, en ese orden. Se sigue guardando porque varias
   * pantallas (folio impreso, listados, busqueda) lo usan tal cual — se
   * recalcula solo aqui mismo cada vez que cambia alguna de las 3 partes.
   */
  nombre_solicitante: string;
  nombre_pila: string;
  apellido_paterno: string;
  apellido_materno: string;
  sexo: string;
  fecha_nacimiento: string;
  correo: string;
  telefono: string;
  curp: string;
  razon_social: string;
  num_integrantes: string;
  dom_municipio_id: string;
  dom_localidad: string;
  dom_delegacion: string;
  dom_cp: string;
  dom_tipo_asentamiento: string;
  dom_asentamiento: string;
  dom_tipo_vialidad: string;
  dom_vialidad: string;
}

interface Props {
  valores: DatosSolicitante;
  municipios: MunicipioVentanilla[];
  cambiar: (campo: keyof DatosSolicitante, valor: string) => void;
  /**
   * Contenido opcional que se pinta justo debajo del campo CURP (ej. el
   * aviso de "esta CURP ya tiene otra solicitud"). Va aqui y no despues de
   * `<SeccionSolicitante>` porque 2.1 y 2.2 viven en el mismo componente: si
   * se pintara afuera, quedaria hasta el fondo de la tarjeta, lejos del
   * campo que lo origina.
   */
  avisoCurp?: ReactNode;
}

export default function SeccionSolicitante({ valores, municipios, cambiar, avisoCurp }: Props) {
  // Persona moral y grupo de productores comparten los campos de razon social
  // y numero de integrantes; la persona fisica ni siquiera los renderiza.
  const esColectiva = valores.tipo_persona === 'moral' || valores.tipo_persona === 'grupo';

  // Escaneo del QR de la Constancia CURP: solo autocompleta los cuatro campos
  // que trae el QR; todo lo demas sigue siendo captura manual.
  const [escaneando, setEscaneando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [escaneoOk, setEscaneoOk] = useState(false);

  // Mismo destino para las dos vias de escaneo: la camara de este equipo y la
  // del celular vinculado. Lo unico que cambia es de donde viene el texto.
  //
  // El QR de RENAPO YA trae nombre(s)/paterno/materno separados (E63): se
  // guardan tal cual, exactos — nada de heuristica aqui, esa solo hace falta
  // para lo que se captura a mano o lo historico sin este dato.
  const aplicarEscaneo = (datos: DatosCurpQr) => {
    cambiar('curp', aMayusculas(datos.curp));
    cambiar('nombre_solicitante', aMayusculas(datos.nombre_solicitante));
    cambiar('nombre_pila', aMayusculas(datos.nombre_pila));
    cambiar('apellido_paterno', aMayusculas(datos.apellido_paterno));
    cambiar('apellido_materno', aMayusculas(datos.apellido_materno));
    if (datos.sexo) cambiar('sexo', datos.sexo);
    if (datos.fecha_nacimiento) cambiar('fecha_nacimiento', datos.fecha_nacimiento);
    setEscaneando(false);
    setVinculando(false);
    setEscaneoOk(true);
  };

  // Captura manual (sin QR): 3 cajas en vez de 1 (E63). El nombre completo
  // combinado se recalcula aqui cada vez, porque varias pantallas (folio
  // impreso, listados, busqueda) siguen usando ese campo unico.
  const cambiarParteNombre = (
    campo: 'nombre_pila' | 'apellido_paterno' | 'apellido_materno',
    valorCrudo: string
  ) => {
    const valor = aMayusculas(valorCrudo);
    cambiar(campo, valor);
    const partes = {
      nombre_pila: campo === 'nombre_pila' ? valor : valores.nombre_pila,
      apellido_paterno: campo === 'apellido_paterno' ? valor : valores.apellido_paterno,
      apellido_materno: campo === 'apellido_materno' ? valor : valores.apellido_materno
    };
    const combinado = [partes.nombre_pila, partes.apellido_paterno, partes.apellido_materno]
      .filter((p) => p.trim() !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    cambiar('nombre_solicitante', combinado);
  };

  return (
    <>
      <div data-testid="seccion-solicitante">
        <h3>2.1 Datos del solicitante</h3>

        <div className="campo">
          <label htmlFor="select-tipo-persona">Tipo de persona</label>
          <select
            id="select-tipo-persona"
            data-testid="select-tipo-persona"
            value={valores.tipo_persona}
            onChange={(e) => cambiar('tipo_persona', e.target.value)}
          >
            {TIPOS_PERSONA.map((t) => (
              <option key={t} value={t}>
                {ETIQUETAS_TIPO_PERSONA[t]}
              </option>
            ))}
          </select>
        </div>

        {esColectiva && (
          <>
            <div className="campo">
              <label htmlFor="input-razon-social">Razón social / nombre del grupo</label>
              <input
                id="input-razon-social"
                data-testid="input-razon-social"
                type="text"
                value={valores.razon_social}
                style={ESTILO_MAYUSCULAS}
                onChange={(e) => cambiar('razon_social', aMayusculas(e.target.value))}
              />
            </div>
            <div className="campo">
              <label htmlFor="input-num-integrantes">Número de integrantes</label>
              <input
                id="input-num-integrantes"
                data-testid="input-num-integrantes"
                type="number"
                min={1}
                value={valores.num_integrantes}
                onChange={(e) => cambiar('num_integrantes', e.target.value)}
              />
            </div>
          </>
        )}

        <div className="campo">
          <button
            type="button"
            className="secundario"
            data-testid="btn-escanear-curp"
            onClick={() => {
              setEscaneoOk(false);
              setEscaneando(true);
            }}
          >
            Escanear CURP
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-vincular-celular"
            onClick={() => {
              setEscaneoOk(false);
              setVinculando(true);
            }}
          >
            Escanear con el celular
          </button>
          <p className="dato">
            Lee el código QR de la Constancia CURP y llena CURP, nombre, sexo y fecha de
            nacimiento. Usa la cámara de este equipo o, si no tiene, vincula tu celular.
          </p>
        </div>

        {escaneoOk && (
          <div className="mensaje exito" role="status" data-testid="exito-escaneo-curp">
            Datos tomados de la Constancia CURP. Revísalos antes de continuar.
          </div>
        )}

        {escaneando && (
          <EscanerCurpQr onDatos={aplicarEscaneo} onCerrar={() => setEscaneando(false)} />
        )}

        {vinculando && (
          <VincularCelular onDatos={aplicarEscaneo} onCerrar={() => setVinculando(false)} />
        )}

        {/*
          3 cajas en vez de 1 (E63): nombre de pila, apellido paterno,
          apellido materno por separado — igual que ya vienen separados en el
          QR de la Constancia CURP. `nombre_solicitante` se sigue mandando al
          backend, pero ahora se RECALCULA solo (ver cambiarParteNombre), no
          se escribe directo.
        */}
        <div className="campo">
          <label htmlFor="input-nombre-pila" data-testid="etiqueta-nombre-solicitante">
            {ETIQUETAS_NOMBRE_SOLICITANTE[valores.tipo_persona]}
          </label>
          <input
            id="input-nombre-pila"
            data-testid="input-nombre-pila"
            type="text"
            placeholder="Nombre(s)"
            value={valores.nombre_pila}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiarParteNombre('nombre_pila', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-apellido-paterno">Apellido paterno</label>
          <input
            id="input-apellido-paterno"
            data-testid="input-apellido-paterno"
            type="text"
            value={valores.apellido_paterno}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiarParteNombre('apellido_paterno', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-apellido-materno">Apellido materno</label>
          <input
            id="input-apellido-materno"
            data-testid="input-apellido-materno"
            type="text"
            value={valores.apellido_materno}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiarParteNombre('apellido_materno', e.target.value)}
          />
        </div>

        {valores.nombre_solicitante && (
          <p className="dato" data-testid="preview-nombre-completo">
            Nombre completo: <strong>{valores.nombre_solicitante}</strong>
          </p>
        )}

        <div className="campo">
          <label htmlFor="select-sexo">Sexo</label>
          <select
            id="select-sexo"
            data-testid="select-sexo"
            value={valores.sexo}
            onChange={(e) => cambiar('sexo', e.target.value)}
          >
            <option value="">Sin especificar</option>
            <option value="H">Hombre</option>
            <option value="M">Mujer</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-fecha-nacimiento">Fecha de nacimiento</label>
          <input
            id="input-fecha-nacimiento"
            data-testid="input-fecha-nacimiento"
            type="date"
            value={valores.fecha_nacimiento}
            onChange={(e) => cambiar('fecha_nacimiento', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-correo">Correo electrónico</label>
          <input
            id="input-correo"
            data-testid="input-correo"
            type="email"
            value={valores.correo}
            onChange={(e) => cambiar('correo', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-telefono">Teléfono (10 dígitos)</label>
          <input
            id="input-telefono"
            data-testid="input-telefono"
            type="tel"
            value={valores.telefono}
            onChange={(e) => cambiar('telefono', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-curp">CURP</label>
          <input
            id="input-curp"
            data-testid="input-curp"
            type="text"
            maxLength={18}
            value={valores.curp}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiar('curp', aMayusculas(e.target.value))}
          />
          {avisoCurp}
        </div>
      </div>

      <div data-testid="seccion-domicilio">
        <h3>2.2 Domicilio particular del solicitante</h3>
        <div className="mensaje aviso" role="status">
          Domicilio del solicitante. La ubicación del predio se captura en la sección 4.
        </div>

        <div className="campo">
          <label htmlFor="select-dom-municipio">Municipio</label>
          <select
            id="select-dom-municipio"
            data-testid="select-dom-municipio"
            value={valores.dom_municipio_id}
            onChange={(e) => cambiar('dom_municipio_id', e.target.value)}
          >
            <option value="">Selecciona un municipio</option>
            {municipios.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-dom-localidad">Localidad</label>
          <input
            id="input-dom-localidad"
            data-testid="input-dom-localidad"
            type="text"
            value={valores.dom_localidad}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiar('dom_localidad', aMayusculas(e.target.value))}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-dom-delegacion">Delegación</label>
          <input
            id="input-dom-delegacion"
            data-testid="input-dom-delegacion"
            type="text"
            value={valores.dom_delegacion}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiar('dom_delegacion', aMayusculas(e.target.value))}
          />
        </div>

        <div className="campo">
          <label htmlFor="input-dom-cp">Código postal</label>
          <input
            id="input-dom-cp"
            data-testid="input-dom-cp"
            type="text"
            maxLength={5}
            value={valores.dom_cp}
            onChange={(e) => cambiar('dom_cp', e.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="select-dom-tipo-asentamiento">Tipo de asentamiento</label>
          <select
            id="select-dom-tipo-asentamiento"
            data-testid="select-dom-tipo-asentamiento"
            value={valores.dom_tipo_asentamiento}
            onChange={(e) => cambiar('dom_tipo_asentamiento', e.target.value)}
          >
            <option value="">Sin especificar</option>
            {TIPOS_ASENTAMIENTO.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-dom-asentamiento">Nombre del asentamiento</label>
          <input
            id="input-dom-asentamiento"
            data-testid="input-dom-asentamiento"
            type="text"
            value={valores.dom_asentamiento}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiar('dom_asentamiento', aMayusculas(e.target.value))}
          />
        </div>

        <div className="campo">
          <label htmlFor="select-dom-tipo-vialidad">Tipo de vialidad</label>
          <select
            id="select-dom-tipo-vialidad"
            data-testid="select-dom-tipo-vialidad"
            value={valores.dom_tipo_vialidad}
            onChange={(e) => cambiar('dom_tipo_vialidad', e.target.value)}
          >
            <option value="">Sin especificar</option>
            {TIPOS_VIALIDAD.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="input-dom-vialidad">Nombre de la vialidad y número</label>
          <input
            id="input-dom-vialidad"
            data-testid="input-dom-vialidad"
            type="text"
            value={valores.dom_vialidad}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => cambiar('dom_vialidad', aMayusculas(e.target.value))}
          />
        </div>
      </div>
    </>
  );
}
