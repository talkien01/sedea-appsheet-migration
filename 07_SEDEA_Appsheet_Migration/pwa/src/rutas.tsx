// Definicion de rutas de la aplicacion.
// El control de acceso por rol se endurece a partir del build 2:
//   /beneficiarios*, /sync   -> capturista, admin
//   /gestion/beneficiarios   -> auditor, admin (consulta en linea)
//   /auditoria*              -> auditor, admin
//   /depuracion*             -> editor_datos, admin
//   /correcciones*           -> editor_datos, admin
//   /dashboard               -> admin, auditor, editor_datos
//   /solicitudes*            -> ventanilla, admin (build 6, en linea)
import { Navigate, Route, Routes } from 'react-router-dom';
import { puedeGestionarEntregas } from '@sedea/shared';
import Cascaron from './componentes/Cascaron';
import RutaProtegida from './componentes/RutaProtegida';
import Login from './pantallas/Login';
import Sync from './pantallas/Sync';
import Beneficiarios from './pantallas/Beneficiarios';
import BeneficiariosOnline from './pantallas/BeneficiariosOnline';
import PrepararEntrega from './pantallas/PrepararEntrega';
import ConciliacionCamiones from './pantallas/ConciliacionCamiones';
import FichaBeneficiario from './pantallas/FichaBeneficiario';
import NuevaCaptura from './pantallas/NuevaCaptura';
import Auditoria from './pantallas/Auditoria';
import Expediente from './pantallas/Expediente';
import Depuracion from './pantallas/Depuracion';
import DepuracionDetalle from './pantallas/DepuracionDetalle';
import DepuracionCatalogos from './pantallas/DepuracionCatalogos';
import Correcciones from './pantallas/Correcciones';
import Dashboard from './pantallas/Dashboard';
import Usuarios from './pantallas/Usuarios';
import Solicitudes from './pantallas/Solicitudes';
import NuevaSolicitud from './pantallas/NuevaSolicitud';
import DetalleSolicitud from './pantallas/DetalleSolicitud';
import FolioEntrega from './componentes/FolioEntrega';
import CambiarPassword from './pantallas/CambiarPassword';
import SinPermiso from './pantallas/SinPermiso';
import Catalogos from './pantallas/Catalogos';
import CatalogoDocumentos from './pantallas/CatalogoDocumentos';
import CatalogoPlazos from './pantallas/CatalogoPlazos';
import Dictamen from './pantallas/Dictamen';
import DictamenDetalle from './pantallas/DictamenDetalle';
import EscaneoMovil from './pantallas/EscaneoMovil';
import RegistrarEntrega from './pantallas/RegistrarEntregaMonitorizada';
import Monitor from './pantallas/Monitor';
import EdicionAdminSolicitudes from './pantallas/EdicionAdminSolicitudes';

const CAMPO = ['capturista', 'admin'];
const AUDITORIA = ['auditor', 'admin'];
const DEPURACION = ['editor_datos', 'admin'];
const GESTION = ['admin', 'auditor', 'editor_datos'];
// Administracion de usuarios: admin y editor de datos (D15).
const USUARIOS = ['admin', 'editor_datos'];
// Monitor de actividad en vivo: SOLO admin (no lo hereda editor_datos).
const MONITOR = ['admin'];
// Edicion administrativa de solicitudes: SOLO admin (unica excepcion a D44).
const EDICION_ADMIN = ['admin'];
// Modulo de ventanilla: rol nuevo `ventanilla` y admin (D34).
const VENTANILLA = ['ventanilla', 'capturista', 'admin'];
// Build 13: pre-dictaminacion con IA. El rol `dictaminador` NO hereda
// permisos de `ventanilla` (A19-12): entra a /dictamen y no a /solicitudes.
const DICTAMEN = ['dictaminador', 'admin'];
// Registro de entrega del apoyo: quien va al evento a entregar fisicamente.
// Debe coincidir con ROLES_ENTREGA del backend y ademas cumplir la capacidad
// multi-rol `puedeGestionarEntregas`.
const ENTREGAS = ['ventanilla', 'capturista', 'admin'];

