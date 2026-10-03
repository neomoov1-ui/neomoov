/**
 * Appels aux réseaux pour l'espace « Réseaux sociaux » de My Hub (3 octobre 2026), sans SDK : écrans d'autorisation
 * OAuth 2.0 (Meta, LinkedIn, X, TikTok, Google pour YouTube), échange du code, rafraîchissement des jetons, découverte
 * des comptes (pages Facebook et comptes Instagram rattachés, pages LinkedIn administrées, chaîne YouTube…), et
 * validation légère d'un compte relié (appel en lecture seule). `fetch` est injecté : les essais passent par un
 * simulateur HTTP. Aucune valeur secrète dans les messages d'erreur (l'adresse d'un appel Telegram contient le jeton :
 * elle n'est jamais citée).
 */
import { createHash } from 'node:crypto';
import { SOCIAL_SPACE_INFO, type SocialOAuthFlow, type SocialSpace } from '@neomoov/domain';
import type { AppEnv } from '../../config/env.js';

export type SocialFetch = typeof fetch;

/** `invalid` : identifiant refusé (à reconnecter) ; `expired` : autorisation échue ; `transient` : panne, réessayer ; `config` : réglage manquant. */
export type SocialErrorKind = 'invalid' | 'expired' | 'transient' | 'config';

export class SocialNetworkError extends Error {
  constructor(readonly kind: SocialErrorKind, message: string) {
    super(message);
    this.name = 'SocialNetworkError';
  }
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  scopes: string[];
  /** Identifiant renvoyé avec le jeton (TikTok : `open_id`). */
  subject: string | null;
}

/** Compte trouvé après l'autorisation, avec ses valeurs (jetons compris : gardés chiffrés, jamais rendus). */
export interface DiscoveredAccount {
  space: SocialSpace;
  accountId: string;
  accountName: string;
  profileUrl: string | null;
  detail: string | null;
  values: Record<string, string>;
}

export interface ValidatedAccount {
  accountId: string;
  accountName: string;
  profileUrl: string | null;
}

