/**
 * Schémas du profil client et de la configuration publique (prompt 10) : ce dont l'application client a besoin avant
 * et autour de la réservation. Réglages lus en base ou dans l'environnement, jamais codés dans l'application.
 */
import { z } from 'zod';
import { VEHICLE_CATEGORIES } from '../enums.js';
import { cents, uuid } from './common.js';
import { coordinatesSchema } from './quotes.js';

const count = z.number().int().min(0);

/**
 * `GET /v1/config` (public) : drapeaux distants et règles affichées par les applications. La négociation n'apparaît
 * dans l'application que si `features.negotiation` est vrai (drapeau `FEATURE_NEGOTIATION` de l'API).
 */
export const appConfigSchema = z.object({
  features: z.object({
    negotiation: z.boolean(),
    negotiationAboveMax: z.boolean(),
    immediateRides: z.boolean(),
    installments: z.boolean(),
    /** Vérification faciale des chauffeurs au début du quart (V1.1, drapeau `FEATURE_FACE_CHECK`). */
    faceCheck: z.boolean(),
    /** Paiement par carte ouvert (Stripe branché) ; sinon, paiement au chauffeur seulement. */
    cardPayments: z.boolean(),
  }),
  booking: z.object({
    /** Préavis minimal (D32), en secondes : 7 200 en V1. */
    minLeadSeconds: count,
    maxLeadDays: count,
    freeCancellationSeconds: count,
    cancellationFeeCents: cents,
  }),
  negotiation: z.object({ floorPpm: count, windowSeconds: count }),
  /** Pourboires proposés à la fin de course (montants en cents, 0 = aucun) ; le montant libre reste possible jusqu'au plafond. */
  tips: z.object({ suggestedCents: z.array(cents), maxCents: cents }),
  support: z.object({ phone: z.string().nullable(), email: z.string().nullable() }),
  /** Version de la politique de confidentialité à accepter à la création du compte (5.15) et pages publiques. */
  legal: z.object({ privacyPolicyVersion: z.string(), termsUrl: z.string().url(), privacyUrl: z.string().url() }),
  categories: z.array(z.object({
    code: z.enum(VEHICLE_CATEGORIES),
    name: z.string(),
    seats: z.number().int().min(1),
    description: z.string().nullable(),
    allowedModels: z.array(z.string()),
  })),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

/** Lieu enregistré du client (domicile, travail, aéroport préféré…). */
export const savedPlaceSchema = z.object({ id: uuid, label: z.string(), address: z.string(), coordinates: coordinatesSchema });
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

export const savedPlaceInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(3).max(300),
  coordinates: coordinatesSchema,
});
export type SavedPlaceInput = z.infer<typeof savedPlaceInputSchema>;
