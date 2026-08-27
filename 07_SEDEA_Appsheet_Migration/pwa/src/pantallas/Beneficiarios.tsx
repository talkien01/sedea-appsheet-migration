// Listado del padron con buscador y selects encadenados. 100% offline:
// todo se resuelve contra IndexedDB.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Beneficiario } from '@sedea/shared';
import { useSesion } from '../App';
import ListaBeneficiarios from '../componentes/ListaBeneficiarios';
import { catalogosPorGrupo, buscarBeneficiarios, contarBeneficiarios, obtenerSesion } from '../db/repositorios';
import { URL_API } from '../api/cliente';
import type { EntradaCatalogoLocal } from '../db/indexeddb';

type Estado = 'todos' | 'pendientes' | 'capturados';

/** Dispara la descarga de un blob ya obtenido, sin dejar el objeto URL colgando. */
function descargarBlob(blob: Blob, nombre: string): void {
  const enlace = document.createElement('a');
  const url = URL.createObjectURL(blob);
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

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

  // ---------------------------------------------------------------------
  // Exportar / imprimir el filtro ACTUAL.
  //
  // Ambas acciones son en linea: el CSV y el PDF los arma el backend, que es
  // quien tiene el padron completo y quien aplica el candado por Regional.
  // Se le mandan los mismos filtros que estan en pantalla; el chip
  // pendientes/capturados NO viaja porque "capturado" es un estado local de
  // este dispositivo y el servidor no lo conoce (se avisa en pantalla).
  // ---------------------------------------------------------------------
  const [trabajando, setTrabajando] = useState<null | 'csv' | 'pdf'>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const filtroServidor = useMemo(() => {
    const p: Record<string, string> = {};
    if (regionalId) p.regional_id = String(regionalId);
    if (municipioId) p.municipio_id = String(municipioId);
    if (coloniaValor) p.colonia = coloniaValor;
    if (seccionValor) p.seccion = seccionValor;
    if (texto.trim()) p.q = texto.trim();
    return p;
  }, [regionalId, municipioId, coloniaValor, seccionValor, texto]);

  const exportarCsv = async () => {
    setTrabajando('csv');
    setAviso(null);
    setErrorAccion(null);
    try {
      const sesion = await obtenerSesion();
      const p = new URLSearchParams(filtroServidor);
      const respuesta = await fetch(`${URL_API}/beneficiarios/export.csv?${p.toString()}`, {
        headers: sesion?.token ? { Authorization: `Bearer ${sesion.token}` } : undefined
      });
      if (!respuesta.ok) throw new Error('export');
      descargarBlob(
        await respuesta.blob(),
        `beneficiarios_sedea_${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      setErrorAccion('No fue posible generar el archivo CSV. Revisa tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };

  const imprimirLote = async () => {
    setTrabajando('pdf');
    setAviso(null);
    setErrorAccion(null);
    try {
      const sesion = await obtenerSesion();
      const respuesta = await fetch(`${URL_API}/solicitudes/lote/folio-entrega.pdf`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(sesion?.token ? { Authorization: `Bearer ${sesion.token}` } : {})
        },
        body: JSON.stringify(filtroServidor)
      });
      if (!respuesta.ok) {
        // El backend explica en espanol el lote vacio y el exceso de folios;
        // ese mensaje es mas util que uno generico.
        const cuerpo = (await respuesta.json().catch(() => null)) as {
          error?: { mensaje?: string };
        } | null;
        setErrorAccion(cuerpo?.error?.mensaje ?? 'No fue posible generar los folios de entrega.');
        return;
      }
      const incluidos = Number(respuesta.headers.get('x-folios-incluidos') ?? 0);
      const omitidos = Number(respuesta.headers.get('x-folios-omitidos') ?? 0);
      descargarBlob(
        await respuesta.blob(),
        `folios_entrega_${new Date().toISOString().slice(0, 10)}.pdf`
      );
      setAviso(
        omitidos > 0
          ? `${incluidos} folio(s) en el PDF. Se omitieron ${omitidos} sin autorización del Secretario.`
          : `${incluidos} folio(s) en el PDF.`
      );
    } catch {
      setErrorAccion('No fue posible generar los folios de entrega. Revisa tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };

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

        <div className="acciones-lote">
          <button
            type="button"
            className="secundario"
            data-testid="btn-exportar-beneficiarios-csv"
            disabled={trabajando !== null}
            onClick={() => void exportarCsv()}
          >
            {trabajando === 'csv' ? 'Generando CSV…' : '⬇️ Exportar a CSV'}
          </button>
          <button
            type="button"
            className="secundario"
            data-testid="btn-imprimir-lote-folios"
            disabled={trabajando !== null}
            onClick={() => void imprimirLote()}
          >
            {trabajando === 'pdf'
              ? 'Generando folios…'
              : `🖨️ Imprimir folios de entrega de los ${filas.length} filtrados`}
          </button>
        </div>

        <p className="dato">
          Ambas acciones usan los filtros de Regional, municipio, colonia, sección y búsqueda, y
          requieren conexión. El chip Pendientes/Capturados no aplica: es un estado de este
          dispositivo. En el PDF solo entran los beneficiarios con autorización del Secretario.
        </p>

        {errorAccion && (
          <div className="mensaje error" role="alert" data-testid="error-acciones-lote">
            {errorAccion}
          </div>
        )}
        {aviso && (
          <div className="mensaje" role="status" data-testid="aviso-acciones-lote">
            {aviso}
          </div>
        )}
      </div>

      <div className="tarjeta">
        <ListaBeneficiarios beneficiarios={filas} />
      </div>
    </>
  );
}
