import { describe, expect, it } from 'vitest';
import {
  activatePack, activationPriceCents, activePack, canReceiveOffers, consumeRide, expirePacks, isUsable, remainingRides,
  renewalPackCode, rolloverOnExpiry, shouldAutoRenew,
  type DriverPackProfile, type PackDefinition, type PackPurchase, type PackSettings,
} from '../src/index.js';

// Catalogue V1 (document de référence, section 6.4), en données et non en constantes du moteur.
const catalog: Record<string, PackDefinition> = {
  decouverte: { code: 'decouverte', ridesIncluded: 10, priceCents: 2900, validityDays: 28, discovery: true, priorityBonus: false },
  essentiel: { code: 'essentiel', ridesIncluded: 25, priceCents: 5900, validityDays: 28, discovery: false, priorityBonus: false },
  pro: { code: 'pro', ridesIncluded: 50, priceCents: 9900, validityDays: 28, discovery: false, priorityBonus: false },
  elite: { code: 'elite', ridesIncluded: 100, priceCents: 16_900, validityDays: 28, discovery: false, priorityBonus: false },
  illimite: { code: 'illimite', ridesIncluded: null, priceCents: 19_900, validityDays: 7, discovery: false, priorityBonus: true },
};
const settings: PackSettings = { lowThreshold: 3, rolloverWindowDays: 7, discoveryFirstDrivers: 100 };
const T0 = new Date('2026-09-14T12:00:00Z');
const days = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);
const buy = (id: string, code: string, at = T0, autoRenew = false, over: Partial<PackPurchase> = {}): PackPurchase =>
  ({ ...activatePack(id, 'd1', catalog[code]!, catalog[code]!.priceCents, at, autoRenew), ...over });
const consumeN = (purchases: PackPurchase[], n: number, at = T0): PackPurchase[] => {
  let ps = purchases;
  for (let i = 0; i < n; i += 1) ps = consumeRide(ps, 'completed', at, settings).purchases;
  return ps;
};

describe('activation', () => {
  it('actif immédiatement, 28 jours, facturé au relevé et jamais d\'avance', () => {
    const p = buy('p1', 'pro');
    expect(p).toMatchObject({ status: 'active', ridesIncluded: 50, ridesRemaining: 50, carriedOverRemaining: 0, billing: 'to_bill', rolloverDone: false, nextPackCode: null });
    expect(p.expiresAt).toEqual(days(28));
    expect(isUsable(p, T0)).toBe(true);
  });
  it('Illimité : 7 jours, sans compteur', () => {
    const p = buy('p1', 'illimite');
    expect(p.expiresAt).toEqual(days(7));
    expect(remainingRides(p)).toBeNull();
  });
  it('un pack offert est marqué gratuit', () => {
    expect(activatePack('p1', 'd1', catalog.decouverte!, 0, T0, false).billing).toBe('free');
  });
});

describe('Découverte', () => {
  const profile = (over: Partial<DriverPackProfile>): DriverPackProfile => ({ driverId: 'd1', isRLuxeEvTenant: false, discoveryUsed: false, signupRank: 250, ...over });
  it('offert aux 100 premiers chauffeurs', () => {
    expect(activationPriceCents(catalog.decouverte!, profile({ signupRank: 100 }), settings)).toEqual({ priceCents: 0, free: true, allowed: true, reason: null });
    expect(activationPriceCents(catalog.decouverte!, profile({ signupRank: 101 }), settings)).toEqual({ priceCents: 2900, free: false, allowed: true, reason: null });
  });
  it('offert à tout locataire R-LuxeEV', () => {
    expect(activationPriceCents(catalog.decouverte!, profile({ isRLuxeEvTenant: true }), settings).priceCents).toBe(0);
  });
  it('une seule fois par chauffeur', () => {
    expect(activationPriceCents(catalog.decouverte!, profile({ signupRank: 1, discoveryUsed: true }), settings)).toMatchObject({ allowed: false, reason: 'discovery_already_used' });
  });
  it('les autres packs se paient toujours', () => {
    expect(activationPriceCents(catalog.pro!, profile({ signupRank: 1, isRLuxeEvTenant: true }), settings)).toEqual({ priceCents: 9900, free: false, allowed: true, reason: null });
  });
});

