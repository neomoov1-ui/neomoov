/**
 * Routes des agents IA (prompt 13, tâches 4 et 5 ; section 7.2).
 * - My Hub (`/admin`) : agents (mode, effort, modèle, seuils, plafond, dépense du jour), journal des exécutions, rapports
 *   de l'agent d'analyse, file d'approbation (approuver exécute l'action une seule fois ; refuser exige un motif),
 *   conversations de l'assistance. Lecture : tout le personnel ; décision : administrateur et opérateur ; réglage d'un
 *   agent : administrateur.
 * - Interne (`/internal`) : exécution d'un agent à la demande et outils des agents, réservés aux comptes de service
 *   (portées `agents:run`, `agents:read`, `tools:*`), au rôle `agent` et au personnel d'exploitation.
 */
import {
  adminAgentSchema, adminApprovalSchema, adminListQuerySchema, agentReportSchema, agentRunListQuerySchema, agentRunRequestSchema, agentRunResultSchema, agentRunSchema, agentUpdateSchema,
  approvalDecisionSchema, compareIdentityToolSchema, conversationReplySchema, conversationSchema, escalateToHumanToolSchema, extractDocumentFieldsToolSchema, flagAnomalyToolSchema, issueCreditToolSchema,
  listStatementLinesToolSchema, lookupClientToolSchema, lookupDriverToolSchema, lookupRideToolSchema, openIncidentToolSchema, pageOf, proposeDecisionToolSchema, queryMetricsToolSchema,
  qualityReviewSchema, qualityRunResultSchema, refundToolSchema, sendMessageRouteSchema, toolResultSchema, toolRouteContextSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentActor, CurrentUser, NoAudit, Roles, Scopes, STAFF_READ_ROLES, type Actor, type UserActor } from '../auth/actor.js';
import { AgentApprovalsService } from './agent-approvals.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import type { ToolName } from './agent-tools.service.js';
import { AgentsService } from './agents.service.js';
import { ConversationsService } from './conversations.service.js';
import { QualityAgent } from './quality.agent.js';

type ListQuery = z.infer<typeof adminListQuerySchema>;
const agentCode = z.string().regex(/^[a-z0-9_]{2,40}$/);
const withContext = <T extends z.ZodObject>(schema: T) => schema.extend(toolRouteContextSchema.shape);
const TOOL_ROLES = ['admin', 'operator', 'agent'] as const;

@ApiTags('agents')
@ApiBearerAuth()
@Controller('admin')
export class AgentsAdminController {
  constructor(
    private readonly approvals: AgentApprovalsService,
    private readonly runner: AgentRunnerService,
    private readonly conversations: ConversationsService,
    private readonly quality: QualityAgent,
  ) {}

  @Get('quality')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Qualité des chauffeurs (5.11) : note sur 50 courses, annulations tardives sur 7 jours, incidents graves, sanction proposée par la règle et couverture en cours' })
  @ZodResponse(200, z.array(qualityReviewSchema))
  @ApiErrors(401, 403, 429)
  async qualityReview() {
    return this.quality.review();
  }

  @Post('quality/run')
  @Roles('admin', 'operator')
  @HttpCode(200)
  @ApiOperation({ summary: 'Passe de l\'agent qualité à la demande : échéances levées, propositions dans la file d\'approbation (aucune en double)' })
  @ZodResponse(200, qualityRunResultSchema)
  @ApiErrors(401, 403, 429)
  async runQuality() {
    const execution = await this.quality.run(new Date(), { ref: null });
    return { run: execution.run, replayed: execution.replayed, evaluated: execution.result?.evaluated ?? 0, proposed: execution.result?.proposed ?? 0, reinstated: execution.result?.reinstated ?? 0 };
  }

  @Get('agents')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Agents IA : mode, modèle, effort, seuils, exécutions sur 7 jours, approbations en attente, dépense du jour et plafond' })
  @ZodResponse(200, z.array(adminAgentSchema))
  @ApiErrors(401, 403, 429)
  agents() {
    return this.approvals.agents();
  }