/** Variables d'environnement des identifiants d'application, par parcours (noms seulement). */
export const FLOW_VARIABLES: Readonly<Record<SocialOAuthFlow, readonly [string, string]>> = {
  meta: ['META_APP_ID', 'META_APP_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  google: ['GOOGLE_SOCIAL_CLIENT_ID', 'GOOGLE_SOCIAL_CLIENT_SECRET'],
};

export function oauthApp(env: AppEnv, flow: SocialOAuthFlow): OAuthApp | null {
  const pair: Record<SocialOAuthFlow, [string | undefined, string | undefined]> = {
    meta: [env.META_APP_ID, env.META_APP_SECRET],
    linkedin: [env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET],
    x: [env.X_CLIENT_ID, env.X_CLIENT_SECRET],
    tiktok: [env.TIKTOK_CLIENT_KEY, env.TIKTOK_CLIENT_SECRET],
    google: [env.GOOGLE_SOCIAL_CLIENT_ID ?? env.YOUTUBE_CLIENT_ID, env.GOOGLE_SOCIAL_CLIENT_SECRET ?? env.YOUTUBE_CLIENT_SECRET],
  };
  const [clientId, clientSecret] = pair[flow];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Droits demandés à chaque réseau (publier, lire les commentaires et y répondre, lire les mesures). */
export const FLOW_SCOPES: Readonly<Record<SocialOAuthFlow, readonly string[]>> = {
  meta: [
    'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content', 'pages_messaging', 'business_management',
    'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages',
  ],
  linkedin: ['r_organization_social', 'w_organization_social', 'rw_organization_admin'],
  x: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'],
  tiktok: ['user.info.basic', 'user.info.profile', 'video.publish', 'video.upload'],
  google: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'],
};

/** Parcours dont l'écran d'autorisation exige PKCE (X) ou l'accepte (Google). */
const PKCE_FLOWS: readonly SocialOAuthFlow[] = ['x', 'google'];

export const NETWORK_URLS = {
  facebookDialog: 'https://www.facebook.com',
  graph: 'https://graph.facebook.com',
  linkedinAuth: 'https://www.linkedin.com/oauth/v2',
  linkedinRest: 'https://api.linkedin.com/rest',
  xAuthorize: 'https://x.com/i/oauth2/authorize',
  xApi: 'https://api.x.com/2',
  tiktokAuthorize: 'https://www.tiktok.com/v2/auth/authorize/',
  tiktokApi: 'https://open.tiktokapis.com/v2',
  googleAuthorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  googleToken: 'https://oauth2.googleapis.com/token',
  youtubeApi: 'https://www.googleapis.com/youtube/v3',
  telegramApi: 'https://api.telegram.org',
} as const;

export interface NetworkOptions {
  fetch: SocialFetch;
  graphVersion: string;
  linkedinVersion: string;
  timeoutMs?: number;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Adresse de l'écran d'autorisation du réseau. */
export function authorizeUrl(flow: SocialOAuthFlow, input: { app: OAuthApp; redirectUri: string; state: string; codeVerifier: string; graphVersion: string }): string {
  const scopes = FLOW_SCOPES[flow];
  let url: URL;
  switch (flow) {
    case 'meta':
      url = new URL(`${NETWORK_URLS.facebookDialog}/${input.graphVersion}/dialog/oauth`);
      url.searchParams.set('client_id', input.app.clientId);
      url.searchParams.set('scope', scopes.join(','));
      break;
    case 'linkedin':
      url = new URL(`${NETWORK_URLS.linkedinAuth}/authorization`);
      url.searchParams.set('client_id', input.app.clientId);
      url.searchParams.set('scope', scopes.join(' '));
      break;
    case 'x':
      url = new URL(NETWORK_URLS.xAuthorize);
      url.searchParams.set('client_id', input.app.clientId);
      url.searchParams.set('scope', scopes.join(' '));
      break;
    case 'tiktok':
      url = new URL(NETWORK_URLS.tiktokAuthorize);
      url.searchParams.set('client_key', input.app.clientId);
      url.searchParams.set('scope', scopes.join(','));
      break;
    case 'google':
      url = new URL(NETWORK_URLS.googleAuthorize);
      url.searchParams.set('client_id', input.app.clientId);
      url.searchParams.set('scope', scopes.join(' '));
      // Jeton de rafraîchissement à chaque autorisation (sinon Google ne le redonne qu'à la première).
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
      break;
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  if (PKCE_FLOWS.includes(flow)) {
    url.searchParams.set('code_challenge', pkceChallenge(input.codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

const seconds = (value: unknown): Date | null => (typeof value === 'number' && value > 0 ? new Date(Date.now() + value * 1000) : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null);

/** Appel HTTP : JSON lu, erreurs classées (jamais l'adresse appelée ni une valeur secrète dans le message). */
async function call<T>(options: NetworkOptions, label: string, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await options.fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
  } catch {
    throw new SocialNetworkError('transient', `${label} : réseau injoignable`);
  }
  const body = (await res.json().catch(() => ({}))) as T & Record<string, unknown>;
  if (res.ok && !(label.startsWith('Telegram') && (body as { ok?: boolean }).ok === false)) return body;
  throw classify(label, res.status, body);
}

function classify(label: string, status: number, body: Record<string, unknown>): SocialNetworkError {
  const error = body['error'];
  const meta = error && typeof error === 'object' ? (error as { code?: number; error_subcode?: number; message?: string }) : null;
  // Meta : 190 jeton invalide (sous-code 463 : expiré), 10 et 200 à 299 droits manquants.
  if (meta?.code === 190) return new SocialNetworkError(meta.error_subcode === 463 ? 'expired' : 'invalid', `${label} : jeton refusé (${meta.error_subcode === 463 ? 'expiré' : 'révoqué ou invalide'}), reconnecter le compte`);
  if (meta?.code === 10 || (meta?.code && meta.code >= 200 && meta.code < 300)) return new SocialNetworkError('invalid', `${label} : droit manquant (${meta.code}) ; reconnecter en acceptant toutes les autorisations`);
  const description = str(body['description']) ?? str(body['error_description']) ?? str(body['message']) ?? (typeof error === 'string' ? error : null) ?? (meta?.message ?? null);
  const detail = description ? ` : ${description.replace(/\d{5,15}:[A-Za-z0-9_-]{30,64}/g, '[jeton]').slice(0, 160)}` : '';
  if (status === 429 || status >= 500) return new SocialNetworkError('transient', `${label} : réseau indisponible ou limite atteinte (${status})${detail}`);
  if (error === 'invalid_grant') return new SocialNetworkError('expired', `${label} : autorisation échue ou révoquée, reconnecter le compte${detail}`);
  if (status === 401 || status === 403 || status === 400 || status === 404) return new SocialNetworkError('invalid', `${label} : refusé (${status})${detail}`);
  return new SocialNetworkError('transient', `${label} : réponse inattendue (${status})${detail}`);
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };

function tokensFrom(body: Record<string, unknown>): OAuthTokens {
  const accessToken = str(body['access_token']);
  if (!accessToken) throw new SocialNetworkError('invalid', 'Réponse d\'autorisation sans jeton d\'accès');
  const scope = str(body['scope']);
  return {
    accessToken,
    refreshToken: str(body['refresh_token']),
    accessExpiresAt: seconds(body['expires_in']),
    refreshExpiresAt: seconds(body['refresh_token_expires_in'] ?? body['refresh_expires_in']),
    scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : [],
    subject: str(body['open_id']),
  };
}

/** Échange du code d'autorisation contre les jetons (Meta : jeton long de 60 jours). */
export async function exchangeCode(flow: SocialOAuthFlow, options: NetworkOptions, input: { app: OAuthApp; code: string; redirectUri: string; codeVerifier: string }): Promise<OAuthTokens> {
  const { app, code, redirectUri, codeVerifier } = input;
  switch (flow) {
    case 'meta': {
      const graph = `${NETWORK_URLS.graph}/${options.graphVersion}/oauth/access_token`;
      const short = await call<Record<string, unknown>>(options, 'Meta', `${graph}?${form({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code })}`);
      const shortToken = str(short['access_token']);
      if (!shortToken) throw new SocialNetworkError('invalid', 'Meta : réponse sans jeton');
      const long = await call<Record<string, unknown>>(options, 'Meta', `${graph}?${form({ grant_type: 'fb_exchange_token', client_id: app.clientId, client_secret: app.clientSecret, fb_exchange_token: shortToken })}`);
      return tokensFrom(long);
    }
    case 'linkedin':
      return tokensFrom(await call(options, 'LinkedIn', `${NETWORK_URLS.linkedinAuth}/accessToken`, { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret }) }));
    case 'x':
      return tokensFrom(await call(options, 'X', `${NETWORK_URLS.xApi}/oauth2/token`, {
        method: 'POST', headers: { ...FORM, authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}` },
        body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: app.clientId }),
      }));
    case 'tiktok':
      return tokensFrom(await call(options, 'TikTok', `${NETWORK_URLS.tiktokApi}/oauth/token/`, { method: 'POST', headers: FORM, body: form({ client_key: app.clientId, client_secret: app.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) }));
    case 'google':
      return tokensFrom(await call(options, 'Google', NETWORK_URLS.googleToken, { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret, code_verifier: codeVerifier }) }));
  }
}

/** Rafraîchissement d'un jeton d'accès (LinkedIn, X, TikTok, Google). X et TikTok peuvent changer le jeton de rafraîchissement. */
export async function refreshTokens(flow: SocialOAuthFlow, options: NetworkOptions, input: { app: OAuthApp; refreshToken: string }): Promise<OAuthTokens> {
  const { app, refreshToken } = input;
  let tokens: OAuthTokens;
  switch (flow) {
    case 'linkedin':
      tokens = tokensFrom(await call(options, 'LinkedIn', `${NETWORK_URLS.linkedinAuth}/accessToken`, { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }) }));
      break;
    case 'x':
      tokens = tokensFrom(await call(options, 'X', `${NETWORK_URLS.xApi}/oauth2/token`, {
        method: 'POST', headers: { ...FORM, authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}` },
        body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId }),
      }));
      break;
    case 'tiktok':
      tokens = tokensFrom(await call(options, 'TikTok', `${NETWORK_URLS.tiktokApi}/oauth/token/`, { method: 'POST', headers: FORM, body: form({ client_key: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) }));
      break;
    case 'google':
      tokens = tokensFrom(await call(options, 'Google', NETWORK_URLS.googleToken, { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }) }));
      break;
    case 'meta':
      throw new SocialNetworkError('config', 'Meta : le jeton de page n\'expire pas, aucun rafraîchissement');
  }
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, accept: 'application/json', ...extra });
const linkedinHeaders = (token: string, version: string) => bearer(token, { 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' });
const linkedinOrgId = (urn: string) => urn.replace(/^urn:li:organization:/, '');

type MetaPage = { id: string; name: string; link?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } };

/** Comptes trouvés après l'autorisation : un ou plusieurs (choix dans My Hub si plusieurs). */
export async function discoverAccounts(flow: SocialOAuthFlow, options: NetworkOptions, tokens: OAuthTokens): Promise<DiscoveredAccount[]> {
  const tokenValues = (): Record<string, string> => ({
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.accessExpiresAt ? { accessTokenExpiresAt: tokens.accessExpiresAt.toISOString() } : {}),
  });
  switch (flow) {
    case 'meta': {
      const url = `${NETWORK_URLS.graph}/${options.graphVersion}/me/accounts?${form({ fields: 'id,name,link,access_token,instagram_business_account{id,username}', limit: '100', access_token: tokens.accessToken })}`;
      const body = await call<{ data?: MetaPage[] }>(options, 'Meta', url);
      const accounts: DiscoveredAccount[] = [];
      for (const page of body.data ?? []) {
        if (!page.access_token) continue;
        const ig = page.instagram_business_account;
        accounts.push({
          space: 'facebook', accountId: page.id, accountName: page.name, profileUrl: page.link ?? `https://www.facebook.com/${page.id}`,
          detail: ig?.username ? `Instagram : @${ig.username}` : 'Aucun compte Instagram professionnel rattaché',
          values: { pageId: page.id, pageToken: page.access_token, ...(ig?.id ? { igUserId: ig.id } : {}), ...(ig?.username ? { igUsername: ig.username } : {}) },
        });
      }
      return accounts;
    }
    case 'linkedin': {
      const acls = await call<{ elements?: Array<{ organization?: string; organizationTarget?: string }> }>(options, 'LinkedIn', `${NETWORK_URLS.linkedinRest}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=20`, { headers: linkedinHeaders(tokens.accessToken, options.linkedinVersion) });
      const ids = [...new Set((acls.elements ?? []).map((e) => e.organization ?? e.organizationTarget).filter((v): v is string => Boolean(v)).map(linkedinOrgId))].slice(0, 10);
      const accounts: DiscoveredAccount[] = [];
      for (const id of ids) {
        const org = await linkedinOrganization(options, tokens.accessToken, id);
        accounts.push({ space: 'linkedin', accountId: id, accountName: org.accountName, profileUrl: org.profileUrl, detail: null, values: { ...tokenValues(), organizationId: id } });
      }
      return accounts;
    }
    case 'x': {
      const me = await xMe(options, tokens.accessToken);
      return [{ space: 'x', ...me, detail: null, values: tokenValues() }];
    }
    case 'tiktok': {
      const me = await tiktokMe(options, tokens.accessToken);
      return [{ space: 'tiktok', ...me, detail: null, values: { ...tokenValues(), openId: tokens.subject ?? me.accountId } }];
    }
    case 'google': {
      const channel = await youtubeChannel(options, tokens.accessToken);
      return [{ space: 'youtube', ...channel, detail: null, values: { ...tokenValues(), channelId: channel.accountId } }];
    }
  }
}

