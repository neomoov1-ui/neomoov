/**
 * Protection anti-robots des formulaires publics (prompt 12) : Cloudflare Turnstile quand la clé secrète est fournie
 * (`TURNSTILE_SECRET_KEY`). Sans clé : en production, tout jeton est refusé ; en développement et en test, tout jeton est
 * accepté sauf « fail » (pour exercer le refus). Les tests n'appellent jamais Cloudflare, même si la clé est dans
 * l'environnement de développement partagé (2 octobre 2026 : clé posée pour la production, tests publics en échec).
 *
 * Défi après plusieurs échecs (revue du 2 octobre 2026, sécurité 4, 8 et 9) : connexion du personnel, demandes de code
 * SMS depuis le web et devis de l'API publique. Chaque échec (ou demande, selon la route) est compté par adresse ; au-delà
 * du seuil (réglage `security.turnstile_<portée>_after`, 0 = jamais), la requête doit porter un jeton Turnstile valide dans
 * l'en-tête `x-turnstile-token`, sinon 403 `TURNSTILE_REQUIRED` (jeton absent) ou `TURNSTILE_FAILED` (jeton refusé) :
 * le web n'affiche le défi qu'à ce moment-là. Sans clé secrète, rien n'est compté ni exigé (aucun changement tant que
 * Turnstile n'est pas configuré).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { AppError } from './app-error.js';
import { APP_LOGGER } from './logger.js';
import { RateLimitService } from './rate-limit.service.js';
import { SettingsService } from './settings.service.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** En-tête qui porte le jeton Turnstile d'une route protégée après plusieurs échecs. */
export const ANTI_BOT_HEADER = 'x-turnstile-token';

/** Routes protégées par le défi après plusieurs échecs : seuil par défaut (par adresse, sur la fenêtre). */
const ESCALATION = {
  /** Mots de passe faux du personnel. */
  staff_login: 3,
  /** Codes SMS demandés (seules les requêtes d'un navigateur reçoivent le défi : les applications ne peuvent pas l'afficher). */
  otp: 5,
  /** Devis de l'API publique (coût des itinéraires). */
  public_quotes: 30,
} as const;
export type AntiBotScope = keyof typeof ESCALATION;

@Injectable()
export class AntiBotService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly store: RateLimitService,
  ) {}

  async verify(token: string, ip: string | null): Promise<boolean> {
    const secret = this.env.TURNSTILE_SECRET_KEY;
    if (!secret || this.env.NODE_ENV === 'test') return this.env.NODE_ENV !== 'production' && token !== 'fail';
    try {
      const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
      const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      const result = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!result.success) this.logger.warn({ codes: result['error-codes'] }, 'Jeton anti-robots refusé');
      return result.success === true;
    } catch (error) {
      this.logger.error({ err: error }, 'Vérification anti-robots impossible');
      return false;
    }
  }

  /** Défi après plusieurs échecs : actif seulement avec la clé secrète de Turnstile (sinon aucune exigence). */
  get escalationEnabled(): boolean {
    return Boolean(this.env.TURNSTILE_SECRET_KEY);
  }

  private key(scope: AntiBotScope, ip: string): string {
    return `antibot:${scope}:${ip}`;
  }

  private async threshold(scope: AntiBotScope): Promise<number> {
    return this.settings.number(`security.turnstile_${scope}_after`, ESCALATION[scope]);
  }

  /**
   * Exige un jeton Turnstile valide quand cette adresse a dépassé le seuil d'échecs de la route ; sans adresse connue ou
   * sous le seuil, rien n'est demandé. Le jeton lui-même n'est jamais journalisé.
   */
  async challenge(scope: AntiBotScope, ip: string | null, token: string | null | undefined): Promise<void> {
    if (!this.escalationEnabled || !ip) return;
    const threshold = await this.threshold(scope);
    if (threshold <= 0) return;
    const { count } = await this.store.peek(this.key(scope, ip));
    if (count < threshold) return;
    if (!token) throw new AppError('TURNSTILE_REQUIRED', 'Vérification anti-robots requise : complétez le défi puis réessayez', 403, { scope });
    if (!(await this.verify(token, ip))) throw new AppError('TURNSTILE_FAILED', 'Vérification anti-robots échouée : réessayez', 403, { scope });
  }

  /** Compte un échec (ou une demande) de cette adresse sur la route, pendant `security.turnstile_window_seconds` (1 h). */
  async record(scope: AntiBotScope, ip: string | null): Promise<void> {
    if (!this.escalationEnabled || !ip) return;
    const window = await this.settings.number('security.turnstile_window_seconds', 3_600);
    await this.store.hit(this.key(scope, ip), Number.MAX_SAFE_INTEGER, Math.max(60, window));
  }

  /** Réussite (connexion ouverte) : le compteur de l'adresse repart de zéro. */
  async clear(scope: AntiBotScope, ip: string | null): Promise<void> {
    if (!this.escalationEnabled || !ip) return;
    await this.store.reset(this.key(scope, ip));
  }
}
