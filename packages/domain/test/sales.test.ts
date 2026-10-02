import { describe, expect, it } from 'vitest';
import {
  businessEmail, businessQuoteFromGrid, callResultFromEndedReason, canContact, createProspectToolSchema, dealStageForProspect, DEFAULT_BUSINESS_GRID, DEFAULT_BUSINESS_HOURS,
  emailDomain, followupDueAt, isBusinessEmail, localDayMinutes, nextBusinessSlot, parseBusinessGrid, parseBusinessHours, prospectCreateSchema, prospectImportSchema,
  prospectListQuerySchema, prospectScore, prospectUpdateSchema, stageAfterCall, withinBusinessHours, type ProspectStage,
} from '../src/index.js';

const TZ = 'America/Toronto';
/** Mardi 6 octobre 2026, 10 h 30 à Montréal (heure avancée, UTC-4). */
const TUESDAY_10H30 = new Date('2026-10-06T14:30:00Z');

describe('ventes : qui peut être démarché (Loi anti-pourriel, retrait, repos après un refus)', () => {
  const base = { unsubscribedAt: null, lostAt: null };
  it('jamais après un retrait, ni en « ne plus contacter », ni un compte gagné', () => {
    expect(canContact({ stage: 'qualified', unsubscribedAt: new Date(), lostAt: null }, TUESDAY_10H30, 180)).toBe(false);
    expect(canContact({ ...base, stage: 'do_not_contact' }, TUESDAY_10H30, 180)).toBe(false);
    expect(canContact({ ...base, stage: 'won' }, TUESDAY_10H30, 180)).toBe(false);
    for (const stage of ['new', 'qualified', 'contacted', 'replied', 'meeting', 'quote'] as ProspectStage[]) expect(canContact({ ...base, stage }, TUESDAY_10H30, 180)).toBe(true);
  });
  it('un prospect perdu attend le délai de repos (6 mois), jamais sans date', () => {
    expect(canContact({ ...base, stage: 'lost' }, TUESDAY_10H30, 180)).toBe(false);
    expect(canContact({ ...base, stage: 'lost', lostAt: new Date(TUESDAY_10H30.getTime() - 100 * 86_400_000) }, TUESDAY_10H30, 180)).toBe(false);
    expect(canContact({ ...base, stage: 'lost', lostAt: new Date(TUESDAY_10H30.getTime() - 181 * 86_400_000) }, TUESDAY_10H30, 180)).toBe(true);
  });
});

