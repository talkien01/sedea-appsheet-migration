// Bloque de alcance del usuario de ventanilla (12.8.4). Solo se renderiza
// cuando el rol elegido es "Ventanilla"; para cualquier otro rol no existe.
//
// "SEDEA Central" equivale a CERO filas en la tabla de alcance (Assumption 44):
// al marcarlo se deshabilita y se limpia la lista correspondiente.
//
// Los municipios NO se capturan uno por uno: se marcan por Direccion Regional
// y el estado interno (`valores.municipios`) sigue guardando los ids de
// municipio, que es lo que persiste E48. La forma de `ValoresAlcance` no
// cambia, asi que ningun otro consumidor (ni la carga masiva CSV, que sigue
// mandando claves separadas por ';') se ve afectado.
interface OpcionMunicipio {
  id: number;
  nombre: string;
  /** Direccion Regional a la que pertenece; null si no tiene. */
  regional_id?: number | null;
}

interface OpcionRegional {
  id: number;
  nombre: string;
}

interface OpcionComponente {
  id: number;
  clave: string;
  nombre: string;
}

export interface ValoresAlcance {
  municipiosTodos: boolean;
  municipios: number[];
  componentesTodos: boolean;
  componentes: number[];
}

interface Props {
  municipios: OpcionMunicipio[];
  regionales: OpcionRegional[];
  componentes: OpcionComponente[];
  valores: ValoresAlcance;
  cambiar: (valores: ValoresAlcance) => void;
}

export default function BloqueAlcance({
  municipios,
  regionales,
  componentes,
  valores,
  cambiar
}: Props) {
  // Municipios de cada Regional, en el orden en que llega el catalogo.
  const municipiosDe = (regionalId: number) =>
    municipios.filter((m) => m.regional_id === regionalId).map((m) => m.id);

  // Una Regional se muestra marcada cuando el alcance guardado cubre TODOS sus
  // municipios. Es una propiedad derivada, no un estado aparte: asi un alcance
  // heredado que cruza Regionales se sigue leyendo sin corromperlo.
  const regionalCompleta = (regionalId: number) => {
    const ids = municipiosDe(regionalId);
    return ids.length > 0 && ids.every((id) => valores.municipios.includes(id));
  };

  // Municipios del alcance que NO quedan cubiertos por ninguna Regional
  // completa: son los "sueltos" de un alcance mixto ya guardado. Se conservan
  // tal cual (solo se listan) para que abrir y guardar sin tocar el alcance
  // deje al usuario exactamente igual que antes.
  const idsCubiertos = new Set(
    regionales.filter((r) => regionalCompleta(r.id)).flatMap((r) => municipiosDe(r.id))
  );
  const sueltos = municipios.filter(
    (m) => valores.municipios.includes(m.id) && !idsCubiertos.has(m.id)
  );

  const alternarRegional = (regionalId: number, marcado: boolean) => {
    const ids = municipiosDe(regionalId);
    cambiar({
      ...valores,
      municipios: marcado
        ? // Union: se pueden marcar varias Regionales a la vez.
          Array.from(new Set([...valores.municipios, ...ids]))
        : // Al desmarcar solo se quitan los municipios de ESA Regional.
          valores.municipios.filter((m) => !ids.includes(m))
    });
  };

  const quitarSuelto = (id: number) => {
    cambiar({ ...valores, municipios: valores.municipios.filter((m) => m !== id) });
  };

  const alternarComponente = (id: number, marcado: boolean) => {
    cambiar({
      ...valores,
      componentes: marcado
        ? [...valores.componentes, id]
        : valores.componentes.filter((c) => c !== id)
    });
  };

  return (
    <div className="campo" data-testid="bloque-alcance">
      <h3>Alcance del usuario de ventanilla</h3>
      <p className="dato">
        El alcance de municipios se define por Dirección Regional. Marca varias si la cuenta
        atiende más de una, o “SEDEA Central” si atiende todo el estado.
      </p>

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-municipios-todos"
          checked={valores.municipiosTodos}
          onChange={(e) =>
            cambiar({ ...valores, municipiosTodos: e.target.checked, municipios: [] })
          }
        />
        SEDEA Central (todo el estado)
      </label>

      <div className="lista-casillas">
        {regionales.map((r) => (
          <label className="casilla" key={r.id}>
            <input
              type="checkbox"
              data-testid={`chk-regional-${r.id}`}
              disabled={valores.municipiosTodos}
              checked={regionalCompleta(r.id)}
              onChange={(e) => alternarRegional(r.id, e.target.checked)}
            />
            {r.nombre}
          </label>
        ))}
      </div>

      {!valores.municipiosTodos && sueltos.length > 0 && (
        <div className="lista-casillas" data-testid="municipios-sueltos">
          <p className="dato">
            Municipios sueltos de este usuario (no completan ninguna Regional). Se conservan tal
            como están; quítalos solo si quieres cambiarlos.
          </p>
          {sueltos.map((m) => (
            <label className="casilla" key={m.id}>
              <input
                type="checkbox"
                data-testid={`chk-municipio-${m.id}`}
                checked
                onChange={() => quitarSuelto(m.id)}
              />
              {m.nombre}
            </label>
          ))}
        </div>
      )}

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-componentes-todos"
          checked={valores.componentesTodos}
          onChange={(e) =>
            cambiar({ ...valores, componentesTodos: e.target.checked, componentes: [] })
          }
        />
        Todos los componentes
      </label>

      <div className="lista-casillas">
        {componentes.map((c) => (
          <label className="casilla" key={c.id}>
            <input
              type="checkbox"
              data-testid={`chk-componente-${c.clave}`}
              disabled={valores.componentesTodos}
              checked={valores.componentes.includes(c.id)}
              onChange={(e) => alternarComponente(c.id, e.target.checked)}
            />
            {c.clave} — {c.nombre}
          </label>
        ))}
      </div>
    </div>
  );
}
