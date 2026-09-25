/**
 * Schémas de l'espace chauffeur (prompt 11, section 7.2 groupe Chauffeur) : candidature, profil, véhicules, documents,
 * formation, accueil, revenus, packs, clients fidèles, tableau de conduite, compte de versement, fin de course.
 * Tous les montants sont calculés par l'API : l'application n'en calcule aucun.
 */
import { z } from 'zod';
import { DOCUMENT_DISPLAY_STATES } from '../drivers/documents.js';
import { SCORE_SUGGESTIONS } from '../drivers/driving.js';
import { ONBOARDING_STEP_STATES, ONBOARDING_STEPS } from '../drivers/onboarding.js';
import {
  DOCUMENT_STATUSES, DOCUMENT_TYPES, DRIVER_QUALIFICATIONS, DRIVER_STATUSES, LANGUAGES, PACK_CODES, PACK_PURCHASE_STATUSES, PAYMENT_METHODS,
  STATEMENT_STATUSES, VEHICLE_CATEGORIES, VEHICLE_STATUSES,
} from '../enums.js';
import { cents, isoDate, localDateString, signedCents, uuid } from './common.js';
import { ridePreferencesSchema } from './quotes.js';
import { driverStatusViewSchema, PAYMENT_CHOICES, scheduledRideSchema } from './rides.js';

const count = z.number().int().min(0);
const name = z.string().trim().min(1).max(80);
/** Numéros de taxes du Québec : TPS (9 chiffres + RT + 4 chiffres), TVQ (10 chiffres + TQ + 4 chiffres). */
export const gstNumber = z.string().trim().toUpperCase().regex(/^\d{9}\s?RT\s?\d{4}$/, 'Numéro de TPS attendu, par exemple 123456789 RT0001');
export const qstNumber = z.string().trim().toUpperCase().regex(/^\d{10}\s?TQ\s?\d{4}$/, 'Numéro de TVQ attendu, par exemple 1234567890 TQ0001');

/** Langues parlées déclarées (codes ISO 639-1) ; le français et l'anglais d'abord. */
export const spokenLanguage = z.string().regex(/^[a-z]{2}$/);

export const driverPaymentModesSchema = z.object({
  /** Carte dans l'application : toujours acceptée (obligatoire). */
  card: z.literal(true),
  cash: z.boolean(),
  interac: z.boolean(),
  terminal: z.boolean(),
  interacEmail: z.string().email().nullable(),
});

/** `POST /driver/apply` : un compte existant (connecté par SMS) devient candidat chauffeur. */
export const driverApplySchema = z.object({
  firstName: name,
  lastName: name,
  email: z.string().trim().email().max(254).optional(),
  qualification: z.enum(DRIVER_QUALIFICATIONS),
  language: z.enum(LANGUAGES).optional(),
  /** Code du parrain chauffeur, s'il y en a un (5.9). */
  referralCode: z.string().trim().max(20).optional(),
});
export type DriverApply = z.infer<typeof driverApplySchema>;

/** `PATCH /driver/profile` : chaque champ est facultatif ; les modes de paiement se changent ici aussi. */
export const driverProfileUpdateSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  qualification: z.enum(DRIVER_QUALIFICATIONS).optional(),
  gstNumber: gstNumber.nullable().optional(),
  qstNumber: qstNumber.nullable().optional(),
  tradeName: z.string().trim().max(150).nullable().optional(),
  spokenLanguages: z.array(spokenLanguage).max(10).optional(),
  experienceYears: z.number().int().min(0).max(60).optional(),
  acceptsCash: z.boolean().optional(),
  acceptsInterac: z.boolean().optional(),
  acceptsTerminal: z.boolean().optional(),
  interacEmail: z.string().trim().email().max(254).nullable().optional(),
  acceptsScheduled: z.boolean().optional(),
  /** Codes des zones préférées (`zones.code`). */
  preferredZones: z.array(z.string().max(40)).max(20).optional(),
});
export type DriverProfileUpdate = z.infer<typeof driverProfileUpdateSchema>;

