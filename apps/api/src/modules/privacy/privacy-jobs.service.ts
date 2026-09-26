/**
 * Tâches de confidentialité (5.15), file `privacy` : export JSON et PDF vers le stockage avec lien signé envoyé à
 * l'utilisateur ; suppression de compte (anonymisation des courses conservées pour la comptabilité, effacement du
 * reste). Traitées par le worker (Redis) ou dans le processus courant en mode mémoire (développement et tests).
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import { EMAIL_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER, type EmailProvider, type SmsProvider, type StorageProvider } from '../../adapters/types.js';
import { escapeHtml, t } from '../../common/i18n.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { TokensService } from '../auth/tokens.service.js';
import { AuditService } from '../audit/audit.service.js';
import { anonymizedPhone } from '../users/users.service.js';
import { FieldCipher } from '../../common/field-cipher.js';
import { collectUserData, toJsonBuffer, toPdfBuffer } from './privacy-export.js';

export { anonymizedPhone };

export interface PrivacyJobData {
  requestId: string;
  userId: string;
}

/** Corps de courriel : texte brut échappé, retours à la ligne en `<br>`. */
function htmlBody(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

@Injectable()
export class PrivacyJobsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
    private readonly fields: FieldCipher,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** En mode mémoire, le processus qui ajoute la tâche doit aussi la traiter : enregistrement automatique. */
  onModuleInit() {
    if (this.queues.mode === 'memory') this.register();
  }

  register(): void {
    this.queues.process(
      'privacy',
      async (job) => {
        const data = job.data as PrivacyJobData;
        if (job.name === 'data-export') await this.exportData(data.requestId);
        else if (job.name === 'account-deletion') await this.deleteAccount(data.userId, data.requestId);
        else this.logger.warn({ job: job.name }, 'Tâche de confidentialité inconnue');
      },
      { concurrency: 2 },
    );
  }

  async exportData(requestId: string): Promise<void> {
    const [request] = await this.db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, requestId)).limit(1);
    if (!request || request.processedAt) return;
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, request.userId)).limit(1);
    if (!user) return;
    const data = await collectUserData(this.db, user.id, (value) => this.fields.decrypt(value));
    const fileKey = `exports/${user.id}/${request.id}`;
    await this.storage.putObject({ key: `${fileKey}.json`, body: toJsonBuffer(data), contentType: 'application/json' });
    await this.storage.putObject({ key: `${fileKey}.pdf`, body: await toPdfBuffer(data, user.language), contentType: 'application/pdf' });
    // `outcome` est une note d'exploitation (My Hub, en français) ; l'utilisateur voit `status` et ses liens.
    await this.db.update(schema.dataRequests).set({ processedAt: new Date(), fileKey, outcome: 'Export produit (JSON et PDF)' }).where(eq(schema.dataRequests.id, request.id));

    const ttlDays = await this.settings.number('privacy.export_link_ttl_days', 7);
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const seconds = ttlDays * 86_400;
    if (user.email) {
      const [json, pdf] = await Promise.all([this.storage.getSignedUrl(`${fileKey}.json`, seconds), this.storage.getSignedUrl(`${fileKey}.pdf`, seconds)]);
      const body = t(user.language, 'email.export.body', { firstName: user.firstName, json, pdf, expiresAt: expiresAt.toLocaleDateString(user.language === 'en' ? 'en-CA' : 'fr-CA', { timeZone: 'America/Toronto' }) });
      await this.email.send({ to: user.email, subject: t(user.language, 'email.export.subject'), html: htmlBody(body), text: body });
    } else {
      await this.sms.send({ to: user.phone, body: t(user.language, 'sms.export_ready') });
    }
    await this.audit.recordSystem({ action: 'privacy.export_produced', entity: 'data_requests', entityId: request.id, after: { type: request.type, notifiedBy: user.email ? 'email' : 'sms' } }, 'privacy_jobs');
    this.logger.info({ requestId: request.id }, 'Export de données produit');
  }

  /** Anonymisation : les courses restent pour la comptabilité (7 ans), tout le reste est effacé. */
  async deleteAccount(userId: string, requestId: string): Promise<void> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) return;
    const email = user.email;
    const language = user.language;
    await this.tokens.revokeAllForUser(userId);
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await tx.delete(schema.devices).where(eq(schema.devices.userId, userId));
      await tx.delete(schema.otpCodes).where(eq(schema.otpCodes.phone, user.phone));
      await tx.delete(schema.staffCredentials).where(eq(schema.staffCredentials.userId, userId));
      await tx.update(schema.consents).set({ withdrawnAt: new Date() }).where(and(eq(schema.consents.userId, userId), isNull(schema.consents.withdrawnAt)));
      const [client] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
      if (client) {
        await tx.delete(schema.savedPlaces).where(eq(schema.savedPlaces.clientId, client.id));
        await tx.delete(schema.favoriteDrivers).where(eq(schema.favoriteDrivers.clientId, client.id));
        await tx.update(schema.clients).set({ notes: null, preferences: {}, status: 'deleted', businessAccountId: null }).where(eq(schema.clients.id, client.id));
        await tx.update(schema.rides).set({ guestName: null, guestPhone: null, passengerName: null, passengerPhone: null }).where(eq(schema.rides.clientId, client.id));
      }
      const [driver] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
      if (driver) {
        await tx.update(schema.drivers).set({ status: 'offboarded', isOnline: false, interacEmail: null, offboardedAt: new Date() }).where(eq(schema.drivers.id, driver.id));
      }
      await tx
        .update(schema.users)
        .set({ phone: anonymizedPhone(userId), email: null, firstName: null, lastName: null, appleId: null, googleId: null, status: 'deleted', deletedAt: user.deletedAt ?? new Date() })
        .where(eq(schema.users.id, userId));
      await tx
        .update(schema.dataRequests)
        .set({ processedAt: new Date(), outcome: 'Compte supprimé : données personnelles effacées, courses anonymisées et conservées pour la comptabilité' })
        .where(eq(schema.dataRequests.id, requestId));
    });
    await this.audit.recordSystem({ action: 'privacy.account_deleted', entity: 'users', entityId: userId, after: { requestId } }, 'privacy_jobs');
    if (email) {
      const body = t(language, 'email.deletion.body');
      await this.email.send({ to: email, subject: t(language, 'email.deletion.subject'), html: htmlBody(body), text: body }).catch((error: unknown) => this.logger.warn({ err: error }, 'Courriel de confirmation de suppression non envoyé'));
    }
    this.logger.info({ userId, requestId }, 'Compte supprimé et anonymisé');
  }
}
