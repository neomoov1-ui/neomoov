/**
 * Prospects d'affaires (phase 1 « entreprise autonome », 2 octobre 2026) : fiches (organisations, jamais un particulier),
 * import en bloc, fil des contacts, étapes, retrait définitif (« ne plus contacter », respecté sans exception), vues de
 * My Hub (coordonnées masquées) et synchronisation HubSpot par la file `crm`. Règle de base légale : une adresse
 * professionnelle publiée (consentement tacite), un formulaire du site, une relation d'affaires ou une recommandation ;
 * jamais une messagerie grand public (refusée à la validation).
 */
import { schema } from '@neomoov/db';
import {
  canContact, maskEmail, maskPhone, prospectScore, type ConsentBasis, type FollowupView, type OutboundCallView, type Page, type ProspectCreate, type ProspectDetailView, type ProspectImportResult,
  type ProspectInterest, type ProspectListQuery, type ProspectSegment, type ProspectSize, type ProspectSource, type ProspectStage, type ProspectTouchView, type ProspectUpdate, type ProspectView,
  type TouchChannel, type TouchDirection,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CrmJobsService } from '../crm/crm-jobs.service.js';
import { CrmSyncService } from '../crm/crm-sync.service.js';

export type ProspectRow = typeof schema.prospects.$inferSelect;
type TouchRow = typeof schema.prospectTouches.$inferSelect;
type FollowupRow = typeof schema.followups.$inferSelect;
type CallRow = typeof schema.outboundCalls.$inferSelect;

export interface ProspectUpsertInput extends ProspectCreate {
  source: ProspectSource;
  sourceRef?: string | null;
  leadId?: string | null;
  consentAt?: Date | null;
  consentSource?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  createdByUserId?: string | null;
}

export interface TouchInput {
  channel: TouchChannel;
  direction: TouchDirection;
  summary: string;
  result?: string | null;
  ref?: string | null;
  agentRunId?: string | null;
  userId?: string | null;
  occurredAt?: Date;
}

const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;

