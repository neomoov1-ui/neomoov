/**
 * Routes My Hub du marketing automatisé (`/admin/marketing`, phase 1 « entreprise autonome ») : espaces et connecteurs,
 * calendrier de la semaine (lecture, modification, approbation en un clic, refus, publication immédiate, média),
 * tâches de référencement (lecture, approbation qui applique, refus), lancement des agents à la demande. Lecture :
 * `marketing.read` ; actions : `marketing.manage`.
 */
import {
  contentItemSchema, contentListQuerySchema, contentPlanRequestSchema, contentRejectSchema, contentUpdateSchema, marketingPlanResultSchema, marketingSpaceSchema, seoPlanRequestSchema, seoPlanResultSchema,
  seoTaskListQuerySchema, seoTaskRejectSchema, seoTaskSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { ContentAgent } from './content.agent.js';
import { ContentService } from './content.service.js';
import { PublishingService } from './publishing.service.js';
import { SeoAgent } from './seo.agent.js';
import { SeoService } from './seo.service.js';

@ApiTags('marketing')
@ApiBearerAuth()
@Controller('admin/marketing')
export class MarketingController {
  constructor(
    private readonly content: ContentService,
    private readonly contentAgent: ContentAgent,
    private readonly publishing: PublishingService,
    private readonly seo: SeoService,
    private readonly seoAgent: SeoAgent,
  ) {}

  @Get('spaces')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Espaces de diffusion : connecteur (simulé, réel, non configuré), formats admis, créneaux' })
  @ZodResponse(200, z.array(marketingSpaceSchema))
  @ApiErrors(401, 403, 429)
  spaces() {
    return this.content.spaces();
  }

  @Get('content')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Calendrier de contenu d\'une semaine (lundi `week`, par défaut la semaine en cours), par espace et par créneau' })
  @ZodQuery(contentListQuerySchema)
  @ZodResponse(200, z.array(contentItemSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(contentListQuerySchema)) query: z.infer<typeof contentListQuerySchema>) {
    return this.content.list(query);
  }

  @Post('content/plan')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lance l\'agent contenu à la demande : calendrier de la semaine suivante (ou de `weekStart`) ; une semaine déjà produite est rejouée sauf `force`' })
  @ZodBody(contentPlanRequestSchema)
  @ZodResponse(200, marketingPlanResultSchema)
  @ApiErrors(400, 401, 403, 429)
  plan(@Body(zodPipe(contentPlanRequestSchema)) body: z.infer<typeof contentPlanRequestSchema>) {
    return this.contentAgent.planWeek({ ...(body.weekStart ? { weekStart: body.weekStart } : {}), force: body.force });
  }

  @Get('content/:id')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Un contenu, ses écarts, ses mesures et ses commentaires' })
  @ZodResponse(200, contentItemSchema)
  @ApiErrors(401, 403, 404, 429)
  item(@Param('id', zodPipe(uuid)) id: string) {
    return this.content.view(id);
  }

  @Get('content/:id/media')
  @Can('marketing.read')
  @NoAudit()
  @ApiProduces('image/png', 'video/mp4', 'text/html')
  @ApiOperation({ summary: 'Visuel (PNG), vidéo (MP4) ou gabarit HTML du contenu, pour l\'aperçu de My Hub' })
  @ApiErrors(401, 403, 404, 429)
  async media(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.content.media(id);
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(file.body);
  }

  @Patch('content/:id')
  @Can('marketing.manage')
  @ApiOperation({ summary: 'Modifie un contenu avant publication (texte, légende, mots-clics, appel à l\'action, créneau) ; les règles sont réappliquées' })
  @ZodBody(contentUpdateSchema)
  @ZodResponse(200, contentItemSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  update(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(contentUpdateSchema)) body: z.infer<typeof contentUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.content.update(id, body, { userId: user.userId });
  }

  @Post('content/:id/approve')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuve un contenu : programmé à son créneau, visuel produit' })
  @ZodResponse(200, contentItemSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  approve(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.content.approve(id, { userId: user.userId });
  }

  @Post('content/:id/reject')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuse un contenu, avec motif' })
  @ZodBody(contentRejectSchema)
  @ZodResponse(200, contentItemSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  reject(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(contentRejectSchema)) body: z.infer<typeof contentRejectSchema>, @CurrentUser() user: UserActor) {
    return this.content.reject(id, body.reason, { userId: user.userId });
  }

  @Post('content/:id/publish')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publie tout de suite un contenu programmé (exécution de l\'agent de diffusion)' })
  @ZodResponse(200, contentItemSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  publish(@Param('id', zodPipe(uuid)) id: string) {
    return this.publishing.publishItem(id);
  }

  @Get('seo/tasks')
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Tâches de référencement (les plus récentes d\'abord) ; filtre `status`' })
  @ZodQuery(seoTaskListQuerySchema)
  @ZodResponse(200, z.array(seoTaskSchema))
  @ApiErrors(400, 401, 403, 429)
  seoTasks(@Query(zodPipe(seoTaskListQuerySchema)) query: z.infer<typeof seoTaskListQuerySchema>) {
    return this.seo.list(query);
  }

  @Post('seo/plan')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lance l\'agent référencement à la demande (plan de la semaine) ; rejoué sauf `force`' })
  @ZodBody(seoPlanRequestSchema)
  @ZodResponse(200, seoPlanResultSchema)
  @ApiErrors(400, 401, 403, 429)
  seoPlan(@Body(zodPipe(seoPlanRequestSchema)) body: z.infer<typeof seoPlanRequestSchema>) {
    return this.seoAgent.planWeek({ ...(body.weekStart ? { weekStart: body.weekStart } : {}), force: body.force });
  }

  @Post('seo/tasks/:id/approve')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuve et applique une tâche de référencement (balise corrigée, brouillon créé ; un lien interne reste à faire à la main)' })
  @ZodResponse(200, seoTaskSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  seoApprove(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.seo.apply(id, { userId: user.userId });
  }

  @Post('seo/tasks/:id/reject')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuse une tâche de référencement, avec motif' })
  @ZodBody(seoTaskRejectSchema)
  @ZodResponse(200, seoTaskSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  seoReject(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(seoTaskRejectSchema)) body: z.infer<typeof seoTaskRejectSchema>, @CurrentUser() user: UserActor) {
    return this.seo.reject(id, body.reason, { userId: user.userId });
  }
}
