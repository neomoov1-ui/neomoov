/**
 * Routes « Ventes » de My Hub (phase 1 « entreprise autonome ») : prospects (filtres par étape, source, segment, score),
 * fiche avec fil des contacts, appels et relances, import CSV, actions (appeler maintenant, relancer, devis, ouvrir le
 * compte, ne plus contacter), listes des relances et des appels, passes à la demande. Lecture `sales.read`, écriture
 * `sales.manage` (plateforme seulement). Les actions humaines s'exécutent directement (journalisées avec la personne),
 * jamais par la file d'approbation : c'est l'humain qui décide.
 */
import {
  followupListQuerySchema, followupSchema, outboundCallListQuerySchema, outboundCallSchema, pageOf, prospectCreateSchema, prospectDetailSchema, prospectImportResultSchema, prospectImportSchema,
  prospectListQuerySchema, prospectSchema, prospectUpdateSchema, SALES_AGENT_CODES, salesActionResultSchema, salesCallNowSchema, salesDoNotContactSchema, salesOpenAccountSchema, salesQuoteRequestSchema,
  salesRunResultSchema, uuid, businessQuoteFromGrid, parseBusinessGrid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { SettingsService } from '../../common/settings.service.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { FollowupsService, FOLLOWUPS } from './followups.service.js';
import { OutboundCallsService, OUTBOUND_CALLS } from './outbound-calls.service.js';
import { ProspectingAgent } from './prospecting.agent.js';
import { prospectView, ProspectsService, callView } from './prospects.service.js';
import { SalesToolsService } from './sales-tools.service.js';

const agentCode = z.enum(SALES_AGENT_CODES);
const okResult = (data: unknown, message: string) => ({ ok: true as const, status: 'done' as const, approvalId: null, message, data });

@ApiTags('sales')
@ApiBearerAuth()
@Controller('admin/sales')
export class SalesAdminController {
  constructor(
    private readonly prospects: ProspectsService,
    private readonly calls: OutboundCallsService,
    private readonly followups: FollowupsService,
    private readonly execution: SalesToolsService,
    private readonly prospecting: ProspectingAgent,
    private readonly settings: SettingsService,
  ) {}

  @Get('prospects')
  @Can('sales.read')
  @NoAudit()
  @ApiOperation({ summary: 'Prospects d\'affaires : filtres par étape, source, segment, score minimal, recherche' })
  @ZodQuery(prospectListQuerySchema)
  @ZodResponse(200, pageOf(prospectSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(prospectListQuerySchema)) query: z.infer<typeof prospectListQuerySchema>) {
    return this.prospects.list(query);
  }

  @Post('prospects')
  @Can('sales.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée un prospect d\'affaires (organisation et coordonnées professionnelles ; une messagerie grand public est refusée)' })
  @ZodBody(prospectCreateSchema)
  @ZodResponse(201, prospectSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  async create(@Body(zodPipe(prospectCreateSchema)) body: z.infer<typeof prospectCreateSchema>, @CurrentUser() user: UserActor) {
    const { row, reason } = await this.prospects.upsert({ ...body, source: 'manual', createdByUserId: user.userId });
    if (reason) throw AppError.conflict('PROSPECT_DO_NOT_CONTACT', 'Ce prospect a demandé le retrait');
    return prospectView(row);
  }

  @Post('prospects/import')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import en bloc (fichier CSV lu par My Hub) : lignes créées, complétées ou refusées avec motif' })
  @ZodBody(prospectImportSchema)
  @ZodResponse(200, prospectImportResultSchema)
  @ApiErrors(400, 401, 403, 429)
  import(@Body(zodPipe(prospectImportSchema)) body: z.infer<typeof prospectImportSchema>, @CurrentUser() user: UserActor) {
    return this.prospects.import(body.rows, user.userId);
  }

  @Get('prospects/:id')
  @Can('sales.read')
  @NoAudit()
  @ApiOperation({ summary: 'Fiche d\'un prospect : fil des contacts, appels sortants, relances' })
  @ZodResponse(200, prospectDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  detail(@Param('id', zodPipe(uuid)) id: string) {
    return this.prospects.detail(id);
  }

  @Patch('prospects/:id')
  @Can('sales.manage')
  @ApiOperation({ summary: 'Suivi d\'un prospect : étape (sauf le retrait, qui a sa route), motif, notes, prochaine action' })
  @ZodBody(prospectUpdateSchema)
  @ZodResponse(200, prospectSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  update(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(prospectUpdateSchema)) body: z.infer<typeof prospectUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.prospects.update(id, body, user.userId);
  }

  @Post('prospects/:id/call')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Appeler maintenant : appel sortant de l\'assistant commercial lancé tout de suite (Vapi), ou planifié au prochain créneau si le fournisseur refuse' })
  @ZodBody(salesCallNowSchema)
  @ZodResponse(200, salesActionResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async callNow(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(salesCallNowSchema)) body: z.infer<typeof salesCallNowSchema>, @CurrentUser() user: UserActor) {
    const scheduled = await this.calls.schedule({ prospectId: id, scriptKey: body.scriptKey, at: new Date(), userId: user.userId });
    const launched = await this.calls.launch(scheduled.id);
    return okResult(callView(launched), launched.status === 'calling' ? 'Appel lancé' : `Appel non lancé : ${launched.summary ?? launched.status}`);
  }

  @Post('prospects/:id/followup')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Relancer maintenant : la prochaine relance du prospect part par son canal d\'origine, avec le gabarit approuvé' })
  @ZodResponse(200, salesActionResultSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  async followupNow(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return okResult(await this.followups.sendNow(id, user.userId), 'Relance envoyée');
  }

  @Post('prospects/:id/quote')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Devis entreprise envoyé par une personne (grille des réglages ; hors grille admis, la personne décide)' })
  @ZodBody(salesQuoteRequestSchema)
  @ZodResponse(200, salesActionResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async quote(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(salesQuoteRequestSchema)) body: z.infer<typeof salesQuoteRequestSchema>, @CurrentUser() user: UserActor) {
    const grid = parseBusinessGrid(await this.settings.get<unknown>('sales.business_grid', null));
    const decision = businessQuoteFromGrid(grid, { expectedMonthlyRides: body.expectedMonthlyRides, requestedDiscountBps: body.requestedDiscountBps, paymentTermsDays: body.paymentTermsDays });
    const data = { prospectId: id, expectedMonthlyRides: body.expectedMonthlyRides, discountBps: decision.discountBps, paymentTermsDays: decision.paymentTermsDays, validityDays: decision.validityDays, inGrid: decision.inGrid, reasons: decision.reasons, notes: body.notes ?? null };
    const result = await this.execution.executeQuote(data, { approvalId: null, approverUserId: user.userId, agentCode: OUTBOUND_CALLS, idempotencyKey: `hub-quote-${id}-${Date.now()}` });
    return okResult(result, decision.inGrid ? 'Devis envoyé' : `Devis hors grille envoyé sur décision humaine (${decision.reasons.join(' ; ')})`);
  }

  @Post('prospects/:id/account')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ouvre le compte entreprise : organisation cliente et invitation du propriétaire par courriel' })
  @ZodBody(salesOpenAccountSchema)
  @ZodResponse(200, salesActionResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async openAccount(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(salesOpenAccountSchema)) body: z.infer<typeof salesOpenAccountSchema>, @CurrentUser() user: UserActor) {
    const result = await this.execution.executeOpenAccount({ prospectId: id, ...(body.ownerEmail ? { ownerEmail: body.ownerEmail } : {}), ...(body.organizationName ? { organizationName: body.organizationName } : {}) }, { approvalId: null, approverUserId: user.userId, agentCode: OUTBOUND_CALLS, idempotencyKey: `hub-account-${id}` });
    return okResult(result, 'Compte entreprise ouvert, propriétaire invité');
  }

  @Post('prospects/:id/do-not-contact')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ne plus contacter : retrait définitif (relances et appels annulés, HubSpot prévenu)' })
  @ZodBody(salesDoNotContactSchema)
  @ZodResponse(200, prospectSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  async doNotContact(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(salesDoNotContactSchema)) body: z.infer<typeof salesDoNotContactSchema>, @CurrentUser() user: UserActor) {
    return prospectView(await this.prospects.markDoNotContact(id, body.reason, { userId: user.userId }));
  }

  @Get('followups')
  @Can('sales.read')
  @NoAudit()
  @ApiOperation({ summary: 'Relances planifiées (prospects, devis, candidatures de chauffeurs) ; status=scheduled, sent, closed, cancelled' })
  @ZodQuery(followupListQuerySchema)
  @ZodResponse(200, pageOf(followupSchema))
  @ApiErrors(400, 401, 403, 429)
  followupsList(@Query(zodPipe(followupListQuerySchema)) query: z.infer<typeof followupListQuerySchema>) {
    return this.followups.list(query);
  }

  @Get('calls')
  @Can('sales.read')
  @NoAudit()
  @ApiOperation({ summary: 'Appels sortants commerciaux : planifiés, en cours, terminés (résultat, résumé, coût)' })
  @ZodQuery(outboundCallListQuerySchema)
  @ZodResponse(200, pageOf(outboundCallSchema))
  @ApiErrors(400, 401, 403, 429)
  callsList(@Query(zodPipe(outboundCallListQuerySchema)) query: z.infer<typeof outboundCallListQuerySchema>) {
    return this.calls.list(query);
  }

  @Post('agents/:code/run')
  @Can('sales.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Passe à la demande : prospection (sources, qualification, séquences), relances échues, appels sortants échus' })
  @ZodResponse(200, salesRunResultSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  async run(@Param('code', zodPipe(agentCode)) code: z.infer<typeof agentCode>) {
    if (code === 'outbound_calls') return { run: null, replayed: false, summary: { callsLaunched: await this.calls.launchDue(new Date()) } };
    const execution = code === 'b2b_prospecting' ? await this.prospecting.run(new Date(), { ref: null }) : await this.followups.run(new Date(), { ref: null });
    return { run: execution.run, replayed: execution.replayed, summary: (execution.result ?? {}) as Record<string, unknown> };
  }
}

export { FOLLOWUPS };