describe('consommation', () => {
  it('une course terminée consomme une unité du pack actif le plus ancien', () => {
    const older = buy('old', 'essentiel', days(-3)), newer = buy('new', 'pro');
    const r = consumeRide([newer, older], 'completed', T0, settings);
    expect(r.consumedFromId).toBe('old');
    expect(r.purchases.find((p) => p.id === 'old')!.ridesRemaining).toBe(24);
    expect(r.purchases.find((p) => p.id === 'new')!.ridesRemaining).toBe(50);
    expect(r.events).toEqual([]);
  });
  it.each(['cancelled', 'no_show', 'requested'])('une course « %s » ne consomme rien', (status) => {
    const p = buy('p1', 'pro');
    expect(consumeRide([p], status, T0, settings)).toEqual({ purchases: [p], consumedFromId: null, events: [] });
  });
  it('sans pack utilisable, rien n\'est consommé', () => {
    expect(consumeRide([], 'completed', T0, settings).consumedFromId).toBeNull();
    expect(consumeRide([buy('p1', 'pro', days(-30))], 'completed', T0, settings).consumedFromId).toBeNull();
  });
  it('Illimité ne décrémente pas', () => {
    const r = consumeRide([buy('u', 'illimite')], 'completed', T0, settings);
    expect(r.consumedFromId).toBe('u');
    expect(r.purchases[0]!.ridesRemaining).toBe(0);
    expect(isUsable(r.purchases[0]!, days(6))).toBe(true);
  });
  it('alerte à 3 courses restantes, puis épuisement', () => {
    const ps = consumeN([buy('p1', 'decouverte')], 6);
    const low = consumeRide(ps, 'completed', T0, settings);
    expect(remainingRides(low.purchases[0]!)).toBe(3);
    expect(low.events).toEqual(['pack.low']);
    const last = consumeRide(consumeN(low.purchases, 2), 'completed', T0, settings);
    expect(last.events).toEqual(['pack.exhausted']);
    expect(last.purchases[0]!.status).toBe('exhausted');
    expect(consumeRide(last.purchases, 'completed', T0, settings).consumedFromId).toBeNull();
  });
  it('les courses reportées se consomment avant celles du pack', () => {
    const p = buy('p1', 'pro', T0, false, { carriedOverRemaining: 2 });
    const r = consumeRide([p], 'completed', T0, settings).purchases[0]!;
    expect(r).toMatchObject({ carriedOverRemaining: 1, ridesRemaining: 50 });
    expect(remainingRides(r)).toBe(51);
  });
});

describe('expiration et report', () => {
  it('expirePacks passe les packs dépassés en expiré, sans toucher aux autres', () => {
    const ps = expirePacks([buy('a', 'pro', days(-28)), buy('b', 'pro', days(-27)), buy('c', 'pro', T0, false, { status: 'exhausted' })], T0);
    expect(ps.map((p) => p.status)).toEqual(['expired', 'active', 'exhausted']);
  });
  it('report des courses non utilisées sur le pack suivant activé dans les 7 jours', () => {
    const expired = { ...consumeN([buy('a', 'pro', days(-28))], 30, days(-27))[0]!, status: 'expired' as const };
    const next = buy('b', 'essentiel', days(6));
    const r = rolloverOnExpiry(expired, next, settings);
    expect(r.rolledOver).toBe(20);
    expect(r.next).toMatchObject({ carriedOverRemaining: 20, ridesRemaining: 25 });
    expect(r.expired).toMatchObject({ ridesRemaining: 0, rolloverDone: true });
  });
  it('report accepté le septième jour, refusé le huitième', () => {
    const expired = buy('a', 'pro', days(-28), false, { status: 'expired', ridesRemaining: 5 });
    expect(rolloverOnExpiry(expired, buy('b', 'pro', days(7)), settings).rolledOver).toBe(5);
    expect(rolloverOnExpiry(expired, buy('b', 'pro', days(8)), settings).rolledOver).toBe(0);
  });
  it('report une seule fois : les courses reportées ne se reportent pas de nouveau', () => {
    const expired = buy('a', 'pro', days(-28), false, { status: 'expired', ridesRemaining: 0, carriedOverRemaining: 4 });
    const r = rolloverOnExpiry(expired, buy('b', 'pro', T0), settings);
    expect(r.rolledOver).toBe(0);
    expect(r.expired.rolloverDone).toBe(true);
    expect(rolloverOnExpiry(r.expired, buy('c', 'pro', T0), settings).rolledOver).toBe(0);
  });
  it.each([
    ['pack encore actif', { status: 'active' as const }, {}],
    ['report déjà fait', { status: 'expired' as const, rolloverDone: true }, {}],
    ['pack Illimité expiré', { status: 'expired' as const, ridesIncluded: null }, {}],
    ['pack suivant Illimité', { status: 'expired' as const }, { ridesIncluded: null }],
    ['autre chauffeur', { status: 'expired' as const }, { driverId: 'd2' }],
    ['pack suivant non actif', { status: 'expired' as const }, { status: 'cancelled' as const }],
    ['pack suivant activé avant l\'expiration', { status: 'expired' as const }, { activatedAt: days(-1) }],
  ])('pas de report : %s', (_label, expiredOver, nextOver) => {
    const expired = buy('a', 'pro', days(-28), false, { ridesRemaining: 5, ...expiredOver });
    const next = { ...buy('b', 'pro', T0), ...nextOver };
    expect(rolloverOnExpiry(expired, next, settings)).toEqual({ expired, next, rolledOver: 0 });
  });
});

