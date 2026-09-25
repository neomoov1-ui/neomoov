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

/** Longueur d'une trace (mètres), somme des segments à vol d'oiseau. */
export function lineLengthMeters(points: readonly GeoPoint[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) meters += haversineMeters(points[i - 1]!, points[i]!);
  return meters;
}

/** Distance (mètres) d'un point au segment [a, b], en approximation plane locale (suffisant à l'échelle d'une ville). */
function distanceToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const ky = 110_574;
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * ky;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
  const cx = ax + t * (bx - ax);
  const cy = ay + t * (by - ay);
  return Math.hypot(px - cx, py - cy);
}

/** Simplification de Douglas-Peucker : garde les points qui s'écartent de plus de `toleranceMeters` de la ligne (trace de course). */
export function simplifyLine(points: readonly GeoPoint[], toleranceMeters = 10): GeoPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegmentMeters(points[i]!, points[start]!, points[end]!);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > toleranceMeters) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
