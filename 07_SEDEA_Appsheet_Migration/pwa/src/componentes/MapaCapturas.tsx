// Mapa Leaflet con tiles publicos de OpenStreetMap (sin servicios de pago).
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import iconoUrl from 'leaflet/dist/images/marker-icon.png';
import iconoRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import sombraUrl from 'leaflet/dist/images/marker-shadow.png';
import { URL_TILES } from '../api/cliente';

// Sin esto, Leaflet intenta cargar los iconos desde una ruta relativa inexistente.
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl
});

export interface PuntoCaptura {
  uuid: string;
  lat: number;
  lng: number;
  titulo: string;
  fecha: string;
  fotoSrc?: string | null;
}

interface Props {
  puntos: PuntoCaptura[];
  centro?: { lat: number; lng: number } | null;
  alto?: 'normal' | 'mini';
}

/** Centra el mapa cuando cambia el punto seleccionado en la tabla. */
function Centrador({ centro }: { centro?: { lat: number; lng: number } | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (centro) mapa.setView([centro.lat, centro.lng], 16, { animate: true });
  }, [centro, mapa]);
  return null;
}

const CENTRO_QUERETARO: [number, number] = [20.5888, -100.3899];

export default function MapaCapturas({ puntos, centro, alto = 'normal' }: Props) {
  const inicial: [number, number] = puntos.length
    ? [puntos[0].lat, puntos[0].lng]
    : CENTRO_QUERETARO;

  return (
    <div className={`mapa ${alto === 'mini' ? 'mapa-mini' : ''}`} data-testid="mapa-capturas">
      <MapContainer
        center={inicial}
        zoom={puntos.length ? 12 : 9}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          url={URL_TILES}
          attribution='&copy; Colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <Centrador centro={centro} />
        {puntos.map((punto) => (
          <Marker key={punto.uuid} position={[punto.lat, punto.lng]}>
            <Popup>
              <strong>{punto.titulo}</strong>
              <br />
              {punto.fecha}
              {punto.fotoSrc && (
                <>
                  <br />
                  <img src={punto.fotoSrc} alt="Evidencia" style={{ width: 140, marginTop: 6 }} />
                </>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