  @Patch('agents/:code')
  @Roles('admin')
  @ApiOperation({ summary: 'Réglage d\'un agent : mode (auto, approval, manual), effort, modèle, activité, seuils (dont le plafond quotidien dailyBudgetMicros)' })
  @ZodBody(agentUpdateSchema)
  @ZodResponse(200, adminAgentSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updateAgent(@Param('code', zodPipe(agentCode)) code: string, @Body(zodPipe(agentUpdateSchema)) body: z.infer<typeof agentUpdateSchema>) {
    return this.approvals.update(code, body);
  }

  @Get('agents/runs')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Journal des exécutions des agents : entrées minimisées, sorties, outils appelés, jetons, coût, durée, statut' })
  @ZodQuery(agentRunListQuerySchema)
  @ZodResponse(200, pageOf(agentRunSchema))
  @ApiErrors(400, 401, 403, 429)
  runs(@Query(zodPipe(agentRunListQuerySchema)) query: z.infer<typeof agentRunListQuerySchema>) {
    return this.approvals.runs(query);
  }

  @Get('agents/runs/:id')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Une exécution d\'agent' })
  @ZodResponse(200, agentRunSchema)
  @ApiErrors(401, 403, 404, 429)
  run(@Param('id', zodPipe(uuid)) id: string) {
    return this.runner.run(id);
  }

  @Get('agents/reports')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Rapports quotidiens et hebdomadaires de l\'agent d\'analyse (les plus récents d\'abord)' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(agentReportSchema))
  @ApiErrors(400, 401, 403, 429)
  reports(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.approvals.reports(query);
  }

  @Get('approvals')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'File d\'approbation des actions proposées par les agents (en attente par défaut ; status=approved ou rejected)' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminApprovalSchema))
  @ApiErrors(400, 401, 403, 429)
  approvalsList(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.approvals.list(query);
  }

  @Post('approvals/:id/decide')
  @Roles('admin', 'operator')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuve (exécute l\'action proposée, une seule fois) ou refuse avec motif une action proposée par un agent' })
  @ZodBody(approvalDecisionSchema)
  @ZodResponse(200, adminApprovalSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  decide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentUser() user: UserActor) {
    return this.approvals.decide(id, body, user);
  }

  @Get('conversations')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Conversations de l\'assistance (escaladées d\'abord) ; status=open, escalated ou closed' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(conversationSchema))
  @ApiErrors(400, 401, 403, 429)
  async conversationsList(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    const status = ['open', 'escalated', 'closed'].includes(query.status ?? '') ? query.status : undefined;
    const page = await this.conversations.list(status, query.pageSize, (query.page - 1) * query.pageSize);
    return { ...page, page: query.page, pageSize: query.pageSize };
  }

  @Get('conversations/:id')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Une conversation et ses messages' })
  @ZodResponse(200, conversationSchema)
  @ApiErrors(401, 403, 404, 429)
  async conversation(@Param('id', zodPipe(uuid)) id: string) {
    return this.conversations.view(await this.conversations.get(id));
  }

  @Post('conversations/:id/messages')
  @Roles('admin', 'operator')
  @HttpCode(200)
  @ApiOperation({ summary: 'Réponse de l\'équipe dans une conversation de l\'assistance (push, WhatsApp ou texto selon le canal) ; close la termine' })
  @ZodBody(conversationReplySchema)
  @ZodResponse(200, conversationSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async reply(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(conversationReplySchema)) body: z.infer<typeof conversationReplySchema>) {
    return this.conversations.reply(id, body.text, body.close);
  }
}

