/**
 * Charte d'équité (D7) : sanctions vues par le chauffeur, réponse et appel, décision dans My Hub, exclusion d'une note.
 */
import { z } from 'zod';
import { APPEAL_KINDS, APPEAL_STATUSES } from '../drivers/fairness.js';
import { SANCTION_TYPES } from '../enums.js';
import { isoDate, uuid } from './common.js';

/** Réponse ou appel du chauffeur sur une sanction qui le concerne (une seule demande ouverte par sanction). */
export const sanctionAppealInputSchema = z.object({
  kind: z.enum(APPEAL_KINDS),
  message: z.string().trim().min(10).max(2000),
});
export type SanctionAppealInput = z.infer<typeof sanctionAppealInputSchema>;

export const sanctionAppealSchema = z.object({
  id: uuid,
  kind: z.enum(APPEAL_KINDS),
  message: z.string(),
  status: z.enum(APPEAL_STATUSES),
  decisionNote: z.string().nullable(),
  createdAt: isoDate,
  decidedAt: isoDate.nullable(),
});

/** Sanction telle que la voit le chauffeur : motif écrit, période, décision humaine ou non, ses réponses et appels. */
export const driverSanctionSchema = z.object({
  id: uuid,
  type: z.enum(SANCTION_TYPES),
  reason: z.string(),
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  active: z.boolean(),
  /** Faux pour une sanction appliquée par le système (blocage de précaution en attente, avertissement automatique). */
  decidedByPerson: z.boolean(),
  appeals: z.array(sanctionAppealSchema),
});
export type DriverSanctionView = z.infer<typeof driverSanctionSchema>;

/** Décision d'une personne sur une réponse ou un appel ; `overturned` lève la sanction. */
export const sanctionAppealDecisionSchema = z.object({
  decision: z.enum(['upheld', 'overturned']),
  note: z.string().trim().min(3).max(1000),
});
export type SanctionAppealDecision = z.infer<typeof sanctionAppealDecisionSchema>;

/** Réponse ou appel vu dans My Hub, avec la sanction et le retard par rapport au délai de rappel. */
export const adminSanctionAppealSchema = sanctionAppealSchema.extend({
  sanctionId: uuid,
  driverId: uuid,
  driverName: z.string().nullable(),
  driverPublicNumber: z.string(),
  sanction: z.object({ type: z.enum(SANCTION_TYPES), reason: z.string(), startsAt: isoDate, endsAt: isoDate.nullable(), decidedByUserId: uuid.nullable() }),
  /** Vrai au-delà de 4 heures ouvrables sans décision (Charte d'équité). */
  overdue: z.boolean(),
});
export type AdminSanctionAppealView = z.infer<typeof adminSanctionAppealSchema>;

export const sanctionAppealListQuerySchema = z.object({ status: z.enum(APPEAL_STATUSES).optional() });

/** Exclusion d'une note du calcul par une personne (réponse du chauffeur admise, cause extérieure établie). */
export const ratingExclusionSchema = z.object({ reason: z.string().trim().min(3).max(500) });
