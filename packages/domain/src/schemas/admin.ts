/**
 * Schémas de My Hub (prompt 12, section 7.2 groupe Admin) : listes paginées, fiches, revues, décisions, paramètres,
 * tarifs et zones, rapports ; et de l'API publique limitée (prospects). Les données sensibles arrivent déjà masquées.
 */
import { z } from 'zod';
import {
  DOCUMENT_STATUSES, DOCUMENT_TYPES, DRIVER_QUALIFICATIONS, DRIVER_STATUSES, INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_TYPES, LANGUAGES,
  PAYMENT_METHODS, RIDE_STATES, RIDE_TYPES, SANCTION_TYPES, USER_ROLES, VEHICLE_CATEGORIES, VEHICLE_STATUSES,
} from '../enums.js';
import { cents, isoDate, localDateString, phoneE164, uuid } from './common.js';
import { INVOICE_KINDS } from '../invoicing/invoice.js';

const count = z.number().int().min(0);

/** Types de prospects reçus par l'API publique. */
export const LEAD_KINDS = ['driver', 'business', 'partner'] as const;

/** Requête de liste : page à partir de 1, recherche libre, filtre d'état. */
export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(80).optional(),
  status: z.string().trim().max(40).optional(),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: count, page: z.number().int().min(1), pageSize: z.number().int().min(1) });
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Tableau de bord ----------------------------------------------------------------------------------------------------

export const fleetPositionSchema = z.object({
  driverId: uuid,
  publicNumber: z.string(),
  firstName: z.string().nullable(),
  status: z.enum(['online', 'paused']),
  category: z.enum(VEHICLE_CATEGORIES).nullable(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }),
  currentRideId: uuid.nullable(),
  updatedAt: isoDate,
});
export type FleetPosition = z.infer<typeof fleetPositionSchema>;

export const adminAlertSchema = z.object({
  incidentId: uuid,
  rideId: uuid.nullable(),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  description: z.string(),
  createdAt: isoDate,
});

export const adminDashboardSchema = z.object({
  counts: z.object({
    ridesToday: count, ridesActive: count, ridesSearching: count, scheduledUpcoming: count, scheduledUnconfirmed: count,
    driversOnline: count, driversPaused: count, driversPending: count, documentsPending: count, incidentsOpen: count, approvalsPending: count,
  }),
  completedToday: count,
  revenueTodayCents: cents,
  alerts: z.array(adminAlertSchema),
  unconfirmed: z.array(z.object({ rideId: uuid, publicNumber: z.string(), requestedAt: isoDate, driverName: z.string().nullable() })),
  fleet: z.array(fleetPositionSchema),
  generatedAt: isoDate,
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

// Courses ------------------------------------------------------------------------------------------------------------

export const adminRideListQuerySchema = adminListQuerySchema.extend({
  state: z.enum(RIDE_STATES).optional(),
  /** `active` : les courses ouvertes d'abord (répartition), `recent` : les plus récentes. */
  view: z.enum(['active', 'scheduled', 'recent']).default('active'),
});
export const adminRideListItemSchema = z.object({
  id: uuid,
  publicNumber: z.string(),
  state: z.enum(RIDE_STATES),
  type: z.enum(RIDE_TYPES),
  category: z.enum(VEHICLE_CATEGORIES),
  requestedAt: isoDate.nullable(),
  origin: z.string(),
  destination: z.string(),
  clientName: z.string().nullable(),
  clientPhone: z.string().nullable(),
  driverName: z.string().nullable(),
  driverPublicNumber: z.string().nullable(),
  quotedTotalCents: cents,
  finalPriceCents: cents.nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  createdAt: isoDate,
});
export type AdminRideListItem = z.infer<typeof adminRideListItemSchema>;
export const adminCancelRideSchema = z.object({ reason: z.string().trim().min(3).max(300), chargeFee: z.boolean().default(false) });

// Chauffeurs, documents, véhicules -----------------------------------------------------------------------------------

export const adminDriverListItemSchema = z.object({
  id: uuid,
  userId: uuid,
  publicNumber: z.string(),
  status: z.enum(DRIVER_STATUSES),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  qualification: z.enum(DRIVER_QUALIFICATIONS).nullable(),
  rating: z.number().min(0).max(5),
  ratingCount: count,
  rideCount: count,
  isOnline: z.boolean(),
  documentsPending: count,
  trainingCertified: z.boolean(),
  createdAt: isoDate,
});
export type AdminDriverListItem = z.infer<typeof adminDriverListItemSchema>;

export const adminDocumentSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverName: z.string().nullable(),
  driverPublicNumber: z.string(),
  type: z.enum(DOCUMENT_TYPES),
  status: z.enum(DOCUMENT_STATUSES),
  number: z.string().nullable(),
  issuedOn: localDateString.nullable(),
  expiresOn: localDateString.nullable(),
  rejectionReason: z.string().nullable(),
  uploadedAt: isoDate,
  verifiedAt: isoDate.nullable(),
});
export type AdminDocument = z.infer<typeof adminDocumentSchema>;

