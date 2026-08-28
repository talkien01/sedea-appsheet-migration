// Monitor de actividad (solo admin): quien esta entrando y que esta haciendo.
// [data-testid="pantalla-monitor"]
//
// Dos secciones con dos fuentes distintas:
//   1. "Usuarios activos ahora"  -> GET /api/admin/presencia (tabla presencia_usuarios,
//      un renglon por usuario, lo que esta pasando AHORA).
//   2. "Actividad reciente"      -> GET /api/auditoria/log (auditoria_log, el
//      historico append-only de acciones sensibles ya registradas).
//
// CRITERIO "activo": ultimo latido dentro de MINUTOS_PRESENCIA_ACTIVA (3 min).
// La PWA late cada 60 s, asi que se toleran dos latidos perdidos antes de dar
// a alguien por desconectado. Quien cae fuera del umbral no desaparece: baja a
// la lista "Estuvieron conectados", que es el mismo dato con otra etiqueta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ETIQUETAS_ROL, type PresenciaUsuario } from '@sedea/shared';
import { api, ErrorPeticion, type FilaActividad } from '../api/cliente';

/** Cada cuanto se vuelve a pedir la foto mientras la pantalla este abierta. */
const INTERVALO_REFRESCO_MS = 20_000;
/** Filas de bitacora que se traen de una vez. */
const FILAS_ACTIVIDAD = 200;

