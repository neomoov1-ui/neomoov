import { describe, expect, it } from 'vitest';
import { isInsideRegion } from '../src/features/ride/map-logic';

/** Zone de 0,1 degré centrée sur le centre-ville de Montréal. */
const region = { latitude: 45.5, longitude: -73.57, latitudeDelta: 0.1, longitudeDelta: 0.1 };

describe('cadrage de la carte du trajet', () => {
  it('un chauffeur au centre ou près du centre ne recadre pas la carte', () => {
    expect(isInsideRegion({ lat: 45.5, lng: -73.57 }, region)).toBe(true);
    expect(isInsideRegion({ lat: 45.53, lng: -73.6 }, region)).toBe(true);
  });

  it('un chauffeur près du bord ou hors de la zone la recadre', () => {
    // Demi-étendue 0,05 ; réserve de 15 % : recadrage au-delà de 0,0425 du centre.
    expect(isInsideRegion({ lat: 45.545, lng: -73.57 }, region)).toBe(false);
    expect(isInsideRegion({ lat: 45.5, lng: -73.52 }, region)).toBe(false);
    expect(isInsideRegion({ lat: 45.7, lng: -73.57 }, region)).toBe(false);
  });

  it('réserve réglable et bornée', () => {
    expect(isInsideRegion({ lat: 45.545, lng: -73.57 }, region, 0)).toBe(true);
    expect(isInsideRegion({ lat: 45.501, lng: -73.57 }, region, 5)).toBe(true);
    expect(isInsideRegion({ lat: 45.506, lng: -73.57 }, region, 5)).toBe(false);
  });
});
