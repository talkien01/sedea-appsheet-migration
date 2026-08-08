// Envoltorio propio de Chart.js sobre un <canvas>. Crea la instancia en el
// efecto, la destruye en el cleanup y la recrea cuando cambian datos u
// opciones: sin esto Chart.js deja instancias huerfanas sobre el mismo canvas.
import { useEffect, useRef } from 'react';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { Chart } from './chartSetup';

interface Props {
  tipo: 'bar' | 'line' | 'doughnut';
  datos: ChartData;
  opciones?: ChartOptions;
  testId: string;
  altura?: number;
}

export default function Grafica({ tipo, datos, opciones, testId, altura = 280 }: Props) {
  const lienzo = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const contexto = lienzo.current?.getContext('2d');
    if (!contexto) return;

    const instancia = new Chart(contexto, {
      type: tipo as ChartType,
      data: datos,
      options: { responsive: true, maintainAspectRatio: false, ...opciones }
    });

    return () => instancia.destroy();
  }, [tipo, datos, opciones]);

  return (
    <div className="lienzo-grafica" style={{ height: altura }}>
      <canvas ref={lienzo} data-testid={testId} role="img" />
    </div>
  );
}
