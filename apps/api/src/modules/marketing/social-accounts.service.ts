/**
 * Espace « Réseaux sociaux » de My Hub (3 octobre 2026) : les dix comptes de Neomoov, leur connexion (écran
 * d'autorisation OAuth avec `state` signé et PKCE, formulaire Telegram, lien public des relais manuels, état du blogue en
 * lecture seule), le choix de la page quand l'autorisation en donne plusieurs, la revalidation, la déconnexion, le mode
 * (direct ou relais manuel), l'approbation de l'application (LinkedIn, TikTok, YouTube) et les liens publics de la page
 * Contact. Passe quotidienne : validation de chaque compte relié, alerte au personnel (refus, échéance proche).
 * Aucune valeur secrète ne sort de ce service : ni dans les vues, ni dans le journal d'audit, ni dans les erreurs.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  defaultSocialMode, isSocialProfileUrl, normalizeTelegramChannel, publicSocialLinks, socialCallbackUrl, SOCIAL_SPACE_INFO, SOCIAL_SPACES,
  type SocialAccountUpdateInput, type SocialAccountView, type SocialConnectStart, type SocialLinksView, type SocialOAuthFlow, type SocialSpace, type SocialTelegramConnectInput,
} from '@neomoov/domain';
import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { SocialAccountsRegistry, type SocialAccountRow, type SocialStatusEvent } from './social-accounts.registry.js';
import { authorizeUrl, discoverAccounts, exchangeCode, FLOW_VARIABLES, oauthApp, SocialNetworkError, validateTelegram, type DiscoveredAccount } from './social-networks.js';

/** Durée de validité d'un `state` OAuth : le temps de passer l'écran d'autorisation du réseau. */
const STATE_TTL_SECONDS = 15 * 60;
const LINKS_CACHE_MS = 10 * 60_000;
const STATE_LABEL = 'neomoov:social-oauth:v1';

interface StatePayload {
  /** Espace demandé (Instagram passe par le parcours Meta de Facebook). */
  s: SocialSpace;
  f: SocialOAuthFlow;
  u: string;
  n: string;
  x: number;
}

type Actor = Pick<UserActor, 'userId'>;

@Injectable()
export class SocialAccountsService implements OnModuleInit {
  private readonly stateKey: Buffer;
  private linksCache: { at: number; value: SocialLinksView } | null = null;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly registry: SocialAccountsRegistry,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {
    // Clé propre aux `state` OAuth, dérivée de ENCRYPTION_KEY (jamais la clé brute) ; valeur de développement hors production.
    this.stateKey = Buffer.from(hkdfSync('sha256', env.ENCRYPTION_KEY ?? 'dev-encryption-key-non-secret-32b', Buffer.alloc(0), STATE_LABEL, 32));
  }

  onModuleInit() {
    this.registry.onStatusChange((event) => void this.alert(event));
  }

