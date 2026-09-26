/**
 * Registre des incidents de confidentialité, fonctions pures du web : saisie du formulaire (texte) et conversion vers
 * l'entrée de l'API, texte type des avis (personnes concernées ou CAI) tiré de la fiche enregistrée. Sans React : testé
 * dans les deux langues (`test/privacy-breach.test.ts`).
 */
import type { PrivacyBreachInput, PrivacyBreachView, PrivacyDataCategory, SeriousHarmAssessment } from '@neomoov/domain';
import type { TFunction } from 'i18next';
import { TIME_ZONE, formatDate, formatDateTime, montrealToIso } from './format';
import type { Language } from './i18n-resources';

/** Saisie du formulaire : du texte partout (champs HTML), converti en entrée de l'API à l'enregistrement. */
export interface BreachDraft {
  occurredFrom: string;
  occurredTo: string;
  discoveredDate: string;
  discoveredTime: string;
  reportedBy: string;
  dataCategories: PrivacyDataCategory[];
  dataDescription: string;
  circumstances: string;
  personsAffected: string;
  personsAffectedQuebec: string;
  containment: string;
  sensitivity: string;
  consequences: string;
  misuseLikelihood: string;
  seriousHarm: SeriousHarmAssessment;
  privacyOfficerConsulted: string;
  caiNotifiedOn: string;
  caiReference: string;
  personsNotifiedOn: string;
  personsNotificationMeans: string;
  publicNotice: boolean;
  publicNoticeReason: string;
  otherNotices: string;
  measures: string;
  followUpReview: string;
}

