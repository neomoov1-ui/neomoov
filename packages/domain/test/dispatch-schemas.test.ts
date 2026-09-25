import { describe, expect, it } from 'vitest';
import { acceptOfferSchema, adminReassignSchema, clientProposalSchema, dispatchSummarySchema, offerCounterSchema, vehicleMismatchSchema } from '../src/index.js';

describe('schémas de la répartition et de la négociation', () => {
  it('contre-proposition : motif « autre » sans texte refusé, avec texte accepté, sans motif accepté', () => {
    expect(offerCounterSchema.safeParse({ proposedTotalCents: 3000, reason: 'other' }).success).toBe(false);
    expect(offerCounterSchema.safeParse({ proposedTotalCents: 3000, reason: 'other', reasonText: 'Pont fermé' }).success).toBe(true);
    expect(offerCounterSchema.safeParse({ proposedTotalCents: 3000, reason: 'event' }).success).toBe(true);
    expect(offerCounterSchema.safeParse({ proposedTotalCents: 3000 }).success).toBe(true);
    expect(offerCounterSchema.safeParse({ proposedTotalCents: -1 }).success).toBe(false);
  });
  it('proposition, acceptation, réattribution, signalement', () => {
    expect(clientProposalSchema.safeParse({ proposedTotalCents: 2800 }).success).toBe(true);
    expect(acceptOfferSchema.safeParse({}).success).toBe(true);
    expect(acceptOfferSchema.safeParse({ consentText: 'court' }).success).toBe(false);
    expect(adminReassignSchema.parse({ reason: 'chauffeur injoignable' })).toEqual({ reason: 'chauffeur injoignable', excludeDriver: true });
    expect(vehicleMismatchSchema.safeParse({ description: 'Plaque différente de celle annoncée', plateSeen: 'ABC 123' }).success).toBe(true);
    expect(vehicleMismatchSchema.safeParse({ description: 'x' }).success).toBe(false);
  });
  it('résumé de répartition', () => {
    const summary = { status: 'offering', mode: 'fixed', wave: 1, radiusMeters: 2000, offersSent: 1, priority: false, startedAt: '2026-09-25T14:00:00.000Z', nextActionAt: null, heldReason: null };
    expect(dispatchSummarySchema.parse(summary)).toEqual(summary);
    expect(dispatchSummarySchema.safeParse({ ...summary, status: 'unknown' }).success).toBe(false);
  });
});
