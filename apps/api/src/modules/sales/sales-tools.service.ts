/**
 * Outils des agents commerciaux (phase 1 « entreprise autonome ») et exécution des demandes : enregistrés dans le registre
 * des outils des agents (`AgentToolsService.register`), donc déclarés par l'agent, validés par Zod, bornés et journalisés
 * comme tout outil ; les actions qui engagent l'entreprise (séquence, appel, devis, compte, décision hors grille, relance)
 * passent par la file d'approbation selon le mode de l'agent et sont exécutées une seule fois par clé d'idempotence.
 * Devis entreprise à partir de la grille des réglages (`sales.business_grid`) : dans la grille, exécuté (mode automatique) ;
 * hors grille ou tarif négocié, approbation humaine obligatoire. Compte entreprise ouvert par les services des
 * organisations (organisation cliente de type `business`, invitation du propriétaire par courriel).
 */
import { schema } from '@neomoov/db';
import {
  businessQuoteFromGrid, createBusinessQuoteToolSchema, createProspectToolSchema, isBusinessEmail, listLeadProspectsToolSchema, markDoNotContactToolSchema, openBusinessAccountToolSchema,
  OWNER_ROLE_CODE, parseBusinessGrid, proposeSalesDecisionToolSchema, prospectScore, qualifyProspectToolSchema, scheduleCallToolSchema, scheduleMeetingToolSchema, searchProspectsToolSchema,
  sendFollowupToolSchema, startSequenceToolSchema, type BusinessQuoteView, type ProspectSegment, type ProspectStage,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { CALENDAR_PROVIDER, PLACES_PROVIDER, type CalendarProvider, type PlacesProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { AgentRunContext } from '../agents/agent-runner.service.js';
import { AgentToolsService, done, notFound, refused, type ActionMeta, type ToolResult } from '../agents/agent-tools.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { FollowupsService } from './followups.service.js';
import { OutboundCallsService } from './outbound-calls.service.js';
import { ProspectsService, type ProspectRow } from './prospects.service.js';
import { renderSequenceText, sequenceFor } from './sequences.js';

type Input<T extends z.ZodType> = z.infer<T>;

const pending = (approvalId: string, data: unknown, message: string): ToolResult => ({ ok: true, status: 'pending_approval', approvalId, data, message });
const slug = (value: string): string => `${value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'entreprise'}-${randomBytes(2).toString('hex')}`;

@Injectable()
export class SalesToolsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(PLACES_PROVIDER) private readonly places: PlacesProvider,
    @Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider,
    private readonly settings: SettingsService,
    private readonly tools: AgentToolsService,
    private readonly prospects: ProspectsService,
    private readonly calls: OutboundCallsService,
    private readonly followups: FollowupsService,
    private readonly outbox: NotificationsOutbox,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  onModuleInit() {
    this.tools.register('searchProspects', { description: 'Établissements d\'une catégorie dans une zone (source ouverte : Google Places), déjà connus exclus. Données publiques d\'organisations seulement.', schema: searchProspectsToolSchema, run: (c, i) => this.searchProspects(c, i) });
    this.tools.register('listLeadProspects', { description: 'Demandes d\'entreprises et de partenaires reçues par le site (formulaire avec consentement) pas encore transformées en prospects.', schema: listLeadProspectsToolSchema, run: (c, i) => this.listLeadProspects(c, i) });
    this.tools.register('createProspect', { description: 'Crée un prospect d\'affaires (organisation, segment, source, coordonnées professionnelles, base légale). Jamais un particulier ; plafond quotidien pour les sources ouvertes.', schema: createProspectToolSchema, run: (c, i) => this.createProspect(c, i) });
    this.tools.register('qualifyProspect', { description: 'Qualifie un prospect : segment, taille, intérêt, retenu ou écarté avec motif ; le score est recalculé.', schema: qualifyProspectToolSchema, run: (c, i) => this.qualifyProspect(c, i) });
    this.tools.register('startSequence', { description: 'Lance la séquence approuvée (message d\'introduction puis relances J+3, J+10, J+30) par courriel professionnel, ou WhatsApp sur un numéro d\'affaires. Approbation selon le mode.', schema: startSequenceToolSchema, run: (c, i) => this.startSequence(c, i) });
    this.tools.register('scheduleCall', { description: 'Planifie un appel sortant de l\'assistant commercial (heures de bureau, fuseau de Montréal). Approbation selon le mode.', schema: scheduleCallToolSchema, run: (c, i) => this.scheduleCall(c, i) });
    this.tools.register('scheduleMeeting', { description: 'Pose un rendez-vous dans l\'agenda du fondateur et envoie la confirmation au prospect.', schema: scheduleMeetingToolSchema, run: (c, i) => this.scheduleMeeting(c, i) });
    this.tools.register('createBusinessQuote', { description: 'Devis entreprise à partir de la grille (volume mensuel, remise, délai de paiement) ; hors grille : approbation humaine.', schema: createBusinessQuoteToolSchema, run: (c, i) => this.createBusinessQuote(c, i) });
    this.tools.register('openBusinessAccount', { description: 'Ouvre le compte entreprise (organisation cliente et invitation de son propriétaire par courriel). Approbation selon le mode.', schema: openBusinessAccountToolSchema, run: (c, i) => this.openBusinessAccount(c, i) });
    this.tools.register('markDoNotContact', { description: 'Retrait définitif d\'un prospect (ne plus contacter) : annule relances et appels, prévient HubSpot. Toujours exécuté.', schema: markDoNotContactToolSchema, run: (c, i) => this.markDoNotContact(c, i) });
    this.tools.register('proposeSalesDecision', { description: 'Soumet à une personne une demande hors grille (tarif négocié, contrat particulier) avec sa justification.', schema: proposeSalesDecisionToolSchema, run: (c, i) => this.proposeSalesDecision(c, i) });
    this.tools.register('sendFollowup', { description: 'Envoie une relance échue par son canal d\'origine (texte rédigé à partir du fil et du gabarit approuvé). Approbation selon le mode.', schema: sendFollowupToolSchema, run: (c, i) => this.sendFollowup(c, i) });
    this.tools.registerAction('startSequence', (data, meta) => this.executeStartSequence(data, meta));
    this.tools.registerAction('scheduleCall', (data, meta) => this.executeScheduleCall(data, meta));
    this.tools.registerAction('createBusinessQuote', (data, meta) => this.executeQuote(data, meta));
    this.tools.registerAction('openBusinessAccount', (data, meta) => this.executeOpenAccount(data, meta));
    this.tools.registerAction('proposeSalesDecision', (data, meta) => this.executeSalesDecision(data, meta));
    this.tools.registerAction('sendFollowup', (data, meta) => this.followups.send(data, meta));
  }

  // Prospection -----------------------------------------------------------------------------------------------------

  private async searchProspects(_ctx: AgentRunContext, input: Input<typeof searchProspectsToolSchema>): Promise<ToolResult> {
    const found = await this.places.searchText({ query: `${input.category} ${input.zone}`, maxResults: input.limit });
    const open = found.filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY');
    const known = await this.prospects.knownSourceRefs('google_places', open.map((p) => p.placeId));
    const candidates = open.filter((p) => !known.has(p.placeId)).map((p) => ({ placeId: p.placeId, name: p.name, city: p.city, phone: p.phone, website: p.website, rating: p.rating, reviewCount: p.reviewCount, types: p.types.slice(0, 5) }));
    return done({ candidates, known: known.size }, `${candidates.length} établissement(s) nouveau(x)`);
  }

  private async listLeadProspects(_ctx: AgentRunContext, input: Input<typeof listLeadProspectsToolSchema>): Promise<ToolResult> {
    const rows = await this.db
      .select({ id: schema.leads.id, kind: schema.leads.kind, firstName: schema.leads.firstName, lastName: schema.leads.lastName, city: schema.leads.city, language: schema.leads.language, message: schema.leads.message, email: schema.leads.email, phone: schema.leads.phone, consentAt: schema.leads.consentAt, createdAt: schema.leads.createdAt })
      .from(schema.leads)
      .leftJoin(schema.prospects, eq(schema.prospects.leadId, schema.leads.id))
      .where(and(sql`${schema.leads.kind} IN ('business', 'partner')`, sql`${schema.leads.status} <> 'discarded'`, sql`${schema.leads.consentAt} IS NOT NULL`, isNull(schema.prospects.id)))
      .orderBy(schema.leads.createdAt)
      .limit(input.limit);
    const leads = rows.map((l) => ({
      leadId: l.id, kind: l.kind, contactName: [l.firstName, l.lastName].filter(Boolean).join(' ') || null, city: l.city, language: l.language, message: (l.message ?? '').slice(0, 300),
      hasBusinessEmail: Boolean(l.email && isBusinessEmail(l.email)), hasPhone: Boolean(l.phone), receivedAt: l.createdAt.toISOString(),
    }));
    return done({ leads }, `${leads.length} demande(s) du site`);
  }

  private async createProspect(ctx: AgentRunContext, input: Input<typeof createProspectToolSchema>): Promise<ToolResult> {
    if (input.source === 'google_places') {
      const [tz, cap] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.number('sales.daily_new_prospects', 20)]);
      if ((await this.prospects.createdTodayFromPlaces(new Date(), tz)) >= cap) return refused(`Plafond quotidien de ${cap} nouveaux prospects atteint`);
    }
    let lead: { email: string | null; phone: string | null; consentAt: Date | null } | null = null;
    if (input.leadId) {
      const [row] = await this.db.select({ email: schema.leads.email, phone: schema.leads.phone, consentAt: schema.leads.consentAt }).from(schema.leads).where(eq(schema.leads.id, input.leadId)).limit(1);
      if (!row) return notFound('Demande du site introuvable');
      if (!row.consentAt) return refused('Demande du site sans consentement : aucun démarchage');
      lead = row;
    }
    const email = input.email ?? (lead?.email && isBusinessEmail(lead.email) ? lead.email.toLowerCase() : null);
    const phone = input.phone ?? lead?.phone ?? null;
    if (!email && !phone) return refused('Aucun canal professionnel (courriel d\'entreprise ou numéro d\'affaires)');
    const { row, created, reason } = await this.prospects.upsert({
      organizationName: input.organizationName, segment: input.segment, source: input.source, sourceRef: input.sourceRef ?? null, website: input.website, city: input.city, contactName: input.contactName, contactRole: input.contactRole,
      ...(email ? { email } : {}), ...(phone ? { phone } : {}), whatsappOk: input.whatsappOk, language: input.language, consentBasis: lead ? 'form' : input.consentBasis, consentAt: lead?.consentAt ?? null,
      consentSource: lead ? 'formulaire du site' : input.source === 'google_places' ? 'fiche publique Google' : input.source, rating: input.rating, reviewCount: input.reviewCount, leadId: input.leadId ?? null, notes: undefined,
    } as never);
    if (reason === 'do_not_contact') return refused('Ce prospect a demandé le retrait : rien n\'est créé ni modifié', { prospectId: row.id });
    if (created) {
      await this.prospects.touch(row.id, { channel: 'note', direction: 'outbound', summary: `Prospect créé (${input.source}, base légale : ${row.consentBasis})`, agentRunId: ctx.runId });
      if (input.leadId) await this.db.update(schema.leads).set({ status: 'contacted' }).where(and(eq(schema.leads.id, input.leadId), eq(schema.leads.status, 'new')));
    }
    return done({ prospectId: row.id, created, stage: row.stage, score: row.score }, created ? 'Prospect créé' : 'Prospect déjà connu, fiche complétée');
  }

  private async qualifyProspect(ctx: AgentRunContext, input: Input<typeof qualifyProspectToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    if (row.stage === 'do_not_contact') return refused('Prospect retiré : aucune qualification');
    const score = prospectScore({ segment: input.segment, hasEmail: Boolean(row.email), hasPhone: Boolean(row.phone), hasWebsite: Boolean(row.website), rating: row.rating === null ? null : Number(row.rating), reviewCount: row.reviewCount, interest: input.interest, size: input.size });
    const stage: ProspectStage = input.qualified ? (row.stage === 'new' ? 'qualified' : (row.stage as ProspectStage)) : 'lost';
    const updated = await this.prospects.setStage(row.id, stage, input.reason.slice(0, 500), { segment: input.segment, size: input.size, interest: input.interest, score });
    await this.prospects.touch(row.id, { channel: 'note', direction: 'outbound', summary: `${input.qualified ? 'Qualifié' : 'Écarté'} (${input.segment}, ${input.size}, intérêt ${input.interest}, score ${score}) : ${input.reason}`.slice(0, 500), agentRunId: ctx.runId });
    this.audit.record({ action: 'sales.prospect_qualified', entity: 'prospects', entityId: row.id, after: { qualified: input.qualified, segment: input.segment, score, agentRunId: ctx.runId } });
    this.prospects.syncCrm(row.id, 'qualified');
    return done({ prospectId: row.id, stage: updated.stage, score }, input.qualified ? 'Prospect qualifié' : 'Prospect écarté');
  }

  /** Canal de la séquence : courriel professionnel d'abord, WhatsApp sur un numéro d'affaires sinon. */
  private channelFor(row: ProspectRow): 'email' | 'whatsapp' | null {
    if (row.email) return 'email';
    if (row.phone && row.whatsappOk) return 'whatsapp';
    return null;
  }

  private async startSequence(ctx: AgentRunContext, input: Input<typeof startSequenceToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    const contactable = await this.prospects.contactable(row);
    if (!contactable.ok) return refused(contactable.reason);
    if (row.sequenceKey) return refused('Une séquence est déjà en cours pour ce prospect');
    if (!['new', 'qualified'].includes(row.stage)) return refused(`Étape ${row.stage} : la séquence ne s'applique qu'à un prospect nouveau ou qualifié`);
    const channel = this.channelFor(row);
    if (!channel) return refused('Aucun canal : courriel professionnel ou numéro d\'affaires WhatsApp requis');
    const sequence = sequenceFor(row.segment as ProspectSegment, await this.settings.get<unknown>('sales.sequence_by_segment', null), input.sequenceKey ?? null);
    const data = { prospectId: row.id, sequenceKey: sequence.key, channel, organizationName: row.organizationName };
    if (ctx.mode === 'manual') return refused('Agent en mode manuel : escalader à un humain');
    if (ctx.mode === 'approval') return pending(await this.tools.propose(ctx, 'startSequence', data, input.justification), data, 'Séquence proposée à l\'approbation humaine');
    const result = await this.executeStartSequence(data, { approvalId: null, approverUserId: null, agentCode: ctx.agent.code, idempotencyKey: `run-${ctx.runId}-sequence-${row.id}` });
    return done(result, 'Séquence lancée');
  }

  async executeStartSequence(data: Record<string, unknown>, meta: ActionMeta): Promise<Record<string, unknown>> {
    const prospectId = String(data['prospectId'] ?? '');
    const row = await this.prospects.get(prospectId);
    if (await this.prospects.touched(meta.idempotencyKey)) return { prospectId, replayed: true };
    const contactable = await this.prospects.contactable(row);
    if (!contactable.ok) throw AppError.conflict('PROSPECT_NOT_CONTACTABLE', contactable.reason);
    const channel: 'email' | 'whatsapp' = data['channel'] === 'whatsapp' ? 'whatsapp' : 'email';
    const address = channel === 'email' ? row.email : row.phone;
    if (!address) throw AppError.conflict('PROSPECT_NO_CHANNEL', 'Aucune coordonnée pour ce canal');
    const language: 'fr' | 'en' = row.language === 'en' ? 'en' : 'fr';
    const sequence = sequenceFor(row.segment as ProspectSegment, await this.settings.get<unknown>('sales.sequence_by_segment', null), typeof data['sequenceKey'] === 'string' ? data['sequenceKey'] : null);
    const senderName = await this.settings.string('sales.sender_name', 'L\'équipe Neomoov');
    const intro = renderSequenceText(sequence.intro[language], language, { organizationName: row.organizationName, contactName: row.contactName, senderName });
    const now = new Date();
    await this.outbox.queue({ recipientAddress: address, channel, template: 'sales.message', language, data: { subject: intro.subject, text: intro.text, prospectId: row.id, sequenceKey: sequence.key, step: 0 } });
    await this.prospects.setStage(row.id, 'contacted', null, { sequenceKey: sequence.key, sequenceChannel: channel, firstContactAt: row.firstContactAt ?? now, nextAction: 'followup' });
    await this.prospects.touch(row.id, { channel, direction: 'outbound', summary: `Séquence ${sequence.key}, message 1 : ${intro.subject}`, result: 'sent', ref: meta.idempotencyKey, occurredAt: now });
    const followup = await this.followups.open({ targetType: 'prospect', targetId: row.id, prospectId: row.id, channel, referenceAt: now, language, context: { sequenceKey: sequence.key } });
    this.audit.record({ action: 'sales.sequence_started', entity: 'prospects', entityId: row.id, after: { sequenceKey: sequence.key, channel, approvalId: meta.approvalId, agentCode: meta.agentCode } });
    this.prospects.syncCrm(row.id, 'sequence');
    await this.prospects.note(row.id, `Séquence ${sequence.key} lancée par ${channel} : ${intro.subject}`, now);
    return { prospectId: row.id, sequenceKey: sequence.key, channel, followupId: followup?.id ?? null, sentAt: now.toISOString() };
  }

  // Appels et rendez-vous -------------------------------------------------------------------------------------------

  private async scheduleCall(ctx: AgentRunContext, input: Input<typeof scheduleCallToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    const contactable = await this.prospects.contactable(row);
    if (!contactable.ok) return refused(contactable.reason);
    if (!row.phone) return refused('Aucun numéro d\'affaires pour ce prospect');
    const at = await this.calls.nextSlot(input.at ? new Date(input.at) : new Date());
    const data = { prospectId: row.id, scriptKey: input.scriptKey, at: at.toISOString(), organizationName: row.organizationName };
    if (ctx.mode === 'manual') return refused('Agent en mode manuel : escalader à un humain');
    if (ctx.mode === 'approval') return pending(await this.tools.propose(ctx, 'scheduleCall', data, input.justification), data, 'Appel proposé à l\'approbation humaine');
    const result = await this.executeScheduleCall(data, { approvalId: null, approverUserId: null, agentCode: ctx.agent.code, idempotencyKey: `run-${ctx.runId}-call-${row.id}-${at.getTime()}` });
    return done(result, `Appel planifié le ${at.toISOString()}`);
  }

  async executeScheduleCall(data: Record<string, unknown>, meta: ActionMeta): Promise<Record<string, unknown>> {
    const prospectId = String(data['prospectId'] ?? '');
    if (await this.prospects.touched(`call-${meta.idempotencyKey}`)) return { prospectId, replayed: true };
    const at = typeof data['at'] === 'string' && !Number.isNaN(Date.parse(data['at'])) ? new Date(data['at']) : await this.calls.nextSlot(new Date());
    const call = await this.calls.schedule({ prospectId, scriptKey: typeof data['scriptKey'] === 'string' ? data['scriptKey'] : 'b2b_intro', at: at < new Date() ? await this.calls.nextSlot(new Date()) : at, userId: meta.approverUserId });
    await this.prospects.touch(prospectId, { channel: 'note', direction: 'outbound', summary: `Appel ${call.id} planifié (${meta.approvalId ? 'approuvé' : 'automatique'})`, ref: `call-${meta.idempotencyKey}` });
    return { callId: call.id, scheduledAt: call.scheduledAt.toISOString() };
  }

  private async scheduleMeeting(ctx: AgentRunContext, input: Input<typeof scheduleMeetingToolSchema>): Promise<ToolResult> {
    const result = await this.bookMeeting(input.prospectId, { startsAt: new Date(input.startsAt), durationMinutes: input.durationMinutes, subject: input.subject, notes: input.notes }, { agentRunId: ctx.runId, userId: null });
    return done(result, 'Rendez-vous posé dans l\'agenda et confirmé au prospect');
  }

  /** Rendez-vous : événement dans l'agenda (réel ou simulé), confirmation au prospect, alerte au fondateur, fil et HubSpot. */
  async bookMeeting(prospectId: string, input: { startsAt: Date; durationMinutes?: number | undefined; subject?: string | undefined; notes?: string | undefined }, by: { agentRunId: string | null; userId: string | null }): Promise<Record<string, unknown>> {
    const row = await this.prospects.get(prospectId);
    if (row.stage === 'do_not_contact' || row.unsubscribedAt) throw AppError.conflict('PROSPECT_NOT_CONTACTABLE', 'Prospect retiré');
    if (input.startsAt.getTime() < Date.now()) throw new AppError('MEETING_IN_PAST', 'Le rendez-vous est dans le passé', 400);
    const [duration, tz, founderEmail] = await Promise.all([this.settings.number('sales.meeting_duration_minutes', 30), this.settings.string('service.time_zone', 'America/Toronto'), this.settings.string('sales.meeting_calendar_email', '')]);
    const minutes = input.durationMinutes ?? duration;
    const endsAt = new Date(input.startsAt.getTime() + minutes * 60_000);
    const title = input.subject ?? `Neomoov × ${row.organizationName}`;
    const attendees = [...(row.email ? [{ email: row.email, ...(row.contactName ? { name: row.contactName } : {}) }] : []), ...(founderEmail ? [{ email: founderEmail }] : [])];
    const event = await this.calendar.createEvent({ title, description: [`Prospect : ${row.organizationName}`, row.contactName ? `Contact : ${row.contactName}${row.contactRole ? ` (${row.contactRole})` : ''}` : null, row.phone ? `Téléphone : ${row.phone}` : null, input.notes ? `Notes : ${input.notes}` : null, 'Fiche : My Hub, Ventes'].filter(Boolean).join('\n'), startsAt: input.startsAt, endsAt, attendees, timeZone: tz });
    const language: 'fr' | 'en' = row.language === 'en' ? 'en' : 'fr';
    await this.prospects.setStage(row.id, 'meeting', null, { nextAction: 'meeting', nextActionAt: input.startsAt });
    await this.prospects.cancelFollowups(row.id, 'replied');
    await this.prospects.touch(row.id, { channel: 'meeting', direction: 'outbound', summary: `Rendez-vous le ${input.startsAt.toISOString()} (${minutes} min), événement ${event.eventId}`, result: 'meeting', ref: `meeting-${event.eventId}`, agentRunId: by.agentRunId, userId: by.userId });
    if (row.email) await this.outbox.queue({ recipientAddress: row.email, channel: 'email', template: 'sales.meeting_confirmation', language, data: { organizationName: row.organizationName, contactName: row.contactName, startsAt: input.startsAt.toISOString(), durationMinutes: minutes, link: event.htmlLink, prospectId: row.id } });
    await this.outbox.queueForStaff('alert.sales_meeting', { organizationName: row.organizationName, startsAt: input.startsAt.toISOString(), link: event.htmlLink, prospectId: row.id });
    this.audit.record({ action: 'sales.meeting_booked', entity: 'prospects', entityId: row.id, after: { eventId: event.eventId, startsAt: input.startsAt.toISOString(), by: by.userId ?? by.agentRunId } });
    this.prospects.syncCrm(row.id, 'meeting');
    await this.prospects.note(row.id, `Rendez-vous pris le ${input.startsAt.toISOString()} (${minutes} minutes)`);
    return { eventId: event.eventId, htmlLink: event.htmlLink, startsAt: input.startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  // Exécution des demandes ------------------------------------------------------------------------------------------

  private async createBusinessQuote(ctx: AgentRunContext, input: Input<typeof createBusinessQuoteToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    const contactable = await this.prospects.contactable(row);
    if (!contactable.ok) return refused(contactable.reason);
    if (!this.channelFor(row)) return refused('Aucun canal pour envoyer le devis (courriel professionnel ou WhatsApp d\'affaires)');
    const grid = parseBusinessGrid(await this.settings.get<unknown>('sales.business_grid', null));
    const decision = businessQuoteFromGrid(grid, { expectedMonthlyRides: input.expectedMonthlyRides, requestedDiscountBps: input.requestedDiscountBps, paymentTermsDays: input.paymentTermsDays });
    const data = { prospectId: row.id, organizationName: row.organizationName, expectedMonthlyRides: input.expectedMonthlyRides, discountBps: decision.discountBps, paymentTermsDays: decision.paymentTermsDays, validityDays: decision.validityDays, inGrid: decision.inGrid, reasons: decision.reasons, notes: input.notes ?? null };
    if (ctx.mode === 'manual') return refused('Agent en mode manuel : escalader à un humain');
    if (!decision.inGrid || ctx.mode === 'approval') {
      const justification = decision.inGrid ? input.justification : `${input.justification} Hors grille : ${decision.reasons.join(' ; ')}`;
      return pending(await this.tools.propose(ctx, 'createBusinessQuote', data, justification), data, decision.inGrid ? 'Devis proposé à l\'approbation humaine' : 'Devis hors grille : approbation humaine obligatoire');
    }
    const result = await this.executeQuote(data, { approvalId: null, approverUserId: null, agentCode: ctx.agent.code, idempotencyKey: `run-${ctx.runId}-quote-${row.id}` });
    return done(result, 'Devis entreprise envoyé');
  }

  async executeQuote(data: Record<string, unknown>, meta: ActionMeta): Promise<Record<string, unknown>> {
    const prospectId = String(data['prospectId'] ?? '');
    const row = await this.prospects.get(prospectId);
    if (await this.prospects.touched(meta.idempotencyKey)) return { prospectId, replayed: true };
    const contactable = await this.prospects.contactable(row);
    if (!contactable.ok) throw AppError.conflict('PROSPECT_NOT_CONTACTABLE', contactable.reason);
    const channel = this.channelFor(row);
    if (!channel) throw AppError.conflict('PROSPECT_NO_CHANNEL', 'Aucun canal pour envoyer le devis');
    const num = (key: string, def: number) => (typeof data[key] === 'number' ? (data[key] as number) : def);
    const now = new Date();
    const validityDays = Math.max(1, num('validityDays', 30));
    const quote: BusinessQuoteView = { expectedMonthlyRides: num('expectedMonthlyRides', 0), discountBps: num('discountBps', 0), paymentTermsDays: num('paymentTermsDays', 30), validUntil: new Date(now.getTime() + validityDays * 86_400_000).toISOString(), sentAt: now.toISOString(), inGrid: data['inGrid'] === true, notes: typeof data['notes'] === 'string' ? data['notes'] : null };
    const language: 'fr' | 'en' = row.language === 'en' ? 'en' : 'fr';
    await this.outbox.queue({ recipientAddress: channel === 'email' ? row.email! : row.phone!, channel, template: 'sales.quote', language, data: { ...quote, organizationName: row.organizationName, contactName: row.contactName, prospectId: row.id } });
    await this.prospects.setStage(row.id, 'quote', null, { lastQuote: quote, nextAction: 'quote_followup', nextActionAt: null });
    await this.prospects.touch(row.id, { channel, direction: 'outbound', summary: `Devis entreprise : ${quote.discountBps / 100} % de remise, ${quote.expectedMonthlyRides} courses/mois, ${quote.paymentTermsDays} jours${quote.inGrid ? '' : ' (hors grille, approuvé)'}`, result: 'quote_sent', ref: meta.idempotencyKey, occurredAt: now, userId: meta.approverUserId });
    await this.followups.open({ targetType: 'quote', targetId: row.id, prospectId: row.id, channel, referenceAt: now, language, context: { kind: 'quote', discountBps: quote.discountBps, validUntil: quote.validUntil } });
    this.audit.record({ action: 'sales.quote_sent', entity: 'prospects', entityId: row.id, after: { ...quote, approvalId: meta.approvalId, agentCode: meta.agentCode } });
    this.prospects.syncCrm(row.id, 'quote');
    await this.prospects.note(row.id, `Devis entreprise envoyé : remise ${quote.discountBps / 100} %, ${quote.expectedMonthlyRides} courses/mois, paiement à ${quote.paymentTermsDays} jours, valable jusqu'au ${quote.validUntil.slice(0, 10)}`, now);
    return { prospectId: row.id, ...quote };
  }

  private async openBusinessAccount(ctx: AgentRunContext, input: Input<typeof openBusinessAccountToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    if (row.stage === 'do_not_contact' || row.unsubscribedAt) return refused('Prospect retiré');
    if (row.organizationId) return refused('Un compte est déjà ouvert pour ce prospect', { organizationId: row.organizationId });
    const ownerEmail = input.ownerEmail ?? row.email;
    if (!ownerEmail || !isBusinessEmail(ownerEmail)) return refused('Courriel professionnel du propriétaire du compte requis');
    const data = { prospectId: row.id, ownerEmail, organizationName: input.organizationName ?? row.organizationName };
    if (ctx.mode === 'manual') return refused('Agent en mode manuel : escalader à un humain');
    if (ctx.mode === 'approval') return pending(await this.tools.propose(ctx, 'openBusinessAccount', data, input.justification), data, 'Ouverture du compte proposée à l\'approbation humaine');
    const result = await this.executeOpenAccount(data, { approvalId: null, approverUserId: null, agentCode: ctx.agent.code, idempotencyKey: `run-${ctx.runId}-account-${row.id}` });
    return done(result, 'Compte entreprise ouvert, propriétaire invité');
  }

  /** Administrateur de la plateforme au nom duquel les services des organisations agissent (approbateur, sinon le premier administrateur). */
  private async platformActor(approverUserId: string | null): Promise<UserActor> {
    const rows = await this.db.execute<{ user_id: string }>(sql`SELECT platform_staff_user_ids(ARRAY['admin']) AS user_id`);
    const adminIds = [...rows].map((r) => r.user_id);
    const userId = approverUserId && adminIds.includes(approverUserId) ? approverUserId : adminIds[0];
    if (!userId) throw new AppError('PLATFORM_ADMIN_REQUIRED', 'Aucun administrateur de la plateforme pour ouvrir un compte entreprise', 500);
    return { kind: 'user', userId, sessionId: 'agent', primaryRole: 'admin', roles: ['admin'], amr: ['agent'] };
  }

  async executeOpenAccount(data: Record<string, unknown>, meta: ActionMeta): Promise<Record<string, unknown>> {
    const prospectId = String(data['prospectId'] ?? '');
    const row = await this.prospects.get(prospectId);
    if (row.organizationId) return { prospectId, organizationId: row.organizationId, replayed: true };
    if (row.stage === 'do_not_contact' || row.unsubscribedAt) throw AppError.conflict('PROSPECT_NOT_CONTACTABLE', 'Prospect retiré');
    const ownerEmail = typeof data['ownerEmail'] === 'string' ? data['ownerEmail'].toLowerCase() : row.email;
    if (!ownerEmail || !isBusinessEmail(ownerEmail)) throw new AppError('ACTION_DATA_INVALID', 'Courriel professionnel du propriétaire requis', 422);
    const name = (typeof data['organizationName'] === 'string' && data['organizationName'].trim()) || row.organizationName;
    const actor = await this.platformActor(meta.approverUserId);
    const [root] = await this.db.select({ id: schema.organizations.id }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    if (!root) throw new AppError('PLATFORM_ORGANIZATION_MISSING', 'Organisation racine absente (données de départ)', 500);
    const organization = await this.organizations.create({ parentId: root.id, code: slug(name), name: name.slice(0, 120), type: 'business' }, actor);
    const [ownerRole] = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, OWNER_ROLE_CODE), isNull(schema.roles.organizationId))).limit(1);
    if (!ownerRole) throw new AppError('SYSTEM_ROLE_MISSING', 'Rôle propriétaire absent (données de départ)', 500);
    const language: 'fr' | 'en' = row.language === 'en' ? 'en' : 'fr';
    const invitation = await this.organizations.invite(organization.id, { roleId: ownerRole.id, email: ownerEmail, scope: 'organization', expiresInDays: 14 }, actor, undefined, new Date(), language);
    await this.prospects.setStage(row.id, 'won', null, { organizationId: organization.id, nextAction: null, nextActionAt: null, ...(row.email ? {} : { email: ownerEmail }) });
    await this.prospects.cancelFollowups(row.id, 'won');
    await this.prospects.touch(row.id, { channel: 'email', direction: 'outbound', summary: `Compte entreprise ouvert (organisation ${organization.code}), propriétaire invité`, result: 'won', ref: meta.idempotencyKey, userId: meta.approverUserId });
    this.audit.record({ action: 'sales.account_opened', entity: 'prospects', entityId: row.id, after: { organizationId: organization.id, invitationId: invitation.id, approvalId: meta.approvalId, agentCode: meta.agentCode, by: meta.approverUserId } });
    this.prospects.syncCrm(row.id, 'won');
    await this.prospects.note(row.id, `Compte entreprise ouvert : organisation ${organization.name} (${organization.code}), propriétaire invité par courriel`);
    return { prospectId: row.id, organizationId: organization.id, organizationCode: organization.code, invitationId: invitation.id, invitationExpiresAt: invitation.expiresAt };
  }

  private async markDoNotContact(ctx: AgentRunContext, input: Input<typeof markDoNotContactToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    if (row.stage === 'do_not_contact') return done({ prospectId: row.id, alreadyMarked: true }, 'Prospect déjà retiré');
    await this.prospects.markDoNotContact(row.id, input.reason, { agentRunId: ctx.runId });
    return done({ prospectId: row.id }, 'Prospect retiré : plus aucun envoi ni appel');
  }

  private async proposeSalesDecision(ctx: AgentRunContext, input: Input<typeof proposeSalesDecisionToolSchema>): Promise<ToolResult> {
    const row = await this.prospects.get(input.prospectId);
    const data = { prospectId: row.id, organizationName: row.organizationName, proposal: input.proposal };
    const approvalId = await this.tools.propose(ctx, 'proposeSalesDecision', data, input.justification);
    await this.prospects.touch(row.id, { channel: 'note', direction: 'outbound', summary: `Demande hors grille soumise à une personne : ${input.proposal}`.slice(0, 500), result: 'pending_approval', agentRunId: ctx.runId });
    return pending(approvalId, data, 'Demande soumise à la décision humaine');
  }

  async executeSalesDecision(data: Record<string, unknown>, meta: ActionMeta): Promise<Record<string, unknown>> {
    const prospectId = String(data['prospectId'] ?? '');
    if (await this.prospects.touched(meta.idempotencyKey)) return { prospectId, replayed: true };
    await this.prospects.touch(prospectId, { channel: 'note', direction: 'outbound', summary: `Décision humaine favorable : ${String(data['proposal'] ?? '')}`.slice(0, 500), result: 'approved', ref: meta.idempotencyKey, userId: meta.approverUserId });
    await this.prospects.note(prospectId, `Décision humaine favorable : ${String(data['proposal'] ?? '')}`);
    return { prospectId, acknowledged: true };
  }

  private async sendFollowup(ctx: AgentRunContext, input: Input<typeof sendFollowupToolSchema>): Promise<ToolResult> {
    const f = await this.followups.get(input.followupId);
    if (f.status !== 'scheduled') return refused('Cette relance n\'est plus ouverte');
    const data = { followupId: f.id, prospectId: f.prospectId, targetType: f.targetType, subject: input.subject ?? null, text: input.text, attempt: f.attempt + 1 };
    if (ctx.mode === 'manual') return refused('Agent en mode manuel : escalader à un humain');
    if (ctx.mode === 'approval') return pending(await this.tools.propose(ctx, 'sendFollowup', data, input.justification ?? `Relance ${f.attempt + 1} sur ${f.maxAttempts}`), data, 'Relance proposée à l\'approbation humaine');
    try {
      const result = await this.followups.send(data, { approvalId: null, approverUserId: null, agentCode: ctx.agent.code, idempotencyKey: `run-${ctx.runId}-followup-${f.id}-${f.attempt}` });
      return done(result, 'Relance envoyée');
    } catch (error) {
      if (error instanceof AppError) return refused(error.message, { errorCode: error.code });
      this.logger.error({ err: error, followupId: f.id }, 'Relance en erreur');
      throw error;
    }
  }
}
