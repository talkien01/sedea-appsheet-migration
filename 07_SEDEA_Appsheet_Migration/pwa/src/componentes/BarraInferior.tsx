// Barra inferior de accesos rapidos. Solo se MONTA en movil (< 768px): en
// tablet y escritorio no existe en el DOM, para que ningun data-testid `nav-*`
// quede duplicado con los de la barra lateral.
//
// Maximo 5 celdas: hasta 4 destinos del rol + el boton "Mas".
import { useCallback, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { estaActivo, repartoMovil } from '../navegacion/menu';
import { IconoMas } from './Iconos';
import HojaMas from './HojaMas';

interface Props {
  rol: string | null | undefined;
}

export default function BarraInferior({ rol }: Props) {
  const ubicacion = useLocation();
  const { celdas, enMas } = repartoMovil(rol);
  const [abierta, setAbierta] = useState(false);
  const botonMas = useRef<HTMLButtonElement | null>(null);

  // Al cerrar, el foco vuelve al boton que abrio la hoja.
  const cerrar = useCallback(() => {
    setAbierta(false);
    botonMas.current?.focus();
  }, []);

  return (
    <>
      <nav className="barra-inferior" data-testid="barra-inferior" aria-label="Accesos rápidos">
        {celdas.map(({ id, ruta, etiqueta, testId, Icono }) => {
          const activo = estaActivo(ruta, ubicacion.pathname);
          return (
            <Link
              key={id}
              to={ruta}
              className="celda-inferior"
              data-testid={testId}
              aria-current={activo ? 'page' : undefined}
              aria-label={etiqueta}
            >
              <Icono tamano={22} />
              <span className="celda-inferior-texto">{etiqueta}</span>
            </Link>
          );
        })}

        <button
          type="button"
          ref={botonMas}
          className="celda-inferior"
          data-testid="mas-opciones"
          aria-label="Más opciones"
          aria-haspopup="dialog"
          aria-expanded={abierta}
          onClick={() => setAbierta((previo) => !previo)}
        >
          <IconoMas tamano={22} />
          <span className="celda-inferior-texto">Más</span>
        </button>
      </nav>

      {abierta && <HojaMas destinos={enMas} alCerrar={cerrar} />}
    </>
  );
}