export const driverProfileSchema = z.object({
  id: uuid,
  publicNumber: z.string(),
  status: z.enum(DRIVER_STATUSES),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string(),
  qualification: z.enum(DRIVER_QUALIFICATIONS).nullable(),
  gstNumber: z.string().nullable(),
  qstNumber: z.string().nullable(),
  tradeName: z.string().nullable(),
  spokenLanguages: z.array(z.string()),
  experienceYears: count.nullable(),
  paymentModes: driverPaymentModesSchema,
  acceptsScheduled: z.boolean(),
  preferredZones: z.array(z.string()),
  rating: z.object({ average: z.number().min(0).max(5), count }),
  rideCount: count,
  trainingCertifiedAt: isoDate.nullable(),
  payout: z.object({ linked: z.boolean(), onboarded: z.boolean() }),
  currentVehicleId: uuid.nullable(),
  activatedAt: isoDate.nullable(),
});
export type DriverProfileView = z.infer<typeof driverProfileSchema>;

/** Équipement d'accueil déclaré avec le véhicule (D36 : commodités). */
export const vehicleEquipmentSchema = z.object({
  childSeat: z.boolean().default(false),
  boosterSeat: z.boolean().default(false),
  wheelchairAccessible: z.boolean().default(false),
  water: z.boolean().default(true),
  chargers: z.boolean().default(true),
  wifi: z.boolean().default(false),
  umbrella: z.boolean().default(true),
});

export const vehicleInputSchema = z.object({
  make: z.string().trim().min(2).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(2015).max(2100),
  colour: z.string().trim().min(2).max(40),
  plate: z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{2,12}$/, 'Plaque attendue (lettres et chiffres)'),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'NIV de 17 caractères attendu').optional(),
  seats: z.number().int().min(1).max(8),
  odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  equipment: vehicleEquipmentSchema.prefault({}),
});
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

export const vehicleViewSchema = z.object({
  id: uuid,
  category: z.enum(VEHICLE_CATEGORIES),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  plate: z.string(),
  seats: z.number().int(),
  status: z.enum(VEHICLE_STATUSES),
  equipment: vehicleEquipmentSchema,
  nextInspectionDueOn: localDateString.nullable(),
  current: z.boolean(),
});
export type VehicleView = z.infer<typeof vehicleViewSchema>;

/** `GET /driver/vehicle-models` : modèles admis (sélecteur), la catégorie est déduite par l'API. */
export const admittedModelSchema = z.object({ name: z.string(), categories: z.array(z.enum(VEHICLE_CATEGORIES)), minYear: z.number().int() });

/** Champs texte du téléversement (multipart : ces champs et le fichier `file`). */
export const documentUploadFieldsSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  number: z.string().trim().max(60).optional(),
  issuedOn: localDateString.optional(),
  expiresOn: localDateString.optional(),
  vehicleId: uuid.optional(),
});
export type DocumentUploadFields = z.infer<typeof documentUploadFieldsSchema>;

export const driverDocumentSchema = z.object({
  id: uuid,
  type: z.enum(DOCUMENT_TYPES),
  status: z.enum(DOCUMENT_STATUSES),
  number: z.string().nullable(),
  issuedOn: localDateString.nullable(),
  expiresOn: localDateString.nullable(),
  rejectionReason: z.string().nullable(),
  uploadedAt: isoDate,
});
export type DriverDocumentView = z.infer<typeof driverDocumentSchema>;

/** `GET /driver/documents` : un élément par type exigé, avec l'état affiché et la marche à suivre. */
export const driverDocumentsViewSchema = z.object({
  items: z.array(z.object({
    type: z.enum(DOCUMENT_TYPES),
    required: z.boolean(),
    state: z.enum(DOCUMENT_DISPLAY_STATES),
    /** Jours avant l'échéance (négatif si dépassée) ; null sans échéance. */
    daysToExpiry: z.number().int().nullable(),
    /** Exige une date d'échéance au dépôt. */
    expires: z.boolean(),
    current: driverDocumentSchema.nullable(),
    /** Nouveau document en cours de vérification pendant que l'ancien reste valide. */
    replacement: driverDocumentSchema.nullable(),
  })),
  /** Suspension automatique en cours (document expiré) : le chauffeur voit quoi déposer pour être réactivé. */
  suspended: z.boolean(),
});
export type DriverDocumentsView = z.infer<typeof driverDocumentsViewSchema>;

