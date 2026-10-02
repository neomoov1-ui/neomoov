import { schema } from '@neomoov/db';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { projectRide, RIDE_EXPORT_FIELDS } from '../src/modules/privacy/privacy-export.js';

/**
 * Revue du 2 octobre 2026 (Loi 25 n° 1) : l'export d'accès et de portabilité d'un chauffeur ne contient ni nom, ni
 * téléphone, ni adresse, ni position d'un passager ; celui d'un client ne contient pas les données du chauffeur
 * au-delà de ce que l'application lui montre. Ces listes sont les clés interdites : le test échoue dès qu'une liste
 * blanche en reprend une.
 */
const PASSENGER_KEYS = [
  'guestName', 'guestPhone', 'guestLanguage', 'passengerName', 'passengerPhone', 'originAddress', 'originPosition', 'destinationAddress', 'destinationPosition', 'stops',
  'flightNumber', 'specialRequests', 'preferences', 'cancellationComment', 'clientId', 'quoteId', 'promotionId', 'favoriteDriverRequested',
];
const DRIVER_KEYS = ['driverId', 'vehicleId', 'fareCents', 'driverFareProtected', 'contactAttempts', 'networkSharedAt'];
const TECHNICAL_KEYS = ['trackingToken', 'idempotencyKey', 'installmentProviderRef', 'organizationId', 'createdByUserId'];

const columns = Object.keys(getTableColumns(schema.rides));

/** Ligne de course complète : chaque colonne porte une valeur reconnaissable, les dates sont des dates. */
function fullRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) row[column] = /At$/.test(column) ? new Date('2026-10-02T12:00:00Z') : `valeur:${column}`;
  return row;
}

describe('export Loi 25 : projection des courses par rôle', () => {
  it('les listes blanches ne nomment que des colonnes de `rides` et aucune clé interdite', () => {
    for (const role of ['client', 'driver'] as const) {
      for (const field of RIDE_EXPORT_FIELDS[role]) expect(columns, `${role}.${field}`).toContain(field);
      for (const key of TECHNICAL_KEYS) expect(RIDE_EXPORT_FIELDS[role], `${role}.${key}`).not.toContain(key);
    }
    for (const key of PASSENGER_KEYS) expect(RIDE_EXPORT_FIELDS.driver, `driver.${key}`).not.toContain(key);
    for (const key of DRIVER_KEYS) expect(RIDE_EXPORT_FIELDS.client, `client.${key}`).not.toContain(key);
    // Les clés interdites existent bien dans le schéma (sinon la liste ne protège plus rien).
    for (const key of [...PASSENGER_KEYS, ...DRIVER_KEYS, ...TECHNICAL_KEYS]) expect(columns, key).toContain(key);
  });

  it('chauffeur : prestation, montants et états, aucune donnée du passager ; client : sa course, sans le tarif ni les identifiants du chauffeur', () => {
    const row = fullRow();
    const driver = projectRide(row, 'driver');
    for (const key of [...PASSENGER_KEYS, ...TECHNICAL_KEYS]) expect(driver, key).not.toHaveProperty(key);
    const driverText = JSON.stringify(driver);
    for (const key of PASSENGER_KEYS) expect(driverText, key).not.toContain(`valeur:${key}`);
    expect(driver).toMatchObject({ id: 'valeur:id', publicNumber: 'valeur:publicNumber', state: 'valeur:state', fareCents: 'valeur:fareCents', tipCents: 'valeur:tipCents', distanceMeters: 'valeur:distanceMeters', createdAt: '2026-10-02T12:00:00.000Z' });

    const client = projectRide(row, 'client');
    for (const key of [...DRIVER_KEYS, ...TECHNICAL_KEYS]) expect(client, key).not.toHaveProperty(key);
    expect(client).toMatchObject({ id: 'valeur:id', originAddress: 'valeur:originAddress', destinationAddress: 'valeur:destinationAddress', passengerPhone: 'valeur:passengerPhone', quotedTotalCents: 'valeur:quotedTotalCents', finalPriceCents: 'valeur:finalPriceCents', requestedAt: '2026-10-02T12:00:00.000Z' });

    // Un champ absent de la ligne (projection partielle) est ignoré, jamais rendu `undefined`.
    expect(Object.keys(projectRide({ id: 'r1', trackingToken: 'secret' }, 'client'))).toEqual(['id']);
  });
});