export default function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/*
        E60: pantalla del celular vinculado. Va FUERA del cascaron y sin
        RutaProtegida a proposito: se abre en un telefono sin sesion. El token
        de la URL es la unica credencial y solo sirve para entregar un escaneo.
      */}
      <Route path="/escaneo-movil/:token" element={<EscaneoMovil />} />
      {/*
        Parte 2 del registro de entrega: pantalla de campo. Va FUERA del
        cascaron a proposito (mismo patron que /escaneo-movil): en modo de
        campo no hay barra lateral ni barra inferior, es una herramienta de un
        solo proposito y de aqui solo se sale con el boton "Salir". Si va
        protegida por sesion y rol: aqui si hay usuario con sesion iniciada.
      */}
      <Route
        path="/entregas/registrar"
        element={
          <RutaProtegida roles={ENTREGAS} validadorRol={puedeGestionarEntregas}>
            <RegistrarEntrega />
          </RutaProtegida>
        }
      />
      <Route element={<Cascaron />}>
        <Route path="/" element={<Navigate to="/beneficiarios" replace />} />

        <Route
          path="/sync"
          element={
            <RutaProtegida roles={CAMPO}>
              <Sync />
            </RutaProtegida>
          }
        />
        {/* Parte 1 del registro de entrega: precarga del paquete offline. */}
        <Route
          path="/entregas/preparar"
          element={
            <RutaProtegida roles={ENTREGAS} validadorRol={puedeGestionarEntregas}>
              <PrepararEntrega />
            </RutaProtegida>
          }
        />
        <Route
          path="/conciliacion"
          element={
            <RutaProtegida roles={CAMPO}>
              <ConciliacionCamiones />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios"
          element={
            <RutaProtegida roles={CAMPO}>
              <Beneficiarios />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios/:id"
          element={
            <RutaProtegida roles={CAMPO}>
              <FichaBeneficiario modo="campo" />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios/:id/captura"
          element={
            <RutaProtegida roles={CAMPO}>
              <NuevaCaptura />
            </RutaProtegida>
          }
        />

        {/* Padrón administrativo: consulta directa al servidor, sin IndexedDB. */}
        <Route
          path="/gestion/beneficiarios"
          element={
            <RutaProtegida roles={AUDITORIA}>
              <BeneficiariosOnline />
            </RutaProtegida>
          }
        />

        <Route
          path="/auditoria"
          element={
            <RutaProtegida roles={AUDITORIA}>
              <Auditoria />
            </RutaProtegida>
          }
        />
        <Route
          path="/auditoria/beneficiario/:id"
          element={
            <RutaProtegida roles={AUDITORIA}>
              <Expediente />
            </RutaProtegida>
          }
        />

        <Route
          path="/depuracion"
          element={
            <RutaProtegida roles={DEPURACION}>
              <Depuracion />
            </RutaProtegida>
          }
        />
        <Route
          path="/depuracion/beneficiarios/:id"
          element={
            <RutaProtegida roles={DEPURACION}>
              <DepuracionDetalle />
            </RutaProtegida>
          }
        />
        <Route
          path="/depuracion/catalogos"
          element={
            <RutaProtegida roles={DEPURACION}>
              <DepuracionCatalogos />
            </RutaProtegida>
          }
        />

        <Route
          path="/correcciones"
          element={
            <RutaProtegida roles={DEPURACION}>
              <Correcciones />
            </RutaProtegida>
          }
        />
        <Route
          path="/correcciones/beneficiarios/:id"
          element={
            <RutaProtegida roles={DEPURACION}>
              <FichaBeneficiario modo="correccion" />
            </RutaProtegida>
          }
        />

        <Route
          path="/dashboard"
          element={
            <RutaProtegida roles={GESTION}>
              <Dashboard />
            </RutaProtegida>
          }
        />

        <Route
          path="/usuarios"
          element={
            <RutaProtegida roles={USUARIOS}>
              <Usuarios />
            </RutaProtegida>
          }
        />

        {/*
          Monitor de actividad en vivo. Solo `admin` (mas estricto que
          /usuarios): saber quien esta conectado y en que pantalla es
          supervision de personas, no administracion de datos. El backend
          aplica el mismo candado en GET /api/admin/presencia.
        */}
        <Route
          path="/monitor"
          element={
            <RutaProtegida roles={MONITOR}>
              <Monitor />
            </RutaProtegida>
          }
        />

        {/*
          Edicion administrativa de solicitudes. SOLO admin — unica excepcion
          a D44 (inmutabilidad de solicitudes). El backend aplica el mismo
          candado en PATCH /api/admin/solicitudes/:id, mas motivo obligatorio
          y reautenticacion por contrasena.
        */}
        <Route
          path="/admin/solicitudes"
          element={
            <RutaProtegida roles={EDICION_ADMIN}>
              <EdicionAdminSolicitudes />
            </RutaProtegida>
          }
        />

        {/* Build 10: administracion de catalogos jerarquicos. */}
        <Route
          path="/catalogos"
          element={
            <RutaProtegida roles={USUARIOS}>
              <Catalogos />
            </RutaProtegida>
          }
        />
        <Route
          path="/catalogos/documentos"
          element={
            <RutaProtegida roles={USUARIOS}>
              <CatalogoDocumentos />
            </RutaProtegida>
          }
        />
        {/*
          Plazo de ingreso de solicitudes. Misma proteccion de ruta que el
          resto de /catalogos; la escritura ademas es solo admin en el backend,
          asi que un editor_datos ve la pantalla con el error de rol.
        */}
        <Route
          path="/catalogos/plazos"
          element={
            <RutaProtegida roles={USUARIOS}>
              <CatalogoPlazos />
            </RutaProtegida>
          }
        />

        {/* Modulo de ventanilla (build 6). Online-only: sin cola offline. */}
        <Route
          path="/solicitudes"
          element={
            <RutaProtegida roles={VENTANILLA}>
              <Solicitudes />
            </RutaProtegida>
          }
        />
        <Route
          path="/solicitudes/nueva"
          element={
            <RutaProtegida roles={VENTANILLA}>
              <NuevaSolicitud />
            </RutaProtegida>
          }
        />
        <Route
          path="/solicitudes/:id"
          element={
            <RutaProtegida roles={VENTANILLA}>
              <DetalleSolicitud />
            </RutaProtegida>
          }
        />
        <Route
          path="/solicitudes/:id/folio"
          element={
            <RutaProtegida roles={VENTANILLA}>
              <FolioEntrega />
            </RutaProtegida>
          }
        />

        {/* Build 13: cola de pre-dictaminacion y detalle del dictamen. */}
        <Route
          path="/dictamen"
          element={
            <RutaProtegida roles={DICTAMEN}>
              <Dictamen />
            </RutaProtegida>
          }
        />
        <Route
          path="/dictamen/:id"
          element={
            <RutaProtegida roles={DICTAMEN}>
              <DictamenDetalle />
            </RutaProtegida>
          }
        />

        {/* Cualquier rol autenticado; unica ruta abierta con el cambio pendiente. */}
        <Route
          path="/cambiar-password"
          element={
            <RutaProtegida permiteCambioPendiente>
              <CambiarPassword />
            </RutaProtegida>
          }
        />

        <Route path="/sin-permiso" element={<SinPermiso />} />
        <Route path="*" element={<Navigate to="/beneficiarios" replace />} />
      </Route>
    </Routes>
  );
}
