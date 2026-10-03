/**
 * Routes My Hub de la publication multiréseau (`/admin/marketing`, chantier « Réseaux sociaux » du 3 octobre 2026) :
 * composer, publications et leur état par réseau, import d'un lot JSON, approbation et programmation en lot, textes
 * adaptés par l'agent de contenu, vue « À relayer » (relais manuel), fichiers à télécharger, commentaires et messages par
 * réseau. Lecture : `marketing.read` ; actions : `marketing.manage` ; réponse à un commentaire : `conversations.reply`.
 */
import {
  conversationSchema, publicationAdaptRequestSchema, publicationAdaptResultSchema, publicationComposeSchema, publicationGroupSchema, publicationImportResultSchema, publicationItemSchema, publicationListQuerySchema,
  publicationScheduleResultSchema, publicationScheduleSchema, publicationsImportSchema, relayDoneSchema, relayListQuerySchema, relayListSchema, socialInboxSummarySchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { PublicationsService } from './publications.service.js';

const downloadQuerySchema = z.object({ asset: z.enum(['main', 'thumbnail']).default('main') });

@ApiTags('marketing')
@ApiBearerAuth()
@Controller('admin/marketing')
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Get('publications')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Publications multiréseau (les plus récentes d\'abord, ou celles d\'une campagne dans l\'ordre du lot), avec l\'état de chaque réseau' })
  @ZodQuery(publicationListQuerySchema)
  @ZodResponse(200, z.array(publicationGroupSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(publicationListQuerySchema)) query: z.infer<typeof publicationListQuerySchema>) {
    return this.publications.list(query);
  }

  @Post('publications')
  @Can('marketing.manage')
  @ApiOperation({ summary: 'Composer : une publication vers un, plusieurs ou tous les réseaux (texte adapté et image différente par réseau, à sa taille) ; publiée tout de suite, à une heure, aux prochains créneaux ou gardée en brouillon' })
  @ZodBody(publicationComposeSchema)
  @ZodResponse(201, publicationGroupSchema)
  @ApiErrors(400, 401, 403, 429)
  compose(@Body(zodPipe(publicationComposeSchema)) body: z.infer<typeof publicationComposeSchema>, @CurrentUser() user: UserActor) {
    return this.publications.compose(body, user.userId);
  }

  @Post('publications/import')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importe un lot de publications (docs/marketing/lancement-50-publications.schema.json) en brouillons groupés, visuels en production ; rejouable (campagne et référence) ; corps limité à 100 Ko, My Hub envoie un gros fichier par tranches' })
  @ZodBody(publicationsImportSchema)
  @ZodResponse(200, publicationImportResultSchema)
  @ApiErrors(400, 401, 403, 413, 429)
  importBatch(@Body(zodPipe(publicationsImportSchema)) body: z.infer<typeof publicationsImportSchema>, @CurrentUser() user: UserActor) {
    return this.publications.importBatch(body, user.userId);
  }

  @Post('publications/schedule')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuver et programmer en lot : publications d\'une campagne (ou choisies) réparties sur N jours selon les créneaux de chaque réseau ; contenus bloqués ou sensibles laissés à l\'approbation un par un' })
  @ZodBody(publicationScheduleSchema)
  @ZodResponse(200, publicationScheduleResultSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  schedule(@Body(zodPipe(publicationScheduleSchema)) body: z.infer<typeof publicationScheduleSchema>, @CurrentUser() user: UserActor) {
    return this.publications.scheduleBatch(body, user.userId);
  }

  @Post('publications/adapt')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Textes par réseau rédigés par l\'agent de contenu à partir du texte de base (à relire dans le composer)' })
  @ZodBody(publicationAdaptRequestSchema)
  @ZodResponse(200, publicationAdaptResultSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  adapt(@Body(zodPipe(publicationAdaptRequestSchema)) body: z.infer<typeof publicationAdaptRequestSchema>) {
    return this.publications.adapt(body);
  }

  @Get('publications/:id')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Une publication, ses contenus par réseau, leurs visuels et leur état' })
  @ZodResponse(200, publicationGroupSchema)
  @ApiErrors(401, 403, 404, 429)
  get(@Param('id', zodPipe(uuid)) id: string) {
    return this.publications.get(id);
  }

  @Get('relay')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'À relayer : publications en relais manuel du jour (retards compris), texte prêt à copier, fichier à la bonne taille, lien direct vers le réseau' })
  @ZodQuery(relayListQuerySchema)
  @ZodResponse(200, relayListSchema)
  @ApiErrors(400, 401, 403, 429)
  relay(@Query(zodPipe(relayListQuerySchema)) query: z.infer<typeof relayListQuerySchema>) {
    return this.publications.relayList(query.date);
  }

  @Post('content/:id/relayed')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marque comme publié un contenu relayé à la main (lien de la publication facultatif)' })
  @ZodBody(relayDoneSchema)
  @ZodResponse(200, publicationItemSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  relayed(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(relayDoneSchema)) body: z.infer<typeof relayDoneSchema>, @CurrentUser() user: UserActor) {
    return this.publications.markRelayed(id, body.url ?? null, user.userId);
  }

  @Get('content/:id/download')
  @Can('marketing.read')
  @NoAudit()
  @ApiProduces('image/png', 'video/mp4', 'text/html')
  @ApiOperation({ summary: 'Télécharge le visuel, la vidéo ou la miniature (`asset=thumbnail`) d\'un contenu, nommé avec son réseau et sa taille' })
  @ZodQuery(downloadQuerySchema)
  @ApiErrors(400, 401, 403, 404, 429)
  async download(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(downloadQuerySchema)) query: z.infer<typeof downloadQuerySchema>, @Res({ passthrough: true }) res: Response) {
    const file = await this.publications.download(id, query.asset);
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(file.body);
  }

  @Get('social/summary')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Commentaires et messages par réseau (boîte unifiée, canal social) : non lus, remis à l\'humain, réponses à relayer' })
  @ZodResponse(200, socialInboxSummarySchema)
  @ApiErrors(401, 403, 429)
  socialSummary() {
    return this.publications.socialSummary();
  }

  @Post('social/messages/:id/send')
  @Can('conversations.reply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoie par le connecteur du réseau une réponse à un commentaire en attente de relais (409 sans connecteur : à coller sur le réseau)' })
  @ZodResponse(200, conversationSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  sendReply(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.publications.sendReply(id, user.userId);
  }
}
