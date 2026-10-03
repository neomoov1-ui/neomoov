/**
 * Schémas de l'espace « Réseaux sociaux » de My Hub (3 octobre 2026) : vue d'un compte (jamais une valeur secrète),
 * réglages, formulaires (Telegram, lien public), choix de la page ou de l'organisation après l'autorisation, liens
 * publics de la page Contact.
 */
import { z } from 'zod';
import { SOCIAL_ACCOUNT_STATUSES, SOCIAL_CONNECTIONS, SOCIAL_MODES, SOCIAL_SPACES } from '../marketing/social-accounts.js';
import { isoDate } from './common.js';

export const socialSpaceSchema = z.enum(SOCIAL_SPACES);

/** Compte possible proposé après l'autorisation (plusieurs pages Facebook, plusieurs pages LinkedIn) : sans jeton. */
export const socialCandidateSchema = z.object({ id: z.string(), name: z.string(), detail: z.string().nullable() });
export type SocialCandidate = z.infer<typeof socialCandidateSchema>;

export const socialAccountSchema = z.object({
  space: socialSpaceSchema,
  label: z.string(),
  connection: z.enum(SOCIAL_CONNECTIONS),
  mode: z.enum(SOCIAL_MODES),
  /** Modes proposés pour cet espace (jamais l'agrégateur). */
  modes: z.array(z.enum(SOCIAL_MODES)),
  status: z.enum(SOCIAL_ACCOUNT_STATUSES),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  profileUrl: z.string().nullable(),
  showOnSite: z.boolean(),
  requiresApproval: z.boolean(),
  appApproved: z.boolean(),
  /** Identifiants d'application du réseau présents sur le serveur (parcours OAuth possible). */
  appConfigured: z.boolean(),
  /** Variables du serveur attendues pour ce réseau (noms seulement). */
  appVariables: z.array(z.string()),
  /** Adresse de rappel à déclarer chez le réseau (parcours OAuth). */
  callbackUrl: z.string().nullable(),
  /** Origine des identifiants utilisés : base (relié dans My Hub), variables du serveur (repli), aucun. */
  credentialSource: z.enum(['database', 'environment', 'none']),
  scopes: z.array(z.string()),
  expiresAt: isoDate.nullable(),
  lastValidatedAt: isoDate.nullable(),
  lastError: z.string().nullable(),
  connectedAt: isoDate.nullable(),
  candidates: z.array(socialCandidateSchema),
  updatedAt: isoDate.nullable(),
});
export type SocialAccountView = z.infer<typeof socialAccountSchema>;

export const socialAccountUpdateSchema = z.object({
  mode: z.enum(['direct', 'manual']).optional(),
  showOnSite: z.boolean().optional(),
  /** Lien public (page Contact) ; null l'efface. Vérifié : https sur un domaine du réseau. */
  profileUrl: z.string().trim().url().max(500).nullable().optional(),
  /** Le réseau a approuvé l'application (LinkedIn, TikTok, YouTube) : confirmé par le fondateur. */
  appApproved: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Aucun changement demandé' });
export type SocialAccountUpdateInput = z.infer<typeof socialAccountUpdateSchema>;

export const socialTelegramConnectSchema = z.object({
  /** Jeton du bot donné par @BotFather (secret : chiffré au repos, jamais rendu). */
  botToken: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/, 'Jeton de bot attendu, par exemple 123456789:AA…'),
  /** Canal : `@nom`, `https://t.me/nom` ou identifiant `-100…`. */
  channel: z.string().trim().min(2).max(120),
});
export type SocialTelegramConnectInput = z.infer<typeof socialTelegramConnectSchema>;

export const socialLinkInputSchema = z.object({ profileUrl: z.string().trim().url().max(500) });
export type SocialLinkInput = z.infer<typeof socialLinkInputSchema>;

export const socialSelectSchema = z.object({ accountId: z.string().trim().min(1).max(100) });
export type SocialSelectInput = z.infer<typeof socialSelectSchema>;

export const socialConnectStartSchema = z.object({ url: z.string().url(), callbackUrl: z.string().url() });
export type SocialConnectStart = z.infer<typeof socialConnectStartSchema>;

export const socialLinksSchema = z.object({ links: z.array(z.object({ space: socialSpaceSchema, label: z.string(), url: z.string() })) });
export type SocialLinksView = z.infer<typeof socialLinksSchema>;
