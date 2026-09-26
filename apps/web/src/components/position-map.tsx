'use client';

/** Carte d'une position (suivi partagé) : un cercle sur la dernière position connue du chauffeur. Client seulement. */
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';

function Follow({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lng]);
  }, [map, lat, lng]);
  return null;
}

export default function PositionMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <MapContainer center={[lat, lng]} zoom={14} className="h-72 w-full rounded-md" aria-label={label}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <CircleMarker center={[lat, lng]} radius={10} pathOptions={{ color: '#10171f', weight: 2, fillColor: '#0b5fb5', fillOpacity: 0.9 }}>
        {label ? <Tooltip permanent>{label}</Tooltip> : null}
      </CircleMarker>
      <Follow lat={lat} lng={lng} />
    </MapContainer>
  );
}