export function prospectView(p: ProspectRow): ProspectView {
  return {
    id: p.id, organizationName: p.organizationName, legalName: p.legalName, segment: p.segment as ProspectSegment, size: p.size as ProspectSize, interest: p.interest as ProspectInterest,
    source: p.source as ProspectSource, sourceRef: p.sourceRef, website: p.website, city: p.city, contactName: p.contactName, contactRole: p.contactRole,
    email: maskEmail(p.email), phone: maskPhone(p.phone), whatsappOk: p.whatsappOk, language: p.language === 'en' ? 'en' : 'fr', consentBasis: p.consentBasis as ConsentBasis,
    consentAt: iso(p.consentAt), unsubscribedAt: iso(p.unsubscribedAt), score: p.score, stage: p.stage as ProspectStage, stageReason: p.stageReason, lostAt: iso(p.lostAt), hubspotId: p.hubspotId,
    nextAction: p.nextAction, nextActionAt: iso(p.nextActionAt), sequenceKey: p.sequenceKey, sequenceChannel: p.sequenceChannel, firstContactAt: iso(p.firstContactAt),
    lastQuote: (p.lastQuote as ProspectView['lastQuote']) ?? null, leadId: p.leadId, organizationId: p.organizationId, notes: p.notes, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

export const touchView = (t: TouchRow): ProspectTouchView => ({
  id: t.id, prospectId: t.prospectId, channel: t.channel as TouchChannel, direction: t.direction as TouchDirection, summary: t.summary, result: t.result, ref: t.ref, agentRunId: t.agentRunId, userId: t.userId, occurredAt: t.occurredAt.toISOString(),
});

export const followupView = (f: FollowupRow): FollowupView => ({
  id: f.id, targetType: f.targetType as FollowupView['targetType'], targetId: f.targetId, prospectId: f.prospectId, channel: f.channel as FollowupView['channel'], dueAt: f.dueAt.toISOString(),
  status: f.status as FollowupView['status'], attempt: f.attempt, maxAttempts: f.maxAttempts, lastSentAt: iso(f.lastSentAt), closedAt: iso(f.closedAt), closeReason: f.closeReason,
  language: f.language === 'en' ? 'en' : 'fr', createdAt: f.createdAt.toISOString(),
});

export const callView = (c: CallRow): OutboundCallView => ({
  id: c.id, prospectId: c.prospectId, scriptKey: c.scriptKey, assistantId: c.assistantId, toPhone: maskPhone(c.toPhone), scheduledAt: c.scheduledAt.toISOString(), startedAt: iso(c.startedAt), endedAt: iso(c.endedAt),
  status: c.status as OutboundCallView['status'], vapiCallId: c.vapiCallId, result: c.result as OutboundCallView['result'], summary: c.summary, costMicros: c.costMicros, durationSeconds: c.durationSeconds,
  recordingConsent: c.recordingConsent, meetingAt: iso(c.meetingAt), callbackAt: iso(c.callbackAt), createdAt: c.createdAt.toISOString(),
});

/** Étapes dans lesquelles un prospect a répondu : une relance en cours n'a plus lieu d'être. */
export const REPLIED_STAGES: readonly ProspectStage[] = ['replied', 'meeting', 'quote', 'won'];

@Injectable()
export class ProspectsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly crmJobs: CrmJobsService,
    private readonly crmSync: CrmSyncService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async get(id: string): Promise<ProspectRow> {
    const [row] = await this.db.select().from(schema.prospects).where(eq(schema.prospects.id, id)).limit(1);
    if (!row) throw AppError.notFound('PROSPECT_NOT_FOUND', 'Prospect introuvable');
    return row;
  }

  async list(query: ProspectListQuery): Promise<Page<ProspectView>> {
    const conditions: SQL[] = [];
    if (query.stage) conditions.push(eq(schema.prospects.stage, query.stage));
    if (query.source) conditions.push(eq(schema.prospects.source, query.source));
    if (query.segment) conditions.push(eq(schema.prospects.segment, query.segment));
    if (query.minScore !== undefined) conditions.push(gte(schema.prospects.score, query.minScore));
    if (query.status) conditions.push(eq(schema.prospects.stage, query.status));
    if (query.q) {
      const like = `%${query.q.replace(/[%_]/g, '')}%`;
      conditions.push(or(ilike(schema.prospects.organizationName, like), ilike(schema.prospects.contactName, like), ilike(schema.prospects.city, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.prospects).where(where).orderBy(desc(schema.prospects.score), desc(schema.prospects.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.prospects).where(where),
    ]);
    return { items: rows.map(prospectView), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string): Promise<ProspectDetailView> {
    const prospect = await this.get(id);
    const [touches, calls, followups] = await Promise.all([
      this.db.select().from(schema.prospectTouches).where(eq(schema.prospectTouches.prospectId, id)).orderBy(desc(schema.prospectTouches.occurredAt)).limit(100),
      this.db.select().from(schema.outboundCalls).where(eq(schema.outboundCalls.prospectId, id)).orderBy(desc(schema.outboundCalls.createdAt)).limit(50),
      this.db.select().from(schema.followups).where(eq(schema.followups.prospectId, id)).orderBy(desc(schema.followups.createdAt)).limit(50),
    ]);
    return { prospect: prospectView(prospect), touches: touches.map(touchView), calls: calls.map(callView), followups: followups.map(followupView) };
  }

  /**
   * Crée un prospect, ou complète la fiche existante (même adresse, même source et référence, ou même prospect du site)
   * sans jamais réveiller un prospect retiré. Le score initial vient du segment, des canaux et de la réputation.
   */
  async upsert(input: ProspectUpsertInput): Promise<{ row: ProspectRow; created: boolean; reason?: string }> {
    const email = input.email?.toLowerCase() ?? null;
    const matches: SQL[] = [];
    if (email) matches.push(eq(schema.prospects.email, email));
    if (input.sourceRef) matches.push(and(eq(schema.prospects.source, input.source), eq(schema.prospects.sourceRef, input.sourceRef))!);
    if (input.leadId) matches.push(eq(schema.prospects.leadId, input.leadId));
    const [existing] = matches.length ? await this.db.select().from(schema.prospects).where(or(...matches)).limit(1) : [];
    if (existing) {
      if (existing.stage === 'do_not_contact' || existing.unsubscribedAt) return { row: existing, created: false, reason: 'do_not_contact' };
      // Complète les champs vides ; ne change ni l'étape ni le consentement déjà journalisé.
      const [updated] = await this.db
        .update(schema.prospects)
        .set({
          legalName: existing.legalName ?? input.legalName ?? null, website: existing.website ?? input.website ?? null, city: existing.city ?? input.city ?? null,
          contactName: existing.contactName ?? input.contactName ?? null, contactRole: existing.contactRole ?? input.contactRole ?? null, email: existing.email ?? email,
          phone: existing.phone ?? input.phone ?? null, whatsappOk: existing.whatsappOk || input.whatsappOk, leadId: existing.leadId ?? input.leadId ?? null,
          notes: existing.notes ?? input.notes ?? null, sourceRef: existing.sourceRef ?? input.sourceRef ?? null,
        })
        .where(eq(schema.prospects.id, existing.id))
        .returning();
      return { row: updated!, created: false };
    }
    const score = prospectScore({ segment: input.segment, hasEmail: Boolean(email), hasPhone: Boolean(input.phone), hasWebsite: Boolean(input.website), rating: input.rating ?? null, reviewCount: input.reviewCount ?? null, interest: 'unknown', size: 'unknown' });
    const [row] = await this.db
      .insert(schema.prospects)
      .values({
        organizationName: input.organizationName, legalName: input.legalName ?? null, segment: input.segment, source: input.source, sourceRef: input.sourceRef ?? null, website: input.website ?? null,
        city: input.city ?? null, rating: input.rating === null || input.rating === undefined ? null : input.rating.toFixed(1), reviewCount: input.reviewCount ?? null,
        contactName: input.contactName ?? null, contactRole: input.contactRole ?? null, email, phone: input.phone ?? null, whatsappOk: input.whatsappOk, language: input.language,
        consentBasis: input.consentBasis, consentAt: input.consentAt ?? (input.consentBasis === 'form' ? new Date() : null), consentSource: input.consentSource ?? input.source,
        score, leadId: input.leadId ?? null, notes: input.notes ?? null, createdByUserId: input.createdByUserId ?? null,
      })
      .returning();
    this.audit.record({ action: 'sales.prospect_created', entity: 'prospects', entityId: row!.id, after: { source: input.source, segment: input.segment, consentBasis: input.consentBasis, score } });
    return { row: row!, created: true };
  }

  /** Import en bloc (My Hub, fichier CSV) : chaque ligne est validée à part ; les refus sont rendus avec leur motif. */
  async import(rows: ProspectCreate[], userId: string | null): Promise<ProspectImportResult> {
    const result: ProspectImportResult = { imported: 0, updated: 0, skipped: [] };
    for (const [index, row] of rows.entries()) {
      try {
        const out = await this.upsert({ ...row, source: 'csv_import', createdByUserId: userId });
        if (out.reason) result.skipped.push({ row: index + 1, reason: out.reason });
        else if (out.created) result.imported += 1;
        else result.updated += 1;
      } catch (error) {
        result.skipped.push({ row: index + 1, reason: error instanceof AppError ? error.code : 'error' });
      }
    }
    this.audit.record({ action: 'sales.prospects_imported', entity: 'prospects', after: { imported: result.imported, updated: result.updated, skipped: result.skipped.length } });
    return result;
  }

  async update(id: string, input: ProspectUpdate, userId: string | null): Promise<ProspectView> {
    const before = await this.get(id);
    if (before.stage === 'do_not_contact' && input.stage) throw AppError.conflict('PROSPECT_DO_NOT_CONTACT', 'Ce prospect a demandé le retrait : son étape ne change plus');
    const [row] = await this.db
      .update(schema.prospects)
      .set({
        ...(input.stage ? { stage: input.stage, lostAt: input.stage === 'lost' ? new Date() : before.lostAt } : {}),
        ...(input.stageReason !== undefined ? { stageReason: input.stageReason } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
        ...(input.nextActionAt !== undefined ? { nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null } : {}),
      })
      .where(eq(schema.prospects.id, id))
      .returning();
    this.audit.record({ action: 'sales.prospect_updated', entity: 'prospects', entityId: id, before: { stage: before.stage }, after: { ...input, by: userId } });
    if (input.stage && input.stage !== before.stage) {
      await this.touch(id, { channel: 'note', direction: 'outbound', summary: `Étape ${before.stage} → ${input.stage}${input.stageReason ? ` : ${input.stageReason}` : ''}`, userId });
      if (REPLIED_STAGES.includes(input.stage) || input.stage === 'lost') await this.cancelFollowups(id, input.stage === 'lost' ? 'lost' : 'replied');
      this.syncCrm(id, `stage-${input.stage}`);
    }
    return prospectView(row!);
  }

  /** Ligne du fil des contacts ; un premier contact sortant date `first_contact_at`. */
  async touch(prospectId: string, input: TouchInput): Promise<string> {
    const [row] = await this.db
      .insert(schema.prospectTouches)
      .values({ prospectId, channel: input.channel, direction: input.direction, summary: input.summary.slice(0, 500), result: input.result ?? null, ref: input.ref ?? null, agentRunId: input.agentRunId ?? null, userId: input.userId ?? null, occurredAt: input.occurredAt ?? new Date() })
      .returning({ id: schema.prospectTouches.id });
    if (input.direction === 'outbound' && input.channel !== 'note') {
      await this.db.update(schema.prospects).set({ firstContactAt: sql`COALESCE(${schema.prospects.firstContactAt}, now())` }).where(eq(schema.prospects.id, prospectId));
    }
    return row!.id;
  }

  /** Une ligne du fil porte déjà cette référence (rejeu d'une approbation, tâche relancée). */
  async touched(ref: string): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.prospectTouches.id }).from(schema.prospectTouches).where(eq(schema.prospectTouches.ref, ref)).limit(1);
    return Boolean(row);
  }

  async setStage(id: string, stage: ProspectStage, reason: string | null, patch: Partial<typeof schema.prospects.$inferInsert> = {}): Promise<ProspectRow> {
    const [row] = await this.db
      .update(schema.prospects)
      .set({ stage, stageReason: reason, ...(stage === 'lost' ? { lostAt: new Date() } : {}), ...patch })
      .where(eq(schema.prospects.id, id))
      .returning();
    if (!row) throw AppError.notFound('PROSPECT_NOT_FOUND', 'Prospect introuvable');
    return row;
  }

  /** Le prospect peut être démarché (retrait, « ne plus contacter », compte gagné, repos après un refus). */
  async contactable(row: ProspectRow, now = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
    const cooldown = await this.settings.number('sales.lost_cooldown_days', 180);
    if (canContact({ stage: row.stage as ProspectStage, unsubscribedAt: row.unsubscribedAt, lostAt: row.lostAt }, now, cooldown)) return { ok: true };
    return { ok: false, reason: row.unsubscribedAt || row.stage === 'do_not_contact' ? 'Prospect retiré (ne plus contacter) : aucun envoi ni appel' : row.stage === 'won' ? 'Compte déjà ouvert' : `Prospect perdu : repos de ${cooldown} jours avant toute relance` };
  }

  /**
   * Retrait définitif : étape « ne plus contacter », relances et appels planifiés annulés, journal, HubSpot prévenu
   * (transaction perdue, note). Respecté sans exception par tous les envois et appels.
   */
  async markDoNotContact(id: string, reason: string, by: { agentRunId?: string | null; userId?: string | null } = {}): Promise<ProspectRow> {
    const before = await this.get(id);
    const now = new Date();
    const row = await this.setStage(id, 'do_not_contact', reason.slice(0, 500), { unsubscribedAt: before.unsubscribedAt ?? now, nextAction: null, nextActionAt: null });
    await this.cancelFollowups(id, 'do_not_contact');
    await this.db.update(schema.outboundCalls).set({ status: 'cancelled' }).where(and(eq(schema.outboundCalls.prospectId, id), inArray(schema.outboundCalls.status, ['scheduled', 'calling'])));
    await this.touch(id, { channel: 'note', direction: 'inbound', summary: `Retrait demandé : ${reason}`.slice(0, 500), result: 'do_not_contact', agentRunId: by.agentRunId ?? null, userId: by.userId ?? null, occurredAt: now });
    await this.audit.recordSystem({ action: 'sales.do_not_contact', entity: 'prospects', entityId: id, before: { stage: before.stage }, after: { reason, by: by.userId ?? null } });
    this.syncCrm(id, 'do-not-contact');
    await this.note(id, `Retrait demandé (ne plus contacter) : ${reason}`, now);
    return row;
  }

  /** Prospect qui porte ce courriel professionnel (réponse reçue dans la boîte unifiée), le plus récent d'abord ; null sinon. */
  async findByEmail(email: string): Promise<ProspectRow | null> {
    const [row] = await this.db.select().from(schema.prospects).where(eq(schema.prospects.email, email.trim().toLowerCase())).orderBy(desc(schema.prospects.updatedAt)).limit(1);
    return row ?? null;
  }

  /** Réponse reçue d'un prospect (boîte unifiée, agent D) : étape « a répondu », relances closes. */
  async incomingReply(id: string, channel: TouchChannel, summary: string): Promise<ProspectRow> {
    const before = await this.get(id);
    await this.touch(id, { channel, direction: 'inbound', summary, result: 'replied' });
    await this.cancelFollowups(id, 'replied');
    const row = REPLIED_STAGES.includes(before.stage as ProspectStage) || before.stage === 'do_not_contact' ? before : await this.setStage(id, 'replied', null);
    this.syncCrm(id, 'replied');
    return row;
  }

  async cancelFollowups(prospectId: string, reason: string): Promise<number> {
    const rows = await this.db
      .update(schema.followups)
      .set({ status: 'cancelled', closedAt: new Date(), closeReason: reason })
      .where(and(eq(schema.followups.prospectId, prospectId), inArray(schema.followups.status, ['scheduled', 'sent'])))
      .returning({ id: schema.followups.id });
    return rows.length;
  }

  /** Synchronisation HubSpot par la file `crm` (asynchrone, rejouable) ; jamais sans base légale (vérifié par le service CRM). */
  syncCrm(id: string, reason: string): void {
    void this.crmJobs.enqueue('prospect', id, reason);
  }

  /** Note sur la fiche HubSpot ; une panne du fournisseur est journalisée, jamais bloquante. */
  async note(id: string, body: string, occurredAt = new Date()): Promise<void> {
    try {
      await this.crmSync.noteProspect(id, body, occurredAt);
    } catch (error) {
      this.logger.warn({ err: error, prospectId: id }, 'Note HubSpot non écrite (reprise par la passe CRM)');
    }
  }

  /** Prospects créés aujourd'hui (heure locale) à partir des sources ouvertes : plafond quotidien. */
  async createdTodayFromPlaces(now: Date, timeZone: string): Promise<number> {
    const [row] = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM prospects WHERE source = 'google_places' AND created_at >= (date_trunc('day', ${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone})`);
    return Number(row?.n ?? 0);
  }

  /** Références déjà connues pour une source (lieux Google déjà transformés en prospects). */
  async knownSourceRefs(source: ProspectSource, refs: string[]): Promise<Set<string>> {
    if (!refs.length) return new Set();
    const rows = await this.db.select({ ref: schema.prospects.sourceRef }).from(schema.prospects).where(and(eq(schema.prospects.source, source), inArray(schema.prospects.sourceRef, refs)));
    return new Set(rows.map((r) => r.ref!).filter(Boolean));
  }

  /** Prospects en étape « nouveau » à qualifier (passe de prospection). */
  async toQualify(limit: number): Promise<ProspectRow[]> {
    return this.db.select().from(schema.prospects).where(eq(schema.prospects.stage, 'new')).orderBy(desc(schema.prospects.score), schema.prospects.createdAt).limit(limit);
  }
}
