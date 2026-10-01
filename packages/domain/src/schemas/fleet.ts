/**
 * Étape 23 (amendement v1.2, section 6) : module Flotte vu par My Hub côté organisation et par l'application chauffeur :
 * chauffeurs rattachés et invitations, véhicules, entretien, carte en direct, réseau, partage des revenus, relevés et
 * versements de l'organisation, rapports, tableau de bord du propriétaire de véhicule. Uniquement les courses Neomoov.
 */
import { z } from 'zod';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, RIDE_STATES, RIDE_TYPES, VEHICLE_CATEGORIES, VEHICLE_STATUSES } from '../enums.js';
import { MAINTENANCE_KINDS, NETWORK_MODES, REVENUE_SHARE_MODES, revenueShareRuleProblem } from '../fleet/fleet.js';
import { adminDriverListItemSchema } from './admin.js';
import { cents, isoDate, localDateString, phoneE164, signedCents, uuid } from './common.js';
import { vehicleEquipmentSchema, vehicleInputSchema } from './driver.js';
import { coordinatesSchema } from './quotes.js';
import { offlineSettlementViewSchema } from './settlement.js';

const count = z.number().int().min(0);

// --- Chauffeurs rattachés ---

/** Invitation d'un chauffeur par texto : le lien porte un jeton à usage unique, jamais montré à la personne qui invite. */
export const driverInvitationCreateSchema = z.object({
  phone: phoneE164,
  firstName: z.string().trim().min(1).max(60).optional(),
  language: z.enum(['fr', 'en']).default('fr'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type DriverInvitationCreate = z.infer<typeof driverInvitationCreateSchema>;

export const driverInvitationCreatedSchema = z.object({ id: uuid, phone: z.string(), expiresAt: isoDate, sent: z.boolean() });

export const driverInvitationAcceptSchema = z.object({ token: z.string().trim().min(10).max(200) });

/** Résultat de l'acceptation : le profil chauffeur (existant ou créé) rattaché à l'organisation. */
export const driverAttachmentSchema = z.object({
  driverId: uuid,
  organizationId: uuid,
  organizationName: z.string(),
  created: z.boolean(),
  /** Organisation quittée (relevés en brouillon émis, règles de partage closes), ou `null`. */
  previousOrganizationId: uuid.nullable(),
  closedStatements: count,
});

export const fleetDocumentSummarySchema = z.object({ approved: count, pending: count, rejected: count, expired: count, expiringSoon: count });

/** Liste des chauffeurs côté organisation : la fiche de My Hub enrichie de la conformité. */
export const fleetDriverSchema = adminDriverListItemSchema.extend({
  documents: fleetDocumentSummarySchema,
  /** Prochaine échéance d'un document approuvé (permis, assurance, immatriculation…). */
  nextDocumentExpiryOn: localDateString.nullable(),
  /** Prochaine inspection du véhicule courant. */
  nextInspectionDueOn: localDateString.nullable(),
  currentVehicle: z.object({ id: uuid, plate: z.string(), make: z.string(), model: z.string(), category: z.enum(VEHICLE_CATEGORIES) }).nullable(),
});
export type FleetDriver = z.infer<typeof fleetDriverSchema>;

export const fleetDocumentSchema = z.object({
  id: uuid,
  driverId: uuid,
  type: z.enum(DOCUMENT_TYPES),
  status: z.enum(DOCUMENT_STATUSES),
  expiresOn: localDateString.nullable(),
  uploadedAt: isoDate,
  /** Revue de l'organisation : une recommandation ; l'approbation finale reste à la plateforme. */
  orgReview: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().nullable(), at: isoDate }).nullable(),
});
export type FleetDocument = z.infer<typeof fleetDocumentSchema>;

export const orgDocumentReviewSchema = z
  .object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(3).max(300).optional() })
  .refine((r) => r.decision === 'approved' || r.note !== undefined, { message: 'Un motif est requis pour refuser un document', path: ['note'] });

// --- Véhicules ---

export const orgVehicleCreateSchema = vehicleInputSchema.extend({
  /** Chauffeur de l'organisation qui détient le véhicule (un véhicule a toujours un titulaire). */
  driverId: uuid,
  /** Propriétaire du véhicule (rôle « propriétaire de véhicule »), s'il n'est pas l'organisation. */
  ownerUserId: uuid.optional(),
});
export type OrgVehicleCreate = z.infer<typeof orgVehicleCreateSchema>;

export const orgVehicleUpdateSchema = z
  .object({
    colour: z.string().trim().min(2).max(40).optional(),
    plate: z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{2,12}$/, 'Plaque attendue (lettres et chiffres)').optional(),
    odometerKm: z.number().int().min(0).max(2_000_000).optional(),
    equipment: vehicleEquipmentSchema.optional(),
    ownerUserId: uuid.nullable().optional(),
    /** Retrait du service (le véhicule n'est plus proposé ni affectable). */
    retired: z.literal(true).optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'Au moins un champ à modifier' });
