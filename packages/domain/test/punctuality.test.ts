import { describe, expect, it } from 'vitest';
import { DEFAULT_PUNCTUALITY_RULES as R, parsePunctualityRules, punctualityCompensation } from '../src/index.js';

/** D10 : garantie de ponctualité (montants proposés, à valider par le fondateur). */
const T0 = new Date('2026-10-01T12:00:00Z');
const late = (minutes: number, seconds = 0) => new Date(T0.getTime() + minutes * 60_000 + seconds * 1000);

describe('garantie de ponctualité (D10)', () => {
  it('à l\'heure ou moins de 10 minutes : rien', () => {
    expect(punctualityCompensation(T0, late(-5), 3000, R)).toEqual({ kind: 'none', minutesLate: 0 });
    expect(punctualityCompensation(T0, late(9, 59), 3000, R)).toEqual({ kind: 'none', minutesLate: 9 });
  });
  it('10 à 20 minutes : 5 $ ; 20 à 30 minutes : 10 $ ; au-delà de 30 minutes : course remboursée', () => {
    expect(punctualityCompensation(T0, late(10), 3000, R)).toEqual({ kind: 'credit', minutesLate: 10, amountCents: 500 });
    expect(punctualityCompensation(T0, late(19, 59), 3000, R)).toEqual({ kind: 'credit', minutesLate: 19, amountCents: 500 });
    expect(punctualityCompensation(T0, late(20), 3000, R)).toEqual({ kind: 'credit', minutesLate: 20, amountCents: 1000 });
    expect(punctualityCompensation(T0, late(30, 59), 3000, R)).toEqual({ kind: 'credit', minutesLate: 30, amountCents: 1000 });
    expect(punctualityCompensation(T0, late(31), 3156, R)).toEqual({ kind: 'refund', minutesLate: 31, amountCents: 3156 });
    expect(punctualityCompensation(T0, late(45), -1, R)).toEqual({ kind: 'refund', minutesLate: 45, amountCents: 0 });
  });
  it('réglage : paliers triés ; valeur invalide ignorée', () => {
    expect(parsePunctualityRules(null)).toEqual(R);
    expect(parsePunctualityRules({ tiers: 'x', refundAfterMinutes: 30 })).toEqual(R);
    expect(parsePunctualityRules({ tiers: [], refundAfterMinutes: 0 })).toEqual(R);
    expect(parsePunctualityRules({ tiers: [{ minMinutes: 10, creditCents: -1 }], refundAfterMinutes: 30 })).toEqual(R);
    expect(parsePunctualityRules({ tiers: [null], refundAfterMinutes: 30 })).toEqual(R);
    expect(parsePunctualityRules({ tiers: [{ minMinutes: 40, creditCents: 500 }], refundAfterMinutes: 30 })).toEqual(R);
    expect(parsePunctualityRules({ tiers: [{ minMinutes: 15, creditCents: 800 }, { minMinutes: 5, creditCents: 300 }], refundAfterMinutes: 25 }))
      .toEqual({ tiers: [{ minMinutes: 5, creditCents: 300 }, { minMinutes: 15, creditCents: 800 }], refundAfterMinutes: 25 });
  });
});