export const documentReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(3).max(300).optional(),
    expiresOn: localDateString.optional(),
    number: z.string().trim().max(60).optional(),
  })
  .refine((r) => r.decision === 'approved' || r.reason !== undefined, { message: 'Un motif est requis pour refuser un document', path: ['reason'] });

export const adminVehicleSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverName: z.string().nullable(),
  driverPublicNumber: z.string(),
  category: z.enum(VEHICLE_CATEGORIES),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  plate: z.string(),
  seats: z.number().int(),
  status: z.enum(VEHICLE_STATUSES),
  nextInspectionDueOn: localDateString.nullable(),
  createdAt: isoDate,
});
export type AdminVehicle = z.infer<typeof adminVehicleSchema>;
export const vehicleReviewSchema = z.object({ status: z.enum(VEHICLE_STATUSES), nextInspectionDueOn: localDateString.optional() });

export const staffNoteSchema = z.object({ id: uuid, body: z.string(), authorName: z.string().nullable(), createdAt: isoDate });
export const staffNoteInputSchema = z.object({ body: z.string().trim().min(2).max(2000) });

export const sanctionSchema = z.object({
  id: uuid,
  driverId: uuid,
  type: z.enum(SANCTION_TYPES),
  reason: z.string(),
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  decidedByUserId: uuid.nullable(),
});
export const sanctionInputSchema = z.object({ type: z.enum(SANCTION_TYPES), reason: z.string().trim().min(3).max(500), endsAt: isoDate.optional() });

export const adminDriverDetailSchema = z.object({
  driver: adminDriverListItemSchema.extend({
    email: z.string().nullable(),
    gstNumber: z.string().nullable(),
    qstNumber: z.string().nullable(),
    spokenLanguages: z.array(z.string()),
    experienceYears: count.nullable(),
    paymentModes: z.object({ cash: z.boolean(), interac: z.boolean(), terminal: z.boolean() }),
    payout: z.object({ linked: z.boolean(), onboarded: z.boolean() }),
    activatedAt: isoDate.nullable(),
    /** Locataire d'un véhicule R-LuxeEV : pack Découverte offert (5.7). */
    rLuxeEvTenant: z.boolean(),
  }),
  vehicles: z.array(adminVehicleSchema),
  documents: z.array(adminDocumentSchema),
  notes: z.array(staffNoteSchema),
  sanctions: z.array(sanctionSchema),
  stats: z.object({ completedRides: count, cancellations30d: count, incidents: count }),
});
export type AdminDriverDetail = z.infer<typeof adminDriverDetailSchema>;
export const driverSuspendSchema = z.object({ reason: z.string().trim().min(3).max(500) });
/** Programmes du chauffeur modifiables par le personnel. */
export const driverProgramsSchema = z.object({ rLuxeEvTenant: z.boolean() });
export type DriverPrograms = z.infer<typeof driverProgramsSchema>;

// Clients ------------------------------------------------------------------------------------------------------------

export const adminClientSchema = z.object({
  id: uuid,
  userId: uuid,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  rideCount: count,
  status: z.string(),
  createdAt: isoDate,
});
export type AdminClient = z.infer<typeof adminClientSchema>;

// Incidents, sanctions, approbations ---------------------------------------------------------------------------------

export const adminIncidentSchema = z.object({
  id: uuid,
  rideId: uuid.nullable(),
  ridePublicNumber: z.string().nullable(),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  reportedByKind: z.string(),
  description: z.string(),
  decision: z.string().nullable(),
  decidedAt: isoDate.nullable(),
  privacyBreach: z.boolean(),
  createdAt: isoDate,
});
export type AdminIncident = z.infer<typeof adminIncidentSchema>;
export const incidentDecisionSchema = z.object({ status: z.enum(['investigating', 'decided', 'closed']), decision: z.string().trim().min(3).max(2000).optional() });

export const adminApprovalSchema = z.object({
  id: uuid,
  agentCode: z.string().nullable(),
  proposedAction: z.string(),
  data: z.unknown(),
  justification: z.string().nullable(),
  decision: z.enum(['pending', 'approved', 'rejected']),
  decidedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type AdminApproval = z.infer<typeof adminApprovalSchema>;
export const approvalDecisionSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() });

// Paramètres, tarifs, zones ------------------------------------------------------------------------------------------

export const adminSettingSchema = z.object({ key: z.string(), value: z.unknown(), description: z.string().nullable(), updatedAt: isoDate.nullable() });
export const settingUpdateSchema = z.object({ value: z.unknown().refine((v) => v !== undefined, 'Valeur requise') });

export const pricingRuleInputSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  baseCents: cents,
  perKmCents: cents,
  perMinuteCents: cents,
  minimumCents: cents,
  /** Date d'entrée en vigueur (heure de Montréal) : la ligne la plus récente déjà en vigueur fait foi. */
  validFrom: localDateString,
});
export const pricingRuleSchema = pricingRuleInputSchema.extend({ id: uuid, cityCode: z.string(), validTo: localDateString.nullable(), createdAt: isoDate });

export const polygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1).max(1),
});
export const zoneUpdateSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), geometry: polygonGeometrySchema });

// Utilisateurs, demandes de droits, rapports --------------------------------------------------------------------------

