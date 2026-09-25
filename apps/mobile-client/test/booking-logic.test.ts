import type { AppConfig, QuoteView, QuotesResponse } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { categoryCards, earliestPickup, pickupProblem, pickupSchedule, priceRows, proposalBounds, serviceClock, sumRows } from '../src/features/booking/logic';

const booking: AppConfig['booking'] = { minLeadSeconds: 7200, maxLeadDays: 30, freeCancellationSeconds: 120, cancellationFeeCents: 500 };

const categories: AppConfig['categories'] = [
  { code: 'neo_premium', name: 'Neo Premium', seats: 4, description: null, allowedModels: ['Tesla Model 3', 'Tesla Model Y'] },
  { code: 'neo_prestige', name: 'Neo Prestige', seats: 4, description: null, allowedModels: ['Mercedes EQS'] },
  { code: 'neo_xl', name: 'Neo XL', seats: 6, description: null, allowedModels: ['Kia EV9'] },
];

/** Devis tel que l'API le renvoie (exemple de contrôle du cahier des charges : 8 km, 18 minutes). */
function quote(category: QuoteView['category'], total: number, eta: QuoteView['eta']): QuoteView {
  return {
    id: `q-${category}`, category, distanceMeters: 8000, durationSeconds: 1080,
    lines: [
      { code: 'base_fare', label: 'Prise en charge', amountCents: 400 },
      { code: 'distance', label: 'Distance', amountCents: 1480 },
      { code: 'duration', label: 'Durée', amountCents: 575 },
      { code: 'service_fee', label: 'Frais de service', amountCents: 200 },
      { code: 'regulatory_fee', label: 'Redevance', amountCents: 90 },
      { code: 'gst', label: 'TPS', amountCents: 137 },
      { code: 'qst', label: 'TVQ', amountCents: 274 },
    ],
    fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, promotionCode: null, promotionDiscountCents: 0, alignmentDiscountCents: 0,
    subtotalCents: 2745, gstCents: 137, qstCents: 274, totalCents: total, creditsAppliedCents: 0, amountDueCents: total, maxConsentedCents: total, flatRateCode: null,
    ignoredOptions: [], estimated: false, eta, requestedAt: null, validUntil: '2026-09-26T12:00:00.000Z', fingerprint: 'x',
  };
}

describe("créneaux de prise en charge (D32), à l'heure de Montréal", () => {
  // 26 septembre 2026, 13 h 07 à Montréal (UTC-4), quel que soit le fuseau de la machine de test.
  const now = new Date('2026-09-26T17:07:00Z');

  it("première heure réservable : 2 heures plus tard, au quart d'heure suivant", () => {
    expect(earliestPickup(now, 7200).toISOString()).toBe('2026-09-26T19:15:00.000Z');
    expect(serviceClock(earliestPickup(now, 7200))).toEqual({ day: '2026-09-26', hour: 15, minute: 15 });
  });

  it('refuse trop tôt et trop tard, accepte entre les deux', () => {
    expect(pickupProblem(new Date('2026-09-26T19:00:00Z'), now, booking)).toBe('too_soon');
    expect(pickupProblem(new Date('2026-09-26T19:15:00Z'), now, booking)).toBeNull();
    expect(pickupProblem(new Date('2026-10-27T17:08:00Z'), now, booking)).toBe('too_far');
  });

  it("jours de Montréal, quarts d'heure exacts : le jour même à partir de 15 h 15, puis 96 créneaux par jour", () => {
    const schedule = pickupSchedule(now, booking);
    expect(schedule).toHaveLength(14);
    expect(schedule[0]!.day).toBe('2026-09-26');
    expect(serviceClock(schedule[0]!.slots[0]!)).toEqual({ day: '2026-09-26', hour: 15, minute: 15 });
    expect(schedule[1]).toMatchObject({ day: '2026-09-27' });
    expect(schedule[1]!.slots).toHaveLength(96);
    expect(schedule.every((d) => d.slots.every((slot) => serviceClock(slot).day === d.day && serviceClock(slot).minute % 15 === 0))).toBe(true);
  });

  it("changement d'heure du 1er novembre 2026 : jour de 25 heures (100 créneaux), aucun jour répété ni perdu", () => {
    const schedule = pickupSchedule(new Date('2026-10-25T12:00:00Z'), booking);
    const days = schedule.map((d) => d.day);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2026-11-01');
    expect(days).toContain('2026-11-02');
    expect(schedule.find((d) => d.day === '2026-11-01')!.slots).toHaveLength(100);
    expect(schedule.find((d) => d.day === '2026-11-02')!.slots).toHaveLength(96);
  });
});

describe('détail du prix (écran 2 sur 3)', () => {
  it('reprend les lignes de l\'API dans l\'ordre, sans calcul : la somme vaut le montant dû au centime', () => {
    const q = quote('neo_premium', 3156, { seconds: 420, status: 'estimated' });
    const rows = priceRows(q);
    expect(rows.map((r) => r.code)).toEqual(['base_fare', 'distance', 'duration', 'service_fee', 'regulatory_fee', 'gst', 'qst']);
    expect(rows.filter((r) => r.emphasis === 'tax').map((r) => r.code)).toEqual(['gst', 'qst']);
    expect(sumRows(rows)).toBe(q.amountDueCents);
  });

  it('une remise (ligne négative) est marquée comme telle', () => {
    const rows = priceRows({ lines: [{ code: 'promotion', label: 'Promotion', amountCents: -500 }] });
    expect(rows[0]!.emphasis).toBe('discount');
  });
});

describe('sélecteur de catégorie', () => {
  it('dans l\'ordre de la configuration, seulement les catégories tarifées, arrivée ou « selon disponibilité »', () => {
    const response: Pick<QuotesResponse, 'quotes'> = { quotes: [quote('neo_xl', 5210, { seconds: null, status: 'on_availability' }), quote('neo_premium', 3156, { seconds: 420, status: 'estimated' })] };
    const cards = categoryCards(response, categories);
    expect(cards.map((c) => c.code)).toEqual(['neo_premium', 'neo_xl']);
    expect(cards[0]).toMatchObject({ name: 'Neo Premium', seats: 4, etaSeconds: 420, models: ['Tesla Model 3', 'Tesla Model Y'] });
    expect(cards[1]!.etaSeconds).toBeNull();
    expect(cards[1]!.quote.totalCents).toBe(5210);
  });
});

describe('négociation (V1.1)', () => {
  it('bornes du curseur : plancher de 70 % arrondi au dollar supérieur, prix affiché au maximum', () => {
    expect(proposalBounds(3156, 700_000)).toEqual({ minCents: 2300, maxCents: 3156, stepCents: 100 });
    expect(proposalBounds(1000, 1_000_000)).toEqual({ minCents: 1000, maxCents: 1000, stepCents: 100 });
  });
});
