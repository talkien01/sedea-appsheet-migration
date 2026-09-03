import RegistrarEntrega from './RegistrarEntrega';
import { usoPresencia } from '../componentes/usoPresencia';

/**
 * La pantalla de entrega vive fuera del Cascaron para operar en campo, por lo
 * que necesita su propio latido de presencia para aparecer en el Monitor.
 * El latido es best-effort y nunca bloquea la captura ni la sincronizacion.
 */
export default function RegistrarEntregaMonitorizada() {
  usoPresencia(true);
  return <RegistrarEntrega />;
}
