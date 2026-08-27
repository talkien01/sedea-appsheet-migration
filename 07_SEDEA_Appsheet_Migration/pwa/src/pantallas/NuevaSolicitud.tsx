// Captura de una Solicitud de Apoyo en ventanilla (12.8.2).
//
// Formulario de 6 pasos en una sola pagina. Se guarda SOLO al final, con una
// unica llamada a E42. El folio es de solo lectura: lo genera el backend (D41)
// y se muestra al confirmar el guardado. Pantalla EN LINEA: no se guarda nada
// en el navegador ni se encola nada (D32).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cantidadPorEscalon,
  PATRON_CURP,
  type CatalogosVentanilla,
  type ConflictoCurpConcepto,
  type DocumentoRequeridoCalculado,
  type RespuestaAltaSolicitud,
  type TipoPersona
} from '@sedea/shared';
import { apiSolicitudes } from '../api/solicitudes';
import { ErrorPeticion } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import SeccionSolicitante, { type DatosSolicitante } from '../componentes/SeccionSolicitante';
import SeccionActividad, { type DatosActividad } from '../componentes/SeccionActividad';
import TablaConceptos, {
  filaConceptoVacia,
  type EstadoEscalonConcepto,
  type FilaConcepto
} from '../componentes/TablaConceptos';
import ChecklistDocumentos from '../componentes/ChecklistDocumentos';
import TimerPlazo from '../componentes/TimerPlazo';
import { ESTILO_MAYUSCULAS, aMayusculas } from '../componentes/campoMayusculas';

const solicitanteInicial: DatosSolicitante = {
  tipo_persona: 'fisica',
  nombre_solicitante: '',
  sexo: '',
  fecha_nacimiento: '',
  correo: '',
  telefono: '',
  curp: '',
  razon_social: '',
  num_integrantes: '',
  dom_municipio_id: '',
  dom_localidad: '',
  dom_delegacion: '',
  dom_cp: '',
  dom_tipo_asentamiento: '',
  dom_asentamiento: '',
  dom_tipo_vialidad: '',
  dom_vialidad: ''
};

const actividadInicial: DatosActividad = {
  agricola: false,
  agr_superficie_total_ha: '',
  agr_superficie_siembra_ha: '',
  agr_temporal_ha: '',
  agr_riego_ha: '',
  agr_cultivo_principal: '',
  ganadera: false,
  gan_tipo_ganado: '',
  gan_num_cabezas: '',
  gan_superficie_agostadero_ha: '',
  gan_produccion: '',
  acuicola: false,
  acu_especies: '',
  pesca: false,
  pes_especies: ''
};