export type OrgVehicleUpdate = z.infer<typeof orgVehicleUpdateSchema>;

export const vehicleAssignSchema = z.object({
  driverId: uuid,
  /** Le véhicule devient le véhicule courant du chauffeur (défaut). */
  makeCurrent: z.boolean().default(true),
});

export const fleetVehicleSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverName: z.string().nullable(),
  ownerUserId: uuid.nullable(),
  category: z.enum(VEHICLE_CATEGORIES),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  plate: z.string(),
  seats: z.number().int(),
  odometerKm: z.number().int().nullable(),
  status: z.enum(VEHICLE_STATUSES),
  nextInspectionDueOn: localDateString.nullable(),
  current: z.boolean(),
});
export type FleetVehicle = z.infer<typeof fleetVehicleSchema>;

export const maintenanceCreateSchema = z
  .object({
    kind: z.enum(MAINTENANCE_KINDS),
    performedOn: localDateString,
    odometerKm: z.number().int().min(0).max(2_000_000).optional(),
    costCents: cents.max(100_000_000).optional(),
    notes: z.string().trim().max(500).optional(),
    nextDueOn: localDateString.optional(),
    nextDueKm: z.number().int().min(0).max(2_000_000).optional(),
  })
  .refine((m) => m.nextDueOn === undefined || m.nextDueOn > m.performedOn, { message: 'La prochaine échéance suit la date de l\'entretien', path: ['nextDueOn'] });
export type MaintenanceCreate = z.infer<typeof maintenanceCreateSchema>;

export const maintenanceDueSchema = z.object({ kind: z.enum(MAINTENANCE_KINDS), dueOn: localDateString.nullable(), dueKm: z.number().int().nullable(), status: z.enum(['ok', 'due_soon', 'overdue']) });

export const maintenanceRecordSchema = z.object({
  id: uuid,
  vehicleId: uuid,
  kind: z.enum(MAINTENANCE_KINDS),
  performedOn: localDateString,
  odometerKm: z.number().int().nullable(),
  costCents: cents.nullable(),
  notes: z.string().nullable(),
  nextDueOn: localDateString.nullable(),
  nextDueKm: z.number().int().nullable(),
  createdAt: isoDate,
});

export const vehicleMaintenanceViewSchema = z.object({
  vehicleId: uuid,
  records: z.array(maintenanceRecordSchema),
  due: z.array(maintenanceDueSchema),
  /** Suggestion d'entretien par l'agent IA : reportée (aucun point d'extension simple), toujours `null` en V1. */
  aiSuggestion: z.string().nullable(),
});

// --- Carte en direct, courses et réseau ---

export const liveDriverSchema = z.object({
  driverId: uuid,
  firstName: z.string().nullable(),
  publicNumber: z.string(),
  status: z.enum(['available', 'busy', 'on_ride']),
  coordinates: coordinatesSchema,
  headingDegrees: z.number().nullable(),
  vehicle: z.object({ id: uuid, plate: z.string(), category: z.enum(VEHICLE_CATEGORIES) }).nullable(),
  /** Course de l'organisation en cours ; une course d'une autre organisation (réseau Neomoov) n'est jamais désignée. */
  rideId: uuid.nullable(),
  updatedAt: isoDate,
});

export const liveRideSchema = z.object({
  id: uuid,
  publicNumber: z.string(),
  state: z.enum(RIDE_STATES),
  type: z.enum(RIDE_TYPES),
  category: z.enum(VEHICLE_CATEGORIES),
  origin: z.object({ address: z.string(), coordinates: coordinatesSchema }),
  destination: z.object({ address: z.string(), coordinates: coordinatesSchema }),
  requestedAt: isoDate.nullable(),
  driverId: uuid.nullable(),
  networkShared: z.boolean(),
});

export const fleetLiveSchema = z.object({ generatedAt: isoDate, drivers: z.array(liveDriverSchema), rides: z.array(liveRideSchema) });
export type FleetLive = z.infer<typeof fleetLiveSchema>;

export const fleetSettingsSchema = z.object({
  networkMode: z.enum(NETWORK_MODES),
  /** Délai sans chauffeur avant que la course reparte au réseau Neomoov (mode réseau). */
  networkAfterMinutes: z.number().int().min(1).max(1440),
});
export type FleetSettings = z.infer<typeof fleetSettingsSchema>;
export const fleetSettingsUpdateSchema = fleetSettingsSchema.partial().refine((u) => Object.keys(u).length > 0, { message: 'Au moins un réglage à modifier' });

/** Ce que reçoit le réseau quand une course y repart : seulement les champs permis (`NETWORK_SHARED_FIELDS`). */
export const networkSharedRideSchema = z.object({
  rideId: uuid,
  category: z.string(),
  type: z.string(),
  origin: z.object({ address: z.string(), coordinates: coordinatesSchema }),
  destination: z.object({ address: z.string(), coordinates: coordinatesSchema }),
  requestedAt: isoDate.nullable(),
  driverFareCents: cents,
  passengerFirstName: z.string().nullable(),
}).strict();

