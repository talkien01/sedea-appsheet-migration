// Hoja "Mas" de la barra inferior (solo movil).
// Sube desde abajo, atrapa el foco, se cierra con Escape o con click en el
// velo, y devuelve el foco al boton que la abrio.
//
// A proposito NO monta ToggleTema: en movil el unico toggle visible es el de
// la franja de estado (regla de S15.6.3: exactamente uno por viewport).
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { estaActivo, type Destino } from '../navegacion/menu';
import MenuUsuario from './MenuUsuario';

interface Props {
  destinos: Destino[];
  alCerrar: () => void;
}

export default function HojaMas({ destinos, alCerrar }: Props) {
  const ubicacion = useLocation();
  const hoja = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // El foco entra a la hoja al abrir.
    const enfocables = hoja.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])'
    );
    enfocables?.[0]?.focus();

    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        alCerrar();
        return;
      }
      if (evento.key !== 'Tab') return;
      // Trampa de foco.
      const lista = hoja.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])'
      );
      if (!lista || lista.length === 0) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCerrar]);

  return (
    <>
      <div className="velo-hoja" onClick={alCerrar} aria-hidden="true" />
      <div
        className="hoja-mas"
        data-testid="hoja-mas"
        role="dialog"
        aria-modal="true"
        aria-label="Más opciones"
        ref={hoja}
      >
        <div className="hoja-asa" aria-hidden="true" />

        {destinos.map(({ id, ruta, etiqueta, testId, Icono }) => (
          <Link
            key={id}
            to={ruta}
            className="nav-item"
            data-testid={testId}
            aria-current={estaActivo(ruta, ubicacion.pathname) ? 'page' : undefined}
            aria-label={etiqueta}
            onClick={alCerrar}
          >
            <Icono tamano={20} />
            <span>{etiqueta}</span>
          </Link>
        ))}

        <MenuUsuario />
      </div>
    </>
  );
}