/** Convierte texto a numero, o null si viene vacio. */
function numero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export default function NuevaSolicitud() {
  const enLinea = useEstadoRed();
  const navegar = useNavigate();

  const [catalogos, setCatalogos] = useState<CatalogosVentanilla | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaAltaSolicitud | null>(null);

  // B7-C: timer de redirección automática al aparecer el modal de folio generado.
  // Se cancela si el usuario pulsa "Ver solicitud" antes de 4 s.
  const timerRedireccionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!resultado) return;
    // Iniciar countdown de 4 s al montar el modal con el folio.
    timerRedireccionRef.current = setTimeout(() => {
      navegar(`/solicitudes/${resultado.solicitud.id}?nuevo=1`);
    }, 4000);
    return () => {
      if (timerRedireccionRef.current) {
        clearTimeout(timerRedireccionRef.current);
        timerRedireccionRef.current = null;
      }
    };
  }, [resultado, navegar]);

  // Paso 1
  const [programaId, setProgramaId] = useState('');
  const [subprogramaId, setSubprogramaId] = useState('');
  const [componenteId, setComponenteId] = useState('');
  const [modalidadId, setModalidadId] = useState('');
  const [proyectoId, setProyectoId] = useState('');
  const [ventanillaId, setVentanillaId] = useState('');

  // Pasos 2 y 3
  const [solicitante, setSolicitante] = useState<DatosSolicitante>(solicitanteInicial);
  const [actividad, setActividad] = useState<DatosActividad>(actividadInicial);

  // Paso 4
  const [descripcion, setDescripcion] = useState('');
  const [benHTotal, setBenHTotal] = useState('0');
  const [benHDiscapacidad, setBenHDiscapacidad] = useState('0');
  const [benHIndigena, setBenHIndigena] = useState('0');
  const [benMTotal, setBenMTotal] = useState('0');
  const [benMDiscapacidad, setBenMDiscapacidad] = useState('0');
  const [benMIndigena, setBenMIndigena] = useState('0');
  const [ubiMunicipioId, setUbiMunicipioId] = useState('');
  const [ubiLocalidad, setUbiLocalidad] = useState('');
  const [ubiEjido, setUbiEjido] = useState('');
  const [ubiCoordenadas, setUbiCoordenadas] = useState('');

  // Paso 5
  const [conceptos, setConceptos] = useState<FilaConcepto[]>([filaConceptoVacia()]);
  const [observaciones, setObservaciones] = useState('');

  // Paso 6
  const [documentos, setDocumentos] = useState<DocumentoRequeridoCalculado[]>([]);
  const [recibidos, setRecibidos] = useState<Record<string, boolean>>({});
  const [calculandoDocs, setCalculandoDocs] = useState(false);
  // Bug real detectado en produccion (caso bguillen): antes, un fallo de red o
  // del backend al calcular el checklist dejaba `documentos` en [] igual que
  // "todavia no elegiste componente", sin avisar. Ventanilla daba de alta la
  // solicitud pensando que ese concepto simplemente no pedia documentos.
  const [errorDocumentos, setErrorDocumentos] = useState<string | null>(null);
  const [declaracion, setDeclaracion] = useState(false);

  // --- Catalogos: si el alcance deja una sola opcion, queda preseleccionada.
  useEffect(() => {
    if (!enLinea) return;
    void (async () => {
      try {
        const datos = await apiSolicitudes.catalogos();
        setCatalogos(datos);
        if (datos.programas.length >= 1) setProgramaId(String(datos.programas[0].id));
        if (datos.proyectos.length === 1) setProyectoId(String(datos.proyectos[0].id));
        if (datos.componentes.length === 1) setComponenteId(String(datos.componentes[0].id));
        if (datos.ventanillas.length === 1) setVentanillaId(String(datos.ventanillas[0].id));
        const municipiosPredio = datos.municipios_captura ?? datos.municipios;
        if (municipiosPredio.length === 1) setUbiMunicipioId(String(municipiosPredio[0].id));
      } catch {
        setError('No se pudieron cargar los catálogos.');
      }
    })();
  }, [enLinea]);

  // --- Al cambiar Componente: reset modalidadId, preseleccionar si hay 1.
  useEffect(() => {
    if (!catalogos) return;
    const modsDelComponente = (catalogos?.modalidades ?? []).filter(
      (m) => String(m.componente_id) === componenteId
    );
    if (modsDelComponente.length === 1) {
      setModalidadId(String(modsDelComponente[0].id));
    } else {
      setModalidadId('');
    }
  }, [componenteId, catalogos]);

  // --- Proyectos aplicables segun componente y modalidad (R14-1).
  const proyectosFiltrados = useMemo(() => {
    if (!catalogos) return [];
    const compId = componenteId ? Number(componenteId) : null;
    const modId = modalidadId ? Number(modalidadId) : null;
    // Si hay modalidades pero no se selecciono ninguna -> vacio.
    const modsDelComponente = (catalogos.modalidades ?? []).filter(
      (m) => m.componente_id === compId
    );
    if (modsDelComponente.length > 0 && modId === null) {
      return [];
    }
    const base = (catalogos.proyectos ?? []).filter(
      (p) =>
        p.componente_id === compId &&
        (modId === null || p.modalidad_id === modId)
    );
    // Fallback: si base vacia -> todos (no regresion TR/CAA/DIN).
    return base.length === 0 ? catalogos.proyectos : base;
  }, [catalogos, componenteId, modalidadId]);

  // --- Cantidad maxima por superficie (regla de catalogo) ------------------
  // La superficie es la MISMA que valida el backend: la total acreditada por el
  // solicitante y, si esa no se capturo, la de siembra.
  const superficieAcreditada = useMemo(() => {
    const total = Number(actividad.agr_superficie_total_ha);
    if (Number.isFinite(total) && total > 0) return total;
    const siembra = Number(actividad.agr_superficie_siembra_ha);
    return Number.isFinite(siembra) && siembra > 0 ? siembra : null;
  }, [actividad.agr_superficie_total_ha, actividad.agr_superficie_siembra_ha]);

  /**
   * Escalon resuelto por `tipo_apoyo_id`; solo los conceptos con escalones.
   * Distingue el caso "cantidad fija" del caso "superficie insuficiente", que
   * la tabla de conceptos muestra como aviso de no elegibilidad.
   */
  const escalonPorTipoApoyo = useMemo(() => {
    const mapa: Record<string, EstadoEscalonConcepto> = {};
    for (const tipo of catalogos?.tipos_apoyo ?? []) {
      const resultado = cantidadPorEscalon(tipo.escalones_cantidad, superficieAcreditada);
      if (resultado.tipo === 'sin_regla') continue;
      if (resultado.tipo === 'fijo') {
        mapa[String(tipo.id)] = { tipo: 'fijo', cantidad: resultado.cantidad };
      } else if (resultado.tipo === 'no_elegible') {
        mapa[String(tipo.id)] = { tipo: 'no_elegible', minimo: resultado.minimo };
      }
      // `sin_superficie`: todavia no hay contra que calcular, no se avisa nada.
    }
    return mapa;
  }, [catalogos, superficieAcreditada]);

  // Al cambiar la superficie se resugiere la cantidad de las filas que el
  // usuario no haya editado a mano (mismo criterio que `total_manual`).
  useEffect(() => {
    setConceptos((previas) => {
      let cambio = false;
      const siguientes = previas.map((fila) => {
        if (fila.cantidad_manual || !fila.tipo_apoyo_id) return fila;
        const escalon = escalonPorTipoApoyo[fila.tipo_apoyo_id];
        // Si la superficie dejo de alcanzar el minimo, se BORRA la cantidad
        // que se habia sugerido: dejarla ahi al lado de "No elegible" haria
        // creer que ese numero sigue siendo valido.
        if (escalon?.tipo === 'no_elegible') {
          if (fila.cantidad === '') return fila;
          cambio = true;
          return { ...fila, cantidad: '' };
        }
        // Solo se sugiere cantidad cuando la superficie alcanza un escalon.
        if (escalon?.tipo !== 'fijo' || String(escalon.cantidad) === fila.cantidad) return fila;
        cambio = true;
        return { ...fila, cantidad: String(escalon.cantidad) };
      });
      return cambio ? siguientes : previas;
    });
  }, [escalonPorTipoApoyo]);

  const idsConceptos = useMemo(
    () => conceptos.map((c) => Number(c.tipo_apoyo_id)).filter((n) => Number.isInteger(n) && n > 0),
    [conceptos]
  );
  const claveConceptos = idsConceptos.join(',');

  // --- Checklist: se recalcula (debounce 300 ms) cuando cambia el componente,
  // el tipo de persona, el proyecto o los conceptos seleccionados.
  useEffect(() => {
    setErrorDocumentos(null);
    if (!enLinea || !componenteId) {
      setDocumentos([]);
      return;
    }
    setCalculandoDocs(true);
    const temporizador = setTimeout(() => {
      void (async () => {
        try {
          const respuesta = await apiSolicitudes.documentosRequeridos({
            componente_id: Number(componenteId),
            tipo_persona: solicitante.tipo_persona as TipoPersona,
            proyecto_id: proyectoId ? Number(proyectoId) : null,
            tipos_apoyo_ids: claveConceptos ? claveConceptos.split(',').map(Number) : []
          });
          setDocumentos(respuesta.documentos);
        } catch (fallo) {
          // No se deja `documentos` en [] en silencio: eso se veia identico a
          // "este concepto no pide documentos" (Assumption real: 0 pendientes
          // es un resultado valido del calculo, un error de red no lo es).
          setDocumentos([]);
          setErrorDocumentos(
            fallo instanceof ErrorPeticion
              ? `No se pudo calcular la lista de documentos requeridos: ${fallo.message}`
              : 'No se pudo calcular la lista de documentos requeridos. Revisa tu conexión e inténtalo de nuevo.'
          );
        } finally {
          setCalculandoDocs(false);
        }
      })();
    }, 300);
    return () => clearTimeout(temporizador);
  }, [enLinea, componenteId, solicitante.tipo_persona, proyectoId, claveConceptos]);

  // --- Aviso en vivo de CURP ya registrada con el mismo concepto -----------
  // Incidente real: ventanilla recapturo a un beneficiario (misma CURP, mismo
  // concepto) y el sistema no aviso nada hasta que casi se duplica la
  // solicitud. En cuanto la CURP esta completa y hay al menos un concepto
  // elegido se consulta al backend (debounce 300 ms, el mismo criterio del
  // checklist de documentos) y los conceptos en conflicto se marcan en la
  // tabla, deshabilitando el guardado.
  //
  // Da igual como llego la CURP al campo —tecleada, escaneada de la Constancia
  // CURP con la camara o traspasada desde el celular—: aqui solo se lee el
  // valor ya capturado en el estado.
  //
  // Esto es una AYUDA de captura: el bloqueo real lo hace el backend al
  // guardar (422 `curp_concepto_duplicado`), asi que un fallo de red aqui no
  // marca conflictos falsos, solo deja pasar al usuario hasta ese 422.
  const [conflictosCurp, setConflictosCurp] = useState<Record<string, ConflictoCurpConcepto>>({});
  const curpNormalizada = solicitante.curp.trim().toUpperCase();
  const curpCompleta = PATRON_CURP.test(curpNormalizada);

  useEffect(() => {
    if (!enLinea || !curpCompleta || claveConceptos === '') {
      setConflictosCurp({});
      return;
    }
    const temporizador = setTimeout(() => {
      void (async () => {
        try {
          const { conflictos } = await apiSolicitudes.verificarCurpConcepto({
            curp: curpNormalizada,
            tipos_apoyo_ids: claveConceptos.split(',').map(Number)
          });
          const mapa: Record<string, ConflictoCurpConcepto> = {};
          for (const c of conflictos) mapa[String(c.tipo_apoyo_id)] = c;
          setConflictosCurp(mapa);
        } catch {
          // Sin conflictos conocidos: no se inventa un bloqueo por un fallo de
          // red. Si de verdad hay duplicado, el backend lo rechaza al guardar.
          setConflictosCurp({});
        }
      })();
    }, 300);
    return () => clearTimeout(temporizador);
  }, [enLinea, curpCompleta, curpNormalizada, claveConceptos]);

  const hayConflictoCurp = Object.keys(conflictosCurp).length > 0;

  const cambiarSolicitante = useCallback((campo: keyof DatosSolicitante, valor: string) => {
    setSolicitante((previo) => ({ ...previo, [campo]: valor }));
  }, []);

  const cambiarActividad = useCallback(
    (campo: keyof DatosActividad, valor: string | boolean) => {
      setActividad((previo) => ({ ...previo, [campo]: valor }) as DatosActividad);
    },
    []
  );

  const cambiarConcepto = useCallback(
    (indice: number, campo: keyof FilaConcepto, valor: string | boolean) => {
      setConceptos((previas) =>
        previas.map((fila, i) => {
          if (i !== indice) return fila;
          const nueva: FilaConcepto = { ...fila, [campo]: valor } as FilaConcepto;

          // Al elegir el concepto se autocompleta la unidad de medida del catalogo.
          if (campo === 'tipo_apoyo_id') {
            const tipo = catalogos?.tipos_apoyo.find((t) => String(t.id) === String(valor));
            if (tipo?.unidad_medida && !fila.unidad_medida) {
              nueva.unidad_medida = tipo.unidad_medida;
            }
            // La descripcion se toma SIEMPRE del catalogo (no hay variante
            // `_manual` como en cantidad/monto: debe quedar homologada entre
            // solicitantes). Si el concepto no tiene descripcion, la fila
            // queda vacia, que es un dato opcional y no bloquea el guardado.
            nueva.descripcion = tipo?.descripcion ?? '';
          }

          // Al elegir un concepto con escalones se sugiere la cantidad FIJA
          // del escalon que corresponde a la superficie. Si la superficie no
          // alcanza el primer escalon no se autocompleta nada: la tabla avisa
          // que el concepto no es elegible. Es solo una ayuda de captura: el
          // tope real lo impone el backend al guardar y al dictaminar.
          if (campo === 'tipo_apoyo_id' && !fila.cantidad_manual) {
            const escalon = escalonPorTipoApoyo[String(valor)];
            if (escalon?.tipo === 'fijo') nueva.cantidad = String(escalon.cantidad);
            else if (escalon?.tipo === 'no_elegible') nueva.cantidad = '';
          }

          // La cantidad deja de autocalcularse en cuanto se escribe a mano.
          if (campo === 'cantidad') {
            nueva.cantidad_manual = true;
          }

          // El total se autocalcula hasta que el usuario lo escribe a mano.
          if (campo === 'monto_total') {
            nueva.total_manual = true;
          } else if ((campo === 'monto_estatal' || campo === 'monto_productor') && !fila.total_manual) {
            const estatal = Number(campo === 'monto_estatal' ? valor : nueva.monto_estatal) || 0;
            const productor =
              Number(campo === 'monto_productor' ? valor : nueva.monto_productor) || 0;
            nueva.monto_total = String(estatal + productor);
          }
          return nueva;
        })
      );
    },
    [catalogos, escalonPorTipoApoyo]
  );

  const agregarConcepto = useCallback(
    () => setConceptos((previas) => [...previas, filaConceptoVacia()]),
    []
  );
  const quitarConcepto = useCallback(
    (indice: number) =>
      setConceptos((previas) => (previas.length <= 1 ? previas : previas.filter((_, i) => i !== indice))),
    []
  );

  // --- Habilitacion del boton de guardar (12.8.2, paso 6) ------------------
  const esColectiva = solicitante.tipo_persona === 'moral' || solicitante.tipo_persona === 'grupo';
  const conceptosValidos =
    conceptos.length > 0 &&
    conceptos.every((c) => c.tipo_apoyo_id !== '' && Number(c.cantidad) > 0);
  const puedeGuardar =
    declaracion &&
    !guardando &&
    // Un concepto ya solicitado por esta CURP no se puede guardar: hay que
    // quitarlo de la tabla. El backend lo rechaza igual (422).
    !hayConflictoCurp &&
    programaId !== '' &&
    componenteId !== '' &&
    proyectoId !== '' &&
    ventanillaId !== '' &&
    solicitante.nombre_solicitante.trim() !== '' &&
    ubiMunicipioId !== '' &&
    conceptosValidos &&
    (!esColectiva ||
      (solicitante.razon_social.trim() !== '' && Number(solicitante.num_integrantes) >= 1));

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const cuerpo: Record<string, unknown> = {
        programa_id: Number(programaId),
        subprograma_id: subprogramaId ? Number(subprogramaId) : null,
        componente_id: Number(componenteId),
        proyecto_id: Number(proyectoId),
        ventanilla_id: Number(ventanillaId),
        modalidad_id: modalidadId ? Number(modalidadId) : null,
        tipo_persona: solicitante.tipo_persona,
        nombre_solicitante: solicitante.nombre_solicitante,
        sexo: solicitante.sexo || null,
        fecha_nacimiento: solicitante.fecha_nacimiento || null,
        correo: solicitante.correo || null,
        telefono: solicitante.telefono || null,
        curp: solicitante.curp || null,
        razon_social: solicitante.razon_social || null,
        num_integrantes: numero(solicitante.num_integrantes),
        domicilio: {
          municipio_id: solicitante.dom_municipio_id ? Number(solicitante.dom_municipio_id) : null,
          localidad: solicitante.dom_localidad || null,
          delegacion: solicitante.dom_delegacion || null,
          cp: solicitante.dom_cp || null,
          tipo_asentamiento: solicitante.dom_tipo_asentamiento || null,
          asentamiento: solicitante.dom_asentamiento || null,
          tipo_vialidad: solicitante.dom_tipo_vialidad || null,
          vialidad: solicitante.dom_vialidad || null
        },
        actividad: {
          agricola: actividad.agricola,
          agr_superficie_total_ha: numero(actividad.agr_superficie_total_ha),
          agr_superficie_siembra_ha: numero(actividad.agr_superficie_siembra_ha),
          agr_temporal_ha: numero(actividad.agr_temporal_ha),
          agr_riego_ha: numero(actividad.agr_riego_ha),
          agr_cultivo_principal: actividad.agr_cultivo_principal || null,
          ganadera: actividad.ganadera,
          gan_tipo_ganado: actividad.gan_tipo_ganado || null,
          gan_num_cabezas: numero(actividad.gan_num_cabezas),
          gan_superficie_agostadero_ha: numero(actividad.gan_superficie_agostadero_ha),
          gan_produccion: actividad.gan_produccion || null,
          acuicola: actividad.acuicola,
          acu_especies: actividad.acu_especies || null,
          pesca: actividad.pesca,
          pes_especies: actividad.pes_especies || null
        },
        apoyo: {
          descripcion_proyecto: descripcion || null,
          ben_hombres_total: Number(benHTotal) || 0,
          ben_hombres_discapacidad: Number(benHDiscapacidad) || 0,
          ben_hombres_lengua_indigena: Number(benHIndigena) || 0,
          ben_mujeres_total: Number(benMTotal) || 0,
          ben_mujeres_discapacidad: Number(benMDiscapacidad) || 0,
          ben_mujeres_lengua_indigena: Number(benMIndigena) || 0,
          ubicacion: {
            municipio_id: Number(ubiMunicipioId),
            localidad: ubiLocalidad || null,
            ejido: ubiEjido || null,
            coordenadas: ubiCoordenadas || null
          }
        },
        conceptos: conceptos.map((c) => ({
          tipo_apoyo_id: Number(c.tipo_apoyo_id),
          descripcion: c.descripcion || null,
          cantidad: Number(c.cantidad),
          unidad_medida: c.unidad_medida || null,
          monto_estatal: Number(c.monto_estatal) || 0,
          monto_productor: Number(c.monto_productor) || 0,
          monto_total: numero(c.monto_total)
        })),
        documentos: documentos.map((d) => ({
          documento_requerido_id: d.documento_requerido_id,
          requisito: d.requisito,
          recibido: recibidos[d.requisito] === true
        })),
        observaciones: observaciones || null,
        declaracion_aceptada: declaracion
      };

      setResultado(await apiSolicitudes.crear(cuerpo));
    } catch (fallo) {
      // El mensaje del backend viene en espanol y se muestra tal cual.
      setError(
        fallo instanceof ErrorPeticion ? fallo.message : 'No fue posible guardar la solicitud.'
      );
    } finally {
      setGuardando(false);
    }
  };

  if (!enLinea) return <p className="vacio">Esta sección requiere conexión a internet.</p>;

  const subprogramasDelPrograma = (catalogos?.subprogramas ?? []).filter(
    (s) => !programaId || String(s.programa_id) === programaId
  );

  return (
    <>
      <div className="tarjeta">
        <h1>Nueva solicitud de apoyo</h1>
        <p className="dato">
          Captura el formulario tal como viene en papel. El folio se genera al guardar.
        </p>
        <TimerPlazo />
        {error && (
          <div className="mensaje error" role="alert" data-testid="error-solicitud">
            {error}
          </div>
        )}
      </div>

      {/* En escritorio el formulario largo gana un indice lateral pegajoso.
          Es puramente visual: no cambia ningun campo ni ninguna validacion. */}
      <div className="con-indice">
        <nav className="indice-secciones" aria-label="Secciones del formulario">
          <a href="#paso-1">1 · Encabezado</a>
          <a href="#paso-2">2 · Solicitante</a>
          <a href="#paso-3">3 · Actividad</a>
          <a href="#paso-4">4 · Datos del apoyo</a>
          <a href="#paso-5">5 · Conceptos</a>
          <a href="#paso-6">6 · Documentos</a>
        </nav>

        <div className="columna-pasos">
      {/* ---------------------------- Paso 1 ---------------------------- */}
      <div className="tarjeta" id="paso-1" data-testid="paso-1">
        <h2>Paso 1 — Encabezado</h2>
        <div data-testid="seccion-encabezado">
          <div className="campo">
            <label>Folio</label>
            {/* Sin input editable: el folio lo genera el backend (D41). */}
            <p className="dato" data-testid="folio-pendiente">
              Se generará al guardar
            </p>
          </div>

          <div className="campo">
            <label htmlFor="select-programa">Programa</label>
            <select
              id="select-programa"
              data-testid="select-programa"
              value={programaId}
              onChange={(e) => setProgramaId(e.target.value)}
            >
              <option value="">Selecciona un programa</option>
              {(catalogos?.programas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="select-subprograma">Subprograma</label>
            <select
              id="select-subprograma"
              data-testid="select-subprograma"
              value={subprogramaId}
              onChange={(e) => setSubprogramaId(e.target.value)}
            >
              <option value="">Sin subprograma</option>
              {subprogramasDelPrograma.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>

          <fieldset data-testid="grupo-componente">
            <legend>Componente (selección única)</legend>
            {(catalogos?.componentes ?? []).map((c) => (
              <label className="casilla" key={c.id}>
                <input
                  type="radio"
                  name="componente"
                  data-testid={`radio-componente-${c.clave}`}
                  checked={componenteId === String(c.id)}
                  onChange={() => {
                    setComponenteId(String(c.id));
                    // Al cambiar componente, el proyecto se limpia si ya no aplica.
                    const modsDelComponente = (catalogos?.modalidades ?? []).filter(
                      (m) => m.componente_id === c.id
                    );
                    if (modsDelComponente.length === 0) {
                      // Sin modalidades: validar que el proyecto siga aplicando.
                      const proyectoAunValido = (catalogos?.proyectos ?? []).some(
                        (p) => String(p.id) === proyectoId && p.componente_id === c.id
                      );
                      if (!proyectoAunValido) setProyectoId('');
                    }
                  }}
                />
                {c.clave} — {c.nombre}
              </label>
            ))}
          </fieldset>

          {/* Selector de Modalidad (Build 8): solo si el componente tiene modalidades */}
          {(catalogos?.modalidades ?? []).some(
            (m) => String(m.componente_id) === componenteId
          ) && (
            <div className="campo">
              <label htmlFor="select-modalidad">Modalidad</label>
              <select
                id="select-modalidad"
                data-testid="select-modalidad"
                value={modalidadId}
                onChange={(e) => {
                  setModalidadId(e.target.value);
                  // Al cambiar modalidad, limpiar proyecto si ya no aplica.
                  const modId = Number(e.target.value);
                  const proyectoAunValido = (catalogos?.proyectos ?? []).some(
                    (p) => String(p.id) === proyectoId && p.modalidad_id === modId
                  );
                  if (!proyectoAunValido) setProyectoId('');
                }}
              >
                <option value="">Selecciona una modalidad</option>
                {(catalogos?.modalidades ?? [])
                  .filter((m) => String(m.componente_id) === componenteId)
                  .map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.nombre}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Si el componente no tiene modalidades, mostrar "No aplica" */}
          {componenteId &&
            !(catalogos?.modalidades ?? []).some(
              (m) => String(m.componente_id) === componenteId
            ) && (
            <p className="dato" data-testid="modalidad-no-aplica">No aplica</p>
          )}

          <div className="campo">
            <label htmlFor="select-proyecto">Proyecto</label>
            <select
              id="select-proyecto"
              data-testid="select-proyecto"
              value={proyectoId}
              onChange={(e) => setProyectoId(e.target.value)}
            >
              <option value="">Selecciona un proyecto</option>
              {proyectosFiltrados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="select-ventanilla">Ventanilla receptora</label>
            <select
              id="select-ventanilla"
              data-testid="select-ventanilla"
              value={ventanillaId}
              onChange={(e) => setVentanillaId(e.target.value)}
            >
              <option value="">Selecciona una ventanilla</option>
              {(catalogos?.ventanillas ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ---------------------------- Paso 2 ---------------------------- */}
      <div className="tarjeta" id="paso-2" data-testid="paso-2">
        <h2>Paso 2 — Datos del solicitante</h2>
        <SeccionSolicitante
          valores={solicitante}
          municipios={catalogos?.municipios_captura ?? catalogos?.municipios ?? []}
          cambiar={cambiarSolicitante}
        />
      </div>

      {/* ---------------------------- Paso 3 ---------------------------- */}
      <div className="tarjeta" id="paso-3" data-testid="paso-3">
        <h2>Paso 3 — Actividad económica</h2>
        <SeccionActividad valores={actividad} cambiar={cambiarActividad} />
      </div>

      {/* ---------------------------- Paso 4 ---------------------------- */}
      <div className="tarjeta" id="paso-4" data-testid="paso-4">
        <h2>Paso 4 — Datos del apoyo</h2>
        <div data-testid="seccion-apoyo">
          <div className="campo">
            <label htmlFor="textarea-descripcion-proyecto">Descripción del proyecto</label>
            <textarea
              id="textarea-descripcion-proyecto"
              data-testid="textarea-descripcion-proyecto"
              rows={4}
              value={descripcion}
              style={ESTILO_MAYUSCULAS}
              onChange={(e) => setDescripcion(aMayusculas(e.target.value))}
            />
          </div>

          <h3>Beneficiarios directos</h3>
          <div className="campo">
            <label htmlFor="input-ben-h-total">Hombres — total</label>
            <input
              id="input-ben-h-total"
              data-testid="input-ben-h-total"
              type="number"
              min={0}
              value={benHTotal}
              onChange={(e) => setBenHTotal(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-ben-h-discapacidad">Hombres — con discapacidad</label>
            <input
              id="input-ben-h-discapacidad"
              data-testid="input-ben-h-discapacidad"
              type="number"
              min={0}
              value={benHDiscapacidad}
              onChange={(e) => setBenHDiscapacidad(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-ben-h-indigena">Hombres — hablantes de lengua indígena</label>
            <input
              id="input-ben-h-indigena"
              data-testid="input-ben-h-indigena"
              type="number"
              min={0}
              value={benHIndigena}
              onChange={(e) => setBenHIndigena(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-ben-m-total">Mujeres — total</label>
            <input
              id="input-ben-m-total"
              data-testid="input-ben-m-total"
              type="number"
              min={0}
              value={benMTotal}
              onChange={(e) => setBenMTotal(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-ben-m-discapacidad">Mujeres — con discapacidad</label>
            <input
              id="input-ben-m-discapacidad"
              data-testid="input-ben-m-discapacidad"
              type="number"
              min={0}
              value={benMDiscapacidad}
              onChange={(e) => setBenMDiscapacidad(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-ben-m-indigena">Mujeres — hablantes de lengua indígena</label>
            <input
              id="input-ben-m-indigena"
              data-testid="input-ben-m-indigena"
              type="number"
              min={0}
              value={benMIndigena}
              onChange={(e) => setBenMIndigena(e.target.value)}
            />
          </div>
        </div>

        <div data-testid="seccion-ubicacion">
          <h3>4.1 Ubicación del apoyo</h3>
          <div className="mensaje aviso" role="status">
            Ubicación del predio o proyecto. Es la dirección que visitará el capturista de campo.
          </div>

          <div className="campo">
            <label htmlFor="select-ubi-municipio">Municipio</label>
            <select
              id="select-ubi-municipio"
              data-testid="select-ubi-municipio"
              value={ubiMunicipioId}
              onChange={(e) => setUbiMunicipioId(e.target.value)}
            >
              <option value="">Selecciona un municipio</option>
              {(catalogos?.municipios_captura ?? catalogos?.municipios ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="input-ubi-localidad">Localidad</label>
            <input
              id="input-ubi-localidad"
              data-testid="input-ubi-localidad"
              type="text"
              value={ubiLocalidad}
              style={ESTILO_MAYUSCULAS}
              onChange={(e) => setUbiLocalidad(aMayusculas(e.target.value))}
            />
          </div>

          <div className="campo">
            <label htmlFor="input-ubi-ejido">Ejido</label>
            <input
              id="input-ubi-ejido"
              data-testid="input-ubi-ejido"
              type="text"
              value={ubiEjido}
              style={ESTILO_MAYUSCULAS}
              onChange={(e) => setUbiEjido(aMayusculas(e.target.value))}
            />
          </div>

          <div className="campo">
            <label htmlFor="input-ubi-coordenadas">Coordenadas declaradas</label>
            {/* Texto libre: lo que el productor declara en papel (D42). */}
            <input
              id="input-ubi-coordenadas"
              data-testid="input-ubi-coordenadas"
              type="text"
              placeholder="20.185, -100.145"
              value={ubiCoordenadas}
              onChange={(e) => setUbiCoordenadas(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ---------------------------- Paso 5 ---------------------------- */}
      <div className="tarjeta" id="paso-5" data-testid="paso-5">
        <h2>Paso 5 — Conceptos de apoyo</h2>
        <TablaConceptos
          filas={conceptos}
          tiposApoyo={catalogos?.tipos_apoyo ?? []}
          escalones={escalonPorTipoApoyo}
          conflictosCurp={conflictosCurp}
          cambiar={cambiarConcepto}
          agregar={agregarConcepto}
          quitar={quitarConcepto}
        />
        <div className="campo">
          <label htmlFor="textarea-observaciones">Observaciones</label>
          <textarea
            id="textarea-observaciones"
            data-testid="textarea-observaciones"
            rows={3}
            value={observaciones}
            style={ESTILO_MAYUSCULAS}
            onChange={(e) => setObservaciones(aMayusculas(e.target.value))}
          />
        </div>
      </div>

      {/* ---------------------------- Paso 6 ---------------------------- */}
      <div className="tarjeta" id="paso-6" data-testid="paso-6">
        <h2>Paso 6 — Documentos y declaraciones</h2>
        <ChecklistDocumentos
          documentos={documentos}
          recibidos={recibidos}
          calculando={calculandoDocs}
          error={errorDocumentos}
          declaracion={declaracion}
          alMarcar={(requisito, marcado) =>
            setRecibidos((previos) => ({ ...previos, [requisito]: marcado }))
          }
          alAceptarDeclaracion={setDeclaracion}
        />

        {/* El detalle por concepto vive en la tabla del paso 5; aqui solo se
            explica por que el boton quedo deshabilitado. */}
        {hayConflictoCurp && (
          <div className="mensaje error" role="alert" data-testid="bloqueo-curp-duplicada">
            No se puede guardar: esta CURP ya tiene una solicitud registrada con alguno de los
            conceptos del paso 5. Quítalo de la tabla para continuar.
          </div>
        )}

        <div className="acciones">
          <button
            type="button"
            data-testid="btn-guardar-solicitud"
            disabled={!puedeGuardar}
            onClick={() => void guardar()}
          >
            {guardando ? 'Guardando…' : 'Guardar solicitud'}
          </button>
        </div>
      </div>

        </div>
      </div>

      {/* Confirmacion con el folio real generado por el backend. */}
      {resultado && (
        <div className="modal-fondo" role="dialog" aria-modal="true">
          <div className="modal tarjeta" data-testid="modal-folio-generado">
            <h2>Solicitud registrada</h2>
            <p>Folio asignado:</p>
            <p className="folio-grande" data-testid="texto-folio">
              {resultado.solicitud.folio}
            </p>

            <h3>Beneficiarios creados</h3>
            <ul>
              {resultado.beneficiarios_creados.map((b) => (
                <li key={b.id}>{b.folio}</li>
              ))}
            </ul>

            <div className="acciones">
              <button
                type="button"
                data-testid="btn-ver-solicitud"
                onClick={() => {
                  // Cancelar el timer automático y navegar de inmediato con ?nuevo=1.
                  if (timerRedireccionRef.current) {
                    clearTimeout(timerRedireccionRef.current);
                    timerRedireccionRef.current = null;
                  }
                  navegar(`/solicitudes/${resultado.solicitud.id}?nuevo=1`);
                }}
              >
                Ver solicitud
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
