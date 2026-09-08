// Combobox de Localidad filtrado por Municipio (Propuesta A, catalogo
// importado del sistema anterior en AppSheet, migracion 035). Al elegir una
// opcion autocompleta la Seccion electoral (editable despues). El catalogo
// NO cubre el 100% de la realidad rural, asi que siempre queda a la mano
// "No esta en la lista" para regresar a texto libre sin bloquear el alta.
import { useEffect, useRef, useState } from 'react';
import { apiSolicitudes } from '../api/solicitudes';
import { ESTILO_MAYUSCULAS, aMayusculas } from './campoMayusculas';

interface OpcionLocalidad {
  id: number;
  nombre: string;
  cve_seccion: string | null;
}

interface Props {
  municipioId: string;
  valorTexto: string;
  valorId: string;
  onSeleccionar: (id: string, nombre: string, seccion: string) => void;
  onTexto: (texto: string) => void;
}

export default function BuscadorLocalidad({
  municipioId,
  valorTexto,
  valorId,
  onSeleccionar,
  onTexto
}: Props) {
  // Si ya trae texto pero no id (captura vieja, o el usuario ya eligio "no
  // esta en la lista" antes), arranca en modo libre para no forzar una
  // busqueda que probablemente no va a encontrar nada.
  const [modoLibre, setModoLibre] = useState(Boolean(valorTexto) && !valorId);
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState<OpcionLocalidad[]>([]);
  const referencia = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (modoLibre || !municipioId) {
      setOpciones([]);
      return;
    }
    const temporizador = setTimeout(() => {
      void (async () => {
        try {
          const { localidades } = await apiSolicitudes.localidades(Number(municipioId), valorTexto);
          setOpciones(localidades);
        } catch {
          setOpciones([]);
        }
      })();
    }, 250);
    return () => clearTimeout(temporizador);
  }, [municipioId, valorTexto, modoLibre]);

  useEffect(() => {
    function alClickFuera(evento: MouseEvent) {
      if (referencia.current && !referencia.current.contains(evento.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClickFuera);
    return () => document.removeEventListener('mousedown', alClickFuera);
  }, []);

  if (modoLibre) {
    return (
      <div className="campo">
        <label htmlFor="input-dom-localidad">Localidad</label>
        <input
          id="input-dom-localidad"
          data-testid="input-dom-localidad"
          type="text"
          value={valorTexto}
          style={ESTILO_MAYUSCULAS}
          onChange={(e) => onTexto(aMayusculas(e.target.value))}
        />
        {municipioId && (
          <button
            type="button"
            className="secundario"
            data-testid="btn-localidad-buscar-catalogo"
            onClick={() => setModoLibre(false)}
          >
            Buscar en el catálogo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="campo" ref={referencia} style={{ position: 'relative' }}>
      <label htmlFor="input-dom-localidad">Localidad</label>
      <input
        id="input-dom-localidad"
        data-testid="input-dom-localidad"
        type="text"
        autoComplete="off"
        disabled={!municipioId}
        placeholder={municipioId ? 'Escribe para buscar…' : 'Primero elige un Municipio'}
        value={valorTexto}
        style={ESTILO_MAYUSCULAS}
        onChange={(e) => {
          onTexto(aMayusculas(e.target.value));
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
      />
      {abierto && opciones.length > 0 && (
        <ul
          data-testid="lista-localidades"
          style={{
            position: 'absolute',
            zIndex: 10,
            listStyle: 'none',
            margin: 0,
            padding: '4px 0',
            width: '100%',
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--fondo, #fff)',
            border: '1px solid #ccc',
            borderRadius: 4
          }}
        >
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                data-testid={`opcion-localidad-${o.id}`}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  onSeleccionar(String(o.id), o.nombre, o.cve_seccion ?? '');
                  setAbierto(false);
                }}
              >
                {o.nombre}
                {o.cve_seccion ? ` · Sección ${o.cve_seccion}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="secundario"
        data-testid="btn-localidad-no-listada"
        onClick={() => {
          setModoLibre(true);
          setAbierto(false);
        }}
      >
        No está en la lista, escribir a mano
      </button>
    </div>
  );
}
