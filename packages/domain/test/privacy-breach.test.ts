import { describe, expect, it } from 'vitest';
import {
  MANUAL_INCIDENT_TYPES, adminIncidentCreateSchema, privacyBreachFollowUps, privacyBreachInputSchema, privacyBreachReference, privacyBreachSchema,
} from '../src/index.js';

const minimal = { discoveredAt: '2026-09-26T14:00:00.000Z', dataDescription: 'Relevé d\'un chauffeur envoyé à un autre chauffeur', circumstances: 'Erreur d\'adresse de courriel' };

describe('registre des incidents de confidentialité', () => {
  it('accepte une inscription minimale et complète les rubriques absentes', () => {
    const entry = privacyBreachInputSchema.parse(minimal);
    expect(entry).toMatchObject({ occurredFrom: null, occurredTo: null, dataCategories: [], personsAffected: null, seriousHarm: 'pending', publicNotice: false, measures: null });
  });

  it('refuse une période inversée, plus de personnes au Québec qu\'au total, un avis public sans raison', () => {
    const errors = (input: object) => privacyBreachInputSchema.safeParse({ ...minimal, ...input }).error?.issues.map((i) => i.path.join('.'));
    expect(errors({ occurredFrom: '2026-09-20', occurredTo: '2026-09-19' })).toEqual(['occurredTo']);
    expect(errors({ occurredFrom: '2026-09-19', occurredTo: '2026-09-20' })).toBeUndefined();
    expect(errors({ occurredTo: '2026-09-19' })).toBeUndefined();
    expect(errors({ personsAffected: 3, personsAffectedQuebec: 4 })).toEqual(['personsAffectedQuebec']);
    expect(errors({ personsAffected: 3, personsAffectedQuebec: 3 })).toBeUndefined();
    expect(errors({ personsAffectedQuebec: 3 })).toBeUndefined();
    expect(errors({ publicNotice: true })).toEqual(['publicNoticeReason']);
    expect(errors({ publicNotice: true, publicNoticeReason: 'Coordonnées manquantes' })).toBeUndefined();
    expect(errors({ dataDescription: '' })).toEqual(['dataDescription']);
    expect(errors({ dataCategories: ['locations', 'inconnue'] })).toEqual(['dataCategories.1']);
  });

  it('numéro de registre annuel sur trois chiffres au moins', () => {
    expect(privacyBreachReference(2026, 1)).toBe('IC-2026-001');
    expect(privacyBreachReference(2027, 1234)).toBe('IC-2027-1234');
  });

  it('suites à donner selon l\'évaluation et les avis', () => {
    const base = privacyBreachInputSchema.parse(minimal);
    expect(privacyBreachFollowUps(base)).toEqual(['record_containment', 'assess_harm', 'record_measures']);
    const serious = { ...base, containment: 'Lien révoqué', seriousHarm: 'serious' as const, measures: 'Double vérification des destinataires' };
    expect(privacyBreachFollowUps(serious)).toEqual(['notify_cai', 'notify_persons']);
    expect(privacyBreachFollowUps({ ...serious, caiNotifiedOn: '2026-09-27', personsNotifiedOn: '2026-09-27' })).toEqual([]);
    expect(privacyBreachFollowUps({ ...serious, caiNotifiedOn: '2026-09-27', publicNotice: true })).toEqual([]);
    expect(privacyBreachFollowUps({ ...serious, seriousHarm: 'not_serious' })).toEqual([]);
  });

  it('vue du registre et création manuelle d\'un incident', () => {
    const view = privacyBreachSchema.parse({ ...privacyBreachInputSchema.parse(minimal), incidentId: '00000000-0000-4000-8000-000000000001', reference: 'IC-2026-001', recordedAt: minimal.discoveredAt, updatedAt: minimal.discoveredAt, followUps: ['assess_harm'] });
    expect(view.reference).toBe('IC-2026-001');
    expect(MANUAL_INCIDENT_TYPES).not.toContain('sos');
    expect(adminIncidentCreateSchema.safeParse({ type: 'privacy', description: 'Fuite d\'un export' }).error?.issues[0]?.path).toEqual(['privacyBreach']);
    expect(adminIncidentCreateSchema.parse({ type: 'privacy', description: 'Fuite d\'un export', privacyBreach: minimal }).severity).toBe('medium');
    expect(adminIncidentCreateSchema.parse({ type: 'lost_item', severity: 'low', description: 'Parapluie oublié' }).privacyBreach).toBeUndefined();
    expect(adminIncidentCreateSchema.safeParse({ type: 'sos', description: 'SOS saisi à la main' }).success).toBe(false);
  });
});