  private async alert(event: SocialStatusEvent): Promise<void> {
    this.linksCache = null;
    const label = SOCIAL_SPACE_INFO[event.space].label;
    const summary = `${label} : compte ${event.status === 'expired' ? 'échu' : 'refusé'} par le réseau, à reconnecter dans My Hub, Réseaux sociaux${event.reason ? ` (${event.reason.slice(0, 160)})` : ''}`;
    try {
      await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'social_account_invalid', summary, space: event.space });
    } catch (error) {
      this.logger.error({ err: error, space: event.space }, 'Alerte du compte de réseau impossible');
    }
  }

  // --- Vues ----------------------------------------------------------------------------------------------------------

  private apiBase(): string {
    return this.env.APP_BASE_URL.replace(/\/+$/, '');
  }

  private hubUrl(query: Record<string, string>): string {
    return `${this.env.WEB_BASE_URL.replace(/\/+$/, '')}/hub/reseaux?${new URLSearchParams(query).toString()}`;
  }

  private appVariables(space: SocialSpace): string[] {
    const info = SOCIAL_SPACE_INFO[space];
    if (info.oauthFlow) return [...FLOW_VARIABLES[info.oauthFlow]];
    if (info.connection === 'wordpress') return ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'];
    return [];
  }

  private async toView(space: SocialSpace, row: SocialAccountRow | null): Promise<SocialAccountView> {
    const info = SOCIAL_SPACE_INFO[space];
    const sealed = this.registry.sealed(row);
    const direct = info.connection === 'manual' ? null : await this.registry.directValues(space, row);
    const appConfigured = info.oauthFlow ? Boolean(oauthApp(this.env, info.oauthFlow)) : info.connection === 'wordpress' ? Boolean(direct) : true;
    const mode = row?.mode ?? defaultSocialMode(space);
    return {
      space,
      label: info.label,
      connection: info.connection,
      mode: mode as SocialAccountView['mode'],
      modes: [...info.modes],
      status: (row?.status ?? (!this.registry.approved(space, null) && mode !== 'manual' ? 'pending_approval' : 'not_connected')) as SocialAccountView['status'],
      accountId: row?.accountId ?? null,
      accountName: row?.accountName ?? null,
      profileUrl: row?.profileUrl ?? null,
      showOnSite: row?.showOnSite ?? true,
      requiresApproval: info.requiresApproval,
      appApproved: this.registry.approved(space, row) && info.requiresApproval,
      appConfigured,
      appVariables: this.appVariables(space),
      callbackUrl: socialCallbackUrl(this.apiBase(), space),
      credentialSource: direct?.source ?? 'none',
      scopes: Array.isArray(row?.scopes) ? (row!.scopes as string[]) : [],
      expiresAt: row?.expiresAt?.toISOString() ?? null,
      lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      candidates: (sealed.candidates ?? []).map((c) => ({ id: c.accountId, name: c.accountName, detail: c.detail })),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async list(): Promise<SocialAccountView[]> {
    const rows = new Map((await this.registry.rows()).map((r) => [r.space as SocialSpace, r]));
    return Promise.all(SOCIAL_SPACES.map((space) => this.toView(space, rows.get(space) ?? null)));
  }

  async view(space: SocialSpace): Promise<SocialAccountView> {
    return this.toView(space, await this.registry.row(space));
  }

  // --- Parcours OAuth ------------------------------------------------------------------------------------------------

  private sign(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.stateKey).update(body).digest('base64url')}`;
  }

  /** Vérifie le `state` rendu par le réseau : signature, échéance, espace de l'adresse de rappel. */
  private verifyState(state: string | undefined, callbackSpace: SocialSpace): StatePayload {
    const [body, signature] = (state ?? '').split('.');
    const invalid = () => new AppError('SOCIAL_OAUTH_STATE_INVALID', 'Autorisation refusée : paramètre state absent, modifié ou expiré. Recommencez depuis My Hub, Réseaux sociaux.', HttpStatus.BAD_REQUEST);
    if (!body || !signature) throw invalid();
    const expected = Buffer.from(createHmac('sha256', this.stateKey).update(body).digest('base64url'));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      throw invalid();
    }
    if (typeof payload.x !== 'number' || payload.x < Math.floor(Date.now() / 1000)) throw invalid();
    if (!SOCIAL_SPACES.includes(payload.s) || SOCIAL_SPACE_INFO[payload.s].callbackSpace !== callbackSpace) throw invalid();
    return payload;
  }

  /** Vérificateur PKCE dérivé du `state` (aucun stockage) : 43 caractères, comme l'exige la norme. */
  private codeVerifier(nonce: string): string {
    return createHmac('sha256', this.stateKey).update(`pkce.${nonce}`).digest('base64url');
  }

  /** Adresse de l'écran d'autorisation du réseau, à ouvrir dans le navigateur ; l'adresse de rappel est rendue pour contrôle. */
  startConnect(space: SocialSpace, actor: Actor): SocialConnectStart {
    const info = SOCIAL_SPACE_INFO[space];
    if (!info.oauthFlow || !info.callbackSpace) throw new AppError('SOCIAL_CONNECTION_KIND', `${info.label} ne se connecte pas par un écran d'autorisation (${info.connection === 'telegram' ? 'formulaire du bot' : info.connection === 'wordpress' ? 'variables du serveur' : 'lien public'}).`, HttpStatus.BAD_REQUEST);
    const app = oauthApp(this.env, info.oauthFlow);
    if (!app) throw new AppError('SOCIAL_APP_NOT_CONFIGURED', `${info.label} : identifiants de l'application absents du serveur (${FLOW_VARIABLES[info.oauthFlow].join(', ')}). Suivre « Comment connecter ».`, HttpStatus.CONFLICT, { variables: FLOW_VARIABLES[info.oauthFlow] });
    const nonce = randomBytes(18).toString('base64url');
    const state = this.sign({ s: space, f: info.oauthFlow, u: actor.userId, n: nonce, x: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS });
    const callbackUrl = socialCallbackUrl(this.apiBase(), space)!;
    return { url: authorizeUrl(info.oauthFlow, { app, redirectUri: callbackUrl, state, codeVerifier: this.codeVerifier(nonce), graphVersion: this.env.META_GRAPH_VERSION }), callbackUrl };
  }

  /**
   * Retour de l'écran d'autorisation : `state` vérifié (refus 400 sinon), code échangé, comptes découverts, compte
   * enregistré chiffré et validé ; renvoie l'adresse My Hub où rediriger le navigateur (succès, choix ou erreur).
   */
  async callback(callbackSpace: SocialSpace, query: { code?: string | undefined; state?: string | undefined; error?: string | undefined; error_description?: string | undefined }): Promise<string> {
    const state = this.verifyState(query.state, callbackSpace);
    const space = state.s;
    if (query.error || !query.code) return this.hubUrl({ reseau: space, erreur: query.error === 'access_denied' || query.error === 'user_cancelled_authorize' ? 'refus' : 'autorisation' });
    const app = oauthApp(this.env, state.f);
    if (!app) return this.hubUrl({ reseau: space, erreur: 'application' });
    const actor = { userId: state.u };
    const options = this.registry.networkOptions();
    let accounts: DiscoveredAccount[];
    let scopes: string[];
    let expiresAt: Date | null;
    let accessExpiresAt: Date | null;
    try {
      const tokens = await exchangeCode(state.f, options, { app, code: query.code, redirectUri: socialCallbackUrl(this.apiBase(), space)!, codeVerifier: this.codeVerifier(state.n) });
      accounts = await discoverAccounts(state.f, options, tokens);
      scopes = tokens.scopes;
      // Échéance de l'autorisation : jeton de rafraîchissement s'il en a une, sinon jeton d'accès sans rafraîchissement (LinkedIn 60 jours).
      expiresAt = state.f === 'meta' ? null : (tokens.refreshExpiresAt ?? (tokens.refreshToken ? null : tokens.accessExpiresAt));
      accessExpiresAt = tokens.accessExpiresAt;
    } catch (error) {
      const message = error instanceof SocialNetworkError ? error.message : 'erreur inattendue';
      this.logger.warn({ space, kind: error instanceof SocialNetworkError ? error.kind : 'unexpected' }, 'Autorisation de réseau en échec');
      await this.registry.upsert(space, { lastError: `Connexion en échec : ${message}`.slice(0, 300) });
      return this.hubUrl({ reseau: space, erreur: 'echange' });
    }
    const target: SocialSpace = state.f === 'meta' ? 'facebook' : space;
    if (!accounts.length) {
      await this.registry.upsert(target, { lastError: state.f === 'meta' ? 'Aucune page Facebook administrée par ce compte (ou page non cochée dans l\'écran de Meta)' : 'Aucun compte administré trouvé (page LinkedIn : rôle « Super administrateur » requis)' });
      return this.hubUrl({ reseau: space, erreur: 'aucun-compte' });
    }
    if (accounts.length > 1) {
      // Plusieurs pages : gardées chiffrées le temps du choix dans My Hub (aucun jeton n'en sort).
      const row = await this.registry.row(target);
      const sealed = this.registry.sealed(row);
      await this.registry.upsert(target, { sealed: { values: sealed.values, candidates: accounts }, scopes, lastError: null });
      await this.record(actor, target, 'social.candidates', { space: target, count: accounts.length });
      return this.hubUrl({ reseau: target, choisir: '1' });
    }
    await this.apply(accounts[0]!, { scopes, expiresAt, accessExpiresAt, actor });
    return this.hubUrl({ connecte: target });
  }

  /** Enregistre un compte choisi (Meta : la page Facebook et le compte Instagram rattaché). */
  private async apply(account: DiscoveredAccount, input: { scopes: string[]; expiresAt: Date | null; accessExpiresAt: Date | null; actor: Actor }): Promise<void> {
    const now = new Date();
    const common = { mode: 'direct' as const, validation: 'connected' as const, scopes: input.scopes, lastValidatedAt: now, lastError: null, connectedAt: now, connectedByUserId: input.actor.userId, updatedByUserId: input.actor.userId };
    if (account.space === 'facebook') {
      const { igUserId, igUsername, pageId, pageToken } = account.values;
      await this.registry.upsert('facebook', { ...common, sealed: { values: { pageId: pageId!, pageToken: pageToken! } }, accountId: account.accountId, accountName: account.accountName.slice(0, 200), profileUrl: account.profileUrl, expiresAt: null, accessExpiresAt: null });
      await this.record(input.actor, 'facebook', 'social.connect', { space: 'facebook', accountId: account.accountId, accountName: account.accountName });
      if (igUserId) {
        await this.registry.upsert('instagram', { ...common, sealed: { values: { pageId: pageId!, pageToken: pageToken!, igUserId } }, accountId: igUserId, accountName: igUsername ? `@${igUsername}` : igUserId, profileUrl: igUsername ? `https://www.instagram.com/${igUsername}/` : null, expiresAt: null, accessExpiresAt: null });
        await this.record(input.actor, 'instagram', 'social.connect', { space: 'instagram', accountId: igUserId, accountName: igUsername ?? null });
      } else {
        await this.registry.upsert('instagram', { lastError: `Aucun compte Instagram professionnel rattaché à la page « ${account.accountName.slice(0, 80)} » : le rattacher dans Meta Business Suite, puis reconnecter Facebook` });
      }
    } else {
      await this.registry.upsert(account.space, { ...common, sealed: { values: account.values }, accountId: account.accountId.slice(0, 120), accountName: account.accountName.slice(0, 200), profileUrl: account.profileUrl?.slice(0, 500) ?? null, expiresAt: input.expiresAt, accessExpiresAt: input.accessExpiresAt });
      await this.record(input.actor, account.space, 'social.connect', { space: account.space, accountId: account.accountId, accountName: account.accountName });
    }
    this.linksCache = null;
  }

  /** Choix de la page (Facebook) ou de l'organisation (LinkedIn) parmi celles proposées après l'autorisation. */
  async select(space: SocialSpace, accountId: string, actor: Actor): Promise<SocialAccountView> {
    const row = await this.registry.row(space);
    const sealed = this.registry.sealed(row);
    const chosen = sealed.candidates?.find((c) => c.accountId === accountId);
    if (!chosen) throw new AppError('SOCIAL_CANDIDATE_NOT_FOUND', 'Compte introuvable parmi ceux proposés : reconnecter le réseau.', HttpStatus.NOT_FOUND);
    // Les candidats sont retirés avant d'enregistrer le compte choisi (aucun jeton d'une autre page ne reste).
    await this.registry.upsert(space, { sealed: { values: sealed.values } });
    await this.apply(chosen, { scopes: Array.isArray(row?.scopes) ? (row!.scopes as string[]) : [], expiresAt: row?.expiresAt ?? null, accessExpiresAt: null, actor });
    return this.view(space);
  }

  // --- Formulaires ---------------------------------------------------------------------------------------------------

  /** Telegram : jeton du bot et canal, validés (bot administrateur avec le droit de publier) avant tout enregistrement. */
  async connectTelegram(input: SocialTelegramConnectInput, actor: Actor): Promise<SocialAccountView> {
    const channel = normalizeTelegramChannel(input.channel);
    if (!channel) throw new AppError('SOCIAL_TELEGRAM_CHANNEL', 'Canal Telegram attendu : @nom, https://t.me/nom ou identifiant -100…', HttpStatus.BAD_REQUEST);
    let account;
    try {
      account = await validateTelegram(this.registry.networkOptions(), { botToken: input.botToken, channel });
    } catch (error) {
      if (!(error instanceof SocialNetworkError)) throw error;
      throw new AppError('SOCIAL_VALIDATION_FAILED', error.message, error.kind === 'transient' ? HttpStatus.BAD_GATEWAY : HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const now = new Date();
    const values: Record<string, string> = { botToken: input.botToken, channelId: account.accountId, ...(channel.startsWith('@') ? { channelUsername: channel } : {}) };
    await this.registry.upsert('telegram', {
      mode: 'direct', validation: 'connected', sealed: { values }, accountId: account.accountId, accountName: account.accountName.slice(0, 200), profileUrl: account.profileUrl,
      scopes: [], expiresAt: null, accessExpiresAt: null, lastValidatedAt: now, lastError: null, connectedAt: now, connectedByUserId: actor.userId, updatedByUserId: actor.userId,
    });
    await this.record(actor, 'telegram', 'social.connect', { space: 'telegram', accountId: account.accountId, accountName: account.accountName, bot: account.botUsername });
    this.linksCache = null;
    return this.view('telegram');
  }

  private checkLink(space: SocialSpace, url: string): string {
    if (!isSocialProfileUrl(space, url)) throw new AppError('SOCIAL_LINK_INVALID', `Lien attendu en https sur ${SOCIAL_SPACE_INFO[space].hosts.join(' ou ')}`, HttpStatus.BAD_REQUEST);
    return url.trim();
  }

  /** Lien public (relais manuel : Snapchat, chaîne WhatsApp, ou tout réseau passé en mode manuel ; ou adresse corrigée). */
  async setLink(space: SocialSpace, profileUrl: string, actor: Actor): Promise<SocialAccountView> {
    const url = this.checkLink(space, profileUrl);
    const info = SOCIAL_SPACE_INFO[space];
    await this.registry.upsert(space, { profileUrl: url, ...(info.connection === 'manual' ? { mode: 'manual' as const, connectedAt: new Date(), connectedByUserId: actor.userId } : {}), lastValidatedAt: new Date(), updatedByUserId: actor.userId });
    await this.record(actor, space, 'social.link', { space, profileUrl: url });
    this.linksCache = null;
    return this.view(space);
  }

  async update(space: SocialSpace, patch: SocialAccountUpdateInput, actor: Actor): Promise<SocialAccountView> {
    const info = SOCIAL_SPACE_INFO[space];
    if (patch.mode && !info.modes.includes(patch.mode)) throw new AppError('SOCIAL_MODE_UNAVAILABLE', `${info.label} : mode ${patch.mode === 'manual' ? 'relais manuel' : 'direct'} non proposé pour ce réseau`, HttpStatus.BAD_REQUEST);
    if (patch.appApproved !== undefined && !info.requiresApproval) throw new AppError('SOCIAL_APPROVAL_NOT_REQUIRED', `${info.label} n'exige pas d'approbation de l'application`, HttpStatus.BAD_REQUEST);
    const row = await this.registry.row(space);
    await this.registry.upsert(space, {
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.showOnSite !== undefined ? { showOnSite: patch.showOnSite } : {}),
      ...(patch.profileUrl !== undefined ? { profileUrl: patch.profileUrl === null ? null : this.checkLink(space, patch.profileUrl) } : {}),
      ...(patch.appApproved !== undefined ? { appApprovedAt: patch.appApproved ? (row?.appApprovedAt ?? new Date()) : null } : {}),
      updatedByUserId: actor.userId,
    });
    await this.record(actor, space, 'social.update', { space, ...patch });
    this.linksCache = null;
    return this.view(space);
  }

  /** Revalidation immédiate (bouton « Revalider ») : rafraîchit le jeton si besoin, relit le compte chez le réseau. */
  async revalidate(space: SocialSpace, actor: Actor): Promise<SocialAccountView> {
    const row = await this.registry.validate(space);
    await this.record(actor, space, 'social.validate', { space, status: row.status });
    this.linksCache = null;
    return this.view(space);
  }

  /** Déconnexion : jetons effacés, compte et lien retirés ; le blogue reste en lecture seule (variables du serveur). */
  async disconnect(space: SocialSpace, actor: Actor): Promise<SocialAccountView> {
    if (SOCIAL_SPACE_INFO[space].connection === 'wordpress') throw new AppError('SOCIAL_READ_ONLY', 'Blogue : connexion par les variables WordPress du serveur, rien à déconnecter ici.', HttpStatus.BAD_REQUEST);
    await this.registry.upsert(space, {
      sealed: null, validation: 'not_connected', accountId: null, accountName: null, profileUrl: null, scopes: [], expiresAt: null, accessExpiresAt: null,
      lastError: null, connectedAt: null, connectedByUserId: null, updatedByUserId: actor.userId,
    });
    await this.record(actor, space, 'social.disconnect', { space });
    this.linksCache = null;
    return this.view(space);
  }

  // --- Liens publics et passe quotidienne ----------------------------------------------------------------------------

  /** Liens de la page Contact (comptes reliés, validés, « afficher sur le site »), en cache 10 minutes. */
  async publicLinks(): Promise<SocialLinksView> {
    if (this.linksCache && Date.now() - this.linksCache.at < LINKS_CACHE_MS) return this.linksCache.value;
    const rows = await this.registry.rows();
    const value = { links: publicSocialLinks(rows.map((r) => ({ space: r.space as SocialSpace, status: r.status as SocialAccountView['status'], showOnSite: r.showOnSite, profileUrl: r.profileUrl }))) };
    this.linksCache = { at: Date.now(), value };
    return value;
  }

  /**
   * Passe quotidienne (file `marketing`) : valide chaque compte direct relié (ou posé dans les variables du serveur) dont
   * la dernière validation a plus de `social.validation_hours` heures (24) ; alerte le personnel quand l'autorisation
   * arrive à échéance dans `social.expiry_alert_days` jours (7) sans rafraîchissement possible.
   */
  async validateDue(now = new Date()): Promise<{ validated: number; failed: number; expiring: number }> {
    const [hours, alertDays] = await Promise.all([this.settings.number('social.validation_hours', 24), this.settings.number('social.expiry_alert_days', 7)]);
    const rows = new Map((await this.registry.rows()).map((r) => [r.space as SocialSpace, r]));
    const report = { validated: 0, failed: 0, expiring: 0 };
    for (const space of SOCIAL_SPACES) {
      const info = SOCIAL_SPACE_INFO[space];
      const row = rows.get(space) ?? null;
      if (info.connection === 'manual' || row?.mode === 'manual') continue;
      if (row?.status === 'invalid' || row?.status === 'expired') continue;
      if (row?.lastValidatedAt && now.getTime() - row.lastValidatedAt.getTime() < hours * 3_600_000) continue;
      if (!(await this.registry.directValues(space, row))) continue;
      try {
        const after = await this.registry.validate(space, now);
        if (after.status === 'invalid' || after.status === 'expired') report.failed += 1;
        else report.validated += 1;
        if (after.expiresAt && after.expiresAt.getTime() - now.getTime() < alertDays * 86_400_000 && (after.status === 'connected' || after.status === 'pending_approval')) {
          report.expiring += 1;
          await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'social_account_expiring', summary: `${info.label} : autorisation échue le ${after.expiresAt.toISOString().slice(0, 10)}, reconnecter dans My Hub, Réseaux sociaux`, space });
        }
      } catch (error) {
        this.logger.error({ err: error, space }, 'Validation du compte de réseau en échec');
      }
    }
    if (report.validated || report.failed) this.linksCache = null;
    return report;
  }

  private async record(actor: Actor, space: SocialSpace, action: string, after: Record<string, unknown>): Promise<void> {
    const row = await this.registry.row(space);
    const entry: AuditEntry = { action, entity: 'social_account', entityId: row?.id ?? null, after };
    // Dans une requête : écrit avec l'acteur à la fin de la requête. Retour OAuth (route publique en GET) : écrit tout de suite au nom de la personne qui a lancé la connexion.
    if (this.audit.storage.getStore()) this.audit.record(entry);
    else await this.audit.write([entry], { actor: { kind: 'user', userId: actor.userId, sessionId: '', primaryRole: 'admin', roles: [], amr: [] }, ip: null, correlationId: null });
  }
}
