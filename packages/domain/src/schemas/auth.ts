/**
 * Schémas Zod de l'identité (prompt 03, sections 4.1, 5.15, 7.2 et 8 du cahier des charges) : connexion par code SMS,
 * Apple, Google, jetons, profil, appareils, consentements, demandes de droits, personnel de My Hub, clés de service.
 */
import { z } from 'zod';
import { AGENT_CODES, CONSENT_PURPOSES, CONSENT_SOURCES, DATA_REQUEST_TYPES, DEVICE_PLATFORMS, LANGUAGES, STAFF_ROLES, USER_ROLES, USER_STATUSES } from '../enums.js';
import { isoDate, phoneE164, uuid } from './common.js';

export const otpCode = z.string().regex(/^\d{6}$/, 'Code à 6 chiffres attendu');
export const versionString = z.string().trim().min(1).max(20);

/** Appareil déclaré à la connexion ou par POST /v1/me/devices. */
export const deviceInputSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  pushToken: z.string().trim().min(10).max(300).optional(),
  appVersion: z.string().trim().max(20).optional(),
});
export type DeviceInput = z.infer<typeof deviceInputSchema>;

export const deviceSchema = z.object({
  id: uuid,
  platform: z.enum(DEVICE_PLATFORMS),
  pushToken: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: isoDate,
  createdAt: isoDate,
});

/** POST /v1/auth/otp/request */
export const otpRequestSchema = z.object({
  phone: phoneE164,
  /** Langue du texto ; par défaut celle de l'en-tête Accept-Language, sinon fr. */
  language: z.enum(LANGUAGES).optional(),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  /** Durée de validité du code, en secondes. */
  expiresIn: z.number().int(),
  /** Délai avant de pouvoir redemander un code, en secondes. */
  retryAfter: z.number().int(),
});

/** POST /v1/auth/otp/verify : crée le compte s'il n'existe pas (conditions et politique acceptées à la création). */
export const otpVerifySchema = z.object({
  phone: phoneE164,
  code: otpCode,
  device: deviceInputSchema.optional(),
  language: z.enum(LANGUAGES).optional(),
  /** Obligatoire à la création d'un compte : acceptation des conditions d'utilisation. */
  acceptTerms: z.boolean().optional(),
  /** Version de la politique de confidentialité acceptée (obligatoire à la création). */
  privacyPolicyVersion: versionString.optional(),
  /** Jeton de liaison remis par POST /v1/auth/apple ou /google quand le compte n'existait pas encore. */
  linkToken: z.string().max(2000).optional(),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/** POST /v1/auth/apple et POST /v1/auth/google */
export const socialLoginSchema = z.object({
  identityToken: z.string().min(10).max(4000),
  /** Nonce brut si l'application en a fourni un au fournisseur (haché par Apple). */
  nonce: z.string().max(200).optional(),
  device: deviceInputSchema.optional(),
  language: z.enum(LANGUAGES).optional(),
});
export type SocialLogin = z.infer<typeof socialLoginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(500) });
export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(500).optional(),
  /** Révoque toutes les sessions de l'utilisateur. */
  allDevices: z.boolean().default(false),
});

export const meSchema = z.object({
  id: uuid,
  phone: phoneE164,
  email: z.string().email().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  language: z.enum(LANGUAGES),
  primaryRole: z.enum(USER_ROLES),
  roles: z.array(z.enum(USER_ROLES)),
  status: z.enum(USER_STATUSES),
  termsAcceptedAt: isoDate.nullable(),
  privacyPolicyVersion: z.string().nullable(),
  /** Version en vigueur ; si elle diffère de `privacyPolicyVersion`, l'application redemande l'acceptation (5.15). */
  privacyPolicyCurrentVersion: z.string(),
  privacyPolicyAccepted: z.boolean(),
  linkedProviders: z.array(z.enum(['apple', 'google'])),
  mfaEnabled: z.boolean(),
  createdAt: isoDate,
});
export type MeView = z.infer<typeof meSchema>;

export const tokensSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  /** Durée de vie du jeton d'accès, en secondes. */
  expiresIn: z.number().int(),
  refreshToken: z.string(),
  /** Vrai quand le compte vient d'être créé. */
  created: z.boolean(),
  user: meSchema,
});
export type TokensView = z.infer<typeof tokensSchema>;

/** Réponse d'une connexion Apple ou Google : jetons, ou liaison à un téléphone vérifié requise. */
export const phoneRequiredSchema = z.object({
  status: z.literal('phone_required'),
  /** À renvoyer dans POST /v1/auth/otp/verify avec le code reçu par texto. */
  linkToken: z.string(),
  /** Courriel remis par le fournisseur, s'il y en a un (prérempli côté application). */
  email: z.string().email().nullable(),
});
export const socialLoginResponseSchema = z.union([tokensSchema, phoneRequiredSchema]);

/** PATCH /v1/me */
export const patchMeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  language: z.enum(LANGUAGES).optional(),
  /** Acceptation d'une nouvelle version de la politique de confidentialité. */
  privacyPolicyVersion: versionString.optional(),
}).refine((p) => Object.keys(p).length > 0, { message: 'Aucun champ à modifier' });
export type PatchMe = z.infer<typeof patchMeSchema>;

