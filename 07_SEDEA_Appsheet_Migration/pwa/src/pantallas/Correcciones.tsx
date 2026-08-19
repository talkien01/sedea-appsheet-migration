// Buscador de beneficiarios ya promovidos para corregir sus datos de contacto
// y ubicacion. NO existe alta manual de beneficiarios (decision D11): todo
// beneficiario entra por importacion de padron revisada en Depuracion.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';

export default function Correcciones() {
  const enLinea = useEstadoRed();
  const [busqueda, setBusqueda] = useState('');
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(async (texto: string) => {
    setCargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ page_size: '50' });
      if (texto.trim().length >= 2) parametros.set('q', texto.trim());
      setFilas((await api.correccionesBuscar(parametros)).data);
    } catch {
      setError('No se pudieron cargar los datos.');
    } finally {
      setCargando(false);
    }
  }, []);

  // Debounce de 300 ms para no golpear la API en cada tecla.
  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void buscar(busqueda), 300);
    return () => clearTimeout(temporizador);
  }, [busqueda, buscar, enLinea]);

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  return (
    <>
      <div className="tarjeta">
        <h1>Corrección de datos — Beneficiarios en producción</h1>
        <div className="mensaje aviso" role="status">
          Aquí se corrigen datos de contacto y ubicación de beneficiarios ya promovidos. CURP y
          Folio no se editan. Para altas de beneficiarios usa la importación de padrón
          (Depuración).
        </div>

        <div className="campo">
          <label htmlFor="input-busqueda-correcciones">Buscar por folio, CURP o nombre</label>
          <input
            id="input-busqueda-correcciones"
            data-testid="input-busqueda-correcciones"
            type="search"
            placeholder="Mínimo 2 caracteres"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      <div className="tarjeta">
        <h2>Resultados ({filas.length})</h2>
        {error && <div className="mensaje error" role="alert">{error}</div>}
        {cargando && <p className="vacio">Cargando…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-correcciones">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>CURP</th>
                  <th>Nombre</th>
                  <th>Regional</th>
                  <th>Municipio</th>
                  <th>Colonia</th>
                  <th>Teléfono</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} data-testid="fila-correccion">
                    <td data-etiqueta="Folio" className="mono">{fila.folio}</td>
                    <td data-etiqueta="CURP" className="mono">{fila.curp ?? '—'}</td>
                    <td data-etiqueta="Nombre">{fila.nombre_completo}</td>
                    <td data-etiqueta="Regional">{fila.regional ?? '—'}</td>
                    <td data-etiqueta="Municipio">{fila.municipio ?? '—'}</td>
                    <td data-etiqueta="Colonia">{fila.colonia ?? '—'}</td>
                    <td data-etiqueta="Teléfono">{fila.telefono ?? '—'}</td>
                    <td data-etiqueta="">
                      <Link
                        className="boton secundario"
                        to={`/correcciones/beneficiarios/${fila.id}`}
                      >
                        Corregir
                      </Link>
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