@ApiTags('agents')
@ApiBearerAuth()
@Controller('internal')
export class InternalAgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly approvals: AgentApprovalsService,
  ) {}

  @Post('agents/:code/run')
  @Roles('admin', 'operator', 'agent')
  @Scopes('agents:run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exécute un agent à la demande (entrée propre à l\'agent : message, document, relevé, période du rapport)' })
  @ZodBody(agentRunRequestSchema)
  @ZodResponse(200, agentRunResultSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  runAgent(@Param('code', zodPipe(agentCode)) code: string, @Body(zodPipe(agentRunRequestSchema)) body: z.infer<typeof agentRunRequestSchema>) {
    return this.agents.runOnDemand(code, body.input);
  }

  @Get('agents/runs')
  @Roles(...STAFF_READ_ROLES, 'agent')
  @Scopes('agents:read')
  @NoAudit()
  @ApiOperation({ summary: 'Journal des exécutions des agents' })
  @ZodQuery(agentRunListQuerySchema)
  @ZodResponse(200, pageOf(agentRunSchema))
  @ApiErrors(400, 401, 403, 429)
  runs(@Query(zodPipe(agentRunListQuerySchema)) query: z.infer<typeof agentRunListQuerySchema>) {
    return this.approvals.runs(query);
  }

  private tool(name: ToolName, body: Record<string, unknown>, actor: Actor | undefined) {
    if (!actor) throw AppError.unauthorized('UNAUTHENTICATED', 'Jeton d\'accès requis');
    return this.agents.callTool(name, body, actor);
  }

  @Post('tools/lookupRide') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : courses du client concerné (subjectUserId)' }) @ZodBody(withContext(lookupRideToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  lookupRide(@Body(zodPipe(withContext(lookupRideToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('lookupRide', body, actor); }

  @Post('tools/lookupClient') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : résumé du compte du client concerné' }) @ZodBody(withContext(lookupClientToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  lookupClient(@Body(zodPipe(withContext(lookupClientToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('lookupClient', body, actor); }

  @Post('tools/lookupDriver') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : fiche minimale d\'un chauffeur' }) @ZodBody(withContext(lookupDriverToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  lookupDriver(@Body(zodPipe(withContext(lookupDriverToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('lookupDriver', body, actor); }

  @Post('tools/issueCredit') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : crédit au client concerné (5 000 cents au plus ; approbation selon le mode de l\'agent)' }) @ZodBody(withContext(issueCreditToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  issueCredit(@Body(zodPipe(withContext(issueCreditToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('issueCredit', body, actor); }

  @Post('tools/refund') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : remboursement d\'une course du client concerné (5 000 cents au plus, idempotent ; approbation selon le mode)' }) @ZodBody(withContext(refundToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  refund(@Body(zodPipe(withContext(refundToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('refund', body, actor); }

  @Post('tools/openIncident') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : consigne un incident' }) @ZodBody(withContext(openIncidentToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  openIncident(@Body(zodPipe(withContext(openIncidentToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('openIncident', body, actor); }

  @Post('tools/escalateToHuman') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : transmet à l\'équipe (conversation escaladée, alerte au personnel)' }) @ZodBody(withContext(escalateToHumanToolSchema).extend({ conversationId: uuid.optional() })) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  escalateToHuman(@Body(zodPipe(withContext(escalateToHumanToolSchema).extend({ conversationId: uuid.optional() }))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('escalateToHuman', body, actor); }

  @Post('tools/sendMessage') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : message au client d\'une conversation, par son canal (file des notifications)' }) @ZodBody(withContext(sendMessageRouteSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  sendMessage(@Body(zodPipe(withContext(sendMessageRouteSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('sendMessage', body, actor); }

  @Post('tools/extractDocumentFields') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : extraction des champs d\'un document de chauffeur (vision)' }) @ZodBody(withContext(extractDocumentFieldsToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  extractDocumentFields(@Body(zodPipe(withContext(extractDocumentFieldsToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('extractDocumentFields', body, actor); }

  @Post('tools/compareIdentity') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : cohérence des champs extraits avec le profil du chauffeur' }) @ZodBody(withContext(compareIdentityToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  compareIdentity(@Body(zodPipe(withContext(compareIdentityToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('compareIdentity', body, actor); }

  @Post('tools/proposeDecision') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : proposition sur un document (toujours soumise à la validation humaine en V1)' }) @ZodBody(withContext(proposeDecisionToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  proposeDecision(@Body(zodPipe(withContext(proposeDecisionToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('proposeDecision', body, actor); }

  @Post('tools/listStatementLines') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : lignes et courses d\'un relevé hebdomadaire' }) @ZodBody(withContext(listStatementLinesToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  listStatementLines(@Body(zodPipe(withContext(listStatementLinesToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('listStatementLines', body, actor); }

  @Post('tools/flagAnomaly') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : anomalie d\'un relevé, soumise à la comptabilité' }) @ZodBody(withContext(flagAnomalyToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  flagAnomaly(@Body(zodPipe(withContext(flagAnomalyToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('flagAnomaly', body, actor); }

  @Post('tools/queryMetrics') @Roles(...TOOL_ROLES) @Scopes('tools:*') @HttpCode(200)
  @ApiOperation({ summary: 'Outil : indicateurs d\'exploitation d\'une période (lecture seule)' }) @ZodBody(withContext(queryMetricsToolSchema)) @ZodResponse(200, toolResultSchema) @ApiErrors(400, 401, 403, 404, 409, 429)
  queryMetrics(@Body(zodPipe(withContext(queryMetricsToolSchema))) body: Record<string, unknown>, @CurrentActor() actor?: Actor) { return this.tool('queryMetrics', body, actor); }
}
