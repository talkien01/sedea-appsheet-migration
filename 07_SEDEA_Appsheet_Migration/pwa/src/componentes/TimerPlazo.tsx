// Timer de plazo para ingreso de solicitudes (Build 12).
// Muestra días restantes para el cierre del plazo.
import { useEffect, useState } from 'react';
import { api } from '../api/cliente';

interface PlazoRespuesta {
  activo: boolean;
  dias_restantes?: number;
  vencido?: boolean;
}

export default function TimerPlazo() {
  const [plazo, setPlazo] = useState<PlazoRespuesta | null>(null);

  useEffect(() => {
    api.get('/api/configuracion/plazo-solicitudes')
      .then(data => setPlazo(data))
      .catch(() => setPlazo({ activo: false }));
  }, []);

  if (!plazo?.activo || plazo.dias_restantes === undefined) return null;

  const esVencido = plazo.vencido || plazo.dias_restantes === 0;

  return (
    <div className={`timer-plazo ${esVencido ? 'vencido' : 'activo'}`} role="status">
      {esVencido ? (
        <>
          <span className="icono">⛔</span>
          <span>El plazo de ingreso de solicitudes ha vencido.</span>
        </>
      ) : (
        <>
          <span className="icono">⏳</span>
          <span>Faltan {plazo.dias_restantes} días para el cierre de ingreso de solicitudes.</span>
        </>
      )}
    </div>
  );
}