async function linkedinOrganization(options: NetworkOptions, token: string, id: string): Promise<ValidatedAccount> {
  const org = await call<{ localizedName?: string; vanityName?: string }>(options, 'LinkedIn', `${NETWORK_URLS.linkedinRest}/organizations/${encodeURIComponent(id)}`, { headers: linkedinHeaders(token, options.linkedinVersion) });
  return { accountId: id, accountName: org.localizedName ?? `Organisation ${id}`, profileUrl: `https://www.linkedin.com/company/${org.vanityName ?? id}/` };
}

async function xMe(options: NetworkOptions, token: string): Promise<ValidatedAccount> {
  const me = await call<{ data?: { id: string; name?: string; username?: string } }>(options, 'X', `${NETWORK_URLS.xApi}/users/me?user.fields=username,name`, { headers: bearer(token) });
  if (!me.data?.id) throw new SocialNetworkError('invalid', 'X : compte introuvable');
  return { accountId: me.data.id, accountName: me.data.name ?? me.data.username ?? me.data.id, profileUrl: me.data.username ? `https://x.com/${me.data.username}` : null };
}

async function tiktokMe(options: NetworkOptions, token: string): Promise<ValidatedAccount> {
  const me = await call<{ data?: { user?: { open_id?: string; display_name?: string; username?: string } }; error?: { code?: string; message?: string } }>(options, 'TikTok', `${NETWORK_URLS.tiktokApi}/user/info/?fields=open_id,display_name,username`, { headers: bearer(token) });
  if (me.error?.code && me.error.code !== 'ok') throw new SocialNetworkError(me.error.code === 'access_token_invalid' ? 'expired' : 'invalid', `TikTok : ${me.error.code}`);
  const user = me.data?.user;
  if (!user?.open_id) throw new SocialNetworkError('invalid', 'TikTok : compte introuvable');
  return { accountId: user.open_id, accountName: user.display_name ?? user.username ?? user.open_id, profileUrl: user.username ? `https://www.tiktok.com/@${user.username}` : null };
}