/** Date (`AAAA-MM-JJ`) et heure (`HH:MM`) de Montréal d'un instant. */
function montrealParts(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function emptyDraft(now = new Date()): BreachDraft {
  const { date, time } = montrealParts(now);
  return {
    occurredFrom: '', occurredTo: '', discoveredDate: date, discoveredTime: time, reportedBy: '', dataCategories: [], dataDescription: '', circumstances: '', personsAffected: '', personsAffectedQuebec: '',
    containment: '', sensitivity: '', consequences: '', misuseLikelihood: '', seriousHarm: 'pending', privacyOfficerConsulted: '', caiNotifiedOn: '', caiReference: '', personsNotifiedOn: '',
    personsNotificationMeans: '', publicNotice: false, publicNoticeReason: '', otherNotices: '', measures: '', followUpReview: '',
  };
}

export function draftOf(entry: PrivacyBreachView): BreachDraft {
  const { date, time } = montrealParts(new Date(entry.discoveredAt));
  const text = (value: string | null) => value ?? '';
  const count = (value: number | null) => (value === null ? '' : String(value));
  return {
    occurredFrom: text(entry.occurredFrom), occurredTo: text(entry.occurredTo), discoveredDate: date, discoveredTime: time, reportedBy: text(entry.reportedBy), dataCategories: entry.dataCategories,
    dataDescription: entry.dataDescription, circumstances: entry.circumstances, personsAffected: count(entry.personsAffected), personsAffectedQuebec: count(entry.personsAffectedQuebec),
    containment: text(entry.containment), sensitivity: text(entry.sensitivity), consequences: text(entry.consequences), misuseLikelihood: text(entry.misuseLikelihood), seriousHarm: entry.seriousHarm,
    privacyOfficerConsulted: text(entry.privacyOfficerConsulted), caiNotifiedOn: text(entry.caiNotifiedOn), caiReference: text(entry.caiReference), personsNotifiedOn: text(entry.personsNotifiedOn),
    personsNotificationMeans: text(entry.personsNotificationMeans), publicNotice: entry.publicNotice, publicNoticeReason: text(entry.publicNoticeReason), otherNotices: text(entry.otherNotices),
    measures: text(entry.measures), followUpReview: text(entry.followUpReview),
  };
}

export function inputOf(draft: BreachDraft): PrivacyBreachInput {
  const text = (value: string) => value.trim() || null;
  const count = (value: string) => (value.trim() === '' ? null : Number(value));
  return {
    occurredFrom: draft.occurredFrom || null, occurredTo: draft.occurredTo || null, discoveredAt: montrealToIso(draft.discoveredDate, draft.discoveredTime || '00:00'), reportedBy: text(draft.reportedBy),
    dataCategories: draft.dataCategories, dataDescription: draft.dataDescription.trim(), circumstances: draft.circumstances.trim(), personsAffected: count(draft.personsAffected),
    personsAffectedQuebec: count(draft.personsAffectedQuebec), containment: text(draft.containment), sensitivity: text(draft.sensitivity), consequences: text(draft.consequences),
    misuseLikelihood: text(draft.misuseLikelihood), seriousHarm: draft.seriousHarm, privacyOfficerConsulted: text(draft.privacyOfficerConsulted), caiNotifiedOn: draft.caiNotifiedOn || null,
    caiReference: text(draft.caiReference), personsNotifiedOn: draft.personsNotifiedOn || null, personsNotificationMeans: text(draft.personsNotificationMeans), publicNotice: draft.publicNotice,
    publicNoticeReason: text(draft.publicNoticeReason), otherNotices: text(draft.otherNotices), measures: text(draft.measures), followUpReview: text(draft.followUpReview),
  };
}

export type NoticeAudience = 'persons' | 'cai';

/** Texte type d'un avis, tiré de la fiche enregistrée ; les passages à compléter restent entre crochets. */
export function noticeText(entry: PrivacyBreachView, audience: NoticeAudience, t: TFunction, language: Language): string {
  const k = (key: string, options?: Record<string, unknown>) => t(`hub.privacy.notice.${key}`, options);
  const toFill = k('toFill');
  const or = (value: string | number | null) => (value === null || value === '' ? toFill : String(value));
  const categories = entry.dataCategories.map((c) => t(`hub.privacy.dataCategories.${c}`)).join(', ');
  const data = categories ? `${categories}. ${entry.dataDescription}` : entry.dataDescription;
  const period = entry.occurredFrom && entry.occurredTo && entry.occurredTo !== entry.occurredFrom
    ? k('periodRange', { from: formatDate(entry.occurredFrom, language), to: formatDate(entry.occurredTo, language) })
    : entry.occurredFrom ? formatDate(entry.occurredFrom, language) : toFill;
  if (audience === 'persons') {
    return [
      k('personsSubject', { reference: entry.reference }), '', k('greeting'), '', k('personsIntro'), '',
      k('data', { value: data }), k('circumstances', { value: entry.circumstances }), k('period', { value: period }), k('measures', { value: or(entry.measures) }), k('selfMeasures'), '',
      k('contact'), '', k('signature'),
    ].join('\n');
  }
  const personsNotice = entry.personsNotifiedOn
    ? k('personsNoticeDone', { date: formatDate(entry.personsNotifiedOn, language), means: or(entry.personsNotificationMeans) })
    : entry.publicNotice ? k('publicNoticeDone', { reason: or(entry.publicNoticeReason) }) : toFill;
  return [
    k('caiTitle'), '', k('company'), k('caiContact'), k('reference', { value: entry.reference }), '',
    k('data', { value: data }), k('caiCircumstances', { value: entry.circumstances }), k('period', { value: period }), k('discovered', { value: formatDateTime(entry.discoveredAt, language) }),
    k('persons', { total: or(entry.personsAffected), quebec: or(entry.personsAffectedQuebec) }),
    k('harm', { sensitivity: or(entry.sensitivity), consequences: or(entry.consequences), likelihood: or(entry.misuseLikelihood) }),
    k('personsNotice', { value: personsNotice }), k('measures', { value: or(entry.measures) }), k('others', { value: entry.otherNotices ?? k('none') }),
  ].join('\n');
}
