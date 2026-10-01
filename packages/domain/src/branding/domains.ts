/**
 * Domaines web d'une organisation (étape 22) : la réservation (`booking`) ou My Hub (`hub`) servis sous le domaine du
 * client, avec sa marque complète. V1 : le jeton de vérification est rendu à la création et un administrateur de la
 * plateforme marque le domaine vérifié après contrôle manuel de l'enregistrement DNS (pas de vérification automatique).
 */
import { z } from 'zod';
import { isoDate, uuid } from '../schemas/common.js';
import { joinCodeSchema } from './join-code.js';

export const ORGANIZATION_DOMAIN_KINDS = ['booking', 'hub'] as const;
export type OrganizationDomainKind = (typeof ORGANIZATION_DOMAIN_KINDS)[number];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Nom d'hôte normalisé (minuscules, sans port, sans point final, sans schéma ni chemin) ou `null` s'il est invalide :
 * au moins deux étiquettes, dernière alphabétique, 253 caractères au plus. Les adresses IP et `localhost` ne sont pas
 * des domaines d'organisation.
 */
export function normalizeDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '');
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]!)) return null;
  return host;
}

export const domainSchema = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .transform((value, ctx) => {
    const domain = normalizeDomain(value);
    if (!domain) {
      ctx.addIssue({ code: 'custom', message: 'Nom de domaine attendu, par exemple reservation.taxi-exemple.ca' });
      return z.NEVER;
    }
    return domain;
  });

export const organizationDomainSchema = z.object({
  id: uuid,
  organizationId: uuid,
  domain: z.string(),
  kind: z.enum(ORGANIZATION_DOMAIN_KINDS),
  verifiedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type OrganizationDomainView = z.infer<typeof organizationDomainSchema>;

export const organizationDomainCreateSchema = z.object({
  domain: domainSchema,
  kind: z.enum(ORGANIZATION_DOMAIN_KINDS).default('booking'),
});
export type OrganizationDomainCreate = z.infer<typeof organizationDomainCreateSchema>;

/** Le jeton et l'enregistrement DNS à poser ne sont rendus qu'à la création. */
export const organizationDomainCreatedSchema = organizationDomainSchema.extend({
  verificationToken: z.string(),
  dnsRecord: z.object({ type: z.literal('TXT'), name: z.string(), value: z.string() }),
});
export type OrganizationDomainCreated = z.infer<typeof organizationDomainCreatedSchema>;

export const DNS_VERIFICATION_PREFIX = '_neomoov-verification';

/** Enregistrement TXT attendu pour un domaine et son jeton. */
export function dnsVerificationRecord(domain: string, token: string): { type: 'TXT'; name: string; value: string } {
  return { type: 'TXT', name: `${DNS_VERIFICATION_PREFIX}.${domain}`, value: `neomoov-verification=${token}` };
}

/** `GET /v1/public/brand?code=` ou `?domain=` : exactement un des deux. */
export const publicBrandQuerySchema = z
  .object({ code: joinCodeSchema.optional(), domain: domainSchema.optional() })
  .refine((q) => (q.code ? 1 : 0) + (q.domain ? 1 : 0) === 1, { message: 'Indiquez un code ou un domaine, pas les deux', path: ['code'] });
export type PublicBrandQuery = z.infer<typeof publicBrandQuerySchema>;

/** `POST /v1/me/organizations/attach`. */
export const attachOrganizationSchema = z.object({ code: joinCodeSchema });
export type AttachOrganization = z.infer<typeof attachOrganizationSchema>;
