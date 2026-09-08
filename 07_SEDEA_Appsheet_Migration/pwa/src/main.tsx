// Punto de entrada de la PWA.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { activarActualizacionAutomatica } from './pwaActualizacion';
import './styles/global.css';
import 'leaflet/dist/leaflet.css';

activarActualizacionAutomatica();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
