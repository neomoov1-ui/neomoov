/**
 * Codes SMS (section 8) : 6 chiffres, hachés avec un secret serveur, 5 minutes, 5 tentatives, limitation par numéro et
 * par adresse IP, délai minimal entre deux envois. Le code n'apparaît dans les journaux qu'en développement local.
 */
import { schema } from '@neomoov/db';
import type { Language } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SMS_PROVIDER, type SmsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { constantTimeEqual, hmacHex, randomDigits } from '../../common/crypto.js';
import { t } from '../../common/i18n.js';
import { APP_LOGGER } from '../../common/logger.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';

export interface OtpRequestResult {
  expiresIn: number;
  retryAfter: number;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Code fixe d'un compte d'examen des magasins (numéro listé dans `REVIEW_PHONES`), sinon null. */
  private reviewCode(phone: string): string | null {
    if (!this.env.REVIEW_PHONES || !this.env.REVIEW_OTP_CODE) return null;
    return this.env.REVIEW_PHONES.split(',').map((p) => p.trim()).includes(phone) ? this.env.REVIEW_OTP_CODE : null;
  }

  private hash(phone: string, code: string): string {
    return hmacHex(this.env.ENCRYPTION_KEY!, `${phone}:${code}`);
  }

  async request(phone: string, ip: string | null, language: Language): Promise<OtpRequestResult> {
    const [ttl, resend, perPhone, perIp] = await Promise.all([
      this.settings.number('auth.otp_ttl_seconds', 300),
      this.settings.number('auth.otp_resend_seconds', 30),
      this.settings.number('auth.otp_per_phone_per_hour', 5),
      this.settings.number('auth.otp_per_ip_per_hour', 20),
    ]);

    const [last] = await this.database.db
      .select({ createdAt: schema.otpCodes.createdAt })
      .from(schema.otpCodes)
      .where(eq(schema.otpCodes.phone, phone))
      .orderBy(desc(schema.otpCodes.createdAt))
      .limit(1);
    if (last) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
      if (elapsed < resend) throw new AppError('OTP_TOO_SOON', 'Un code vient d\'être envoyé, patientez avant d\'en redemander un', 429, { retryAfter: Math.ceil(resend - elapsed) });
    }
    const byPhone = await this.rateLimit.hit(`otp:phone:${phone}`, perPhone, 3600);
    if (!byPhone.allowed) throw new AppError('OTP_RATE_LIMITED', 'Trop de codes demandés pour ce numéro, réessayez plus tard', 429, { retryAfter: byPhone.resetIn });
    if (ip) {
      const byIp = await this.rateLimit.hit(`otp:ip:${ip}`, perIp, 3600);
      if (!byIp.allowed) throw new AppError('OTP_RATE_LIMITED', 'Trop de codes demandés depuis cette adresse, réessayez plus tard', 429, { retryAfter: byIp.resetIn });
    }

    const review = this.reviewCode(phone);
    const code = review ?? randomDigits(6);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.database.db.transaction(async (tx) => {
      // Un seul code actif par numéro : les précédents sont consommés.
      await tx.update(schema.otpCodes).set({ consumedAt: new Date() }).where(and(eq(schema.otpCodes.phone, phone), isNull(schema.otpCodes.consumedAt)));
      await tx.insert(schema.otpCodes).values({ phone, codeHash: this.hash(phone, code), expiresAt });
    });
    if (review) {
      // Compte d'examen des magasins : aucun texto (le numéro n'est pas joignable), code connu des examinateurs.
      this.logger.info({ phone: maskPhone(phone) }, 'Code de connexion d\'un compte d\'examen des magasins');
      return { expiresIn: ttl, retryAfter: resend };
    }
    await this.sms.send({ to: phone, body: t(language, 'sms.otp', { code, minutes: Math.round(ttl / 60) }) });
    if (this.env.NODE_ENV === 'development') this.logger.info({ phone: maskPhone(phone), devOtpCode: code }, 'Code SMS (affiché en développement seulement)');
    return { expiresIn: ttl, retryAfter: resend };
  }

  /** Vérifie et consomme le code ; compte les tentatives et invalide le code après la cinquième. */
  async verify(phone: string, code: string): Promise<void> {
    const maxAttempts = await this.settings.number('auth.otp_max_attempts', 5);
    const [row] = await this.database.db
      .select()
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), isNull(schema.otpCodes.consumedAt), gt(schema.otpCodes.expiresAt, new Date())))
      .orderBy(desc(schema.otpCodes.createdAt))
      .limit(1);
    if (!row) throw new AppError('OTP_EXPIRED', 'Aucun code valide pour ce numéro : demandez-en un nouveau', 400);
    if (!constantTimeEqual(row.codeHash, this.hash(phone, code))) {
      const attempts = row.attempts + 1;
      const locked = attempts >= maxAttempts;
      // Au dernier échec, le code est consommé : la tentative suivante ne trouve plus de code valide (OTP_EXPIRED).
      await this.database.db
        .update(schema.otpCodes)
        .set({ attempts, ...(locked ? { consumedAt: new Date() } : {}) })
        .where(eq(schema.otpCodes.id, row.id));
      if (locked) throw new AppError('OTP_LOCKED', 'Trop de tentatives : demandez un nouveau code', 429, { attemptsLeft: 0 });
      throw new AppError('OTP_INVALID', 'Code incorrect', 400, { attemptsLeft: maxAttempts - attempts });
    }
    await this.database.db.update(schema.otpCodes).set({ consumedAt: new Date() }).where(eq(schema.otpCodes.id, row.id));
  }
}

export function maskPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 3)}…${phone.slice(-3)}` : '…';
}