export const networkPassReportSchema = z.object({ shared: z.array(uuid) });

// --- Partage des revenus ---

export const revenueShareRuleCreateSchema = z
  .object({
    /** Chauffeur visé ; absent : règle par défaut de l'organisation. */
    driverId: uuid.optional(),
    mode: z.enum(REVENUE_SHARE_MODES),
    weeklyRentCents: cents.max(1_000_000).optional(),
    /** Part de l'organisation en parties par million du tarif chauffeur (200000 = 20 %). */
    percentagePpm: z.number().int().min(1).max(1_000_000).optional(),
    effectiveFrom: localDateString,
    effectiveTo: localDateString.optional(),
  })
  .refine((r) => revenueShareRuleProblem({ mode: r.mode, weeklyRentCents: r.weeklyRentCents ?? null, percentagePpm: r.percentagePpm ?? null, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? null }) === null, {
    message: 'Règle incohérente : un loyer pour « rent », un pourcentage pour « percentage », une fin après le début',
  });
export type RevenueShareRuleCreate = z.infer<typeof revenueShareRuleCreateSchema>;

export const revenueShareRuleEndSchema = z.object({ effectiveTo: localDateString });

export const revenueShareRuleSchema = z.object({
  id: uuid,
  organizationId: uuid,
  driverId: uuid.nullable(),
  driverName: z.string().nullable(),
  mode: z.enum(REVENUE_SHARE_MODES),
  weeklyRentCents: cents.nullable(),
  percentagePpm: z.number().int().nullable(),
  effectiveFrom: localDateString,
  effectiveTo: localDateString.nullable(),
  createdAt: isoDate,
});
export type RevenueShareRuleView = z.infer<typeof revenueShareRuleSchema>;

// --- Relevés et versements de l'organisation ---

export const ORGANIZATION_STATEMENT_STATUSES = ['issued', 'paid', 'failed', 'settled_offline'] as const;

export const organizationStatementLineSchema = z.object({ driverId: uuid, driverName: z.string().nullable(), driverPublicNumber: z.string(), statementId: uuid, shareCents: cents });

export const organizationStatementSchema = z.object({
  id: uuid,
  organizationId: uuid,
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.enum(ORGANIZATION_STATEMENT_STATUSES),
  shareCents: cents,
  driverCount: count,
  lines: z.array(organizationStatementLineSchema),
  /** Versement par Stripe Connect : référence du transfert, sinon `null` (règlement hors plateforme ou en attente). */
  transferRef: z.string().nullable(),
  failureCode: z.string().nullable(),
  offlineSettlement: offlineSettlementViewSchema.nullable(),
  issuedAt: isoDate,
  settledAt: isoDate.nullable(),
});
export type OrganizationStatementView = z.infer<typeof organizationStatementSchema>;

export const payoutAccountSchema = z.object({
  /** `connect` : versements automatiques sur le compte Stripe Connect de l'organisation ; `offline` : règlement hors plateforme. */
  mode: z.enum(['connect', 'offline']),
  linked: z.boolean(),
  onboarded: z.boolean(),
  payoutsEnabled: z.boolean(),
  provider: z.string(),
});
export const payoutOnboardingSchema = z.object({ url: z.string().url(), expiresAt: isoDate, simulated: z.boolean() });

/** Détail d'un relevé de chauffeur vu par l'organisation (mêmes lignes que My Hub, dont la part de l'organisation). */
export const orgStatementDetailSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverName: z.string().nullable(),
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.string(),
  creditsCents: cents,
  debitsCents: cents,
  netCents: signedCents,
  shareCents: cents,
  issuedAt: isoDate.nullable(),
  pdfAvailable: z.boolean(),
  lines: z.array(z.object({ kind: z.string(), label: z.string(), amountCents: signedCents, rideId: uuid.nullable(), occurredAt: isoDate })),
});

// --- Rapports ---

export const weeklyReportQuerySchema = z.object({ periodStart: localDateString.optional() });

export const weeklyReportSchema = z.object({
  periodStart: localDateString,
  periodEnd: localDateString,
  totals: z.object({ rides: count, fareCents: cents, shareCents: cents }),
  byDriver: z.array(z.object({ driverId: uuid, driverName: z.string().nullable(), publicNumber: z.string(), rides: count, fareCents: cents, shareCents: cents })),
  byVehicle: z.array(z.object({ vehicleId: uuid, plate: z.string(), make: z.string(), model: z.string(), rides: count, fareCents: cents })),
});
export type WeeklyReport = z.infer<typeof weeklyReportSchema>;

export const ownerDashboardSchema = z.object({
  periodStart: localDateString,
  periodEnd: localDateString,
  vehicles: z.array(z.object({
    vehicleId: uuid, plate: z.string(), make: z.string(), model: z.string(), status: z.enum(VEHICLE_STATUSES), driverName: z.string().nullable(),
    rides: count, fareCents: cents, nextInspectionDueOn: localDateString.nullable(), maintenanceDue: z.array(maintenanceDueSchema),
  })),
});
export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
