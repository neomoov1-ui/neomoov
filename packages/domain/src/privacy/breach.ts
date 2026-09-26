/**
 * Registre des incidents de confidentialité (Loi sur la protection des renseignements personnels dans le secteur privé,
 * articles 3.5 à 3.8, et Règlement sur les incidents de confidentialité). Une inscription par incident, dans
 * `incidents.privacy_breach` : renseignements concernés, circonstances, dates, personnes touchées, évaluation du risque
 * de préjudice sérieux, avis à la Commission d'accès à l'information (CAI) et aux personnes, mesures. Procédure :
 * `docs/runbooks/incident-confidentialite.md`. Aucun nom de personne touchée ne s'inscrit ici : des catégories et des
 * nombres suffisent au registre.
 */
import { z } from 'zod';
import { INCIDENT_TYPES } from '../enums.js';
import { isoDate, localDateString, uuid } from '../schemas/common.js';

/** Catégories de renseignements touchés (aide au tri et au texte des avis ; le détail va dans `dataDescription`). */
export const PRIVACY_DATA_CATEGORIES = [
  'identity', 'contact', 'addresses', 'locations', 'identity_documents', 'background_checks', 'financial', 'tax_numbers', 'messages', 'health', 'credentials', 'other',
] as const;
export type PrivacyDataCategory = (typeof PRIVACY_DATA_CATEGORIES)[number];

/** Conclusion de l'évaluation : à faire, risque de préjudice sérieux (avis obligatoires), ou pas de risque sérieux (registre seul). */
export const SERIOUS_HARM_ASSESSMENTS = ['pending', 'serious', 'not_serious'] as const;
export type SeriousHarmAssessment = (typeof SERIOUS_HARM_ASSESSMENTS)[number];

/** Suites à donner, calculées à partir de l'inscription (jamais saisies). */
export const PRIVACY_FOLLOW_UPS = ['record_containment', 'assess_harm', 'notify_cai', 'notify_persons', 'record_measures'] as const;
export type PrivacyFollowUp = (typeof PRIVACY_FOLLOW_UPS)[number];

/** Types d'incident qu'un membre du personnel peut ouvrir à la main (le SOS, la garantie modèle et l'échec de paiement naissent de leurs parcours). */
export const MANUAL_INCIDENT_TYPES = ['complaint', 'accident', 'lost_item', 'no_show_dispute', 'privacy', 'other'] as const satisfies ReadonlyArray<(typeof INCIDENT_TYPES)[number]>;
export type ManualIncidentType = (typeof MANUAL_INCIDENT_TYPES)[number];

const note = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
const headcount = z.number().int().min(0).max(100_000_000).nullable().default(null);

/** Rubriques du registre, sans règle croisée (base commune de la saisie et de la vue). */
export const privacyBreachFieldsSchema = z.object({
  /** Date, ou début de la période, de l'incident (même approximative) ; null si inconnue. */
  occurredFrom: localDateString.nullable().default(null),
  /** Fin de la période de l'incident ; null pour un incident d'un jour ou une fin inconnue. */
  occurredTo: localDateString.nullable().default(null),
  /** Prise de connaissance par Neomoov : point de départ des délais internes (contenir, inscrire, évaluer, aviser). */
  discoveredAt: isoDate,
  reportedBy: note(200),
  dataCategories: z.array(z.enum(PRIVACY_DATA_CATEGORIES)).max(PRIVACY_DATA_CATEGORIES.length).default([]),
  /** Renseignements concernés, ou raisons pour lesquelles on ne peut pas encore les décrire. */
  dataDescription: z.string().trim().min(3).max(4000),
  /** Brève description des circonstances et de la cause, si elle est connue. */
  circumstances: z.string().trim().min(3).max(4000),
  /** Nombre de personnes concernées (même approximatif), dont au Québec. */
  personsAffected: headcount,
  personsAffectedQuebec: headcount,
  /** Mesures de confinement prises (date, heure, geste). */
  containment: note(4000),
  /** Évaluation du risque : sensibilité, conséquences appréhendées, probabilité de mauvaise utilisation. */
  sensitivity: note(2000),
  consequences: note(2000),
  misuseLikelihood: note(2000),
  seriousHarm: z.enum(SERIOUS_HARM_ASSESSMENTS).default('pending'),
  /** Responsable de la protection des renseignements personnels consulté (nom, date). */
  privacyOfficerConsulted: note(200),
  caiNotifiedOn: localDateString.nullable().default(null),
  caiReference: note(100),
  personsNotifiedOn: localDateString.nullable().default(null),
  personsNotificationMeans: note(500),
  /** Avis public à la place de l'avis direct (préjudice accru, avis trop difficile, coordonnées manquantes) et sa raison. */
  publicNotice: z.boolean().default(false),
  publicNoticeReason: note(1000),
  /** Autres avis : police, fournisseur, banque, autorités hors Québec. */
  otherNotices: note(2000),
  /** Mesures prises ou prévues pour réduire le risque et éviter un nouvel incident. */
  measures: note(4000),
  /** Revue à 30 jours : la mesure a-t-elle tenu ? */
  followUpReview: note(2000),
});

