// Listado del padron con buscador y selects encadenados. 100% offline:
// todo se resuelve contra IndexedDB.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Beneficiario } from '@sedea/shared';
import { useSesion } from '../App';
import ListaBeneficiarios from '../componentes/ListaBeneficiarios';
import { catalogosPorGrupo, buscarBeneficiarios, contarBeneficiarios } from '../db/repositorios';
import type { EntradaCatalogoLocal } from '../db/indexeddb';

type Estado = 'todos' | 'pendientes' | 'capturados';

export default function Beneficiarios() {
  const { perfil } = useSesion();
  const esCapturista = perfil?.rol === 'capturista';

  const [regionales, setRegionales] = useState<EntradaCatalogoLocal[]>([]);
  const [municipios, setMunicipios] = useState<EntradaCatalogoLocal[]>([]);
  const [colonias, setColonias] = useState<EntradaCatalogoLocal[]>([]);
  const [secciones, setSecciones] = useState<EntradaCatalogoLocal[]>([]);

  const [regionalId, setRegionalId] = useState<number | null>(perfil?.regional_id ?? null);
  const [municipioClave, setMunicipioClave] = useState<string>('');
  const [coloniaClave, setColoniaClave] = useState<string>('');
  const [seccionValor, setSeccionValor] = useState<string>('');

  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>('todos');
  const [filas, setFilas] = useState<Array<Beneficiario & { capturado: boolean }>>([]);
  const [totalLocal, setTotalLocal] = useState(0);

  // Carga inicial de catalogos locales.
  useEffect(() => {
    void (async () => {
      setRegionales(await catalogosPorGrupo('regional'));
      setMunicipios(await catalogosPorGrupo('municipio'));
      setColonias(await catalogosPorGrupo('colonia'));
      setSecciones(await catalogosPorGrupo('seccion'));
      setTotalLocal(await contarBeneficiarios());
    })();
  }, []);

  const municipiosVisibles = useMemo(() => {
    if (!regionalId) return municipios;
    return municipios.filter((m) => Number(m.datos?.regional_id) === regionalId);
  }, [municipios, regionalId]);

  const coloniasVisibles = useMemo(() => {
    if (!municipioClave) return [];
    return colonias.filter((c) => c.padre_clave === municipioClave);
  }, [colonias, municipioClave]);

  const seccionesVisibles = useMemo(() => {
    if (!coloniaClave) return [];
    return secciones.filter((s) => s.padre_clave === coloniaClave);
  }, [secciones, coloniaClave]);

  const municipioId = useMemo(() => {
    const encontrado = municipios.find((m) => m.clave === municipioClave);
    return encontrado ? Number(encontrado.datos?.id) : null;
  }, [municipios, municipioClave]);

  const coloniaValor = useMemo(() => {
    const encontrada = colonias.find((c) => c.clave === coloniaClave);
    return encontrada ? encontrada.valor : null;
  }, [colonias, coloniaClave]);

  const recargar = useCallback(async () => {
    const resultado = await buscarBeneficiarios({
      texto,
      regional_id: regionalId,
      municipio_id: municipioId,
      colonia: coloniaValor,
      seccion: seccionValor || null,
      estado
    });
    setFilas(resultado);
  }, [texto, regionalId, municipioId, coloniaValor, seccionValor, estado]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <>
      <div className="tarjeta pantalla-ancha">
        <h1>Padrón de beneficiarios</h1>
        <p className="dato">
          {filas.length} de {totalLocal} beneficiarios en este dispositivo.
        </p>

        <div className="campo">
          <label htmlFor="buscador">Buscar por nombre, CURP o folio</label>
          <input
            id="buscador"
            type="search"
            placeholder="Ej. María Hernández, DEMO000001 o BEN-0001"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            data-testid="buscador"
          />
        </div>

        <div className="rejilla">
          <div className="campo">
            <label htmlFor="regional">Dirección Regional</label>
            <select
              id="regional"
              data-testid="select-regional"
              value={regionalId ?? ''}
              disabled={esCapturista}
              onChange={(e) => {
                setRegionalId(e.target.value ? Number(e.target.value) : null);
                setMunicipioClave('');
                setColoniaClave('');
                setSeccionValor('');
              }}
            >
              <option value="">Todas</option>
              {regionales.map((r) => (
                <option key={r.clave} value={Number(r.datos?.id)}>
                  {r.valor}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="municipio">Municipio</label>
            <select
              id="municipio"
              data-testid="select-municipio"
              value={municipioClave}
              onChange={(e) => {
                setMunicipioClave(e.target.value);
                setColoniaClave('');
                setSeccionValor('');
              }}
            >
              <option value="">Todos</option>
              {municipiosVisibles.map((m) => (
                <option key={m.clave} value={m.clave}>
                  {m.valor}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="colonia">Colonia</label>
            <select
              id="colonia"
              data-testid="select-colonia"
              value={coloniaClave}
              disabled={!municipioClave}
              onChange={(e) => {
                setColoniaClave(e.target.value);
                setSeccionValor('');
              }}
            >
              <option value="">Todas</option>
              {coloniasVisibles.map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.valor}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="seccion">Sección</label>
            <select
              id="seccion"
              data-testid="select-seccion"
              value={seccionValor}
              disabled={!coloniaClave}
              onChange={(e) => setSeccionValor(e.target.value)}
            >
              <option value="">Todas</option>
              {seccionesVisibles.map((s) => (
                <option key={s.clave} value={s.valor}>
                  {s.valor}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="chips">
          {(['todos', 'pendientes', 'capturados'] as Estado[]).map((valor) => (
            <button
              key={valor}
              type="button"
              className={`chip ${estado === valor ? 'activo' : ''}`}
              onClick={() => setEstado(valor)}
            >
              {valor === 'todos' ? 'Todos' : valor === 'pendientes' ? 'Pendientes' : 'Capturados'}
            </button>
          ))}
        </div>
      </div>

      <div className="tarjeta">
        <ListaBeneficiarios beneficiarios={filas} />
      </div>
    </>
  );
}
