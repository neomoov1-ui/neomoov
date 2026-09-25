import { describe, expect, it } from 'vitest';
import { adminAssignSchema, adminCreateRideSchema, completeRideSchema, driverStatusSchema, locationBatchSchema, locationUpdateSchema, rideListQuerySchema, rideMessageInputSchema, sosInputSchema } from '../src/index.js';

const ID = '2f4c1a3e-8b6d-4f1a-9c2e-7d5b6a4c3e21';

describe('schémas des courses en temps réel (prompt 05)', () => {
  it('création par l\'opérateur : un client (compte ou fiche minimale) est requis', () => {
    expect(adminCreateRideSchema.safeParse({ quoteId: ID }).success).toBe(false);
    const guest = adminCreateRideSchema.parse({ quoteId: ID, guest: { name: 'Marie Roy', phone: '+15145550142' } });
    expect(guest.paymentMethod).toBe('cash');
    expect(guest.paymentChoice).toBe('pay_driver_after');
    expect(guest.guest?.language).toBe('fr');
    expect(adminCreateRideSchema.parse({ quoteId: ID, clientUserId: ID }).clientUserId).toBe(ID);
    expect(adminAssignSchema.parse({ driverId: ID }).vehicleId).toBeUndefined();
  });

  it('statut, positions, messages, SOS, fin de course, liste', () => {
    expect(driverStatusSchema.parse({ status: 'online' }).status).toBe('online');
    expect(driverStatusSchema.safeParse({ status: 'busy' }).success).toBe(false);
    const position = locationUpdateSchema.parse({ coordinates: { lat: 45.5, lng: -73.6 }, speedMps: 12, headingDegrees: 90 });
    expect(position.accuracyMeters).toBeUndefined();
    expect(locationBatchSchema.safeParse({ positions: [] }).success).toBe(false);
    expect(rideMessageInputSchema.parse({ body: '  Je suis devant la porte  ' }).body).toBe('Je suis devant la porte');
    expect(rideMessageInputSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(sosInputSchema.parse({}).coordinates).toBeUndefined();
    expect(completeRideSchema.parse({ measuredDistanceMeters: 8200 }).measuredDurationSeconds).toBeUndefined();
    expect(rideListQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(rideListQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});
