import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { parseLedgerPeriod } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { csvCell, csvDocument, csvLine } from '../src/modules/ledgers/csv.js';
import { buildGeolocationCsv, geolocationFormat, geolocationKey, pseudonym, type GeolocationRide } from '../src/modules/ledgers/geolocation-format.js';
import { formatCad, renderLedgerSummaryPdf } from '../src/modules/ledgers/ledger-summary-pdf.js';

describe('CSV des exports', () => {
  it('cellules citées au besoin, nombres tels quels, formules neutralisées', () => {
    expect(csvCell(null, ';')).toBe('');
    expect(csvCell(1234, ';')).toBe('1234');
    expect(csvCell(-73.582, ',')).toBe('-73.582');
    expect(csvCell('NM-2026-09-15-0412', ';')).toBe('NM-2026-09-15-0412');
    expect(csvCell('a;b', ';')).toBe('"a;b"');
    expect(csvCell('dit "oui"', ';')).toBe('"dit ""oui"""');
    expect(csvCell('=HYPERLINK("x")', ';')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1', ';')).toBe('\'+1');
    expect(csvLine(['TOTAL 2026-09', 2, null, 180], ';')).toBe('TOTAL 2026-09;2;;180');
    expect(csvDocument(['a', 'b'])).toBe('a\r\nb\r\n');
  });
});

describe('export de géolocalisation : format et pseudonymes', () => {
  const secret = 'cle-de-test-non-secrete';
  const ride: GeolocationRide = {
    id: '11111111-1111-4111-8111-111111111111', driverId: '22222222-2222-4222-8222-222222222222', vehicleId: null, category: 'neo_xl',
    originLat: 45.523456, originLng: -73.582345, destinationLat: 45.4706, destinationLng: -73.7408,
    pickedUpAt: '2026-09-15T14:40:00.123Z', completedAt: '2026-09-15T15:00:00.000Z', distanceMeters: 8200, durationSeconds: null,
  };
  it('clé dérivée par HKDF avec une étiquette propre : jamais la clé brute', () => {
    const key = geolocationKey(secret);
    expect(key).toHaveLength(32);
    expect(geolocationKey(secret).equals(key)).toBe(true);
    expect(pseudonym(key, 'ride', ride.id)).not.toBe(createHmac('sha256', secret).update(`ride:${ride.id}`).digest('hex').slice(0, 32));
    expect(geolocationKey('autre-cle').equals(key)).toBe(false);
  });
  it('pseudonymes stables, distincts par nature, 32 caractères hexadécimaux', () => {
    const key = geolocationKey(secret);
    expect(pseudonym(key, 'ride', ride.id)).toMatch(/^[0-9a-f]{32}$/);
    expect(pseudonym(key, 'ride', ride.id)).toBe(pseudonym(geolocationKey(secret), 'ride', ride.id));
    expect(pseudonym(key, 'driver', ride.id)).not.toBe(pseudonym(key, 'ride', ride.id));
  });
  it('csv-v0 : en-tête, coordonnées à 3 décimales, UTC à la seconde, champs absents vides', () => {
    const key = geolocationKey(secret);
    const csv = buildGeolocationCsv(geolocationFormat('csv-v0'), [ride], key);
    const [header, line] = csv.trim().split('\r\n');
    expect(header).toBe('trajet,chauffeur,vehicule,categorie,origine_lat,origine_lng,destination_lat,destination_lng,prise_en_charge_utc,arrivee_utc,distance_m,duree_s');
    expect(line).toBe(`${pseudonym(key, 'ride', ride.id)},${pseudonym(key, 'driver', ride.driverId!)},,neo_xl,45.523,-73.582,45.471,-73.741,2026-09-15T14:40:00Z,2026-09-15T15:00:00Z,8200,`);
    expect(csv).not.toContain(ride.id);
  });
  it('format inconnu refusé', () => {
    expect(() => geolocationFormat('xml-v9')).toThrow(/inconnu/);
  });
});

describe('rapport de synthèse PDF', () => {
  it('montants au format canadien français', () => {
    expect(formatCad(0)).toBe('0,00 $');
    expect(formatCad(90)).toBe('0,90 $');
    expect(formatCad(123456789)).toBe('1 234 567,89 $');
    expect(formatCad(-4500)).toBe('-45,00 $');
  });
  it('PDF produit pour les deux registres, mois sans ligne compris', async () => {
    const period = parseLedgerPeriod('2026-T3')!;
    const months = [{ period: '2026-08', rideCount: 2, redevanceCents: 180, redevanceBilledCents: 90, remittedCents: 0, unremittedCount: 2, remittedAt: null, fareGstCents: 250, fareQstCents: 499, feeGstCents: 29, feeQstCents: 58 }];
    for (const type of ['redevance', 'taxes'] as const) {
      const pdf = await renderLedgerSummaryPdf({ type, period, companyName: 'Neomoov', generatedAt: new Date('2026-10-01T14:05:00Z'), timeZone: 'America/Toronto', months, drivers: [] });
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1_000);
    }
  });
});
