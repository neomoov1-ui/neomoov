'use client';

/**
 * Carte des zones (Leaflet) : polygones existants, et tracé en cours d'édition par clics sur la carte. Les coordonnées
 * GeoJSON sont en [longitude, latitude] ; Leaflet attend [latitude, longitude].
 */
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import { MONTREAL } from './fleet-map';

export interface ZoneShape {
  code: string;
  name: string;
  ring: [number, number][];
}

function ClickCapture({ onClick }: { onClick: (lng: number, lat: number) => void }) {
  useMapEvents({ click: (e) => onClick(Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))) });
  return null;
}

export default function ZoneMap({ zones, selected, draft, onAddPoint }: { zones: ZoneShape[]; selected: string | null; draft: [number, number][] | null; onAddPoint: (lng: number, lat: number) => void }) {
  const toLatLng = (ring: [number, number][]) => ring.map(([lng, lat]) => [lat, lng] as [number, number]);
  return (
    <MapContainer center={MONTREAL} zoom={10} className="h-[480px] w-full rounded-md" aria-label="Carte des zones">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {zones.map((z) => (
        <Polygon key={z.code} positions={toLatLng(z.ring)} pathOptions={{ color: z.code === selected ? '#0b5fb5' : '#475569', weight: z.code === selected ? 3 : 1, fillOpacity: z.code === selected ? 0.15 : 0.05 }}>
          <Tooltip sticky>{z.name}</Tooltip>
        </Polygon>
      ))}
      {draft ? (
        <>
          <Polyline positions={toLatLng(draft.length > 2 ? [...draft, draft[0]!] : draft)} pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '6 4' }} />
          {draft.map(([lng, lat], i) => <CircleMarker key={`${lng}-${lat}-${i}`} center={[lat, lng]} radius={5} pathOptions={{ color: '#b91c1c', fillOpacity: 1 }} />)}
          <ClickCapture onClick={onAddPoint} />
        </>
      ) : null}
    </MapContainer>
  );
}
