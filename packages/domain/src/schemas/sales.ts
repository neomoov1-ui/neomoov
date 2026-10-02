/**
 * Schémas de la direction commerciale automatisée (phase 1 « entreprise autonome ») : prospects B2B, fil des contacts,
 * relances, appels sortants, entrées des outils des agents `b2b_prospecting`, `outbound_calls` et `followups`, et routes
 * « Ventes » de My Hub. Jamais un particulier : une adresse courriel grand public est refusée à l'entrée.
 */
import { z } from 'zod';
import { LANGUAGES } from '../enums.js';
import {
  CONSENT_BASES, FOLLOWUP_CHANNELS, FOLLOWUP_STATUSES, FOLLOWUP_TARGETS, isBusinessEmail, OUTBOUND_CALL_RESULTS, OUTBOUND_CALL_STATUSES, PROSPECT_INTERESTS,
  PROSPECT_SEGMENTS, PROSPECT_SIZES, PROSPECT_SOURCES, PROSPECT_STAGES, TOUCH_CHANNELS, TOUCH_DIRECTIONS,
} from '../sales/sales.js';
import { adminListQuerySchema } from './admin.js';
import { agentRunSchema } from './agents.js';
import { isoDate, phoneE164, uuid } from './common.js';

const count = z.number().int().min(0);
const shortText = (max: number) => z.string().trim().min(1).max(max);
/** Adresse professionnelle seulement (prospection B2B) : une messagerie grand public désigne une personne. */
export const businessEmail = z.string().trim().toLowerCase().email().max(254).refine((e) => isBusinessEmail(e), { message: 'Adresse professionnelle attendue (pas de messagerie grand public)' });
const justification = z.string().trim().min(3).max(1000).describe('Justification de l\'action, affichée dans la file d\'approbation');

/** Dernier devis entreprise envoyé à un prospect (gardé sur la fiche). */
export const businessQuoteViewSchema = z.object({
  expectedMonthlyRides: count,
  discountBps: count,
  paymentTermsDays: count,
  validUntil: isoDate,
  sentAt: isoDate,
  inGrid: z.boolean(),
  notes: z.string().nullable(),
});
export type BusinessQuoteView = z.infer<typeof businessQuoteViewSchema>;

