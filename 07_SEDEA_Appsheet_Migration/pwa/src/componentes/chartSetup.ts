// Registro selectivo de Chart.js: solo los controladores y escalas que usa el
// dashboard, para no arrastrar al bundle lo que no se dibuja.
// Chart.js es la unica dependencia de graficas del proyecto (decision D13):
// no hay wrappers de React, ni plugins de fecha, ni scripts por CDN.
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title
);

// Todas las etiquetas de la interfaz estan en espanol.
Chart.defaults.locale = 'es-MX';
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.font.family =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export { Chart };
