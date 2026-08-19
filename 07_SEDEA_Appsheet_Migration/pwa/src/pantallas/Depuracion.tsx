// Lista de depuracion del staging de padron. Pantalla en linea: no se cachea
// en IndexedDB ni se encola en la sincronizacion (Assumption 26).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ETIQUETAS_ESTADO, ETIQUETAS_FLAG, FLAGS_BENEFICIARIO } from '@sedea/shared';
import type { ResumenStaging } from '@sedea/shared';
import { api } from '../api/cliente';
import { BadgesDeFila } from '../componentes/BadgeAlerta';
import { useEstadoRed } from '../sync/estadoRed';

const ESTADOS = ['pendiente', 'aprobado', 'descartado', 'fusionado', 'todos'] as const;

export default function Depuracion() {
  const enLinea = useEstadoRed();
  const [estado, setEstado] = useState<string>('pendiente');
  const [alerta, setAlerta] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [filas, setFilas] = useState<any[]>([]);
  const [resumen, setResumen] = useState<ResumenStaging | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ estado, page_size: '200' });
      if (alerta) parametros.set('alerta', alerta);
      if (busqueda.trim()) parametros.set('q', busqueda.trim());
      const [pagina, resumenNuevo] = await Promise.all([
        api.stagingBeneficiarios(parametros),
        api.stagingResumen()
      ]);
      setFilas(pagina.data);
      setResumen(resumenNuevo);
    } catch {
      setError('No se pudieron cargar los datos.');
    } finally {
      setCargando(false);
    }
  }, [estado, alerta, busqueda]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(temporizador);
  }, [cargar, enLinea]);

  if (!enLinea) {
    return <p className="vacio">Esta sección requiere conexión a internet.</p>;
  }

  return (
    <>
      <div className="tarjeta">
        <h1>Depuración de datos — Padrón</h1>
        <p className="dato">
          Ninguna fila llega al padrón de campo sin que la apruebes aquí. Un beneficiario puede
          recibir apoyos distintos: revisa antes de descartar.
        </p>

        <div className="tarjetas-resumen">
          {(['pendiente', 'aprobado', 'descartado', 'fusionado'] as const).map((clave) => (
            <div className="metrica" key={clave} data-testid={`resumen-${clave}`}>
              <span className="metrica-valor">{resumen?.beneficiarios.por_estado[clave] ?? 0}</span>
              <span className="metrica-etiqueta">
                {clave === 'pendiente'
                  ? 'Pendientes'
                  : clave === 'aprobado'
                    ? 'Aprobados'
                    : clave === 'descartado'
                      ? 'Descartados'
                      : 'Fusionados'}
              </span>
            </div>
          ))}
          {(['alta', 'media', 'ninguna'] as const).map((nivel) => (
            <div className="metrica" key={nivel} data-testid={`resumen-nivel-${nivel}`}>
              <span className="metrica-valor">{resumen?.beneficiarios.por_nivel[nivel] ?? 0}</span>
              <span className="metrica-etiqueta">
                {nivel === 'alta'
                  ? 'Alerta alta'
                  : nivel === 'media'
                    ? 'Alerta media'
                    : 'Sin alertas'}
              </span>
            </div>
          ))}
        </div>

        <div className="filtros">
          <label className="campo">
            <span>Estado</span>
            <select
              data-testid="select-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              {ESTADOS.map((valor) => (
                <option key={valor} value={valor}>
                  {valor === 'todos' ? 'Todos' : ETIQUETAS_ESTADO[valor]}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span>Alerta</span>
            <select
              data-testid="select-alerta"
              value={alerta}
              onChange={(e) => setAlerta(e.target.value)}
            >
              <option value="">Todas</option>
              {FLAGS_BENEFICIARIO.map((flag) => (
                <option key={flag} value={flag}>
                  {ETIQUETAS_FLAG[flag]}
                </option>
              ))}
              <option value="ninguna">Sin alertas</option>
            </select>
          </label>

          <label className="campo">
            <span>Buscar</span>
            <input
              data-testid="input-busqueda"
              type="search"
              placeholder="Folio, CURP o nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </label>
        </div>

        <p className="dato">
          <Link to="/depuracion/catalogos">Ir a depuración de catálogos</Link>
        </p>
      </div>

      <div className="tarjeta">
        <h2>Filas en staging ({filas.length})</h2>
        {error && <div className="mensaje error" role="alert">{error}</div>}
        {cargando && <p className="vacio">Cargando…</p>}
        {!cargando && filas.length === 0 && <p className="vacio">Sin resultados</p>}

        {!cargando && filas.length > 0 && (
          <div className="tabla-contenedor">
            <table data-testid="tabla-staging">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>CURP</th>
                  <th>Nombre</th>
                  <th>Regional</th>
                  <th>Municipio</th>
                  <th>Concepto de apoyo</th>
                  <th>Alertas</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} data-testid="fila-staging">
                    <td data-etiqueta="Folio" className="mono">{fila.folio ?? '—'}</td>
                    <td data-etiqueta="CURP" className="mono">{fila.curp ?? '—'}</td>
                    <td data-etiqueta="Nombre">{fila.nombre_completo ?? '—'}</td>
                    <td data-etiqueta="Regional">{fila.regional_nombre ?? fila.regional_texto ?? '—'}</td>
                    <td data-etiqueta="Municipio">{fila.municipio_nombre ?? fila.municipio_texto ?? '—'}</td>
                    <td data-etiqueta="Concepto de apoyo">{fila.tipo_apoyo_nombre ?? fila.tipo_apoyo_texto ?? '—'}</td>
                    <td data-etiqueta="Alertas">
                      <BadgesDeFila fila={fila} flags={FLAGS_BENEFICIARIO} />
                    </td>
                    <td data-etiqueta="Estado" data-testid="estado-fila">{ETIQUETAS_ESTADO[fila.estado_revision as never]}</td>
                    <td data-etiqueta="">
                      <Link className="boton secundario" to={`/depuracion/beneficiarios/${fila.id}`}>
                        Revisar
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
