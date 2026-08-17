// Bloque de alcance del usuario de ventanilla (12.8.4). Solo se renderiza
// cuando el rol elegido es "Ventanilla"; para cualquier otro rol no existe.
//
// "Todos" equivale a CERO filas en la tabla de alcance (Assumption 44): al
// marcarlo se deshabilita y se limpia la lista correspondiente.
interface OpcionMunicipio {
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
  componentes: OpcionComponente[];
  valores: ValoresAlcance;
  cambiar: (valores: ValoresAlcance) => void;
}

export default function BloqueAlcance({ municipios, componentes, valores, cambiar }: Props) {
  const alternarMunicipio = (id: number, marcado: boolean) => {
    cambiar({
      ...valores,
      municipios: marcado
        ? [...valores.municipios, id]
        : valores.municipios.filter((m) => m !== id)
    });
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
        Sin municipios ni componentes marcados, el usuario tiene acceso a todos.
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
        Todos los municipios
      </label>

      <div className="lista-casillas">
        {municipios.map((m) => (
          <label className="casilla" key={m.id}>
            <input
              type="checkbox"
              data-testid={`chk-municipio-${m.id}`}
              disabled={valores.municipiosTodos}
              checked={valores.municipios.includes(m.id)}
              onChange={(e) => alternarMunicipio(m.id, e.target.checked)}
            />
            {m.nombre}
          </label>
        ))}
      </div>

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