async function youtubeChannel(options: NetworkOptions, token: string): Promise<ValidatedAccount> {
  const body = await call<{ items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> }>(options, 'YouTube', `${NETWORK_URLS.youtubeApi}/channels?part=snippet&mine=true`, { headers: bearer(token) });
  const channel = body.items?.[0];
  if (!channel) throw new SocialNetworkError('invalid', 'YouTube : aucune chaîne sur ce compte Google (créer la chaîne, puis reconnecter)');
  const handle = channel.snippet?.customUrl;
  return { accountId: channel.id, accountName: channel.snippet?.title ?? channel.id, profileUrl: handle ? `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}` : `https://www.youtube.com/channel/${channel.id}` };
}

type TelegramChat = { id: number; type: string; title?: string; username?: string; invite_link?: string };

/**
 * Telegram : le bot existe (`getMe`), le canal existe (`getChat`), et le bot en est administrateur avec le droit de
 * publier (`getChatMember`). Adresse publique : `t.me/<nom>` pour un canal public, sinon le lien d'invitation.
 */
export async function validateTelegram(options: NetworkOptions, input: { botToken: string; channel: string }): Promise<ValidatedAccount & { botUsername: string | null }> {
  const base = `${NETWORK_URLS.telegramApi}/bot${input.botToken}`;
  const me = await call<{ result?: { id: number; username?: string } }>(options, 'Telegram (bot)', `${base}/getMe`);
  if (!me.result?.id) throw new SocialNetworkError('invalid', 'Telegram (bot) : jeton refusé');
  const chat = await call<{ result?: TelegramChat }>(options, 'Telegram (canal)', `${base}/getChat?${form({ chat_id: input.channel })}`);
  const result = chat.result;
  if (!result) throw new SocialNetworkError('invalid', 'Telegram (canal) : canal introuvable ; ajouter d\'abord le bot comme administrateur du canal');
  if (result.type !== 'channel') throw new SocialNetworkError('invalid', `Telegram (canal) : « ${result.title ?? input.channel} » n'est pas un canal (type ${result.type})`);
  const member = await call<{ result?: { status?: string; can_post_messages?: boolean } }>(options, 'Telegram (droits)', `${base}/getChatMember?${form({ chat_id: String(result.id), user_id: String(me.result.id) })}`);
  const status = member.result?.status;
  if (status !== 'administrator' && status !== 'creator') throw new SocialNetworkError('invalid', 'Telegram (droits) : le bot n\'est pas administrateur du canal');
  if (status === 'administrator' && member.result?.can_post_messages === false) throw new SocialNetworkError('invalid', 'Telegram (droits) : le bot est administrateur sans le droit « Publier des messages »');
  return {
    accountId: String(result.id), accountName: result.title ?? input.channel,
    profileUrl: result.username ? `https://t.me/${result.username}` : (result.invite_link ?? null), botUsername: me.result.username ?? null,
  };
}

