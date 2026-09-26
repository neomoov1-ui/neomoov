/**
 * Protection anti-robots des formulaires publics (prompt 12) : Cloudflare Turnstile quand la clé secrète est fournie
 * (`TURNSTILE_SECRET_KEY`). Sans clé : en production, tout jeton est refusé ; en développement et en test, tout jeton est
 * accepté sauf « fail » (pour exercer le refus).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { APP_LOGGER } from './logger.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

@Injectable()
export class AntiBotService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  async verify(token: string, ip: string | null): Promise<boolean> {
    const secret = this.env.TURNSTILE_SECRET_KEY;
    if (!secret) return this.env.NODE_ENV !== 'production' && token !== 'fail';
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
}
