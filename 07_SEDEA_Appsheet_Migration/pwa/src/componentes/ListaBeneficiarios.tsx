// Lista virtualizada sencilla: solo renderiza los renglones visibles del
// contenedor con scroll, para soportar padrones grandes en telefonos modestos.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Beneficiario } from '@sedea/shared';

type Fila = Beneficiario & { capturado: boolean };

interface Props {
  beneficiarios: Fila[];
}

const ALTO_FILA = 68;
const COLCHON = 6;

export default function ListaBeneficiarios({ beneficiarios }: Props) {
  const contenedor = useRef<HTMLUListElement>(null);
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [alto, setAlto] = useState(600);

  const visibles = useMemo(() => {
    const inicio = Math.max(0, Math.floor(desplazamiento / ALTO_FILA) - COLCHON);
    const cantidad = Math.ceil(alto / ALTO_FILA) + COLCHON * 2;
    return { inicio, fin: Math.min(beneficiarios.length, inicio + cantidad) };
  }, [desplazamiento, alto, beneficiarios.length]);

  if (beneficiarios.length === 0) {
    return <p className="vacio">Sin resultados</p>;
  }

  const porcion = beneficiarios.slice(visibles.inicio, visibles.fin);

  return (
    <ul
      className="lista"
      ref={contenedor}
      data-testid="lista-beneficiarios"
      onScroll={(e) => {
        setDesplazamiento(e.currentTarget.scrollTop);
        setAlto(e.currentTarget.clientHeight);
      }}
    >
      <li style={{ height: visibles.inicio * ALTO_FILA, border: 'none' }} aria-hidden="true" />
      {porcion.map((b) => (
        <li key={b.id} data-testid="fila-beneficiario">
          <Link to={`/beneficiarios/${b.id}`}>
            <span className="datos">
              <span className="nombre">{b.nombre_completo}</span>
              <span className="detalle">
                {b.curp || 'Sin CURP'} · {b.municipio_nombre ?? 'Sin municipio'} ·{' '}
                {b.tipo_apoyo_nombre ?? 'Sin apoyo asignado'}
              </span>
            </span>
            <span className={`badge ${b.capturado ? 'capturado' : 'pendiente'}`}>
              {b.capturado ? 'Capturado' : 'Pendiente'}
            </span>
          </Link>
        </li>
      ))}
      <li
        style={{ height: (beneficiarios.length - visibles.fin) * ALTO_FILA, border: 'none' }}
        aria-hidden="true"
      />
    </ul>
  );
}