export const localizedTextSchema = z.object({ fr: z.string(), en: z.string() });

export const trainingModuleSchema = z.object({
  code: z.string(),
  title: localizedTextSchema,
  summary: localizedTextSchema,
  videoUrl: z.string().url().nullable(),
  durationMinutes: count,
  questions: z.array(z.object({ id: z.string(), prompt: localizedTextSchema, choices: z.array(localizedTextSchema) })),
  passed: z.boolean(),
  bestScorePct: count.nullable(),
});
export const trainingViewSchema = z.object({
  passScorePct: count,
  modules: z.array(trainingModuleSchema),
  certifiedAt: isoDate.nullable(),
});
export type TrainingView = z.infer<typeof trainingViewSchema>;

export const trainingSubmitSchema = z.object({ answers: z.record(z.string(), z.number().int().min(0).max(10)) });
export const trainingResultSchema = z.object({
  moduleCode: z.string(),
  correct: count,
  total: count,
  scorePct: count,
  passed: z.boolean(),
  /** Identifiants des questions manquées, pour relire le module. */
  missed: z.array(z.string()),
  certifiedAt: isoDate.nullable(),
});
export type TrainingResult = z.infer<typeof trainingResultSchema>;

export const onboardingSchema = z.object({
  steps: z.array(z.object({ code: z.enum(ONBOARDING_STEPS), state: z.enum(ONBOARDING_STEP_STATES) })),
  next: z.enum(ONBOARDING_STEPS).nullable(),
  complete: z.boolean(),
});
export type OnboardingView = z.infer<typeof onboardingSchema>;

