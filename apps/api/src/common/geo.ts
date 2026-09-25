/** Géométrie élémentaire (WGS 84) : distance à vol d'oiseau et point dans un polygone GeoJSON, sans dépendance. Partagée par le simulateur de cartes et le service de devis. */
import type { GeoPoint } from '../adapters/types.js';

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Anneaux [longitude, latitude] : le premier est le contour, les suivants des trous. */
  coordinates: number[][][];
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Lancer de rayon : vrai si le point est dans l'anneau. */
function inRing(point: GeoPoint, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    const crosses = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Dans le contour et hors des trous. */
export function pointInPolygon(point: GeoPoint, polygon: GeoJsonPolygon): boolean {
  const [outer, ...holes] = polygon.coordinates;
  if (!outer || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}
