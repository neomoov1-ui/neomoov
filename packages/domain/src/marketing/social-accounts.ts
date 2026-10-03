/**
 * Comptes des réseaux sociaux de Neomoov (chantier « Réseaux sociaux » du 3 octobre 2026) : les dix espaces que le
 * fondateur connecte dans My Hub, leur mode de connexion, leurs états, la forme des liens publics affichés sur la page
 * Contact de neomoov.net. Fonctions pures, sans dépendance d'infrastructure.
 *
 * Décision du fondateur (3 octobre 2026) : connexions directes seulement, aucun agrégateur. Le mode `aggregator` reste
 * dans l'énumération (contrat commun des agents) mais n'est jamais proposé. Snapchat et la chaîne WhatsApp n'ont pas
 * d'API de publication ouverte : relais manuel, lien public seulement. LinkedIn, TikTok et YouTube exigent une
 * approbation de l'application par le réseau : tant qu'elle n'est pas confirmée, l'espace est « en attente
 * d'approbation » et la publication passe par le relais manuel.
 */

/** Les dix espaces, dans l'ordre d'affichage (My Hub, page Contact). Mêmes codes que les autres agents du chantier. */
export const SOCIAL_SPACES = ['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel'] as const;
export type SocialSpace = (typeof SOCIAL_SPACES)[number];

