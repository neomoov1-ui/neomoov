import { describe, expect, it } from 'vitest';
import { haversineMeters, pointInPolygon } from '../src/common/geo.js';
import { lineLabel } from '../src/modules/pricing/labels.js';

describe('géométrie des zones', () => {
  const square = { type: 'Polygon' as const, coordinates: [[[-73.6, 45.5], [-73.5, 45.5], [-73.5, 45.6], [-73.6, 45.6], [-73.6, 45.5]]] };
  it('point dans un carré, hors du carré, dans un trou', () => {
    expect(pointInPolygon({ lat: 45.55, lng: -73.55 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 45.65, lng: -73.55 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 45.55, lng: -73.45 }, square)).toBe(false);
    const withHole = { type: 'Polygon' as const, coordinates: [...square.coordinates, [[-73.57, 45.53], [-73.53, 45.53], [-73.53, 45.57], [-73.57, 45.57], [-73.57, 45.53]]] };
    expect(pointInPolygon({ lat: 45.55, lng: -73.55 }, withHole)).toBe(false);
    expect(pointInPolygon({ lat: 45.51, lng: -73.59 }, withHole)).toBe(true);
    expect(pointInPolygon({ lat: 45.55, lng: -73.55 }, { type: 'Polygon', coordinates: [] })).toBe(false);
  });
  it('distance à vol d\'oiseau : centre-ville de Montréal à l\'aéroport, environ 14 km', () => {
    const d = haversineMeters({ lat: 45.5019, lng: -73.5674 }, { lat: 45.4706, lng: -73.7408 });
    expect(d).toBeGreaterThan(13_500);
    expect(d).toBeLessThan(14_500);
    expect(haversineMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
});

describe('libellés des lignes de devis', () => {
  it('français par défaut, anglais sur demande, code inconnu renvoyé tel quel', () => {
    expect(lineLabel('service_fee')).toBe('Frais de service');
    expect(lineLabel('service_fee', 'en')).toBe('Service fee');
    expect(lineLabel('inconnu')).toBe('inconnu');
  });
});
