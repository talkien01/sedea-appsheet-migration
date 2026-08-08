// Definicion de rutas de la aplicacion.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import BarraEstado from './componentes/BarraEstado';
import RutaProtegida from './componentes/RutaProtegida';
import Login from './pantallas/Login';
import Sync from './pantallas/Sync';
import Beneficiarios from './pantallas/Beneficiarios';
import FichaBeneficiario from './pantallas/FichaBeneficiario';
import NuevaCaptura from './pantallas/NuevaCaptura';
import Auditoria from './pantallas/Auditoria';
import Expediente from './pantallas/Expediente';
import SinPermiso from './pantallas/SinPermiso';

/** Layout comun: barra de estado siempre visible + contenido. */
function Layout() {
  return (
    <>
      <BarraEstado />
      <main className="contenido">
        <Outlet />
      </main>
    </>
  );
}

export default function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/beneficiarios" replace />} />
        <Route
          path="/sync"
          element={
            <RutaProtegida>
              <Sync />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios"
          element={
            <RutaProtegida>
              <Beneficiarios />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios/:id"
          element={
            <RutaProtegida>
              <FichaBeneficiario />
            </RutaProtegida>
          }
        />
        <Route
          path="/beneficiarios/:id/captura"
          element={
            <RutaProtegida>
              <NuevaCaptura />
            </RutaProtegida>
          }
        />
        <Route
          path="/auditoria"
          element={
            <RutaProtegida roles={['auditor', 'admin']}>
              <Auditoria />
            </RutaProtegida>
          }
        />
        <Route
          path="/auditoria/beneficiario/:id"
          element={
            <RutaProtegida roles={['auditor', 'admin']}>
              <Expediente />
            </RutaProtegida>
          }
        />
        <Route path="/sin-permiso" element={<SinPermiso />} />
        <Route path="*" element={<Navigate to="/beneficiarios" replace />} />
      </Route>
    </Routes>
  );
}
