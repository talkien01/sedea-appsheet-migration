// Barra lateral de navegacion. Solo se MONTA en tablet y escritorio: en movil
// no existe en el DOM (lo decide Cascaron.tsx con matchMedia), para que ningun
// data-testid `nav-*` quede duplicado.
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { estaActivo, gruposDeRol } from '../navegacion/menu';
import { IconoPanel } from './Iconos';
import Marca from './Marca';
import MenuUsuario from './MenuUsuario';
import ToggleTema from './ToggleTema';

export type ModoLateral = 'rail' | 'expandido';

interface Props {
  rol: string | null | undefined;
  modo: ModoLateral;
  alAlternarModo: () => void;
  /** true cuando en tablet se abre encima del contenido. */
  esOverlay?: boolean;
  /** Se invoca al navegar (cierra el overlay de tablet). */
  alNavegar?: () => void;
  /** Se invoca al pulsar la marca (abre el overlay en tablet). */
  alPulsarMarca?: () => void;
}

export default function BarraLateral({
  rol,
  modo,
  alAlternarModo,
  esOverlay = false,
  alNavegar,
  alPulsarMarca
}: Props) {
  const ubicacion = useLocation();
  const grupos = gruposDeRol(rol);
  const esRail = modo === 'rail' && !esOverlay;

  // En overlay, Escape cierra.
  useEffect(() => {
    if (!esOverlay || !alNavegar) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') alNavegar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [esOverlay, alNavegar]);

  const textoColapsar = esRail ? 'Expandir la barra lateral' : 'Colapsar la barra lateral';

  return (
    <nav
      className="barra-lateral"
      data-testid="barra-lateral"
      data-modo={esRail ? 'rail' : 'expandido'}
      data-overlay={esOverlay ? 'si' : 'no'}
      aria-label="Navegación principal"
    >
      <div className="barra-lateral-cabecera">
        <button
          type="button"
          className="secundario"
          style={{ border: 0, background: 'transparent', padding: 0, minHeight: 'auto' }}
          onClick={alPulsarMarca}
          aria-label="SEDEA Campo 2026"
        >
          <Marca soloGlifo={esRail} />
        </button>
      </div>

      <div className="barra-lateral-cuerpo">
        {grupos.map(({ grupo, destinos }) => (
          <div className="nav-grupo" key={grupo}>
            <div className="nav-grupo-titulo">{grupo}</div>
            {destinos.map(({ id, ruta, etiqueta, testId, Icono }) => {
              const activo = estaActivo(ruta, ubicacion.pathname);
              return (
                <Link
                  key={id}
                  to={ruta}
                  className="nav-item"
                  data-testid={testId}
                  aria-current={activo ? 'page' : undefined}
                  aria-label={etiqueta}
                  title={etiqueta}
                  onClick={alNavegar}
                >
                  <Icono tamano={20} />
                  {/* En rail la etiqueta se oculta visualmente pero sigue en
                      el arbol de accesibilidad y el item sigue clickeable. */}
                  <span className={esRail ? 'sr-solo' : ''}>{etiqueta}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="barra-lateral-pie">
        <MenuUsuario compacto={esRail} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <ToggleTema />
          <button
            type="button"
            className="toggle-tema boton-colapsar"
            data-testid="colapsar-lateral"
            aria-label={textoColapsar}
            title={textoColapsar}
            aria-pressed={esRail}
            onClick={alAlternarModo}
          >
            <IconoPanel tamano={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
