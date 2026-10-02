/**
 * Boîte de réception unifiée (phase 1 « entreprise autonome », 2 octobre 2026).
 * - Webhooks : relais entrant Brevo (`POST /webhooks/email`, secret partagé `EMAIL_INBOUND_SECRET` dans l'en-tête
 *   `x-inbound-secret` ou le paramètre `secret`) ; Meta (`GET` et `POST /webhooks/meta`, même jeton de vérification et même
 *   signature que WhatsApp) pour Messenger, Facebook et Instagram.
 * - My Hub (`/admin/inbox`) : liste filtrée par canal, réseau et état, détail, relais manuel d'un message reçu sur un réseau
 *   sans connecteur (l'agent prépare la réponse, l'humain la colle puis la marque relayée).
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { conversationSchema, inboxItemSchema, inboxListQuerySchema, inboxRelaySchema, inboxSummarySchema, pageOf, uuid, type InboxListQuery } from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SOCIAL_PROVIDER, type InboundEmail, type SocialProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { Can, CurrentUser, NoAudit, Public, type UserActor } from '../auth/actor.js';
import { ConversationsService } from '../agents/conversations.service.js';
import { CustomerRelationsAgent } from '../agents/customer-relations.agent.js';
import { InboundEmailService } from './inbound-email.service.js';
import { SocialInboxService } from './social-inbox.service.js';

/** Un courriel du relais entrant de Brevo (« inbound parsing ») ; les champs absents sont tolérés. */
const brevoAddress = z.object({ Name: z.string().nullish(), Address: z.string().nullish() });
const brevoItemSchema = z.object({
  Uuid: z.array(z.string()).nullish(),
  MessageId: z.string().nullish(),
  InReplyTo: z.string().nullish(),
  From: brevoAddress.nullish(),
  To: z.array(brevoAddress).nullish(),
  Subject: z.string().nullish(),
  RawHtmlBody: z.string().nullish(),
  RawTextBody: z.string().nullish(),
  ExtractedMarkdownMessage: z.string().nullish(),
  SentAtDate: z.string().nullish(),
  Attachments: z.array(z.object({ Name: z.string().nullish(), ContentType: z.string().nullish(), ContentLength: z.number().nullish() })).nullish(),
  Headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).nullish(),
});
const brevoWebhookSchema = z.union([z.object({ items: z.array(brevoItemSchema) }), brevoItemSchema]);
type BrevoItem = z.infer<typeof brevoItemSchema>;

export function brevoToEmail(item: BrevoItem): InboundEmail {
  const from = item.From?.Address ? (item.From.Name ? `${item.From.Name} <${item.From.Address}>` : item.From.Address) : '';
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.Headers ?? {})) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(' ') : value;
  const references = (headers['references'] ?? '').split(/\s+/).filter(Boolean);
  const sentAt = item.SentAtDate ? new Date(item.SentAtDate) : new Date();
  return {
    messageId: item.MessageId ?? headers['message-id'] ?? null,
    inReplyTo: item.InReplyTo ?? headers['in-reply-to'] ?? null,
    references,
    from,
    to: (item.To ?? []).map((t) => t.Address ?? '').filter(Boolean),
    subject: item.Subject ?? null,
    text: item.RawTextBody ?? item.ExtractedMarkdownMessage ?? null,
    html: item.RawHtmlBody ?? null,
    attachments: (item.Attachments ?? []).map((a) => ({ name: a.Name ?? 'piece-jointe', contentType: a.ContentType ?? null, size: a.ContentLength ?? null })),
    headers,
    receivedAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
  };
}

