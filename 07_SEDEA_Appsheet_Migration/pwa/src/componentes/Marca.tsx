// Marca del cascaron. Es TIPOGRAFICA a proposito (A15-3): no se usa el
// logotipo de IntechQRO (es la marca de otra empresa) ni se inventa un
// escudo institucional. El glifo es un cuadrado con la esquina achaflanada
// y una barra en --accent. Si el cliente entrega el escudo oficial, se
// sustituye solo el glifo y nada mas.

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
      <svg
        className="marca-glifo"
        width={lado}
        height={lado}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M3 3h13l5 5v13H3z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <rect x="7" y="13" width="10" height="3.2" rx="1" fill="currentColor" />
      </svg>
      <span className={`marca-textos ${soloGlifo ? 'sr-solo' : ''}`}>
        <span className="marca-nombre">SEDEA</span>
        <span className="marca-sub">CAMPO 2026</span>
      </span>
    </span>
  );
}
