import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPATCH_WEIGHTS, DEFAULT_SEARCH_RADII, etaMinutesOf, fairnessPenalty, nextRadius, parseDispatchWeights, parseSearchRadii, scoreCandidate, scoreCandidates, selectWave,
  type DispatchCandidate, type DispatchContext,
} from '../src/index.js';

const context: DispatchContext = { premiumContext: false, fallbackSpeedMps: 8 };
const base: DispatchCandidate = { driverId: 'a', etaSeconds: 600, distanceMeters: 3000, rating: 4.5, idleMinutes: 0, zoneImbalance: 0, isRequestedFavourite: false, isClientFavourite: false, isUnlimited: false };

describe('poids du score (réglage dispatch.score_weights)', () => {
  it('renvoie les défauts pour une valeur absente, non objet ou vide', () => {
    expect(parseDispatchWeights(undefined)).toEqual(DEFAULT_DISPATCH_WEIGHTS);
    expect(parseDispatchWeights(null)).toEqual(DEFAULT_DISPATCH_WEIGHTS);
    expect(parseDispatchWeights('x')).toEqual(DEFAULT_DISPATCH_WEIGHTS);
    expect(parseDispatchWeights({})).toEqual(DEFAULT_DISPATCH_WEIGHTS);
  });
  it('lit un objet partiel et ignore les valeurs invalides et les anciennes clés', () => {
    const weights = parseDispatchWeights({ eta: 0.7, rating: -1, fairness: Number.NaN, zone: '1', favouriteBonus: 80, distance: 40 });
    expect(weights).toEqual({ ...DEFAULT_DISPATCH_WEIGHTS, eta: 0.7, favouriteBonus: 80 });
  });
});

describe('pénalité d\'équité et temps d\'arrivée', () => {
  it('décroît de 10 à 0 sur la durée de décroissance, jamais négative', () => {
    expect(fairnessPenalty(0, 20)).toBe(10);
    expect(fairnessPenalty(10, 20)).toBe(5);
    expect(fairnessPenalty(20, 20)).toBe(0);
    expect(fairnessPenalty(45, 20)).toBe(0);
    expect(fairnessPenalty(-5, 20)).toBe(10);
    expect(fairnessPenalty(3, 0)).toBe(0);
  });
  it('préfère la matrice, se replie sur la distance et la vitesse, sinon 0', () => {
    expect(etaMinutesOf({ etaSeconds: 600, distanceMeters: 100 }, context)).toBe(10);
    expect(etaMinutesOf({ etaSeconds: -30, distanceMeters: 100 }, context)).toBe(0);
    expect(etaMinutesOf({ etaSeconds: null, distanceMeters: 4800 }, context)).toBe(10);
    expect(etaMinutesOf({ etaSeconds: null, distanceMeters: -10 }, context)).toBe(0);
    expect(etaMinutesOf({ etaSeconds: null, distanceMeters: 4800 }, { ...context, fallbackSpeedMps: 0 })).toBe(0);
    expect(etaMinutesOf({ etaSeconds: null, distanceMeters: null }, context)).toBe(0);
  });
});

