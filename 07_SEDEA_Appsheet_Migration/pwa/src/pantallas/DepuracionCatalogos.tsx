// Depuracion del staging de catalogos. Version reducida de la de padron: aqui
// basta aprobar o descartar, no existe fusion (decision D5).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ETIQUETAS_ESTADO, ETIQUETAS_FLAG, FLAGS_CATALOGO } from '@sedea/shared';
import { api, ErrorPeticion } from '../api/cliente';
import { BadgesDeFila } from '../componentes/BadgeAlerta';
import { useEstadoRed } from '../sync/estadoRed';

const ESTADOS = ['pendiente', 'aprobado', 'descartado', 'todos'] as const;

export default function DepuracionCatalogos() {
  const enLinea = useEstadoRed();
  const [estado, setEstado] = useState<string>('pendiente');
  const [alerta, setAlerta] = useState<string>('');
  const [grupo, setGrupo] = useState('');
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const parametros = new URLSearchParams({ estado, page_size: '200' });
      if (alerta) parametros.set('alerta', alerta);
      if (grupo.trim()) parametros.set('grupo', grupo.trim());
      setFilas((await api.stagingCatalogos(parametros)).data);
      setError(null);
    } catch {
      setError('No se pudieron cargar los datos.');
    } finally {
      setCargando(false);
    }
  }, [estado, alerta, grupo]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(temporizador);
  }, [cargar, enLinea]);

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  const accionar = async (accion: () => Promise<unknown>, exito: string) => {
    setError(null);
    setAviso(null);
    try {
      await accion();
      setAviso(exito);
      await cargar();
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion && fallo.estado === 409
          ? 'Esta fila ya fue revisada.'
          : 'No se pudo completar la acción.'
      );
      await cargar();
    }
  };

  return (
    <>
      <div className="tarjeta">
        <h1>Depuración de datos — Catálogos</h1>
        <p className="dato">
          Una clave duplicada se resuelve aprobando una fila y descartando la otra.
        </p>

        {aviso && (
          <div className="mensaje exito" role="status" data-testid="toast-exito">
            {aviso}
          </div>
        )}
        {error && (
          <div className="mensaje error" role="alert">
            {error}
          </div>
        )}

        <div className="filtros">
          <label className="campo">
            <span>Estado</span>
            <select
              data-testid="select-estado-catalogos"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              {ESTADOS.map((valor) => (
                <option key={valor} value={valor}>
                  {valor === 'todos' ? 'Todos' : ETIQUETAS_ESTADO[valor as never]}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span>Alerta</span>
            <select
              data-testid="select-alerta-catalogos"
              value={alerta}
              onChange={(e) => setAlerta(e.target.value)}
            >
              <option value="">Todas</option>
              {FLAGS_CATALOGO.map((flag) => (
                <option key={flag} value={flag}>
                  {ETIQUETAS_FLAG[flag] ?? flag}
                </option>
              ))}
              <option value="ninguna">Sin alertas</option>
            </select>
          </label>

          <label className="campo">
            <span>Grupo</span>
            <input
              data-testid="input-grupo-catalogos"
              type="search"
              placeholder="Ej. unidad_medida"
              value={grupo}
              onChange={(e) => setGrupo(e.target.value)}
            />
          </label>
        </div>

        <p className="dato">
          <Link to="/depuracion">Volver a depuración del padrón</Link>
        </p>
      </div>

      <div className="tarjeta">
        <h2>Filas en staging ({filas.length})</h2>
        {cargando && <p className="vacio">Cargando…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-staging-catalogos">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Clave</th>
                  <th>Valor</th>
                  <th>Alertas</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} data-testid="fila-staging-catalogo">
                    <td data-etiqueta="Grupo">{fila.grupo ?? '—'}</td>
                    <td data-etiqueta="Clave" className="mono">{fila.clave ?? '—'}</td>
                    <td data-etiqueta="Valor">{fila.valor ?? '—'}</td>
                    <td data-etiqueta="Alertas">
                      <BadgesDeFila fila={fila} flags={FLAGS_CATALOGO} />
                    </td>
                    <td data-etiqueta="Estado">{ETIQUETAS_ESTADO[fila.estado_revision as never]}</td>
                    <td data-etiqueta="">
                      <button
                        type="button"
                        data-testid="btn-aprobar-catalogo"
                        disabled={fila.estado_revision !== 'pendiente'}
                        onClick={() =>
                          void accionar(
                            () => api.stagingCatalogoAprobar(fila.id),
                            'Entrada de catálogo aprobada.'
                          )
                        }
                      >
                        Aprobar
                      </button>{' '}
                      <button
                        type="button"
                        className="secundario"
                        data-testid="btn-descartar-catalogo"
                        disabled={fila.estado_revision !== 'pendiente'}
                        onClick={() =>
                          void accionar(
                            () => api.stagingCatalogoDescartar(fila.id),
                            'Entrada de catálogo descartada.'
                          )
                        }
                      >
                        Descartar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