@ApiTags('webhooks')
@Controller('webhooks')
export class InboxWebhooksController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(SOCIAL_PROVIDER) private readonly social: SocialProvider,
    private readonly inboundEmail: InboundEmailService,
    private readonly socialInbox: SocialInboxService,
  ) {}

  private secretAccepted(given: string | undefined): boolean {
    const expected = this.env.EMAIL_INBOUND_SECRET;
    if (!expected || !given) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  @Post('email')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Courriels reçus sur contact@ (relais entrant Brevo) : secret partagé vérifié, courriels automatiques classés sans réponse, les autres confiés à l\'agent relation client' })
  @ZodResponse(200, z.object({ received: z.number().int().min(0), queued: z.number().int().min(0), automated: z.number().int().min(0), duplicates: z.number().int().min(0) }))
  @ApiErrors(400, 429)
  async email(@Body() body: unknown, @Headers('x-inbound-secret') header: string | undefined, @Query('secret') secret: string | undefined) {
    if (!this.secretAccepted(header ?? secret)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Secret du relais entrant invalide', 400);
    const parsed = brevoWebhookSchema.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Corps du relais entrant illisible', 400);
    const items = 'items' in parsed.data ? parsed.data.items : [parsed.data];
    const counts = { received: items.length, queued: 0, automated: 0, duplicates: 0 };
    for (const item of items) {
      const { status } = await this.inboundEmail.receive(brevoToEmail(item));
      if (status === 'queued') counts.queued += 1;
      if (status === 'automated') counts.automated += 1;
      if (status === 'duplicate') counts.duplicates += 1;
    }
    return counts;
  }

  @Get('meta')
  @Public()
  @NoAudit()
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Vérification de l\'abonnement au webhook Meta (Messenger, Facebook, Instagram) : même jeton que WhatsApp' })
  @ApiErrors(403, 429)
  metaVerify(@Query() query: Record<string, string | undefined>, @Res({ passthrough: true }) res: Response) {
    const challenge = this.social.verifyWebhook(query);
    if (!challenge) throw AppError.forbidden('WEBHOOK_VERIFY_FAILED', 'Jeton de vérification invalide');
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    return challenge;
  }

  @Post('meta')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Messages privés et commentaires Meta (objet page ou instagram) : signature vérifiée sur le corps brut, confiés à l\'agent relation client' })
  @ZodResponse(200, z.object({ messages: z.number().int().min(0), comments: z.number().int().min(0) }))
  @ApiErrors(400, 429)
  metaInbound(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined) {
    if (!req.rawBody || !this.social.verifySignature(req.rawBody, signature)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    return this.socialInbox.receiveWebhook(req.body);
  }
}

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('admin/inbox')
export class InboxAdminController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly customerRelations: CustomerRelationsAgent,
  ) {}

  @Get()
  @Can('agents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Boîte de réception unifiée : conversations de tous les canaux (courriel, réseaux, WhatsApp, texto, voix, application, web), filtrées par canal, réseau et état ; remises à l\'humain et réponses à relayer d\'abord' })
  @ZodQuery(inboxListQuerySchema)
  @ZodResponse(200, pageOf(inboxItemSchema))
  @ApiErrors(400, 401, 403, 429)
  async list(@Query(zodPipe(inboxListQuerySchema)) query: InboxListQuery) {
    const page = await this.conversations.listInbox(query);
    return { ...page, page: query.page, pageSize: query.pageSize };
  }

  @Get('summary')
  @Can('agents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Boîte de réception : compteurs par canal (sans réponse, remises à l\'humain, ouvertes) et réponses à relayer' })
  @ZodResponse(200, inboxSummarySchema)
  @ApiErrors(401, 403, 429)
  summary() {
    return this.conversations.inboxSummary();
  }

  @Get(':id')
  @Can('agents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Une conversation de la boîte de réception et ses messages' })
  @ZodResponse(200, conversationSchema)
  @ApiErrors(401, 403, 404, 429)
  async conversation(@Param('id', zodPipe(uuid)) id: string) {
    return this.conversations.view(await this.conversations.get(id));
  }

  @Post('relay')
  @Can('conversations.reply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Relais manuel : un message reçu sur un réseau sans connecteur (YouTube, TikTok, X, Google, LinkedIn, Snapchat) est collé ici ; l\'agent prépare la réponse, à coller sur le réseau puis à marquer relayée' })
  @ZodBody(inboxRelaySchema)
  @ZodResponse(200, conversationSchema)
  @ApiErrors(400, 401, 403, 429)
  async relay(@Body(zodPipe(inboxRelaySchema)) body: z.infer<typeof inboxRelaySchema>, @CurrentUser() user: UserActor) {
    const handle = body.from.trim().replace(/^@/, '').toLowerCase();
    const result = await this.customerRelations.handleInbound({
      channel: 'social', externalId: `relay:${randomUUID()}`, userId: null, phone: null, text: body.text, language: body.language ?? null, rideId: null,
      address: `${body.network}:${handle}`.slice(0, 254), network: body.network, kind: body.kind, threadRef: body.link ?? null, displayName: body.from.trim(),
      metadata: { relay: true, link: body.link ?? null, relayedByUserId: user.userId },
    });
    if (!result) throw new AppError('VALIDATION_ERROR', 'Message vide', 400);
    return this.conversations.view(await this.conversations.get(result.conversationId));
  }

  @Post('messages/:id/relayed')
  @Can('conversations.reply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Réponse collée sur le réseau : marquée relayée par le membre du personnel' })
  @ZodResponse(200, conversationSchema)
  @ApiErrors(401, 403, 404, 429)
  relayed(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.conversations.markRelayed(id, user.userId);
  }
}
