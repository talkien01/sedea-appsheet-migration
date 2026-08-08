// Tarjeta de una metrica agregada del dashboard.
interface Props {
  etiqueta: string;
  valor: string | number;
  testId: string;
  detalle?: string;
}

export default function TarjetaMetrica({ etiqueta, valor, testId, detalle }: Props) {
  return (
    // El data-testid va sobre el valor, no sobre la tarjeta, para que su texto
    // sea exactamente el numero (o el porcentaje) sin arrastrar la etiqueta.
    <div className="metrica">
      <span className="metrica-valor" data-testid={testId}>
        {valor}
      </span>
      <span className="metrica-etiqueta">{etiqueta}</span>
      {detalle && <span className="metrica-detalle">{detalle}</span>}
    </div>
  );
}
