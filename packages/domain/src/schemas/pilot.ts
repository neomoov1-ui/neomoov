/**
 * Schémas de Neomoov Pilote (étape 24) : réglages et consentement (Loi 25, article 12.1), score des offres, décisions,
 * coûts et rentabilité, agenda des réservations chaînées, rapport des exclusions de zones.
 */
import { z } from 'zod';
import { RIDE_TYPES } from '../enums.js';
import { AGENDA_STATUSES } from '../pilot/agenda.js';
import { PILOT_DECISIONS, PILOT_REASON_CODES, PILOT_SCORES, pilotCriteriaSchema } from '../pilot/pilot.js';
import { cents, isoDate, signedCents, uuid } from './common.js';
import { placeSchema } from './quotes.js';

const count = z.number().int().min(0);

/** Mois civil `AAAA-MM` (heure de Montréal). */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois AAAA-MM attendu');

export const pilotReasonSchema = z.object({
  code: z.enum(PILOT_REASON_CODES),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).optional(),
  /** Exclusion de zone : surveillée par Neomoov (discrimination indirecte). */
  monitored: z.literal(true).optional(),
});

export const pilotMetricsSchema = z.object({
  netCents: signedCents,
  netPerKmCents: z.number().int().nullable(),
  netPerHourCents: z.number().int().nullable(),
  totalMeters: count.nullable(),
  totalSeconds: count.nullable(),
});

/** Score d'une offre selon les critères du chauffeur, Pilote activé ou non ; `autoAccept` : Pilote l'accepte pour lui. */
export const pilotScoreSchema = z.object({
  decision: z.enum(PILOT_DECISIONS),
  score: z.enum(PILOT_SCORES),
  reasons: z.array(pilotReasonSchema),
  metrics: pilotMetricsSchema,
  enabled: z.boolean(),
  autoAccept: z.boolean(),
});
export type PilotScoreView = z.infer<typeof pilotScoreSchema>;

export const pilotInformationSchema = z.object({ version: z.string(), title: z.string(), paragraphs: z.array(z.string()) });

/** `GET /driver/pilot` : réglages, texte d'information à sa version courante, paramètres de la plateforme, zones connues. */
export const pilotSettingsSchema = z.object({
  /** Interrupteur général de la plateforme (`pilot.enabled`). */
  available: z.boolean(),
  enabled: z.boolean(),
  multiAppMode: z.boolean(),
  criteria: pilotCriteriaSchema,
  consentAt: isoDate.nullable(),
  consentVersion: z.string().nullable(),
  /** Consentement donné à la version courante du texte d'information. */
  consentCurrent: z.boolean(),
  information: pilotInformationSchema,
  graceSeconds: count,
  multiAppFactor: z.number().min(1),
  multiAppResponseSeconds: count,
  zones: z.array(z.object({ code: z.string(), name: z.string(), type: z.string() })),
  updatedAt: isoDate.nullable(),
});
export type PilotSettingsView = z.infer<typeof pilotSettingsSchema>;

/** `PUT /driver/pilot` : l'activation exige `consentVersion` égale à la version courante (ou un consentement déjà à jour). */
export const pilotSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  criteria: pilotCriteriaSchema.optional(),
  consentVersion: z.string().trim().min(1).max(20).optional(),
});
export type PilotSettingsUpdate = z.infer<typeof pilotSettingsUpdateSchema>;

export const pilotDecisionSchema = z.object({
  id: uuid,
  rideId: uuid,
  offerId: uuid.nullable(),
  decision: z.enum(PILOT_DECISIONS),
  score: z.enum(PILOT_SCORES),
  reasons: z.array(pilotReasonSchema),
  autoAcceptedAt: isoDate.nullable(),
  cancelledInGraceAt: isoDate.nullable(),
  /** Fin du délai d'annulation sans frais d'une course acceptée par Pilote ; null sinon. */
  graceEndsAt: isoDate.nullable(),
  createdAt: isoDate,
  ride: z.object({ publicNumber: z.string(), type: z.enum(RIDE_TYPES), requestedAt: isoDate.nullable(), originAddress: z.string(), destinationAddress: z.string(), driverFareCents: cents }),
});
export type PilotDecisionView = z.infer<typeof pilotDecisionSchema>;