/** Saisie ou mise à jour d'une inscription au registre (la fiche entière est remplacée). */
export const privacyBreachInputSchema = privacyBreachFieldsSchema.superRefine((entry, ctx) => {
  if (entry.occurredFrom && entry.occurredTo && entry.occurredTo < entry.occurredFrom) {
    ctx.addIssue({ code: 'custom', message: 'La fin de la période précède son début', path: ['occurredTo'] });
  }
  if (entry.personsAffected !== null && entry.personsAffectedQuebec !== null && entry.personsAffectedQuebec > entry.personsAffected) {
    ctx.addIssue({ code: 'custom', message: 'Les personnes touchées au Québec ne peuvent pas dépasser le total', path: ['personsAffectedQuebec'] });
  }
  if (entry.publicNotice && !entry.publicNoticeReason) {
    ctx.addIssue({ code: 'custom', message: 'Un avis public exige sa raison', path: ['publicNoticeReason'] });
  }
});
export type PrivacyBreachInput = z.input<typeof privacyBreachInputSchema>;
export type PrivacyBreachFields = z.output<typeof privacyBreachFieldsSchema>;

/** Inscription telle que lue par My Hub : numéro de registre, dates d'inscription et de mise à jour, suites à donner. */
export const privacyBreachSchema = privacyBreachFieldsSchema.extend({
  incidentId: uuid,
  /** Numéro de registre `IC-AAAA-NNN` (année de l'inscription, heure de Montréal). */
  reference: z.string(),
  recordedAt: isoDate,
  updatedAt: isoDate,
  followUps: z.array(z.enum(PRIVACY_FOLLOW_UPS)),
});
export type PrivacyBreachView = z.infer<typeof privacyBreachSchema>;

/** Numéro de registre : `IC-2026-001`, séquence annuelle sur trois chiffres au moins. */
export function privacyBreachReference(year: number, sequence: number): string {
  return `IC-${year}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Suites à donner d'après l'inscription : confinement à consigner, évaluation du préjudice à conclure, avis à la CAI et
 * aux personnes quand le risque est sérieux (l'avis public remplace l'avis direct), mesures à inscrire.
 */
export function privacyBreachFollowUps(entry: Pick<PrivacyBreachFields, 'containment' | 'seriousHarm' | 'caiNotifiedOn' | 'personsNotifiedOn' | 'publicNotice' | 'measures'>): PrivacyFollowUp[] {
  const followUps: PrivacyFollowUp[] = [];
  if (!entry.containment) followUps.push('record_containment');
  if (entry.seriousHarm === 'pending') followUps.push('assess_harm');
  if (entry.seriousHarm === 'serious' && !entry.caiNotifiedOn) followUps.push('notify_cai');
  if (entry.seriousHarm === 'serious' && !entry.personsNotifiedOn && !entry.publicNotice) followUps.push('notify_persons');
  if (!entry.measures) followUps.push('record_measures');
  return followUps;
}
