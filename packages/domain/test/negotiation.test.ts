import { describe, expect, it } from 'vitest';
import {
  agreedPrice, ceilingCentsOf, clampProposal, experimentGroupFor, negotiationIneligibility, proposalFloorCents, roundToDollar, validateCounter, withinConsent, type NegotiationRules,
} from '../src/index.js';

const rules: NegotiationRules = { floorPpm: 700_000, ceilingPpm: 1_300_000, aboveMaxEnabled: false };
const aboveMax: NegotiationRules = { ...rules, aboveMaxEnabled: true };
const P = 3156; // 31,56 $ : l'exemple de contrôle du cahier des charges

describe('proposition du client (P\')', () => {
  it('arrondit au dollar', () => {
    expect(roundToDollar(2849)).toBe(2800);
    expect(roundToDollar(2850)).toBe(2900);
    expect(roundToDollar(0)).toBe(0);
  });
  it('plancher : 70 % du prix affiché arrondi au dollar supérieur, jamais au-dessus du prix', () => {
    expect(proposalFloorCents(P, 700_000)).toBe(2300); // 22,09 $ → 23 $
    expect(proposalFloorCents(P, 1_500_000)).toBe(P);
    expect(proposalFloorCents(P, -5)).toBe(0);
    expect(proposalFloorCents(150, 700_000)).toBe(150); // 1,05 $ → 2 $ plafonné au prix
  });
  it('borne la proposition entre le plancher et P', () => {
    expect(clampProposal(P, 2800, 700_000)).toEqual({ totalCents: 2800, floorCents: 2300, adjusted: false });
    expect(clampProposal(P, 2849, 700_000)).toEqual({ totalCents: 2800, floorCents: 2300, adjusted: true });
    expect(clampProposal(P, 1000, 700_000)).toEqual({ totalCents: 2300, floorCents: 2300, adjusted: true });
    expect(clampProposal(P, 5000, 700_000)).toEqual({ totalCents: P, floorCents: 2300, adjusted: true });
    expect(clampProposal(P, -50, 700_000).totalCents).toBe(2300);
  });
});

describe('contre-proposition du chauffeur', () => {
  it('accepte une valeur entre P\' et P', () => {
    expect(validateCounter({ displayedCents: P, proposedCents: 2800, counterCents: 3000 }, rules)).toEqual({ ok: true, aboveDisplayed: false, ceilingCents: 4102 });
    expect(validateCounter({ displayedCents: P, proposedCents: 2800, counterCents: 2800 }, rules).ok).toBe(true);
    expect(validateCounter({ displayedCents: P, proposedCents: 2800, counterCents: P }, rules).ok).toBe(true);
  });
  it('refuse sous P\'', () => {
    expect(validateCounter({ displayedCents: P, proposedCents: 2800, counterCents: 2799 }, rules)).toMatchObject({ ok: false, code: 'COUNTER_BELOW_PROPOSAL' });
  });
  it('au-dessus de P : second drapeau, motif obligatoire, texte pour « autre », plafond', () => {
    const above = { displayedCents: P, proposedCents: 2800, counterCents: 3500 };
    expect(validateCounter(above, rules)).toMatchObject({ ok: false, code: 'ABOVE_MAX_DISABLED' });
    expect(validateCounter(above, aboveMax)).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(validateCounter({ ...above, reason: 'other' }, aboveMax)).toMatchObject({ ok: false, code: 'REASON_TEXT_REQUIRED' });
    expect(validateCounter({ ...above, reason: 'other', reasonText: '   ' }, aboveMax)).toMatchObject({ ok: false, code: 'REASON_TEXT_REQUIRED' });
    expect(validateCounter({ ...above, reason: 'other', reasonText: 'Pont fermé' }, aboveMax)).toEqual({ ok: true, aboveDisplayed: true, ceilingCents: 4102 });
    expect(validateCounter({ ...above, reason: 'event' }, aboveMax)).toEqual({ ok: true, aboveDisplayed: true, ceilingCents: 4102 });
    expect(validateCounter({ ...above, counterCents: 4103, reason: 'event' }, aboveMax)).toMatchObject({ ok: false, code: 'COUNTER_ABOVE_CEILING' });
  });
  it('le plafond n\'est jamais sous le prix affiché', () => {
    expect(ceilingCentsOf(P, 1_300_000)).toBe(4102);
    expect(ceilingCentsOf(P, 500_000)).toBe(P);
  });
});