describe('ventes : adresses professionnelles seulement (jamais un particulier)', () => {
  it('reconnaît le domaine et refuse les messageries grand public', () => {
    expect(emailDomain('Achats@Hotel-Exemple.CA ')).toBe('hotel-exemple.ca');
    expect(emailDomain('pas-une-adresse')).toBeNull();
    expect(isBusinessEmail('achats@hotel-exemple.ca')).toBe(true);
    expect(isBusinessEmail('jean.tremblay@gmail.com')).toBe(false);
    expect(isBusinessEmail('x@videotron.ca')).toBe(false);
    expect(isBusinessEmail('invalide')).toBe(false);
    expect(businessEmail.safeParse('  Reception@Clinique.QC.CA ').data).toBe('reception@clinique.qc.ca');
    expect(businessEmail.safeParse('moi@hotmail.com').success).toBe(false);
  });
  it('schémas d\'entrée : organisation et un canal professionnel exigés ; import borné ; mise à jour non vide', () => {
    expect(prospectCreateSchema.safeParse({ organizationName: 'Hôtel Exemple' }).success).toBe(false);
    const ok = prospectCreateSchema.parse({ organizationName: 'Hôtel Exemple', phone: '+15145550123' });
    expect(ok).toMatchObject({ segment: 'other', language: 'fr', consentBasis: 'published_address', whatsappOk: false });
    expect(prospectCreateSchema.safeParse({ organizationName: 'X', email: 'a@gmail.com' }).success).toBe(false);
    expect(prospectImportSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(prospectImportSchema.parse({ rows: [{ organizationName: 'Clinique', email: 'info@clinique.ca' }] }).rows).toHaveLength(1);
    expect(prospectUpdateSchema.safeParse({}).success).toBe(false);
    expect(prospectUpdateSchema.safeParse({ stage: 'do_not_contact' }).success).toBe(false);
    expect(prospectUpdateSchema.parse({ stage: 'lost', stageReason: 'Pas de besoin' })).toEqual({ stage: 'lost', stageReason: 'Pas de besoin' });
    expect(prospectListQuerySchema.parse({ minScore: '40', stage: 'qualified' })).toMatchObject({ page: 1, pageSize: 25, minScore: 40, stage: 'qualified' });
    expect(createProspectToolSchema.parse({ organizationName: 'École', source: 'google_places', phone: '+15145550100' })).toMatchObject({ rating: null, reviewCount: null, segment: 'other' });
  });
});

describe('ventes : score et relances', () => {
  it('score de 0 à 100 selon le segment, les canaux, la réputation, l\'intérêt et la taille', () => {
    expect(prospectScore({ segment: 'hotel', hasEmail: true, hasPhone: true, hasWebsite: true, rating: 4.5, reviewCount: 120, interest: 'high', size: 'large' })).toBe(100);
    expect(prospectScore({ segment: 'other', hasEmail: false, hasPhone: false, hasWebsite: false, rating: null, reviewCount: null, interest: 'low', size: 'small' })).toBe(5);
    expect(prospectScore({ segment: 'school', hasEmail: true, hasPhone: false, hasWebsite: false, rating: 3.9, reviewCount: 10, interest: 'unknown', size: 'unknown' })).toBe(32);
    expect(prospectScore({ segment: 'clinic', hasEmail: false, hasPhone: true, hasWebsite: true, rating: 4, reviewCount: 50, interest: 'medium', size: 'medium' })).toBe(60);
  });
  it('échéances J+3, J+10, J+30 puis clôture', () => {
    const first = new Date('2026-10-01T15:00:00Z');
    expect(followupDueAt(first, [3, 10, 30], 0)).toEqual(new Date('2026-10-04T15:00:00Z'));
    expect(followupDueAt(first, [3, 10, 30], 2)).toEqual(new Date('2026-10-31T15:00:00Z'));
    expect(followupDueAt(first, [3, 10, 30], 3)).toBeNull();
  });
});

describe('ventes : heures de bureau des appels (America/Toronto)', () => {
  it('le réglage sales.call_hours a la forme de fairness.business_hours (même lecture)', () => {
    expect(parseBusinessHours({ days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' })).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(parseBusinessHours({ days: [1, 3], from: '08:30', to: '16:00' })).toEqual({ days: [1, 3], startMinute: 510, endMinute: 960 });
  });
  it('dedans en semaine entre 9 h et 17 h, dehors le soir et la fin de semaine ; prochain créneau', () => {
    expect(localDayMinutes(TUESDAY_10H30, TZ)).toEqual({ weekday: 2, minutes: 630 });
    expect(withinBusinessHours(TUESDAY_10H30, TZ, DEFAULT_BUSINESS_HOURS)).toBe(true);
    expect(withinBusinessHours(new Date('2026-10-06T21:00:00Z'), TZ, DEFAULT_BUSINESS_HOURS)).toBe(false);
    expect(withinBusinessHours(new Date('2026-10-10T15:00:00Z'), TZ, DEFAULT_BUSINESS_HOURS)).toBe(false);
    expect(nextBusinessSlot(TUESDAY_10H30, TZ, DEFAULT_BUSINESS_HOURS)).toBe(TUESDAY_10H30);
    // Mardi 21 h 30 à Montréal : mercredi 9 h.
    expect(nextBusinessSlot(new Date('2026-10-07T01:30:00Z'), TZ, DEFAULT_BUSINESS_HOURS)).toEqual(new Date('2026-10-07T13:00:00Z'));
    // Samedi midi : lundi 9 h.
    expect(nextBusinessSlot(new Date('2026-10-10T16:00:00Z'), TZ, DEFAULT_BUSINESS_HOURS)).toEqual(new Date('2026-10-12T13:00:00Z'));
    // Mardi 6 h 00 à Montréal, avec des secondes : le même jour à 9 h.
    expect(nextBusinessSlot(new Date('2026-10-06T10:00:30Z'), TZ, DEFAULT_BUSINESS_HOURS)).toEqual(new Date('2026-10-06T13:00:00Z'));
  });
});

describe('ventes : grille entreprise et devis', () => {
  it('lit la grille des réglages, trie les paliers, reprend les défauts', () => {
    expect(parseBusinessGrid(null)).toEqual(DEFAULT_BUSINESS_GRID);
    expect(parseBusinessGrid({ tiers: [{ minMonthlyRides: 100, discountBps: 1500 }, { minMonthlyRides: 10, discountBps: 300 }, { bad: true }], maxDiscountBps: 1500, validityDays: 0, paymentTermsDays: -1 })).toEqual({
      ...DEFAULT_BUSINESS_GRID, tiers: [{ minMonthlyRides: 10, discountBps: 300 }, { minMonthlyRides: 100, discountBps: 1500 }], maxDiscountBps: 1500, validityDays: 1,
    });
    expect(parseBusinessGrid({ tiers: 'x' }).tiers).toEqual(DEFAULT_BUSINESS_GRID.tiers);
  });
  it('dans la grille : palier atteint ; hors grille : remise, délai ou volume hors bornes (valeurs demandées gardées pour l\'approbation)', () => {
    expect(businessQuoteFromGrid(DEFAULT_BUSINESS_GRID, { expectedMonthlyRides: 25 })).toEqual({ inGrid: true, discountBps: 500, paymentTermsDays: 30, validityDays: 30, reasons: [] });
    expect(businessQuoteFromGrid(DEFAULT_BUSINESS_GRID, { expectedMonthlyRides: 60, requestedDiscountBps: 800 })).toMatchObject({ inGrid: true, discountBps: 1000 });
    const over = businessQuoteFromGrid(DEFAULT_BUSINESS_GRID, { expectedMonthlyRides: 60, requestedDiscountBps: 1500, paymentTermsDays: 60 });
    expect(over).toMatchObject({ inGrid: false, discountBps: 1500, paymentTermsDays: 60 });
    expect(over.reasons).toHaveLength(2);
    expect(over.reasons[0]).toContain('plafond');
    const abovePalier = businessQuoteFromGrid(DEFAULT_BUSINESS_GRID, { expectedMonthlyRides: 5, requestedDiscountBps: 300 });
    expect(abovePalier.reasons[0]).toContain('palier');
    const tooSmall = businessQuoteFromGrid({ ...DEFAULT_BUSINESS_GRID, minMonthlyRides: 10 }, { expectedMonthlyRides: 2, paymentTermsDays: 30 });
    expect(tooSmall).toMatchObject({ inGrid: false, discountBps: 0 });
    expect(tooSmall.reasons[0]).toContain('minimum');
    expect(businessQuoteFromGrid({ ...DEFAULT_BUSINESS_GRID, tiers: [{ minMonthlyRides: 50, discountBps: 500 }] }, { expectedMonthlyRides: 10 })).toMatchObject({ inGrid: true, discountBps: 0 });
  });
});

describe('ventes : résultats d\'appel et étapes', () => {
  it('étape après un appel, résultat déduit de la raison de fin, étape HubSpot', () => {
    expect(stageAfterCall('meeting')).toBe('meeting');
    expect(stageAfterCall('callback')).toBe('contacted');
    expect(stageAfterCall('not_interested')).toBe('lost');
    expect(stageAfterCall('do_not_contact')).toBe('do_not_contact');
    expect(stageAfterCall('voicemail')).toBeNull();
    expect(callResultFromEndedReason(undefined)).toBeNull();
    expect(callResultFromEndedReason('voicemail')).toBe('voicemail');
    expect(callResultFromEndedReason('customer-did-not-answer')).toBe('no_answer');
    expect(callResultFromEndedReason('customer-busy')).toBe('no_answer');
    expect(callResultFromEndedReason('assistant-error')).toBe('failed');
    expect(callResultFromEndedReason('customer-ended-call')).toBeNull();
    expect(dealStageForProspect('new')).toBe('new');
    expect(dealStageForProspect('qualified')).toBe('new');
    expect(dealStageForProspect('contacted')).toBe('contacted');
    expect(dealStageForProspect('replied')).toBe('contacted');
    expect(dealStageForProspect('meeting')).toBe('contacted');
    expect(dealStageForProspect('quote')).toBe('proposal');
    expect(dealStageForProspect('won')).toBe('active');
    expect(dealStageForProspect('lost')).toBe('lost');
    expect(dealStageForProspect('do_not_contact')).toBe('lost');
  });
});