export const pilotDecisionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PilotDecisionsQuery = z.infer<typeof pilotDecisionsQuerySchema>;

export const pilotDecisionPageSchema = z.object({ items: z.array(pilotDecisionSchema), total: count, page: z.number().int().min(1), pageSize: z.number().int().min(1) });
export type PilotDecisionPage = z.infer<typeof pilotDecisionPageSchema>;

const costAmount = z.number().int().min(0).max(10_000_000);

/** `PUT /driver/costs/{mois}` : postes de coûts du mois et revenus des autres plateformes (un total, sans logo). */
export const driverCostsInputSchema = z.object({
  vehicleCents: costAmount.default(0),
  insuranceCents: costAmount.default(0),
  energyCents: costAmount.default(0),
  maintenanceCents: costAmount.default(0),
  phoneCents: costAmount.default(0),
  otherCents: costAmount.default(0),
  externalRevenueCents: costAmount.default(0),
});
export type DriverCostsInput = z.input<typeof driverCostsInputSchema>;

export const driverCostsSchema = z.object({
  month: monthSchema,
  vehicleCents: cents,
  insuranceCents: cents,
  energyCents: cents,
  maintenanceCents: cents,
  phoneCents: cents,
  otherCents: cents,
  externalRevenueCents: cents,
  updatedAt: isoDate.nullable(),
});
export type DriverCostsView = z.infer<typeof driverCostsSchema>;

export const profitabilityQuerySchema = z.object({ month: monthSchema.optional() });

export const driverProfitabilitySchema = z.object({
  month: monthSchema,
  rides: count,
  revenue: z.object({ neomoovCents: cents, externalCents: cents, totalCents: cents }),
  costs: z.object({
    items: z.object({ vehicle: cents, insurance: cents, energy: cents, maintenance: cents, phone: cents, other: cents }),
    packsCents: cents,
    totalCents: cents,
  }),
  netCents: signedCents,
  marginPercent: z.number().nullable(),
  neomoovSharePercent: z.number().nullable(),
  /** Faux tant que le chauffeur n'a saisi aucun coût pour ce mois. */
  costsEntered: z.boolean(),
});
export type DriverProfitabilityView = z.infer<typeof driverProfitabilitySchema>;

/** `GET /driver/agenda` : position facultative (lat et lng ensemble), sinon la dernière position connue en ligne. */
export const driverAgendaQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const driverAgendaItemSchema = z.object({
  rideId: uuid,
  publicNumber: z.string(),
  requestedAt: isoDate,
  endsAt: isoDate,
  origin: placeSchema,
  destination: placeSchema,
  driverFareCents: cents,
  travelSeconds: count.nullable(),
  leaveAt: isoDate.nullable(),
  gapSeconds: z.number().int().nullable(),
  conflict: z.boolean(),
  status: z.enum(AGENDA_STATUSES),
});

export const driverAgendaSchema = z.object({
  /** Point de départ du calcul de la première course : position envoyée, dernière position en ligne, ou aucune. */
  from: z.enum(['position', 'presence', 'none']),
  alertMinutes: count,
  items: z.array(driverAgendaItemSchema),
});
export type DriverAgendaView = z.infer<typeof driverAgendaSchema>;

/** `GET /admin/pilot/zone-exclusions` : surveillance de la discrimination indirecte. */
export const pilotZoneExclusionsSchema = z.object({
  watchedZones: z.array(z.string()),
  zones: z.array(z.object({ code: z.string(), name: z.string(), type: z.string(), watched: z.boolean(), drivers: count, enabledDrivers: count, origin: count, destination: count })),
  drivers: z.array(z.object({ driverId: uuid, publicNumber: z.string(), enabled: z.boolean(), origin: z.array(z.string()), destination: z.array(z.string()), watched: z.array(z.string()) })),
});
export type PilotZoneExclusionsView = z.infer<typeof pilotZoneExclusionsSchema>;