export const prospectSchema = z.object({
  id: uuid,
  organizationName: z.string(),
  legalName: z.string().nullable(),
  segment: z.enum(PROSPECT_SEGMENTS),
  size: z.enum(PROSPECT_SIZES),
  interest: z.enum(PROSPECT_INTERESTS),
  source: z.enum(PROSPECT_SOURCES),
  sourceRef: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  contactName: z.string().nullable(),
  contactRole: z.string().nullable(),
  /** Coordonnées masquées (My Hub n'affiche jamais une valeur complète). */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsappOk: z.boolean(),
  language: z.enum(LANGUAGES),
  consentBasis: z.enum(CONSENT_BASES),
  consentAt: isoDate.nullable(),
  unsubscribedAt: isoDate.nullable(),
  score: count,
  stage: z.enum(PROSPECT_STAGES),
  stageReason: z.string().nullable(),
  lostAt: isoDate.nullable(),
  hubspotId: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionAt: isoDate.nullable(),
  sequenceKey: z.string().nullable(),
  sequenceChannel: z.string().nullable(),
  firstContactAt: isoDate.nullable(),
  lastQuote: businessQuoteViewSchema.nullable(),
  leadId: uuid.nullable(),
  organizationId: uuid.nullable(),
  notes: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ProspectView = z.infer<typeof prospectSchema>;

export const prospectTouchSchema = z.object({
  id: uuid,
  prospectId: uuid,
  channel: z.enum(TOUCH_CHANNELS),
  direction: z.enum(TOUCH_DIRECTIONS),
  summary: z.string(),
  result: z.string().nullable(),
  ref: z.string().nullable(),
  agentRunId: uuid.nullable(),
  userId: uuid.nullable(),
  occurredAt: isoDate,
});
export type ProspectTouchView = z.infer<typeof prospectTouchSchema>;

export const followupSchema = z.object({
  id: uuid,
  targetType: z.enum(FOLLOWUP_TARGETS),
  targetId: uuid,
  prospectId: uuid.nullable(),
  channel: z.enum(FOLLOWUP_CHANNELS),
  dueAt: isoDate,
  status: z.enum(FOLLOWUP_STATUSES),
  attempt: count,
  maxAttempts: count,
  lastSentAt: isoDate.nullable(),
  closedAt: isoDate.nullable(),
  closeReason: z.string().nullable(),
  language: z.enum(LANGUAGES),
  createdAt: isoDate,
});
export type FollowupView = z.infer<typeof followupSchema>;

export const outboundCallSchema = z.object({
  id: uuid,
  prospectId: uuid,
  scriptKey: z.string(),
  assistantId: z.string().nullable(),
  toPhone: z.string().nullable(),
  scheduledAt: isoDate,
  startedAt: isoDate.nullable(),
  endedAt: isoDate.nullable(),
  status: z.enum(OUTBOUND_CALL_STATUSES),
  vapiCallId: z.string().nullable(),
  result: z.enum(OUTBOUND_CALL_RESULTS).nullable(),
  summary: z.string().nullable(),
  costMicros: count,
  durationSeconds: count.nullable(),
  recordingConsent: z.boolean(),
  meetingAt: isoDate.nullable(),
  callbackAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type OutboundCallView = z.infer<typeof outboundCallSchema>;

/** Fiche complète d'un prospect : fil des contacts, appels et relances. */
export const prospectDetailSchema = z.object({
  prospect: prospectSchema,
  touches: z.array(prospectTouchSchema),
  calls: z.array(outboundCallSchema),
  followups: z.array(followupSchema),
});
export type ProspectDetailView = z.infer<typeof prospectDetailSchema>;

export const prospectListQuerySchema = adminListQuerySchema.extend({
  stage: z.enum(PROSPECT_STAGES).optional(),
  source: z.enum(PROSPECT_SOURCES).optional(),
  segment: z.enum(PROSPECT_SEGMENTS).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
});
export type ProspectListQuery = z.infer<typeof prospectListQuerySchema>;

/** Création manuelle ou ligne d'un fichier CSV importé par My Hub (organisation et au moins un canal professionnel). */
export const prospectCreateSchema = z.object({
  organizationName: shortText(200),
  legalName: shortText(200).optional(),
  segment: z.enum(PROSPECT_SEGMENTS).default('other'),
  website: z.string().trim().max(300).optional(),
  city: shortText(80).optional(),
  contactName: shortText(120).optional(),
  contactRole: shortText(80).optional(),
  email: businessEmail.optional(),
  phone: phoneE164.optional(),
  whatsappOk: z.boolean().default(false),
  language: z.enum(LANGUAGES).default('fr'),
  consentBasis: z.enum(CONSENT_BASES).default('published_address'),
  notes: z.string().trim().max(2000).optional(),
}).refine((p) => Boolean(p.email) || Boolean(p.phone), { message: 'Courriel professionnel ou téléphone requis', path: ['email'] });
export type ProspectCreate = z.infer<typeof prospectCreateSchema>;
export type ProspectCreateInput = z.input<typeof prospectCreateSchema>;

export const prospectImportSchema = z.object({ rows: z.array(prospectCreateSchema).min(1).max(500) });
export type ProspectImport = z.infer<typeof prospectImportSchema>;
export type ProspectImportInput = z.input<typeof prospectImportSchema>;

/** Import en bloc : lignes refusées (particulier, doublon, données manquantes) listées avec leur motif. */
export const prospectImportResultSchema = z.object({
  imported: count,
  updated: count,
  skipped: z.array(z.object({ row: count, reason: z.string() })),
});
export type ProspectImportResult = z.infer<typeof prospectImportResultSchema>;

export const prospectUpdateSchema = z.object({
  stage: z.enum(PROSPECT_STAGES).exclude(['do_not_contact']).optional(),
  stageReason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  nextAction: z.string().trim().max(40).nullable().optional(),
  nextActionAt: isoDate.nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Au moins un champ à modifier' });
export type ProspectUpdate = z.infer<typeof prospectUpdateSchema>;

// Outils des agents commerciaux : entrées vues par le modèle --------------------------------------------------------------

export const searchProspectsToolSchema = z.object({
  category: shortText(60).describe('Catégorie d\'établissement (hôtel, agence de voyages, clinique, école, salle d\'événements, siège d\'entreprise)'),
  zone: shortText(80).describe('Ville ou secteur (Montréal, Laval, Longueuil)'),
  limit: z.number().int().min(1).max(20).default(10),
});
export const listLeadProspectsToolSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) });
export const createProspectToolSchema = z.object({
  organizationName: shortText(200),
  segment: z.enum(PROSPECT_SEGMENTS).default('other'),
  source: z.enum(PROSPECT_SOURCES),
  sourceRef: shortText(120).optional().describe('Identifiant du lieu (Google Places) ou du prospect du site'),
  website: z.string().trim().max(300).optional(),
  city: shortText(80).optional(),
  contactName: shortText(120).optional(),
  contactRole: shortText(80).optional(),
  email: businessEmail.optional(),
  phone: phoneE164.optional(),
  whatsappOk: z.boolean().default(false),
  language: z.enum(LANGUAGES).default('fr'),
  consentBasis: z.enum(CONSENT_BASES).default('published_address'),
  leadId: uuid.optional(),
  rating: z.number().min(0).max(5).nullable().default(null),
  reviewCount: count.nullable().default(null),
});
export const qualifyProspectToolSchema = z.object({
  prospectId: uuid,
  segment: z.enum(PROSPECT_SEGMENTS),
  size: z.enum(PROSPECT_SIZES),
  interest: z.enum(PROSPECT_INTERESTS),
  qualified: z.boolean().describe('Faux : prospect écarté (particulier, hors zone, sans intérêt)'),
  reason: z.string().trim().min(3).max(300),
});
export const startSequenceToolSchema = z.object({
  prospectId: uuid,
  sequenceKey: z.string().trim().max(60).optional().describe('Gabarit approuvé (docs/sales/sequences.md) ; par défaut selon le segment'),
  justification,
});
export const scheduleCallToolSchema = z.object({
  prospectId: uuid,
  scriptKey: z.string().trim().max(60).default('b2b_intro'),
  at: isoDate.optional().describe('Heure souhaitée ; sinon le prochain créneau de bureau'),
  justification,
});
export const scheduleMeetingToolSchema = z.object({
  prospectId: uuid,
  startsAt: isoDate,
  durationMinutes: z.number().int().min(15).max(240).optional(),
  subject: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export const createBusinessQuoteToolSchema = z.object({
  prospectId: uuid,
  expectedMonthlyRides: z.number().int().min(0).max(100_000),
  requestedDiscountBps: z.number().int().min(0).max(10_000).nullable().default(null),
  paymentTermsDays: z.number().int().min(0).max(120).nullable().default(null),
  notes: z.string().trim().max(1000).optional(),
  justification,
});
export const openBusinessAccountToolSchema = z.object({
  prospectId: uuid,
  ownerEmail: businessEmail.optional().describe('Courriel du propriétaire du compte ; par défaut le contact du prospect'),
  organizationName: shortText(120).optional(),
  justification,
});
export const markDoNotContactToolSchema = z.object({ prospectId: uuid, reason: z.string().trim().min(3).max(300) });
export const proposeSalesDecisionToolSchema = z.object({
  prospectId: uuid,
  proposal: z.string().trim().min(3).max(1000).describe('Ce qui est demandé hors grille (tarif négocié, contrat particulier)'),
  justification,
});
export const sendFollowupToolSchema = z.object({
  followupId: uuid,
  subject: z.string().trim().max(150).optional(),
  text: z.string().trim().min(10).max(3000),
  justification: justification.optional(),
});

// Routes « Ventes » de My Hub ------------------------------------------------------------------------------------------------

export const salesQuoteRequestSchema = z.object({
  expectedMonthlyRides: z.number().int().min(0).max(100_000),
  requestedDiscountBps: z.number().int().min(0).max(10_000).nullable().default(null),
  paymentTermsDays: z.number().int().min(0).max(120).nullable().default(null),
  notes: z.string().trim().max(1000).optional(),
});
export type SalesQuoteRequest = z.input<typeof salesQuoteRequestSchema>;
export const salesOpenAccountSchema = z.object({ ownerEmail: businessEmail.optional(), organizationName: shortText(120).optional() });
export type SalesOpenAccountInput = z.input<typeof salesOpenAccountSchema>;
export const salesDoNotContactSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type SalesDoNotContactInput = z.infer<typeof salesDoNotContactSchema>;
export const salesCallNowSchema = z.object({ scriptKey: z.string().trim().max(60).default('b2b_intro') });

/** Action déclenchée depuis My Hub : résultat de l'outil et, pour un appel, l'appel créé. */
export const salesActionResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['done', 'pending_approval', 'refused', 'not_found']),
  approvalId: uuid.nullable(),
  message: z.string(),
  data: z.unknown(),
});
export type SalesActionResult = z.infer<typeof salesActionResultSchema>;

export const SALES_AGENT_CODES = ['b2b_prospecting', 'outbound_calls', 'followups'] as const;
export type SalesAgentCode = (typeof SALES_AGENT_CODES)[number];

export const salesRunResultSchema = z.object({
  run: agentRunSchema.nullable(),
  replayed: z.boolean(),
  summary: z.record(z.string(), z.unknown()),
});
export type SalesRunResult = z.infer<typeof salesRunResultSchema>;

export const followupListQuerySchema = adminListQuerySchema.extend({ targetType: z.enum(FOLLOWUP_TARGETS).optional() });
export const outboundCallListQuerySchema = adminListQuerySchema.extend({ prospectId: uuid.optional() });
