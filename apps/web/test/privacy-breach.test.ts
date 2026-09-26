import { privacyBreachInputSchema, type PrivacyBreachView } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/lib/i18n';
import { draftOf, emptyDraft, inputOf, noticeText } from '../src/lib/privacy-breach';

const entry: PrivacyBreachView = {
  incidentId: '00000000-0000-4000-8000-000000000001', reference: 'IC-2026-004', recordedAt: '2026-09-26T14:00:00.000Z', updatedAt: '2026-09-26T15:00:00.000Z', followUps: ['notify_persons'],
  occurredFrom: '2026-09-24', occurredTo: '2026-09-25', discoveredAt: '2026-09-26T13:30:00.000Z', reportedBy: 'Opérateur', dataCategories: ['identity', 'tax_numbers'],
  dataDescription: 'Relevé hebdomadaire envoyé au mauvais chauffeur', circumstances: 'Erreur de saisie de l\'adresse', personsAffected: 1, personsAffectedQuebec: 1,
  containment: 'Suppression confirmée par écrit', sensitivity: 'Numéros de taxes', consequences: 'Fraude', misuseLikelihood: 'Faible', seriousHarm: 'serious', privacyOfficerConsulted: 'Fondateur',
  caiNotifiedOn: '2026-09-27', caiReference: null, personsNotifiedOn: null, personsNotificationMeans: null, publicNotice: false, publicNoticeReason: null, otherNotices: null,
  measures: 'Double vérification des destinataires', followUpReview: null,
};

describe('registre des incidents de confidentialité (web)', () => {
  it('convertit la saisie en entrée valide de l\'API et relit une fiche sans perte', () => {
    const blank = emptyDraft(new Date('2026-09-26T13:30:00.000Z'));
    expect(blank).toMatchObject({ discoveredDate: '2026-09-26', discoveredTime: '09:30', seriousHarm: 'pending', dataCategories: [] });
    const input = inputOf({ ...blank, dataDescription: '  Adresse d\'une course  ', circumstances: 'Lien de suivi transféré', personsAffected: '3', personsAffectedQuebec: '' });
    expect(input).toMatchObject({ discoveredAt: '2026-09-26T13:30:00.000Z', dataDescription: 'Adresse d\'une course', personsAffected: 3, personsAffectedQuebec: null, occurredFrom: null, measures: null });
    expect(privacyBreachInputSchema.safeParse(input).success).toBe(true);
    const roundTrip = inputOf(draftOf(entry));
    const { incidentId: _i, reference: _r, recordedAt: _a, updatedAt: _u, followUps: _f, ...fields } = entry;
    expect(roundTrip).toEqual(fields);
  });

  it('avis aux personnes et déclaration à la CAI, en français et en anglais, avec les passages à compléter', () => {
    const fr = createI18n('fr-CA').t;
    const en = createI18n('en').t;
    const persons = noticeText(entry, 'persons', fr, 'fr-CA');
    expect(persons).toContain('Objet : incident de confidentialité touchant vos renseignements personnels (IC-2026-004)');
    expect(persons).toContain('Renseignements concernés : Identité (nom, date de naissance), Numéros de TPS et TVQ. Relevé hebdomadaire envoyé au mauvais chauffeur');
    expect(persons).toContain('Mesures prises ou prévues pour réduire le risque : Double vérification des destinataires');
    expect(persons).toMatch(/Date ou période de l'incident : du .+ au .+/);
    const cai = noticeText(entry, 'cai', fr, 'fr-CA');
    expect(cai).toContain('Numéro au registre : IC-2026-004');
    expect(cai).toContain('Nombre de personnes concernées : 1, dont au Québec : 1');
    expect(cai).toContain('Avis aux personnes concernées (mesures prises ou prévues, dates) : [à compléter]');
    expect(cai).toContain('Autres personnes ou organismes avisés : aucun');
    const caiEn = noticeText({ ...entry, publicNotice: true, publicNoticeReason: 'No contact details', personsAffected: null }, 'cai', en, 'en');
    expect(caiEn).toContain('Number of people concerned: [to be completed], of whom in Quebec: 1');
    expect(caiEn).toContain('public notice (No contact details)');
    const personsEn = noticeText({ ...entry, occurredTo: null, measures: null, dataCategories: [] }, 'persons', en, 'en');
    expect(personsEn).toContain('Information concerned: Relevé hebdomadaire envoyé au mauvais chauffeur');
    expect(personsEn).toContain('Measures taken or planned to reduce the risk: [to be completed]');
    expect(personsEn).not.toMatch(/\{\{|hub\.privacy/);
    expect(noticeText({ ...entry, occurredFrom: null, occurredTo: null }, 'persons', fr, 'fr-CA')).toContain('Date ou période de l\'incident : [à compléter]');
  });
});
