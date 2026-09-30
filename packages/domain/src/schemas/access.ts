/**
 * Étape 19 (amendement v1.2) : organisations en arbre, catalogue des permissions, rôles personnalisés, adhésions et
 * invitations, tels que My Hub les lit et les écrit.
 */
import { z } from 'zod';
import { ORGANIZATION_TYPES, PERMISSION_MODULES } from '../access/permissions.js';
import { isoDate, phoneE164, uuid } from './common.js';

export const ORGANIZATION_STATUSES = ['trial', 'active', 'read_only', 'suspended', 'closed'] as const;
export const MEMBERSHIP_SCOPES = ['organization', 'subtree'] as const;
export const MEMBERSHIP_STATUSES = ['active', 'suspended'] as const;

export const organizationSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  type: z.enum(ORGANIZATION_TYPES),
  parentId: uuid.nullable(),
  path: z.string(),
  status: z.enum(ORGANIZATION_STATUSES),
  planCode: z.string().nullable(),
});
export type OrganizationView = z.infer<typeof organizationSchema>;

/** Sous-organisation : jamais une seconde plateforme. */
export const organizationCreateSchema = z.object({
  parentId: uuid,
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(120),
  type: z.enum(ORGANIZATION_TYPES).exclude(['platform']),
});
export type OrganizationCreate = z.infer<typeof organizationCreateSchema>;

export const permissionViewSchema = z.object({
  code: z.string(),
  module: z.enum(PERMISSION_MODULES),
  description: z.string(),
  sensitive: z.boolean(),
  platformOnly: z.boolean(),
});

export const roleViewSchema = z.object({
  id: uuid,
  organizationId: uuid.nullable(),
  code: z.string(),
  name: z.string(),
  level: z.number().int().min(0).max(4),
  /** Rôle système (défini par le domaine) : lecture seule. */
  system: z.boolean(),
  permissions: z.array(z.string()),
});
export type RoleView = z.infer<typeof roleViewSchema>;

export const roleListQuerySchema = z.object({ organizationId: uuid.optional() });

/** Rôle personnalisé d'une organisation (niveau 1 à 4) ; jamais plus que les permissions de celui qui le crée. */
export const roleCreateSchema = z.object({
  organizationId: uuid,
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,60}$/),
  name: z.string().trim().min(2).max(120),
  level: z.number().int().min(1).max(4),
  permissions: z.array(z.string()).min(1).max(100),
});
export type RoleCreate = z.infer<typeof roleCreateSchema>;

export const rolePermissionsUpdateSchema = z.object({ permissions: z.array(z.string()).min(1).max(100) });

export const membershipViewSchema = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().nullable(),
  organizationId: uuid,
  roleId: uuid,
  roleCode: z.string(),
  roleName: z.string(),
  scope: z.enum(MEMBERSHIP_SCOPES),
  status: z.enum(MEMBERSHIP_STATUSES),
  expiresAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type MembershipView = z.infer<typeof membershipViewSchema>;

export const membershipUpdateSchema = z.object({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  roleId: uuid.optional(),
}).refine((m) => m.status !== undefined || m.roleId !== undefined, { message: 'Rien à modifier' });
export type MembershipUpdate = z.infer<typeof membershipUpdateSchema>;

/** Invitation par courriel ou texto, à usage unique ; valable 1 à 30 jours (7 par défaut). */
export const invitationCreateSchema = z.object({
  roleId: uuid,
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: phoneE164.optional(),
  scope: z.enum(MEMBERSHIP_SCOPES).default('organization'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
}).refine((i) => Boolean(i.email) || Boolean(i.phone), { message: 'Courriel ou téléphone requis', path: ['phone'] });
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;

/** Le jeton n'est montré qu'une fois ; seule son empreinte est gardée. */
export const invitationCreatedSchema = z.object({ id: uuid, token: z.string(), expiresAt: isoDate });

export const invitationAcceptSchema = z.object({ token: z.string().trim().min(20).max(200) });

// --- Étape 20 : routes d'organisation (`/v1/org/:organizationId`) et sélecteur d'organisation de l'application unique ---

/** Une adhésion active de l'utilisateur connecté, avec l'organisation et le rôle (sélecteur d'organisation). */
export const myOrganizationSchema = z.object({
  membershipId: uuid,
  organizationId: uuid,
  code: z.string(),
  name: z.string(),
  type: z.enum(ORGANIZATION_TYPES),
  path: z.string(),
  organizationStatus: z.enum(ORGANIZATION_STATUSES),
  roleId: uuid,
  roleCode: z.string(),
  roleName: z.string(),
  scope: z.enum(MEMBERSHIP_SCOPES),
  status: z.enum(MEMBERSHIP_STATUSES),
  expiresAt: isoDate.nullable(),
});
export type MyOrganization = z.infer<typeof myOrganizationSchema>;

/** Fiche d'une organisation vue par un membre : permissions effectives de l'appelant, modules actifs. */
export const organizationHomeSchema = z.object({
  organization: organizationSchema,
  /** Permissions de l'appelant dans cette organisation (rôles de ses adhésions, modules de la formule, double authentification). */
  permissions: z.array(z.string()),
  /** Modules actifs ; sans restriction (`modulesRestricted` faux), tous les modules du catalogue. */
  modules: z.array(z.string()),
  modulesRestricted: z.boolean(),
});
export type OrganizationHome = z.infer<typeof organizationHomeSchema>;

/** Rôle personnalisé créé par une route d'organisation : l'organisation est celle de la route, jamais celle du corps. */
export const orgRoleCreateSchema = roleCreateSchema.omit({ organizationId: true });
export type OrgRoleCreate = z.infer<typeof orgRoleCreateSchema>;