describe('éligibilité, groupe de test et prix convenu', () => {
  const eligible = { flatRateCode: null, category: 'neo_premium', organizationId: null, businessAccountId: null };
  it('exclut forfaits, comptes entreprises et organisations, lots, Neo Limo', () => {
    expect(negotiationIneligibility(eligible)).toBeNull();
    expect(negotiationIneligibility({ ...eligible, flatRateCode: 'yul-centre' })).toBe('flat_rate');
    expect(negotiationIneligibility({ ...eligible, businessAccountId: 'b' })).toBe('business_account');
    expect(negotiationIneligibility({ ...eligible, organizationId: 'o' })).toBe('business_account');
    expect(negotiationIneligibility({ ...eligible, seriesId: 's' })).toBe('ride_series');
    expect(negotiationIneligibility({ ...eligible, category: 'neo_limo' })).toBe('neo_limo');
  });
  it('répartit les clients moitié-moitié', () => {
    expect(experimentGroupFor(0)).toBe('negotiation');
    expect(experimentGroupFor(0.49)).toBe('negotiation');
    expect(experimentGroupFor(0.5)).toBe('fixed');
    expect(experimentGroupFor(0.99)).toBe('fixed');
  });
  it('prix convenu selon l\'offre acceptée', () => {
    expect(agreedPrice({ displayedCents: P, proposedCents: 2800, offer: { type: 'fixed', proposedTotalCents: null } })).toEqual({ totalCents: P, explicitConsentRequired: false });
    expect(agreedPrice({ displayedCents: P, proposedCents: 2800, offer: { type: 'client_proposal', proposedTotalCents: 2800 } })).toEqual({ totalCents: 2800, explicitConsentRequired: false });
    expect(agreedPrice({ displayedCents: P, proposedCents: null, offer: { type: 'client_proposal', proposedTotalCents: null } })).toEqual({ totalCents: P, explicitConsentRequired: false });
    expect(agreedPrice({ displayedCents: P, proposedCents: 2800, offer: { type: 'driver_counter', proposedTotalCents: 3000 } })).toEqual({ totalCents: 3000, explicitConsentRequired: false });
    expect(agreedPrice({ displayedCents: P, proposedCents: 2800, offer: { type: 'driver_counter', proposedTotalCents: 3500 } })).toEqual({ totalCents: 3500, explicitConsentRequired: true });
    expect(agreedPrice({ displayedCents: P, proposedCents: 2800, offer: { type: 'driver_counter', proposedTotalCents: null } })).toEqual({ totalCents: P, explicitConsentRequired: false });
  });
  it('invariant : le prix final ne dépasse pas le prix maximal consenti', () => {
    expect(withinConsent(3000, P)).toBe(true);
    expect(withinConsent(P, P)).toBe(true);
    expect(withinConsent(P + 1, P)).toBe(false);
  });
});

describe('propriété : 1 000 négociations aléatoires respectent le prix maximal consenti', () => {
  it('sans le second drapeau, tout prix convenu est entre le plancher et P ; avec lui, seule une offre consentie dépasse P', () => {
    let seed = 20260925;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 1000; i += 1) {
      const displayed = 800 + Math.floor(random() * 50_000);
      const floorPpm = 500_000 + Math.floor(random() * 500_000);
      const proposal = clampProposal(displayed, Math.floor(random() * displayed * 1.5), floorPpm);
      expect(proposal.totalCents).toBeGreaterThanOrEqual(proposal.floorCents);
      expect(proposal.totalCents).toBeLessThanOrEqual(displayed);
      expect(proposal.totalCents % 100 === 0 || proposal.totalCents === displayed).toBe(true);
      const counter = Math.floor(proposal.totalCents + random() * displayed * 0.8);
      const enabled = random() < 0.5;
      const check = validateCounter({ displayedCents: displayed, proposedCents: proposal.totalCents, counterCents: counter, reason: 'event' }, { floorPpm, ceilingPpm: 1_300_000, aboveMaxEnabled: enabled });
      if (check.ok) {
        const agreed = agreedPrice({ displayedCents: displayed, proposedCents: proposal.totalCents, offer: { type: 'driver_counter', proposedTotalCents: counter } });
        if (!check.aboveDisplayed) expect(withinConsent(agreed.totalCents, displayed)).toBe(true);
        else {
          expect(enabled).toBe(true);
          expect(agreed.explicitConsentRequired).toBe(true);
          expect(counter).toBeLessThanOrEqual(check.ceilingCents);
        }
        expect(agreed.totalCents).toBeGreaterThanOrEqual(proposal.totalCents);
      } else {
        expect(counter > displayed || counter < proposal.totalCents).toBe(true);
      }
      const accepted = agreedPrice({ displayedCents: displayed, proposedCents: proposal.totalCents, offer: { type: random() < 0.5 ? 'fixed' : 'client_proposal', proposedTotalCents: null } });
      expect(withinConsent(accepted.totalCents, displayed)).toBe(true);
    }
  });
});
