/**
 * Profil de l'utilisateur connecté (section 7.2, groupe Auth, et 5.15 Loi 25) : modification, appareils, consentements
 * versionnés par finalité, demandes de droits (accès, rectification, portabilité, retrait), suppression du compte.
 */
import { schema } from '@neomoov/db';
import type { ConsentInput, ConsentPurpose, DataRequestInput, PatchMe, UserRole } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { hasStaffRole, type UserActor } from '../auth/actor.js';
import { TokensService } from '../auth/tokens.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';

type ConsentRow = typeof schema.consents.$inferSelect;
type DataRequestRow = typeof schema.dataRequests.$inferSelect;

const montrealDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Date locale de Montréal au format AAAA-MM-JJ, décalée de `plusDays` jours. */
export function localDate(at: Date, plusDays = 0): string {
  return montrealDate.format(new Date(at.getTime() + plusDays * 86_400_000));
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async patch(userId: string, input: PatchMe, sessionRoles?: UserRole[]) {
    const before = this.users.requireUsable(await this.users.findById(userId));
    const changes: Partial<typeof schema.users.$inferInsert> = {};
    if (input.firstName !== undefined) changes.firstName = input.firstName;
    if (input.lastName !== undefined) changes.lastName = input.lastName;
    if (input.language !== undefined) changes.language = input.language;
    if (input.email !== undefined) changes.email = input.email ? input.email.toLowerCase() : null;
    if (input.privacyPolicyVersion !== undefined) {
      const current = await this.users.currentPrivacyPolicyVersion();
      if (input.privacyPolicyVersion !== current) throw new AppError('PRIVACY_POLICY_VERSION_OUTDATED', 'Seule la version en vigueur peut être acceptée', 400, { currentVersion: current });
      changes.privacyPolicyVersion = current;
    }
    if (changes.email && changes.email !== before.email) {
      const taken = await this.users.findByEmail(changes.email);
      if (taken && taken.id !== userId) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel est déjà utilisé par un autre compte');
    }
    let after: typeof before;
    try {
      [after] = (await this.db.update(schema.users).set(changes).where(eq(schema.users.id, userId)).returning()) as [typeof before];
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel est déjà utilisé par un autre compte');
      throw error;
    }
    const pick = (u: typeof before) => ({ firstName: u.firstName, lastName: u.lastName, email: u.email, language: u.language, privacyPolicyVersion: u.privacyPolicyVersion });
    this.audit.record({ action: 'me.updated', entity: 'users', entityId: userId, before: pick(before), after: pick(after) });
    return this.users.meViewOf(after, sessionRoles);
  }

  // --- Consentements (5.15) : une ligne par accord, retrait horodaté, version conservée ---

  async listConsents(userId: string) {
    const rows = await this.db.select().from(schema.consents).where(eq(schema.consents.userId, userId)).orderBy(desc(schema.consents.grantedAt));
    const latest = new Map<ConsentPurpose, ConsentRow>();
    for (const row of rows) if (!latest.has(row.purpose)) latest.set(row.purpose, row);
    const purposes: ConsentPurpose[] = ['geolocation', 'marketing', 'audio_recording', 'biometrics', 'data_transfer'];
    return purposes.map((purpose) => MeService.consentView(purpose, latest.get(purpose) ?? null));
  }

  async setConsent(userId: string, input: ConsentInput) {
    const [active] = await this.db
      .select()
      .from(schema.consents)
      .where(and(eq(schema.consents.userId, userId), eq(schema.consents.purpose, input.purpose), isNull(schema.consents.withdrawnAt)))
      .orderBy(desc(schema.consents.grantedAt))
      .limit(1);
    const now = new Date();
    if (input.granted) {
      if (active && active.version === input.version) return MeService.consentView(input.purpose, active);
      // Nouvelle version = nouvel accord ; l'ancien est clos.
      if (active) await this.db.update(schema.consents).set({ withdrawnAt: now }).where(eq(schema.consents.id, active.id));
      const [row] = await this.db.insert(schema.consents).values({ userId, purpose: input.purpose, version: input.version, grantedAt: now, source: input.source }).returning();
      this.audit.record({ action: 'consent.granted', entity: 'consents', entityId: row!.id, after: { purpose: input.purpose, version: input.version, source: input.source } });
      return MeService.consentView(input.purpose, row!);
    }
    if (!active) {
      const [last] = await this.db.select().from(schema.consents).where(and(eq(schema.consents.userId, userId), eq(schema.consents.purpose, input.purpose))).orderBy(desc(schema.consents.grantedAt)).limit(1);
      return MeService.consentView(input.purpose, last ?? null);
    }
    const [row] = await this.db.update(schema.consents).set({ withdrawnAt: now }).where(eq(schema.consents.id, active.id)).returning();
    this.audit.record({ action: 'consent.withdrawn', entity: 'consents', entityId: active.id, before: { purpose: input.purpose, version: active.version }, after: { withdrawnAt: now, source: input.source } });
    return MeService.consentView(input.purpose, row!);
  }

  static consentView(purpose: ConsentPurpose, row: ConsentRow | null) {
    return {
      purpose,
      granted: Boolean(row && !row.withdrawnAt),
      version: row?.version ?? null,
      grantedAt: row?.grantedAt.toISOString() ?? null,
      withdrawnAt: row?.withdrawnAt?.toISOString() ?? null,
      source: row?.source ?? null,
    };
  }

  // --- Demandes de droits (5.15) : suivies dans data_requests, export produit par le worker ---

  async listDataRequests(userId: string) {
    const rows = await this.db.select().from(schema.dataRequests).where(eq(schema.dataRequests.userId, userId)).orderBy(desc(schema.dataRequests.receivedAt));
    return Promise.all(rows.map((r) => this.dataRequestView(r)));
  }

  async getDataRequest(id: string) {
    const [row] = await this.db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, id)).limit(1);
    if (!row) throw AppError.notFound('NOT_FOUND', 'Demande introuvable');
    return this.dataRequestView(row);
  }

  async createDataRequest(userId: string, input: DataRequestInput) {
    const dueDays = await this.settings.number('privacy.data_request_due_days', 30);
    const [row] = await this.db
      .insert(schema.dataRequests)
      .values({ userId, type: input.type, dueOn: localDate(new Date(), dueDays), outcome: input.details ? `Demande : ${input.details}` : null })
      .returning();
    this.audit.record({ action: 'privacy.data_request_created', entity: 'data_requests', entityId: row!.id, after: { type: input.type } });
    if (input.type === 'access' || input.type === 'portability') {
      await this.queues.add('privacy', 'data-export', { requestId: row!.id, userId });
    } else if (input.type === 'consent_withdrawal') {
      // Retrait de tous les consentements actifs, effectif immédiatement ; la demande reste tracée.
      const withdrawn = await this.db
        .update(schema.consents)
        .set({ withdrawnAt: new Date() })
        .where(and(eq(schema.consents.userId, userId), isNull(schema.consents.withdrawnAt)))
        .returning({ id: schema.consents.id, purpose: schema.consents.purpose });
      await this.db.update(schema.dataRequests).set({ processedAt: new Date(), outcome: `Consentements retirés : ${withdrawn.map((w) => w.purpose).join(', ') || 'aucun actif'}` }).where(eq(schema.dataRequests.id, row!.id));
      this.audit.record({ action: 'consent.withdrawn_all', entity: 'users', entityId: userId, after: { purposes: withdrawn.map((w) => w.purpose) } });
    }
    return this.getDataRequest(row!.id);
  }

  async dataRequestView(row: DataRequestRow) {
    let downloads: { json: string; pdf: string; expiresAt: string } | null = null;
    if (row.fileKey && row.processedAt) {
      const ttlDays = await this.settings.number('privacy.export_link_ttl_days', 7);
      const expiresAt = new Date(row.processedAt.getTime() + ttlDays * 86_400_000);
      if (expiresAt > new Date()) {
        const seconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
        downloads = { json: await this.storage.getSignedUrl(`${row.fileKey}.json`, seconds), pdf: await this.storage.getSignedUrl(`${row.fileKey}.pdf`, seconds), expiresAt: expiresAt.toISOString() };
      }
    }
    return {
      id: row.id,
      type: row.type,
      status: row.processedAt ? ('processed' as const) : ('pending' as const),
      receivedAt: row.receivedAt.toISOString(),
      dueOn: row.dueOn,
      processedAt: row.processedAt?.toISOString() ?? null,
      outcome: row.outcome,
      downloads,
    };
  }

  // --- Suppression du compte (5.15) : immédiate pour l'accès, anonymisation par le worker ---

  async deleteAccount(actor: UserActor, reason: string | undefined) {
    if (hasStaffRole(await this.users.rolesOf(actor.userId))) {
      throw AppError.forbidden('STAFF_ACCOUNT', 'Un compte du personnel est supprimé par un administrateur, pas depuis l\'application');
    }
    const user = this.users.requireUsable(await this.users.findById(actor.userId));
    const dueDays = await this.settings.number('privacy.data_request_due_days', 30);
    const [request] = await this.db
      .insert(schema.dataRequests)
      .values({ userId: user.id, type: 'deletion', dueOn: localDate(new Date(), dueDays), outcome: reason ? `Motif : ${reason}` : null })
      .returning();
    await this.db.update(schema.users).set({ status: 'deleted', deletedAt: new Date() }).where(eq(schema.users.id, user.id));
    await this.tokens.revokeAllForUser(user.id);
    this.audit.record({ action: 'privacy.account_deletion_requested', entity: 'users', entityId: user.id, after: { requestId: request!.id, reason: reason ?? null } });
    await this.queues.add('privacy', 'account-deletion', { requestId: request!.id, userId: user.id });
    return { requestId: request!.id, status: 'scheduled' as const };
  }
}