/** Blogue : l'utilisateur WordPress et son mot de passe d'application ouvrent `wp/v2/users/me`. */
export async function validateWordPress(options: NetworkOptions, input: { url: string; user: string; appPassword: string }): Promise<ValidatedAccount> {
  const base = input.url.replace(/\/+$/, '');
  const me = await call<{ id?: number; name?: string }>(options, 'WordPress', `${base}/wp-json/wp/v2/users/me?context=edit`, { headers: { authorization: `Basic ${Buffer.from(`${input.user}:${input.appPassword}`).toString('base64')}`, accept: 'application/json' } });
  return { accountId: String(me.id ?? input.user), accountName: me.name ?? input.user, profileUrl: base };
}

/** Validation légère d'un compte relié en mode direct, par réseau (lecture seule). */
export async function validateAccount(space: SocialSpace, options: NetworkOptions, values: Record<string, string>): Promise<ValidatedAccount> {
  const need = (key: string) => {
    const value = values[key];
    if (!value) throw new SocialNetworkError('invalid', `${SOCIAL_SPACE_INFO[space].label} : valeur ${key} absente, reconnecter le compte`);
    return value;
  };
  switch (space) {
    case 'facebook': {
      const page = await call<{ id: string; name?: string; link?: string }>(options, 'Facebook', `${NETWORK_URLS.graph}/${options.graphVersion}/${encodeURIComponent(need('pageId'))}?${form({ fields: 'id,name,link', access_token: need('pageToken') })}`);
      return { accountId: page.id, accountName: page.name ?? page.id, profileUrl: page.link ?? `https://www.facebook.com/${page.id}` };
    }
    case 'instagram': {
      const ig = await call<{ id: string; username?: string; name?: string }>(options, 'Instagram', `${NETWORK_URLS.graph}/${options.graphVersion}/${encodeURIComponent(need('igUserId'))}?${form({ fields: 'id,username,name', access_token: need('pageToken') })}`);
      return { accountId: ig.id, accountName: ig.username ? `@${ig.username}` : (ig.name ?? ig.id), profileUrl: ig.username ? `https://www.instagram.com/${ig.username}/` : null };
    }
    case 'linkedin':
      return linkedinOrganization(options, need('accessToken'), need('organizationId'));
    case 'x':
      return xMe(options, need('accessToken'));
    case 'tiktok':
      return tiktokMe(options, need('accessToken'));
    case 'youtube':
      return youtubeChannel(options, need('accessToken'));
    case 'telegram':
      return validateTelegram(options, { botToken: need('botToken'), channel: need('channelId') });
    case 'site_blog':
      return validateWordPress(options, { url: need('url'), user: need('user'), appPassword: need('appPassword') });
    case 'snapchat':
    case 'whatsapp_channel':
      throw new SocialNetworkError('config', `${SOCIAL_SPACE_INFO[space].label} : relais manuel seulement, aucune validation par API`);
  }
}
