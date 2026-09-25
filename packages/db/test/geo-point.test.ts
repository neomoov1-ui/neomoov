import { describe, expect, it } from 'vitest';
import { geoPoint, pointFromEwkbHex } from '../src/schema/_helpers.js';

describe('points PostGIS', () => {
  it('décode le EWKB hexadécimal renvoyé par une lecture brute (SRID 4326)', () => {
    // SELECT ST_SetSRID(ST_MakePoint(1, 2), 4326)::geography
    expect(pointFromEwkbHex('0101000020E6100000000000000000F03F0000000000000040')).toEqual({ lng: 1, lat: 2 });
  });

  it('décode un point réel, avec ou sans SRID, dans les deux ordres d\'octets', () => {
    const le = Buffer.alloc(16);
    le.writeDoubleLE(-73.582, 0);
    le.writeDoubleLE(45.5257, 8);
    expect(pointFromEwkbHex(`0101000020E6100000${le.toString('hex')}`)).toEqual({ lng: -73.582, lat: 45.5257 });
    expect(pointFromEwkbHex(`0101000000${le.toString('hex')}`)).toEqual({ lng: -73.582, lat: 45.5257 });
    const be = Buffer.alloc(16);
    be.writeDoubleBE(-73.582, 0);
    be.writeDoubleBE(45.5257, 8);
    expect(pointFromEwkbHex(`0020000001000010E6${be.toString('hex')}`)).toEqual({ lng: -73.582, lat: 45.5257 });
  });

  it('refuse une autre géométrie ou une valeur tronquée', () => {
    expect(() => pointFromEwkbHex('0102000020E6100000')).toThrow();
    expect(() => pointFromEwkbHex('0103000020E610000000000000000000000000000000000000')).toThrow(/point était attendu/);
  });

  it('la colonne lit toujours le GeoJSON de ST_AsGeoJSON', () => {
    const column = geoPoint('position');
    const fromDriver = (column as unknown as { config: { customTypeParams: { fromDriver: (v: string) => unknown } } }).config.customTypeParams.fromDriver;
    expect(fromDriver('{"type":"Point","coordinates":[-73.5,45.5]}')).toEqual({ lng: -73.5, lat: 45.5 });
    expect(fromDriver('0101000020E6100000000000000000F03F0000000000000040')).toEqual({ lng: 1, lat: 2 });
  });
});