export const DRIVER_ALERT_CODES = [
  'document_expiring', 'document_expired', 'document_rejected', 'pack_low', 'pack_missing', 'balance_negative', 'balance_suspended',
  'training_required', 'payout_required', 'rating_warning', 'suspended', 'scheduled_to_confirm',
] as const;
export const driverAlertSchema = z.object({
  code: z.enum(DRIVER_ALERT_CODES),
  severity: z.enum(['info', 'warning', 'critical']),
  /** Valeurs utiles au libellé (type de document, jours restants, courses restantes, montant). */
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type DriverAlert = z.infer<typeof driverAlertSchema>;

export const activePackSummarySchema = z.object({
  id: uuid,
  code: z.enum(PACK_CODES),
  name: z.string(),
  ridesRemaining: count.nullable(),
  expiresAt: isoDate,
  autoRenew: z.boolean(),
});

export const earningsTotalsSchema = z.object({ fareCents: cents, tipsCents: cents, totalCents: cents, rides: count });

/** `GET /driver/home` : tout l'écran d'accueil en une requête. */
export const driverHomeSchema = z.object({
  profile: z.object({ firstName: z.string().nullable(), publicNumber: z.string(), status: z.enum(DRIVER_STATUSES) }),
  presence: driverStatusViewSchema,
  /** Raisons qui empêchent de passer en ligne (vides si tout est prêt). */
  blockers: z.array(z.string()),
  onboarding: onboardingSchema,
  pack: activePackSummarySchema.nullable(),
  earnings: z.object({ today: earningsTotalsSchema, week: earningsTotalsSchema }),
  nextScheduled: scheduledRideSchema.nullable(),
  alerts: z.array(driverAlertSchema),
  features: z.object({ faceCheck: z.boolean(), negotiation: z.boolean() }),
});
export type DriverHomeView = z.infer<typeof driverHomeSchema>;

export const EARNINGS_PERIODS = ['day', 'week', 'month'] as const;
export const earningsQuerySchema = z.object({
  period: z.enum(EARNINGS_PERIODS).default('week'),
  /** Jour de référence (AAAA-MM-JJ, heure de Montréal) ; aujourd'hui par défaut. */
  date: localDateString.optional(),
});
export const earningsSchema = z.object({
  period: z.enum(EARNINGS_PERIODS),
  from: localDateString,
  to: localDateString,
  totals: earningsTotalsSchema,
  /** Part encaissée directement par le chauffeur (espèces, Interac, terminal), déjà dans ses poches. */
  collectedDirectCents: cents,
  items: z.array(z.object({
    rideId: uuid,
    publicNumber: z.string(),
    /** Course terminée, ou frais d'annulation et de non-présentation (100 % au chauffeur). */
    kind: z.enum(['ride', 'cancellation_fee']),
    at: isoDate,
    fareCents: cents,
    tipCents: cents,
    paymentMethod: z.enum(PAYMENT_METHODS),
    collectedBy: z.enum(['platform', 'driver']),
  })),
});
export type EarningsView = z.infer<typeof earningsSchema>;

export const statementSummarySchema = z.object({
  id: uuid,
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.enum(STATEMENT_STATUSES),
  creditsCents: cents,
  debitsCents: cents,
  netCents: signedCents,
  issuedAt: isoDate.nullable(),
  settledAt: isoDate.nullable(),
  pdfAvailable: z.boolean(),
});
export type StatementSummary = z.infer<typeof statementSummarySchema>;

export const driverStatementSchema = statementSummarySchema.extend({
  lines: z.array(z.object({
    kind: z.string(),
    label: z.string(),
    amountCents: signedCents,
    rideId: uuid.nullable(),
    packPurchaseId: uuid.nullable(),
    occurredAt: isoDate,
  })),
});
export type DriverStatementView = z.infer<typeof driverStatementSchema>;

export const driverPacksViewSchema = z.object({
  catalog: z.array(z.object({
    code: z.enum(PACK_CODES),
    name: z.string(),
    ridesIncluded: count.nullable(),
    priceCents: cents,
    validityDays: z.number().int().positive(),
    /** Prix appliqué à ce chauffeur (Découverte offerte aux premiers chauffeurs, une fois). */
    priceForMeCents: cents,
    available: z.boolean(),
  })),
  active: activePackSummarySchema.nullable(),
  history: z.array(z.object({
    id: uuid,
    code: z.enum(PACK_CODES),
    pricePaidCents: cents,
    ridesIncluded: count.nullable(),
    ridesRemaining: count.nullable(),
    carriedOverRemaining: count,
    activatedAt: isoDate,
    expiresAt: isoDate,
    status: z.enum(PACK_PURCHASE_STATUSES),
    autoRenew: z.boolean(),
    nextPackCode: z.enum(PACK_CODES).nullable(),
    billing: z.enum(['to_bill', 'billed', 'free']),
  })),
  /** Sans pack actif ni renouvellement, aucune offre n'est reçue (5.7). */
  required: z.boolean(),
});
export type DriverPacksView = z.infer<typeof driverPacksViewSchema>;

export const packActivateSchema = z.object({ packCode: z.enum(PACK_CODES), autoRenew: z.boolean().default(true) });
export const packUpdateSchema = z.object({ autoRenew: z.boolean().optional(), nextPackCode: z.enum(PACK_CODES).nullable().optional() });

export const loyalClientSchema = z.object({
  clientId: uuid,
  firstName: z.string().nullable(),
  favourite: z.boolean(),
  favouriteSince: isoDate.nullable(),
  ridesCount: count,
  lastRideAt: isoDate.nullable(),
});
export type LoyalClientView = z.infer<typeof loyalClientSchema>;

export const driverScoreSchema = z.object({
  periodStart: localDateString,
  periodEnd: localDateString,
  punctualityPct: z.number().int().min(0).max(100),
  cancellationCount: count,
  harshAccelerations: count,
  harshBrakings: count,
  distanceKm: z.number().min(0),
  rating: z.number().min(0).max(5).nullable(),
  ratingCount: count,
  completedRides: count,
  suggestions: z.array(z.enum(SCORE_SUGGESTIONS)),
  computedAt: isoDate,
});
export type DriverScoreView = z.infer<typeof driverScoreSchema>;

export const payoutStatusSchema = z.object({ linked: z.boolean(), onboarded: z.boolean(), provider: z.string() });
/** Lien d'inscription Stripe Connect Express ; `simulated` : fournisseur simulé, l'inscription est déjà terminée. */
export const payoutLinkSchema = z.object({ url: z.string().url(), expiresAt: isoDate, simulated: z.boolean() });

/**
 * Fiche de course du chauffeur (`GET /driver/rides/{id}`) : ce qu'il doit savoir pour servir le client, sans son numéro
 * (appel et message masqués). Montants calculés par l'API.
 */
export const driverJobSchema = z.object({
  clientFirstName: z.string().nullable(),
  /** Passager tiers (réservation pour un proche) : c'est lui qu'on accueille. */
  passengerName: z.string().nullable(),
  language: z.enum(LANGUAGES).nullable(),
  preferences: ridePreferencesSchema.nullable(),
  specialRequests: z.string().nullable(),
  paymentChoice: z.enum(PAYMENT_CHOICES),
  driverFareCents: cents,
  distanceMeters: count.nullable(),
  durationSeconds: count.nullable(),
  waitedSeconds: count,
  contactAttempts: count,
  /** Non-présentation possible à partir de cet instant, si les tentatives de contact sont faites. */
  noShow: z.object({ availableAt: isoDate.nullable(), minContacts: count }),
  payment: z.object({
    /** Paiement direct au chauffeur (espèces, Interac, terminal) : il confirme le montant reçu. */
    direct: z.boolean(),
    amountDueCents: cents.nullable(),
    confirmedCents: cents.nullable(),
  }),
  clientRated: z.boolean(),
  /** Numéro d'appel masqué (mandataire téléphonique) ; null tant que la téléphonie n'est pas branchée : messages seulement. */
  callNumber: z.string().nullable(),
});
export type DriverJob = z.infer<typeof driverJobSchema>;

/** Fin de course en paiement direct : montant confirmé reçu du client (5.6). */
export const paymentReceivedSchema = z.object({ amountCents: cents.max(100_000_00) });
export const CLIENT_RATING_TAGS = ['polite', 'punctual', 'respectful', 'clean', 'late', 'rude', 'damage', 'unsafe_behaviour'] as const;
export const rateClientSchema = z.object({
  score: z.number().int().min(1).max(5),
  tags: z.array(z.enum(CLIENT_RATING_TAGS)).max(5).default([]),
  comment: z.string().trim().max(500).optional(),
});

export const INCIDENT_KINDS = ['accident', 'aggression', 'damage', 'lost_item', 'client_behaviour', 'vehicle_problem', 'other'] as const;
export const driverIncidentSchema = z.object({ kind: z.enum(INCIDENT_KINDS), description: z.string().trim().min(5).max(1000) });

/** `POST /driver/shifts/start` : vérification faciale (V1.1, drapeau `FEATURE_FACE_CHECK`), photo en JPEG base64. */
export const shiftStartSchema = z.object({ photoBase64: z.string().min(100).max(4_000_000) });
export const shiftStartResultSchema = z.object({ shiftId: uuid.nullable(), faceCheck: z.enum(['passed', 'failed', 'disabled']), startedAt: isoDate.nullable() });

// Types des requêtes et réponses de l'espace chauffeur, pour le client d'API.
export type AdmittedModel = z.infer<typeof admittedModelSchema>;
export type TrainingSubmit = z.infer<typeof trainingSubmitSchema>;
export type PackActivate = z.input<typeof packActivateSchema>;
export type PackUpdate = z.infer<typeof packUpdateSchema>;
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;
export type PayoutLink = z.infer<typeof payoutLinkSchema>;
export type RateClient = z.input<typeof rateClientSchema>;
export type DriverIncidentInput = z.infer<typeof driverIncidentSchema>;
export type ShiftStartResult = z.infer<typeof shiftStartResultSchema>;
export type EarningsQuery = z.input<typeof earningsQuerySchema>;
export type VehicleInputBody = z.input<typeof vehicleInputSchema>;
