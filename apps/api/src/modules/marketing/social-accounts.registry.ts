/**
 * Registre des comptes des réseaux sociaux (3 octobre 2026) : implémentation de `SOCIAL_CREDENTIALS` sur la table
 * `social_accounts` (jetons et secrets chiffrés par `FieldCipher`), avec repli sur les variables d'environnement pour un
 * espace jamais relié dans My Hub. Fourni par `AdaptersModule` (API et worker), il sert les connecteurs de diffusion et
 * le service de l'espace « Réseaux sociaux » de My Hub.
 *
 * Règles de `get` : compte en mode manuel ou en attente d'approbation de l'application → relais manuel ; compte relié et
 * valide → valeurs déchiffrées, identifiants d'application ajoutés (pour le rafraîchissement par les connecteurs) et jeton
 * d'accès rafraîchi s'il arrive à échéance ; compte refusé ou échu → null (connecteur « non configuré », alerte déjà
 * envoyée) ; jamais relié → variables d'environnement. Une validation de plus d'une heure est refaite avant de servir
 * (avant chaque publication).
 */
import { schema } from '@neomoov/db';
import { effectiveSocialStatus, isSocialSpace, SOCIAL_SPACE_INFO, type SocialAccountStatus, type SocialMode, type SocialOAuthFlow, type SocialSpace } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { FieldCipher } from '../../common/field-cipher.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { EnvSocialCredentialsProvider, MANUAL_ONLY_SPACES, type SocialCredentials, type SocialCredentialsProvider } from './social-credentials.js';
import { oauthApp, refreshTokens, SocialNetworkError, validateAccount, type DiscoveredAccount, type NetworkOptions, type SocialFetch } from './social-networks.js';

export type SocialAccountRow = typeof schema.socialAccounts.$inferSelect;

/** Contenu chiffré de `credentials` : valeurs du compte et comptes proposés après l'autorisation (choix en attente). */
export interface SealedCredentials {
  values: Record<string, string>;
  candidates?: DiscoveredAccount[];
}

export interface SocialStatusEvent {
  space: SocialSpace;
  status: SocialAccountStatus;
  reason: string;
}

/** Accès HTTP des réseaux : remplaçable par un simulateur dans les essais (`app.get(SocialHttp).fetch = …`). */
@Injectable()
export class SocialHttp {
  fetch: SocialFetch = (input, init) => globalThis.fetch(input, init);
}

const DEFAULT_LINKEDIN_VERSION = '202606';
/** Marge avant l'échéance d'un jeton d'accès : rafraîchi s'il lui reste moins de dix minutes. */
const REFRESH_MARGIN_MS = 10 * 60_000;

type RowPatch = Partial<Omit<typeof schema.socialAccounts.$inferInsert, 'id' | 'space' | 'status' | 'createdAt'>> & { sealed?: SealedCredentials | null };