/** POST /v1/me/consents : accorde ou retire un consentement pour une finalité et une version. */
export const consentInputSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  version: versionString,
  granted: z.boolean(),
  source: z.enum(CONSENT_SOURCES).default('app'),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

export const consentViewSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  version: z.string().nullable(),
  grantedAt: isoDate.nullable(),
  withdrawnAt: isoDate.nullable(),
  source: z.string().nullable(),
});

const REQUESTABLE_TYPES = ['access', 'rectification', 'portability', 'consent_withdrawal'] as const satisfies ReadonlyArray<(typeof DATA_REQUEST_TYPES)[number]>;

/** POST /v1/me/data-requests : accès, rectification, portabilité, retrait de consentement (la suppression passe par DELETE /v1/me). */
export const dataRequestInputSchema = z.object({
  type: z.enum(REQUESTABLE_TYPES),
  /** Précisions du demandeur (rectification : champs à corriger). */
  details: z.string().trim().max(2000).optional(),
});
export type DataRequestInput = z.infer<typeof dataRequestInputSchema>;

export const dataRequestViewSchema = z.object({
  id: uuid,
  type: z.enum(DATA_REQUEST_TYPES),
  /** État à afficher (traduit par l'application) : en attente, ou traitée. */
  status: z.enum(['pending', 'processed']),
  receivedAt: isoDate,
  dueOn: z.string(),
  processedAt: isoDate.nullable(),
  /** Note d'exploitation (My Hub, en français), pas un texte d'interface. */
  outcome: z.string().nullable(),
  /** Liens signés vers l'export (accès et portabilité), présents une fois la demande traitée. */
  downloads: z.object({ json: z.string(), pdf: z.string(), expiresAt: isoDate }).nullable(),
});

export const deleteMeSchema = z.object({ reason: z.string().trim().max(500).optional() });

/** Personnel de My Hub : courriel et mot de passe, puis second facteur obligatoire. */
export const staffLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export const staffLoginResponseSchema = z.object({
  status: z.enum(['mfa_required', 'mfa_enrollment_required']),
  /** Jeton de passage (5 minutes) à présenter aux endpoints /auth/staff/mfa/*. */
  mfaToken: z.string(),
});

export const mfaTokenSchema = z.object({ mfaToken: z.string().min(10).max(2000) });
export const mfaCodeSchema = mfaTokenSchema.extend({ code: otpCode });
export const mfaBackupSchema = mfaTokenSchema.extend({ backupCode: z.string().trim().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i, 'Code de secours au format xxxx-xxxx') });

export const mfaEnrollmentSchema = z.object({
  /** Secret en base32, à saisir à la main si le QR ne peut être lu. */
  secret: z.string(),
  otpauthUri: z.string(),
  /** QR en SVG (chaîne), à afficher tel quel. */
  qrSvg: z.string(),
});

export const backupCodesSchema = z.object({
  /** Codes de secours affichés une seule fois. */
  backupCodes: z.array(z.string()),
});

/** Administration : création d'un membre du personnel (mot de passe initial à changer). */
export const staffCreateSchema = z.object({
  phone: phoneE164,
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  roles: z.array(z.enum(STAFF_ROLES)).min(1),
  password: z.string().min(12).max(200),
  language: z.enum(LANGUAGES).default('fr'),
});
export type StaffCreate = z.infer<typeof staffCreateSchema>;

export const staffPasswordSchema = z.object({ password: z.string().min(12).max(200) });

/** Clés de service (comptes de service des agents et intégrations, section 7.1). */
export const API_KEY_SCOPES = ['agents:run', 'agents:read', 'tools:*', 'rides:read', 'rides:write', 'drivers:read', 'reports:read', 'webhooks:write', 'public:write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  /** Agent qui utilise la clé, pour l'attribuer dans le journal d'audit. */
  agentCode: z.enum(AGENT_CODES).optional(),
  expiresAt: isoDate.optional(),
});
export type ApiKeyCreate = z.infer<typeof apiKeyCreateSchema>;

export const apiKeyViewSchema = z.object({
  id: uuid,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  agentCode: z.enum(AGENT_CODES).nullable(),
  expiresAt: isoDate.nullable(),
  lastUsedAt: isoDate.nullable(),
  revokedAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const apiKeyCreatedSchema = apiKeyViewSchema.extend({
  /** Secret complet, affiché une seule fois. */
  key: z.string(),
});

/** Réponse d'erreur unique de l'API (section 7.1). */
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  correlationId: z.string(),
});

// Types des réponses, pour les clients de l'API (applications, web).
export type ConsentView = z.infer<typeof consentViewSchema>;
export type DataRequestView = z.infer<typeof dataRequestViewSchema>;
export type DeviceView = z.infer<typeof deviceSchema>;
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;
export type SocialLoginResponse = z.infer<typeof socialLoginResponseSchema>;

// Types de la connexion du personnel, pour le client d'API.
export type StaffLogin = z.infer<typeof staffLoginSchema>;
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;
export type MfaEnrollment = z.infer<typeof mfaEnrollmentSchema>;
