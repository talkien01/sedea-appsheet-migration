// Marca del cascaron. Nacio TIPOGRAFICA (A15-3) con un glifo generico porque
// entonces no habia escudo oficial y no se queria inventar uno. Ese comentario
// dejaba dicho el camino: "si el cliente entrega el escudo oficial, se
// sustituye solo el glifo y nada mas". La Secretaria ya lo entrego, asi que
// eso es exactamente lo que se hizo aqui: cambia el <svg> por el escudo
// recortado del logotipo oficial y los textos SEDEA / CAMPO 2026 siguen
// igual.
//
// Se usa el escudo suelto (no el lockup horizontal completo) porque en la
// barra conviven con los textos: el lockup ya trae "SECRETARIA DE DESARROLLO
// AGROPECUARIO" impreso y se leeria dos veces. El lockup completo si se usa
// en /login, que es la portada oficial del sistema.

interface Props {
  /** En modo rail solo se pinta el glifo (los textos quedan en .sr-solo). */
  soloGlifo?: boolean;
  /** Variante grande para /login y /sin-permiso. */
  grande?: boolean;
}

export default function Marca({ soloGlifo = false, grande = false }: Props) {
  const lado = grande ? 40 : 24;
  return (
    <span className={`marca ${grande ? 'marca-grande' : ''}`}>
      <img
        className="marca-glifo"
        src="/logos/sedea-escudo.png"
        height={lado}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <span className={`marca-textos ${soloGlifo ? 'sr-solo' : ''}`}>
        <span className="marca-nombre">SEDEA</span>
        <span className="marca-sub">CAMPO 2026</span>
      </span>
    </span>
  );
}