/** `direct` : API officielle du réseau ; `manual` : la plateforme prépare, un humain publie ; `aggregator` : non retenu. */
export const SOCIAL_MODES = ['direct', 'aggregator', 'manual'] as const;
export type SocialMode = (typeof SOCIAL_MODES)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['not_connected', 'connected', 'invalid', 'expired', 'pending_approval'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

/**
 * Manière de relier le compte : `oauth` (écran d'autorisation du réseau, adresse de rappel de l'API), `telegram`
 * (jeton du bot et canal saisis dans My Hub), `wordpress` (variables du serveur, lecture seule), `manual` (lien public).
 */
export const SOCIAL_CONNECTIONS = ['oauth', 'telegram', 'wordpress', 'manual'] as const;
export type SocialConnection = (typeof SOCIAL_CONNECTIONS)[number];

/** Parcours OAuth : un seul parcours Meta donne la page Facebook ET le compte Instagram rattaché. */
export const SOCIAL_OAUTH_FLOWS = ['meta', 'linkedin', 'x', 'tiktok', 'google'] as const;
export type SocialOAuthFlow = (typeof SOCIAL_OAUTH_FLOWS)[number];

export interface SocialSpaceInfo {
  /** Nom affiché (page Contact, My Hub). */
  label: string;
  connection: SocialConnection;
  /** Modes proposés dans My Hub (jamais `aggregator`) ; au moins un, le premier sert par défaut. */
  modes: readonly [SocialMode, ...SocialMode[]];
  oauthFlow: SocialOAuthFlow | null;
  /** Espace dont l'adresse de rappel sert au parcours (Instagram passe par celle de Facebook). */
  callbackSpace: SocialSpace | null;
  /** Le réseau doit approuver l'application avant toute publication publique (examen, audit). */
  requiresApproval: boolean;
  /** Domaines admis pour le lien public (un lien saisi à la main doit pointer vers le réseau). */
  hosts: readonly string[];
}

export const SOCIAL_SPACE_INFO: Readonly<Record<SocialSpace, SocialSpaceInfo>> = {
  site_blog: { label: 'Blogue', connection: 'wordpress', modes: ['direct'], oauthFlow: null, callbackSpace: null, requiresApproval: false, hosts: ['neomoov.net'] },
  facebook: { label: 'Facebook', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'meta', callbackSpace: 'facebook', requiresApproval: false, hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  instagram: { label: 'Instagram', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'meta', callbackSpace: 'facebook', requiresApproval: false, hosts: ['instagram.com'] },
  linkedin: { label: 'LinkedIn', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'linkedin', callbackSpace: 'linkedin', requiresApproval: true, hosts: ['linkedin.com'] },
  x: { label: 'X', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'x', callbackSpace: 'x', requiresApproval: false, hosts: ['x.com', 'twitter.com'] },
  tiktok: { label: 'TikTok', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'tiktok', callbackSpace: 'tiktok', requiresApproval: true, hosts: ['tiktok.com'] },
  snapchat: { label: 'Snapchat', connection: 'manual', modes: ['manual'], oauthFlow: null, callbackSpace: null, requiresApproval: false, hosts: ['snapchat.com'] },
  telegram: { label: 'Telegram', connection: 'telegram', modes: ['direct', 'manual'], oauthFlow: null, callbackSpace: null, requiresApproval: false, hosts: ['t.me', 'telegram.me'] },
  youtube: { label: 'YouTube', connection: 'oauth', modes: ['direct', 'manual'], oauthFlow: 'google', callbackSpace: 'youtube', requiresApproval: true, hosts: ['youtube.com', 'youtu.be'] },
  whatsapp_channel: { label: 'Chaîne WhatsApp', connection: 'manual', modes: ['manual'], oauthFlow: null, callbackSpace: null, requiresApproval: false, hosts: ['whatsapp.com'] },
};

export function isSocialSpace(value: string): value is SocialSpace {
  return (SOCIAL_SPACES as readonly string[]).includes(value);
}

/** Mode par défaut d'un espace sans réglage : direct quand le réseau le permet, sinon relais manuel. */
export function defaultSocialMode(space: SocialSpace): SocialMode {
  return SOCIAL_SPACE_INFO[space].modes[0];
}

/** Adresse de rappel OAuth à déclarer chez le réseau : `<api>/v1/social/oauth/callback/<espace>`. */
export function socialCallbackUrl(apiBaseUrl: string, space: SocialSpace): string | null {
  const target = SOCIAL_SPACE_INFO[space].callbackSpace;
  return target ? `${apiBaseUrl.replace(/\/+$/, '')}/v1/social/oauth/callback/${target}` : null;
}

/**
 * État affiché d'un compte : en mode manuel, relié dès qu'un lien public est enregistré ; en mode direct, l'état
 * de la dernière validation, sauf qu'un réseau à approbation reste `pending_approval` tant que le fondateur n'a pas
 * confirmé l'approbation de l'application.
 */
export function effectiveSocialStatus(input: { space: SocialSpace; mode: SocialMode; validation: SocialAccountStatus; profileUrl: string | null; appApproved: boolean }): SocialAccountStatus {
  if (input.mode === 'manual') return input.profileUrl ? 'connected' : 'not_connected';
  if (SOCIAL_SPACE_INFO[input.space].requiresApproval && !input.appApproved) return 'pending_approval';
  return input.validation === 'pending_approval' ? 'not_connected' : input.validation;
}

/** Canal Telegram saisi (`@nom`, `t.me/nom`, `https://t.me/nom`, identifiant `-100…`) ; null si la forme est inacceptable. */
export function normalizeTelegramChannel(raw: string): string | null {
  const value = raw.trim();
  if (/^-100\d{5,15}$/.test(value)) return value;
  const match = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/|@)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/.exec(value);
  return match ? `@${match[1]}` : null;
}

/** Lien public acceptable pour l'espace : https, sur un domaine du réseau (ou un de ses sous-domaines). */
export function isSocialProfileUrl(space: SocialSpace, raw: string): boolean {
  // Sans `URL` (domaine pur, sans types du navigateur ni de Node) : autorité sans identifiants, port facultatif.
  const match = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.exec(raw.trim());
  if (!match) return false;
  const host = match[1]!.toLowerCase();
  return SOCIAL_SPACE_INFO[space].hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export interface SocialLinkCandidate {
  space: SocialSpace;
  status: SocialAccountStatus;
  showOnSite: boolean;
  profileUrl: string | null;
}

export interface SocialLink {
  space: SocialSpace;
  label: string;
  url: string;
}

/** Liens de la page Contact : comptes reliés et validés, cochés « afficher sur le site », dans l'ordre des espaces. */
export function publicSocialLinks(rows: readonly SocialLinkCandidate[]): SocialLink[] {
  const bySpace = new Map(rows.map((row) => [row.space, row]));
  const links: SocialLink[] = [];
  for (const space of SOCIAL_SPACES) {
    const row = bySpace.get(space);
    if (!row || row.status !== 'connected' || !row.showOnSite || !row.profileUrl || !isSocialProfileUrl(space, row.profileUrl)) continue;
    links.push({ space, label: SOCIAL_SPACE_INFO[space].label, url: row.profileUrl });
  }
  return links;
}