@Injectable()
export class SocialAccountsRegistry implements SocialCredentialsProvider {
  readonly fallback: EnvSocialCredentialsProvider;
  private readonly listeners: Array<(event: SocialStatusEvent) => void> = [];
  private readonly refreshing = new Map<SocialSpace, Promise<Record<string, string>>>();

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(DB) private readonly database: Database,
    private readonly cipher: FieldCipher,
    private readonly settings: SettingsService,
    private readonly http: SocialHttp,
  ) {
    this.fallback = new EnvSocialCredentialsProvider(env);
  }

  toJSON() {
    return { name: 'social_accounts', fallback: 'env' };
  }

  /** Abonnement aux passages en `invalid` ou `expired` (alerte au personnel par le service de My Hub). */
  onStatusChange(listener: (event: SocialStatusEvent) => void): void {
    this.listeners.push(listener);
  }

  networkOptions(): NetworkOptions {
    const linkedinVersion = (this.env as unknown as Record<string, unknown>)['LINKEDIN_API_VERSION'];
    return { fetch: this.http.fetch, graphVersion: this.env.META_GRAPH_VERSION, linkedinVersion: typeof linkedinVersion === 'string' && linkedinVersion ? linkedinVersion : DEFAULT_LINKEDIN_VERSION };
  }

  async row(space: SocialSpace): Promise<SocialAccountRow | null> {
    const [row] = await this.database.db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.space, space)).limit(1);
    return row ?? null;
  }

  async rows(): Promise<SocialAccountRow[]> {
    return this.database.db.select().from(schema.socialAccounts);
  }

  sealed(row: SocialAccountRow | null): SealedCredentials {
    if (!row?.credentials) return { values: {} };
    try {
      const parsed = JSON.parse(this.cipher.decrypt(row.credentials) ?? '{}') as SealedCredentials;
      return { values: parsed.values ?? {}, ...(parsed.candidates ? { candidates: parsed.candidates } : {}) };
    } catch {
      // Clé de chiffrement changée ou valeur abîmée : le compte est à reconnecter, jamais une valeur partielle.
      return { values: {} };
    }
  }

  /** Identifiants de l'application du réseau, ajoutés aux valeurs pour que les connecteurs rafraîchissent eux-mêmes. */
  appValues(space: SocialSpace): Record<string, string> {
    const flow = SOCIAL_SPACE_INFO[space].oauthFlow;
    if (!flow || flow === 'meta') return {};
    const app = oauthApp(this.env, flow);
    if (!app) return {};
    return flow === 'tiktok' ? { clientKey: app.clientId, clientSecret: app.clientSecret } : { clientId: app.clientId, clientSecret: app.clientSecret };
  }

  /**
   * Écrit un compte (création ou mise à jour) et recalcule son état affiché. `sealed` remplace le contenu chiffré
   * (null l'efface). Un passage en `invalid` ou `expired` prévient les abonnés.
   */
  async upsert(space: SocialSpace, patch: RowPatch): Promise<SocialAccountRow> {
    const before = await this.row(space);
    const { sealed, ...fields } = patch;
    const merged = { mode: (fields.mode ?? before?.mode ?? SOCIAL_SPACE_INFO[space].modes[0] ?? 'manual') as SocialMode, validation: (fields.validation ?? before?.validation ?? 'not_connected') as SocialAccountStatus, profileUrl: fields.profileUrl !== undefined ? fields.profileUrl : (before?.profileUrl ?? null), appApprovedAt: fields.appApprovedAt !== undefined ? fields.appApprovedAt : (before?.appApprovedAt ?? null) };
    const status = effectiveSocialStatus({ space, mode: merged.mode, validation: merged.validation, profileUrl: merged.profileUrl, appApproved: Boolean(merged.appApprovedAt) });
    const values = {
      ...fields,
      ...(sealed !== undefined ? { credentials: sealed ? this.cipher.encrypt(JSON.stringify(sealed)) : null } : {}),
      mode: merged.mode,
      status,
      updatedAt: new Date(),
    };
    const [row] = await this.database.db
      .insert(schema.socialAccounts)
      .values({ space, ...values })
      .onConflictDoUpdate({ target: schema.socialAccounts.space, set: values })
      .returning();
    if ((status === 'invalid' || status === 'expired') && before?.status !== status) {
      const event: SocialStatusEvent = { space, status, reason: row!.lastError ?? '' };
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // Une alerte en échec ne bloque jamais l'écriture du compte.
        }
      }
    }
    return row!;
  }

  /** Valeurs du mode direct : base (compte relié dans My Hub), sinon variables d'environnement. */
  async directValues(space: SocialSpace, row: SocialAccountRow | null): Promise<{ values: Record<string, string>; source: 'database' | 'environment' } | null> {
    if (space !== 'site_blog' && row?.credentials) {
      const values = this.sealed(row).values;
      if (Object.keys(values).length) return { values, source: 'database' };
    }
    const env = await this.fallback.get(space);
    return env && env.mode === 'direct' ? { values: env.values, source: 'environment' } : null;
  }

  async get(space: string): Promise<SocialCredentials | null> {
    if (!isSocialSpace(space)) return this.fallback.get(space);
    const row = await this.row(space);
    if (!row) return this.fallback.get(space);
    const manual: SocialCredentials = { mode: 'manual', values: {}, accountId: row.accountId, accountName: row.accountName, profileUrl: row.profileUrl, expiresAt: null };
    if (row.mode === 'manual' || MANUAL_ONLY_SPACES.includes(space) || row.status === 'pending_approval') return manual;
    if (row.status === 'invalid' || row.status === 'expired') return null;
    if (row.status !== 'connected') return this.fallback.get(space);
    let current = row;
    const maxAgeMinutes = await this.settings.number('social.prepublish_validation_minutes', 60);
    if (!current.lastValidatedAt || Date.now() - current.lastValidatedAt.getTime() > maxAgeMinutes * 60_000) {
      current = await this.validate(space);
      if (current.status !== 'connected') return current.status === 'pending_approval' ? manual : null;
    }
    const direct = await this.directValues(space, current);
    if (!direct) return null;
    const values = direct.source === 'database' ? await this.freshValues(space, current, direct.values) : direct.values;
    return { mode: 'direct', values: { ...this.appValues(space), ...values }, accountId: current.accountId, accountName: current.accountName, profileUrl: current.profileUrl, expiresAt: current.expiresAt };
  }

  async markInvalid(space: string, reason: string): Promise<void> {
    if (!isSocialSpace(space)) return this.fallback.markInvalid(space, reason);
    const clean = reason.replace(/\d{5,15}:[A-Za-z0-9_-]{30,64}/g, '[jeton]').slice(0, 300);
    const row = await this.row(space);
    if (!row?.credentials) await this.fallback.markInvalid(space, clean);
    if (row?.mode === 'manual') return;
    await this.upsert(space, { validation: 'invalid', lastError: clean, lastValidatedAt: new Date() });
  }

  /**
   * Jeton d'accès rafraîchi avant son échéance (LinkedIn, X, TikTok, YouTube). Un seul rafraîchissement à la fois par
   * espace : dans le processus (promesse partagée) et entre l'API et le worker (verrou consultatif de la base, ligne
   * relue sous le verrou : X change le jeton de rafraîchissement à chaque échange).
   */
  async freshValues(space: SocialSpace, row: SocialAccountRow, values: Record<string, string>): Promise<Record<string, string>> {
    const flow = SOCIAL_SPACE_INFO[space].oauthFlow;
    if (!flow || flow === 'meta' || !values['refreshToken'] || !this.needsRefresh(values)) return values;
    const running = this.refreshing.get(space);
    if (running) return running;
    const task = this.refreshUnderLock(space, flow).finally(() => this.refreshing.delete(space));
    this.refreshing.set(space, task);
    return task;
  }

  private needsRefresh(values: Record<string, string>): boolean {
    if (!values['accessToken']) return true;
    const at = values['accessTokenExpiresAt'] ? Date.parse(values['accessTokenExpiresAt']) : NaN;
    return Number.isFinite(at) && at - Date.now() < REFRESH_MARGIN_MS;
  }

  private async refreshUnderLock(space: SocialSpace, flow: Exclude<SocialOAuthFlow, 'meta'>): Promise<Record<string, string>> {
    const app = oauthApp(this.env, flow);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`social-refresh:${space}`}))`);
      const [locked] = await tx.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.space, space)).limit(1);
      const values = this.sealed(locked ?? null).values;
      if (!values['refreshToken'] || !this.needsRefresh(values)) return values;
      if (!app) throw new SocialNetworkError('config', `${SOCIAL_SPACE_INFO[space].label} : identifiants de l'application absents du serveur, rafraîchissement impossible`);
      let tokens;
      try {
        tokens = await refreshTokens(flow, this.networkOptions(), { app, refreshToken: values['refreshToken'] });
      } catch (error) {
        if (error instanceof SocialNetworkError && (error.kind === 'invalid' || error.kind === 'expired')) {
          await this.upsert(space, { validation: 'expired', lastError: error.message, lastValidatedAt: new Date() });
        }
        throw error;
      }
      const next: Record<string, string> = {
        ...values,
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        ...(tokens.accessExpiresAt ? { accessTokenExpiresAt: tokens.accessExpiresAt.toISOString() } : {}),
      };
      const sealed: SealedCredentials = { values: next };
      await tx.update(schema.socialAccounts).set({
        credentials: this.cipher.encrypt(JSON.stringify(sealed)),
        accessExpiresAt: tokens.accessExpiresAt,
        ...(tokens.refreshExpiresAt ? { expiresAt: tokens.refreshExpiresAt } : {}),
        updatedAt: new Date(),
      }).where(eq(schema.socialAccounts.space, space));
      return next;
    });
  }

  /**
   * Validation légère d'un compte (appel en lecture seule chez le réseau) : `connected` avec le nom et l'adresse du
   * compte, ou `invalid` / `expired` avec la raison (alerte au personnel). Une panne passagère du réseau garde l'état et
   * note l'erreur. Relais manuel : rien à appeler, le lien public suffit.
   */
  async validate(space: SocialSpace, now = new Date()): Promise<SocialAccountRow> {
    const row = await this.row(space);
    if (row?.mode === 'manual' || MANUAL_ONLY_SPACES.includes(space)) return this.upsert(space, { lastValidatedAt: now, lastError: null });
    const direct = await this.directValues(space, row);
    if (!direct) return this.upsert(space, { validation: 'not_connected', lastError: null });
    try {
      const values = direct.source === 'database' && row ? await this.freshValues(space, row, direct.values) : direct.values;
      const account = await validateAccount(space, this.networkOptions(), values);
      return await this.upsert(space, {
        validation: 'connected', accountId: account.accountId.slice(0, 120), accountName: account.accountName.slice(0, 200),
        ...(account.profileUrl && !row?.profileUrl ? { profileUrl: account.profileUrl.slice(0, 500) } : {}),
        lastValidatedAt: now, lastError: null,
      });
    } catch (error) {
      if (!(error instanceof SocialNetworkError)) throw error;
      if (error.kind === 'transient') return this.upsert(space, { lastError: error.message });
      return this.upsert(space, { validation: error.kind === 'expired' ? 'expired' : 'invalid', lastError: error.message, lastValidatedAt: now });
    }
  }
}