export const adminStaffSchema = z.object({
  id: uuid,
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  roles: z.array(z.enum(USER_ROLES)),
  mfaEnrolled: z.boolean(),
  status: z.string(),
  createdAt: isoDate,
});

/** Demande de droits (Loi 25) : réponse due sous 30 jours ; `overdue` quand l'échéance est passée sans réponse. */
export const adminDataRequestSchema = z.object({
  id: uuid,
  userId: uuid,
  type: z.string(),
  status: z.enum(['open', 'overdue', 'done']),
  receivedAt: isoDate,
  dueOn: localDateString,
  processedAt: isoDate.nullable(),
  outcome: z.string().nullable(),
});

export const adminLeadSchema = z.object({
  id: uuid,
  kind: z.enum(LEAD_KINDS),
  firstName: z.string(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  message: z.string().nullable(),
  source: z.string(),
  status: z.enum(['new', 'contacted', 'converted', 'discarded']),
  createdAt: isoDate,
});
export const leadStatusSchema = z.object({ status: z.enum(['new', 'contacted', 'converted', 'discarded']) });

export const reportQuerySchema = z.object({ from: localDateString, to: localDateString });
export const adminReportSchema = z.object({
  from: localDateString,
  to: localDateString,
  totals: z.object({
    ridesRequested: count, ridesCompleted: count, ridesCancelled: count, noDriver: count, noShow: count,
    revenueCents: cents, tipsCents: cents, averageRating: z.number().nullable(), newClients: count, newDrivers: count, activeDrivers: count,
    cancellationRatePct: z.number().min(0).max(100), noDriverRatePct: z.number().min(0).max(100),
  }),
  daily: z.array(z.object({ date: localDateString, requested: count, completed: count, cancelled: count, revenueCents: cents })),
});
export type AdminReport = z.infer<typeof adminReportSchema>;

// API publique (WordPress, pages web) ---------------------------------------------------------------------------------

export const leadInputSchema = z.object({
  kind: z.enum(LEAD_KINDS),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  phone: phoneE164,
  email: z.string().trim().email().max(254).optional(),
  city: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
  language: z.enum(LANGUAGES).default('fr'),
  /** Jeton de la protection anti-robots (Cloudflare Turnstile). */
  antiBotToken: z.string().min(1).max(2048),
  /** Consentement à être recontacté (Loi 25). */
  consent: z.literal(true),
});
export type LeadInput = z.input<typeof leadInputSchema>;
export const leadCreatedSchema = z.object({ id: uuid, status: z.literal('received') });

// Catalogue et comptabilité (lecture en V1 ; génération des relevés et factures aux étapes 9 et 13) --------------------

export const adminInvoiceSchema = z.object({
  id: uuid,
  number: z.string(),
  /** Facture de course, d'annulation, de non-présentation, ou note de crédit (étape 9). */
  kind: z.enum(INVOICE_KINDS),
  rideId: uuid,
  supplierName: z.string(),
  totalCents: cents,
  paymentMethod: z.enum(PAYMENT_METHODS),
  sevStatus: z.string(),
  sevTransactionId: z.string().nullable(),
  issuedAt: isoDate,
});
export const adminPromotionSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.number().int(),
  active: z.boolean(),
  spentCents: cents,
  budgetCents: cents.nullable(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
});
export const adminStatementSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverPublicNumber: z.string(),
  driverName: z.string().nullable(),
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.string(),
  creditsCents: cents,
  debitsCents: cents,
  netCents: z.number().int(),
  issuedAt: isoDate.nullable(),
});
export const adminAgentSchema = z.object({ code: z.string(), name: z.string(), mode: z.string(), model: z.string(), effort: z.string(), runs7d: count, pendingApprovals: count });

// Types des réponses de My Hub, pour le client d'API.
export type AdminStaff = z.infer<typeof adminStaffSchema>;
export type AdminDataRequest = z.infer<typeof adminDataRequestSchema>;
export type AdminLead = z.infer<typeof adminLeadSchema>;
export type AdminSetting = z.infer<typeof adminSettingSchema>;
export type AdminInvoice = z.infer<typeof adminInvoiceSchema>;
export type AdminPromotion = z.infer<typeof adminPromotionSchema>;
export type AdminStatement = z.infer<typeof adminStatementSchema>;
export type AdminAgent = z.infer<typeof adminAgentSchema>;
export type PricingRuleView = z.infer<typeof pricingRuleSchema>;
export type PricingRuleInput = z.infer<typeof pricingRuleInputSchema>;
export type StaffNote = z.infer<typeof staffNoteSchema>;
export type AdminRideListQuery = Partial<z.infer<typeof adminRideListQuerySchema>>;
export type DocumentReview = z.infer<typeof documentReviewSchema>;
export type VehicleReview = z.infer<typeof vehicleReviewSchema>;
export type IncidentDecision = z.infer<typeof incidentDecisionSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type SanctionInput = z.infer<typeof sanctionInputSchema>;
export type ZoneUpdate = z.infer<typeof zoneUpdateSchema>;
export type LeadStatus = z.infer<typeof leadStatusSchema>['status'];
export interface ZoneGeometry {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}