describe('renouvellement et changement de pack', () => {
  it('renouvellement automatique à l\'épuisement, et à l\'expiration pour Illimité', () => {
    expect(shouldAutoRenew(buy('a', 'pro', T0, true, { status: 'exhausted' }), T0)).toBe(true);
    expect(shouldAutoRenew(buy('a', 'pro', T0, true, { status: 'expired' }), T0)).toBe(true);
    expect(shouldAutoRenew(buy('a', 'pro', T0, true), T0)).toBe(false);
    expect(shouldAutoRenew(buy('u', 'illimite', days(-7), true), T0)).toBe(true);
    expect(shouldAutoRenew(buy('u', 'illimite', days(-6), true), T0)).toBe(false);
  });
  it('jamais sans l\'option, ni pour un pack annulé', () => {
    expect(shouldAutoRenew(buy('a', 'pro', T0, false, { status: 'exhausted' }), T0)).toBe(false);
    expect(shouldAutoRenew(buy('a', 'pro', T0, true, { status: 'cancelled' }), T0)).toBe(false);
  });
  it('le nouveau pack prend effet à l\'épuisement de l\'actuel', () => {
    expect(renewalPackCode(buy('a', 'pro', T0, true, { nextPackCode: 'elite' }))).toBe('elite');
    expect(renewalPackCode(buy('a', 'pro', T0, true))).toBe('pro');
  });
});

describe('réception des offres', () => {
  it('avec un pack utilisable', () => {
    expect(canReceiveOffers([buy('a', 'pro')], T0)).toEqual({ ok: true, reason: null });
  });
  it('sans pack : motif « no_pack »', () => {
    expect(canReceiveOffers([], T0)).toEqual({ ok: false, reason: 'no_pack' });
    expect(canReceiveOffers([buy('a', 'pro', T0, false, { status: 'cancelled' })], T0)).toEqual({ ok: false, reason: 'no_pack' });
  });
  it('pack épuisé ou expiré sans renouvellement : refus motivé', () => {
    expect(canReceiveOffers([buy('a', 'pro', T0, false, { status: 'exhausted' })], T0)).toEqual({ ok: false, reason: 'exhausted' });
    expect(canReceiveOffers([buy('a', 'pro', days(-40), false, { status: 'expired' })], T0)).toEqual({ ok: false, reason: 'expired' });
  });
  it('le motif vient du pack le plus récent', () => {
    const olderExpired = buy('a', 'pro', days(-60), false, { status: 'expired' });
    const recentExhausted = buy('b', 'pro', days(-2), false, { status: 'exhausted' });
    expect(canReceiveOffers([olderExpired, recentExhausted], T0).reason).toBe('exhausted');
    expect(canReceiveOffers([recentExhausted, olderExpired], T0).reason).toBe('exhausted');
  });
  it('pack épuisé avec renouvellement automatique : offres maintenues', () => {
    expect(canReceiveOffers([buy('a', 'pro', T0, true, { status: 'exhausted' })], T0).ok).toBe(true);
  });
  it('activePack ignore les packs non utilisables', () => {
    expect(activePack([buy('a', 'pro', T0, false, { status: 'exhausted' })], T0)).toBeNull();
  });
});
