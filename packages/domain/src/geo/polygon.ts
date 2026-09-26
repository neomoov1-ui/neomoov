/**
 * Validation des polygones de zones (prompt 12, contrainte : « fermés, sans auto-intersection ») avant tout
 * enregistrement depuis l'éditeur de My Hub. Coordonnées GeoJSON [longitude, latitude]. Fonctions pures.
 */

export type Position = readonly [number, number];

export type PolygonRefusal = 'too_few_points' | 'not_closed' | 'out_of_range' | 'duplicate_points' | 'self_intersecting';

export type PolygonCheck = { valid: true } | { valid: false; reason: PolygonRefusal; segments?: [number, number] };

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Orientation du triplet (p, q, r) : 0 alignés, 1 horaire, 2 antihoraire. */
function orientation(p: Position, q: Position, r: Position): 0 | 1 | 2 {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (value === 0) return 0;
  return value > 0 ? 1 : 2;
}

/** q est sur le segment [p, r], sachant les trois points alignés. */
function onSegment(p: Position, q: Position, r: Position): boolean {
  return q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) && q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]);
}

/** Les segments [p1, q1] et [p2, q2] se touchent ou se croisent (y compris par recouvrement). */
export function segmentsIntersect(p1: Position, q1: Position, p2: Position, q2: Position): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(p1, p2, q1)) || (o2 === 0 && onSegment(p1, q2, q1)) || (o3 === 0 && onSegment(p2, p1, q2)) || (o4 === 0 && onSegment(p2, q1, q2));
}

/**
 * Anneau extérieur valide : au moins trois sommets distincts plus le point de fermeture, fermé, dans les bornes WGS 84,
 * sans sommet répété et sans arêtes non voisines qui se touchent.
 */
export function validateRing(ring: readonly Position[]): PolygonCheck {
  if (ring.length < 4) return { valid: false, reason: 'too_few_points' };
  if (!same(ring[0]!, ring[ring.length - 1]!)) return { valid: false, reason: 'not_closed' };
  if (ring.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)) return { valid: false, reason: 'out_of_range' };
  const vertices = ring.slice(0, -1);
  const keys = new Set(vertices.map(([lng, lat]) => `${lng},${lat}`));
  if (keys.size !== vertices.length) return { valid: false, reason: 'duplicate_points' };
  const edges = vertices.length;
  for (let i = 0; i < edges; i += 1) {
    for (let j = i + 1; j < edges; j += 1) {
      // Arêtes voisines (qui partagent un sommet, y compris la première et la dernière) : non comparées.
      if (j === i + 1 || (i === 0 && j === edges - 1)) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return { valid: false, reason: 'self_intersecting', segments: [i, j] };
    }
  }
  return { valid: true };
}
