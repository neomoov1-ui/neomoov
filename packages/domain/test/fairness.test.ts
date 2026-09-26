import { describe, expect, it } from 'vitest';
import {
  appealOverdue, businessSecondsBetween, canDecideAppeal, DEFAULT_BUSINESS_HOURS as H, parseBusinessHours, precautionaryReviewOverdue,
  ratingExclusionSchema, sanctionAppealDecisionSchema, sanctionAppealInputSchema,
} from '../src/index.js';

const TZ = 'America/Toronto';
const at = (iso: string) => new Date(iso);

describe('heures ouvrables (Charte d\'équité, D7)', () => {
  it('réglage : défaut du lundi au vendredi, 9 h à 17 h ; valeur invalide ignorée', () => {
    expect(parseBusinessHours(null)).toEqual(H);
    expect(parseBusinessHours('9-17')).toEqual(H);
    expect(parseBusinessHours({ days: [], from: '09:00', to: '17:00' })).toEqual(H);
    expect(parseBusinessHours({ days: [1, 8], from: '09:00', to: '17:00' })).toEqual(H);
    expect(parseBusinessHours({ days: [1], from: '9h', to: '17:00' })).toEqual(H);
    expect(parseBusinessHours({ days: [1], from: 9, to: '17:00' })).toEqual(H);
    expect(parseBusinessHours({ days: [1], from: '09:00', to: 17 })).toEqual(H);
    expect(parseBusinessHours({ days: [1], from: '18:00', to: '08:00' })).toEqual(H);
    expect(parseBusinessHours({ days: [1, 2, 3, 4, 5, 6], from: '08:30', to: '20:00' })).toEqual({ days: [1, 2, 3, 4, 5, 6], startMinute: 510, endMinute: 1200 });
  });

  it('compte seulement les heures ouvrables, en heure de Montréal', () => {
    // Mardi 22 septembre 2026, 10 h à 12 h (heure avancée, UTC-4).
    expect(businessSecondsBetween(at('2026-09-22T14:00:00Z'), at('2026-09-22T16:00:00Z'), H, TZ)).toBe(7200);
    // Lundi 16 h au mardi 10 h : une heure le lundi, une heure le mardi.
    expect(businessSecondsBetween(at('2026-09-21T20:00:00Z'), at('2026-09-22T14:00:00Z'), H, TZ)).toBe(7200);
    // Vendredi 16 h au lundi 10 h : la fin de semaine ne compte pas.
    expect(businessSecondsBetween(at('2026-09-25T20:00:00Z'), at('2026-09-28T14:00:00Z'), H, TZ)).toBe(7200);
    // Un samedi entier : rien.
    expect(businessSecondsBetween(at('2026-09-26T12:00:00Z'), at('2026-09-26T22:00:00Z'), H, TZ)).toBe(0);
    // Fin avant le début : rien.
    expect(businessSecondsBetween(at('2026-09-22T16:00:00Z'), at('2026-09-22T14:00:00Z'), H, TZ)).toBe(0);
  });

  it('jours du changement d\'heure : la plage garde sa durée locale', () => {
    const sunday = { days: [0], startMinute: 0, endMinute: 1440 };
    // Dimanche 1er novembre 2026 : retour à l'heure normale, journée de 25 heures.
    expect(businessSecondsBetween(at('2026-11-01T04:00:00Z'), at('2026-11-02T05:00:00Z'), sunday, TZ)).toBe(25 * 3600);
    // Dimanche 8 mars 2026 : passage à l'heure avancée, journée de 23 heures.
    expect(businessSecondsBetween(at('2026-03-08T05:00:00Z'), at('2026-03-09T04:00:00Z'), sunday, TZ)).toBe(23 * 3600);
  });

  it('au plus un an parcouru', () => {
    const always = { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440 };
    const seconds = businessSecondsBetween(at('2026-01-01T05:00:00Z'), at('2028-01-01T05:00:00Z'), always, TZ);
    expect(seconds).toBeGreaterThanOrEqual(365 * 86_400);
    expect(seconds).toBeLessThanOrEqual(366 * 86_400 + 3600);
  });
});

describe('délais et décideur (Charte d\'équité, D7)', () => {
  it('réponse ou appel en retard après 4 heures ouvrables', () => {
    expect(appealOverdue(at('2026-09-22T14:00:00Z'), at('2026-09-22T17:59:00Z'), H, TZ)).toBe(false);
    expect(appealOverdue(at('2026-09-22T14:00:00Z'), at('2026-09-22T18:00:00Z'), H, TZ)).toBe(true);
    // Déposé le vendredi à 16 h : en retard le lundi à 12 h seulement (1 h + 3 h).
    expect(appealOverdue(at('2026-09-25T20:00:00Z'), at('2026-09-28T15:59:00Z'), H, TZ)).toBe(false);
    expect(appealOverdue(at('2026-09-25T20:00:00Z'), at('2026-09-28T16:00:00Z'), H, TZ)).toBe(true);
    expect(appealOverdue(at('2026-09-22T14:00:00Z'), at('2026-09-22T15:00:00Z'), H, TZ, 3600)).toBe(true);
  });

  it('suspension de précaution à réexaminer sous 24 heures pleines', () => {
    expect(precautionaryReviewOverdue(at('2026-09-26T10:00:00Z'), at('2026-09-27T09:59:59Z'))).toBe(false);
    expect(precautionaryReviewOverdue(at('2026-09-26T10:00:00Z'), at('2026-09-27T10:00:00Z'))).toBe(true);
    expect(precautionaryReviewOverdue(at('2026-09-26T10:00:00Z'), at('2026-09-26T12:00:00Z'), 3600)).toBe(true);
  });

  it('l\'appel est tranché par une autre personne que celle qui a décidé la sanction', () => {
    expect(canDecideAppeal('appeal', 'u1', 'u1')).toBe(false);
    expect(canDecideAppeal('appeal', 'u1', 'u2')).toBe(true);
    expect(canDecideAppeal('appeal', null, 'u1')).toBe(true);
    expect(canDecideAppeal('response', 'u1', 'u1')).toBe(true);
  });

  it('schémas : message de 10 caractères au moins, décision motivée, exclusion motivée', () => {
    expect(sanctionAppealInputSchema.safeParse({ kind: 'appeal', message: 'Trop court' }).success).toBe(true);
    expect(sanctionAppealInputSchema.safeParse({ kind: 'appeal', message: 'court' }).success).toBe(false);
    expect(sanctionAppealInputSchema.safeParse({ kind: 'plainte', message: 'Un message assez long' }).success).toBe(false);
    expect(sanctionAppealDecisionSchema.parse({ decision: 'overturned', note: 'Version du chauffeur confirmée' }).decision).toBe('overturned');
    expect(ratingExclusionSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });
});
