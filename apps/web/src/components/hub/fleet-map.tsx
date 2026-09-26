'use client';

/** Carte de la flotte (Leaflet, tuiles OpenStreetMap) : un cercle par chauffeur, couleur selon l'état. Client seulement. */
import type { FleetPosition } from '@neomoov/domain';
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';

export const MONTREAL: [number, number] = [45.5019, -73.5674];

export interface FleetMapLabels {
  onRide: string;
  available: string;
  paused: string;
  category: (code: string) => string;
}

export default function FleetMap({ positions, labels }: { positions: FleetPosition[]; labels: FleetMapLabels }) {
  return (
    <MapContainer center={MONTREAL} zoom={11} scrollWheelZoom className="h-[420px] w-full rounded-md" aria-label="Carte">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {positions.map((p) => {
        const color = p.status === 'paused' ? '#b45309' : p.currentRideId ? '#0b5fb5' : '#15803d';
        return (
          <CircleMarker key={p.driverId} center={[p.coordinates.lat, p.coordinates.lng]} radius={9} pathOptions={{ color: '#10171f', weight: 1, fillColor: color, fillOpacity: 0.9 }}>
            <Popup>
              <strong>{p.firstName ?? p.publicNumber}</strong> ({p.publicNumber})
              <br />
              {p.category ? labels.category(p.category) : ''}
              <br />
              {p.status === 'paused' ? labels.paused : p.currentRideId ? labels.onRide : labels.available}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
