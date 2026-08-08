// Tarjeta de una metrica agregada del dashboard.
interface Props {
  etiqueta: string;
  valor: string | number;
  testId: string;
  detalle?: string;
}

export default function TarjetaMetrica({ etiqueta, valor, testId, detalle }: Props) {
  return (
    <div className="metrica" data-testid={testId}>
      <span className="metrica-valor">{valor}</span>
      <span className="metrica-etiqueta">{etiqueta}</span>
      {detalle && <span className="metrica-detalle">{detalle}</span>}
    </div>
  );
}