describe('score des candidats (formule 5.4)', () => {
  it('applique exactement la formule : 0,55 × ETA + 0,20 × (5 − note) × 4 + 0,15 × équité + 0,10 × zone', () => {
    // ETA 10 min, note 4,5, vient de finir une course (pénalité 10), zone équilibrée : 5,5 + 0,4 + 1,5 + 0 = 7,4
    expect(scoreCandidate(base, context).score).toBe(7.4);
    expect(scoreCandidate({ ...base, idleMinutes: 30, zoneImbalance: 5 }, context).score).toBe(6.4);
  });
  it('borne la note entre 0 et 5 et le déséquilibre entre 0 et 10', () => {
    expect(scoreCandidate({ ...base, rating: 9, idleMinutes: 30 }, context).score).toBe(5.5);
    expect(scoreCandidate({ ...base, rating: -2, idleMinutes: 30 }, context).score).toBe(9.5);
    expect(scoreCandidate({ ...base, idleMinutes: 30, zoneImbalance: 50 }, context).score).toBe(6.9);
    expect(scoreCandidate({ ...base, idleMinutes: 30, zoneImbalance: -3 }, context).score).toBe(5.9);
  });
  it('favori demandé : −100 ; autre favori du client : −50 ; jamais les deux', () => {
    expect(scoreCandidate({ ...base, isRequestedFavourite: true }, context).score).toBe(-92.6);
    expect(scoreCandidate({ ...base, isClientFavourite: true }, context).score).toBe(-42.6);
    expect(scoreCandidate({ ...base, isRequestedFavourite: true, isClientFavourite: true }, context).score).toBe(-92.6);
  });
  it('Illimité : −5 seulement sur une course VIP, aéroport ou entreprise', () => {
    expect(scoreCandidate({ ...base, isUnlimited: true }, context).score).toBe(7.4);
    expect(scoreCandidate({ ...base, isUnlimited: true }, { ...context, premiumContext: true }).score).toBe(2.4);
    expect(scoreCandidate(base, { ...context, premiumContext: true }).score).toBe(7.4);
  });
  it('classe du meilleur au moins bon, départage par le temps d\'arrivée puis l\'identifiant', () => {
    const far: DispatchCandidate = { ...base, driverId: 'far', etaSeconds: 1200 };
    const near: DispatchCandidate = { ...base, driverId: 'near', etaSeconds: 300 };
    const favourite: DispatchCandidate = { ...far, driverId: 'fav', isRequestedFavourite: true };
    const sameScoreB: DispatchCandidate = { ...base, driverId: 'b' };
    const sameScoreA: DispatchCandidate = { ...base, driverId: 'a' };
    // Même score que « a » avec un temps d'arrivée plus long compensé par une note plus haute (arrondi au millième).
    const slower: DispatchCandidate = { ...base, driverId: 'slow', etaSeconds: 600 + 60, rating: 5 };
    const ranked = scoreCandidates([far, sameScoreB, near, favourite, sameScoreA, slower], context, { ...DEFAULT_DISPATCH_WEIGHTS });
    expect(ranked.map((c) => c.driverId)).toEqual(['fav', 'near', 'a', 'b', 'slow', 'far']);
    expect(ranked[1]!.etaMinutes).toBe(5);
  });
});

describe('vagues et rayons', () => {
  it('sélectionne les meilleurs de la vague, jamais moins de zéro', () => {
    const scored = scoreCandidates([base, { ...base, driverId: 'b' }, { ...base, driverId: 'c' }], context);
    expect(selectWave(scored, 2)).toHaveLength(2);
    expect(selectWave(scored, 2.9)).toHaveLength(2);
    expect(selectWave(scored, 0)).toHaveLength(0);
    expect(selectWave(scored, -1)).toHaveLength(0);
    expect(selectWave(scored, 10)).toHaveLength(3);
  });
  it('enchaîne 2 km, 5 km, 10 km puis toute la zone, et s\'arrête', () => {
    const radii = parseSearchRadii([2000, 5000, 10_000, null]);
    expect(nextRadius(-1, radii)).toEqual({ index: 0, radius: 2000 });
    expect(nextRadius(0, radii)).toEqual({ index: 1, radius: 5000 });
    expect(nextRadius(2, radii)).toEqual({ index: 3, radius: null });
    expect(nextRadius(3, radii)).toBeNull();
    expect(nextRadius(-3, radii)).toBeNull();
    expect(nextRadius(-1, [])).toBeNull();
  });
  it('lit les rayons depuis un réglage et retombe sur le défaut', () => {
    expect(parseSearchRadii(undefined)).toEqual([...DEFAULT_SEARCH_RADII]);
    expect(parseSearchRadii([1000, -5, 'x', null, Number.NaN])).toEqual([1000, null]);
    expect(parseSearchRadii(['x'])).toEqual([...DEFAULT_SEARCH_RADII]);
  });
});
