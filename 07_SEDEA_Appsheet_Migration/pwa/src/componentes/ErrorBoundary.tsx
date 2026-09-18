// Red de seguridad contra pantalla en blanco: la app entera no tenia NINGUN
// error boundary -- cualquier excepcion sin atrapar durante un render (ej.
// un dato real con una forma inesperada que rompe un `.trim()`/`.split()`)
// desmonta TODO el arbol de React en silencio, sin ningun mensaje, log
// visible ni forma de recuperarse salvo cerrar y reabrir la app.
//
// Reportado en campo: "al sincronizar y bajar el padron se queda en
// pantalla blanca, no avanza ni da nada" -- exactamente el sintoma de un
// crash de render sin boundary. Este componente no arregla la causa raiz
// (que puede variar: un dato real con un campo nulo, etc.), pero convierte
// cualquier crash futuro en un mensaje visible con boton de recargar, en
// vez de una pantalla muda que no se puede diagnosticar a control remoto.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sin servicio de telemetria remota en este proyecto: el console.error
    // es lo unico que sobrevive si alguien conecta el celular a un depurador
    // remoto (chrome://inspect). Mejor que nada.
    // eslint-disable-next-line no-console
    console.error('Error no capturado en el arbol de React:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '40px auto' }}>
        <div className="tarjeta">
          <h1>Algo salió mal</h1>
          <div className="mensaje error" role="alert">
            La aplicación encontró un error inesperado y no puede continuar en esta pantalla.
          </div>
          <p className="dato">
            Tus datos capturados (fotos, GPS, entregas) NO se pierden: siguen guardados en este
            dispositivo. Recarga la app para intentar de nuevo.
          </p>
          <p className="dato mono" style={{ fontSize: 12, wordBreak: 'break-word' }}>
            {this.state.error.message}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Recargar la aplicación
          </button>
        </div>
      </div>
    );
  }
}