/** "hace 30 segundos" / "hace 2 minutos" / "hace 3 horas". */
function haceCuanto(segundos: number): string {
  if (segundos < 5) return 'ahora mismo';
  if (segundos < 60) return `hace ${segundos} segundos`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Resumen corto del jsonb `detalle` para que quepa en la tabla. */
function resumirDetalle(fila: FilaActividad): string {
  const partes: string[] = [];
  if (fila.entidad) partes.push(`${fila.entidad}${fila.entidad_id ? ` #${fila.entidad_id}` : ''}`);
  const detalle = fila.detalle;
  if (detalle && typeof detalle === 'object') {
    for (const [clave, valor] of Object.entries(detalle)) {
      if (valor === null || valor === undefined || typeof valor === 'object') continue;
      partes.push(`${clave}: ${String(valor)}`);
      if (partes.length >= 4) break;
    }
  }
  return partes.join(' · ') || '—';
}

function nombreDeRol(rol: string): string {
  return rol
    .split('+')
    .map((r) => ETIQUETAS_ROL[r] ?? r)
    .join(' + ');
}

function TablaPresencia({ filas, testId }: { filas: PresenciaUsuario[]; testId: string }) {
  return (
    <div className="tabla-contenedor">
      <table data-testid={testId}>
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Regional</th>
            <th>Pantalla</th>
            <th>Último aviso</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.usuario_id} data-testid="fila-presencia" data-usuario={fila.usuario}>
              <td data-etiqueta="Usuario">
                <strong>{fila.nombre_completo}</strong>
                <br />
                <span className="tenue">{fila.usuario}</span>
              </td>
              <td data-etiqueta="Rol">{nombreDeRol(fila.rol)}</td>
              <td data-etiqueta="Regional">{fila.regional ?? 'Todas'}</td>
              <td data-etiqueta="Pantalla" data-testid="celda-pantalla">
                {fila.etiqueta_pantalla || fila.ruta}
                <br />
                <span className="tenue">{fila.ruta}</span>
              </td>
              <td data-etiqueta="Último aviso" title={formatearFechaHora(fila.visto_en)}>
                {haceCuanto(fila.segundos_desde_visto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Monitor() {
  const [activos, setActivos] = useState<PresenciaUsuario[]>([]);
  const [inactivos, setInactivos] = useState<PresenciaUsuario[]>([]);
  const [umbral, setUmbral] = useState(3);
  const [actividad, setActividad] = useState<FilaActividad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroUsuario, setFiltroUsuario] = useState('');

  // El filtro viaja por ref para que el temporizador de refresco no se recree
  // (ni se reinicie el conteo) cada vez que el admin cambia de persona.
  const filtroRef = useRef(filtroUsuario);
  filtroRef.current = filtroUsuario;

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const parametros = new URLSearchParams({ page_size: String(FILAS_ACTIVIDAD) });
      if (filtroRef.current) parametros.set('usuario_id', filtroRef.current);
      const [presencia, bitacora] = await Promise.all([
        api.presencia(),
        api.actividadReciente(parametros)
      ]);
      setActivos(presencia.activos);
      setInactivos(presencia.inactivos);
      setUmbral(presencia.umbral_minutos);
      setActividad(bitacora.data ?? []);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorPeticion && fallo.estado === 0
          ? 'Esta sección requiere conexión a internet.'
          : (fallo as Error).message
      );
    } finally {
      setCargando(false);
    }
  }, []);

  // Carga inicial y recarga inmediata al cambiar el filtro (sin esperar al
  // refresco automatico).
  useEffect(() => {
    void cargar();
  }, [filtroUsuario, cargar]);

  // Refresco automatico mientras la pantalla esta abierta y visible.
  useEffect(() => {
    const temporizador = window.setInterval(() => {
      if (document.visibilityState === 'visible') void cargar();
    }, INTERVALO_REFRESCO_MS);
    return () => window.clearInterval(temporizador);
  }, [cargar]);

  // Personas que aparecen en la bitacora o en la presencia, para el filtro.
  const opcionesUsuario = new Map<string, string>();
  for (const fila of [...activos, ...inactivos]) {
    opcionesUsuario.set(String(fila.usuario_id), `${fila.nombre_completo} (${fila.usuario})`);
  }
  for (const fila of actividad) {
    if (fila.usuario_id && !opcionesUsuario.has(String(fila.usuario_id))) {
      opcionesUsuario.set(
        String(fila.usuario_id),
        `${fila.nombre_completo ?? fila.usuario ?? 'Usuario'} (${fila.usuario ?? fila.usuario_id})`
      );
    }
  }

  return (
    <div className="tarjeta pantalla-ancha" data-testid="pantalla-monitor">
      <h1>Monitor de actividad</h1>
      <p className="mensaje aviso">
        Quién está usando el sistema en este momento y qué se ha hecho. Se actualiza solo cada{' '}
        {INTERVALO_REFRESCO_MS / 1000} segundos. Se considera <strong>activo</strong> a quien dio
        señal en los últimos {umbral} minutos; la app avisa cada minuto y deja de avisar cuando la
        pestaña queda en segundo plano.
      </p>

      {error && (
        <div className="mensaje error" role="alert" data-testid="error-monitor">
          {error}
        </div>
      )}

      <h2>
        Usuarios activos ahora{' '}
        <span className="badge capturado" data-testid="conteo-activos">
          {activos.length}
        </span>
      </h2>
      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : activos.length === 0 ? (
        <p className="vacio" data-testid="sin-activos">
          Nadie está usando el sistema en este momento.
        </p>
      ) : (
        <TablaPresencia filas={activos} testId="tabla-activos" />
      )}

      <h2>Estuvieron conectados</h2>
      {inactivos.length === 0 ? (
        <p className="vacio" data-testid="sin-inactivos">
          Sin sesiones anteriores registradas.
        </p>
      ) : (
        <TablaPresencia filas={inactivos} testId="tabla-inactivos" />
      )}

      <h2>Actividad reciente</h2>
      <div className="campo">
        <label htmlFor="monitor-filtro-usuario">Filtrar por usuario</label>
        <select
          id="monitor-filtro-usuario"
          data-testid="filtro-usuario"
          value={filtroUsuario}
          onChange={(evento) => setFiltroUsuario(evento.target.value)}
        >
          <option value="">Todos los usuarios</option>
          {[...opcionesUsuario.entries()].map(([id, etiqueta]) => (
            <option key={id} value={id}>
              {etiqueta}
            </option>
          ))}
        </select>
      </div>

      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : actividad.length === 0 ? (
        <p className="vacio" data-testid="sin-actividad">
          Sin acciones registradas.
        </p>
      ) : (
        <div className="tabla-contenedor">
          <table data-testid="tabla-actividad">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {actividad.map((fila) => (
                <tr key={fila.id} data-testid="fila-actividad">
                  <td data-etiqueta="Fecha">{formatearFechaHora(fila.creado_en)}</td>
                  <td data-etiqueta="Usuario">
                    {fila.nombre_completo ?? fila.usuario ?? 'Sin sesión'}
                  </td>
                  <td data-etiqueta="Acción">{fila.accion}</td>
                  <td data-etiqueta="Detalle">{resumirDetalle(fila)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
