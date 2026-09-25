/**
 * Espace chauffeur (prompt 11, section 7.2 groupe Chauffeur) : candidature, dossier, formation, accueil, revenus,
 * relevés, packs, clients fidèles, tableau de conduite, fiche et fin de course, compte de versement, quart.
 * Le déroulé des courses, les offres, le statut et les positions restent dans `rides/driver.controller.ts`.
 */
import {
  admittedModelSchema, driverApplySchema, driverDocumentSchema, driverDocumentsViewSchema, driverHomeSchema, driverIncidentSchema, driverPacksViewSchema,
  driverProfileSchema, driverProfileUpdateSchema, driverRideSchema, driverScoreSchema, driverStatementSchema, documentUploadFieldsSchema, earningsQuerySchema,
  earningsSchema, loyalClientSchema, onboardingSchema, packActivateSchema, packUpdateSchema, paymentReceivedSchema, payoutLinkSchema, payoutStatusSchema,
  rateClientSchema, shiftStartResultSchema, shiftStartSchema, statementSummarySchema, trainingResultSchema, trainingSubmitSchema, trainingViewSchema, uuid,
  vehicleInputSchema, vehicleViewSchema,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse, zodToOpenApi } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, CurrentUser, NoAudit, Roles, type UserActor } from '../auth/actor.js';
import { DriverActivityService } from './driver-activity.service.js';
import { DriverProfileService, type UploadedFile as DocumentFile } from './driver-profile.service.js';
import { DriverTrainingService } from './driver-training.service.js';

const moduleCode = z.string().regex(/^[a-z0-9_-]{1,40}$/);
/** Limite de multer au-dessus du réglage (10 Mo) : le service renvoie une erreur lisible au-delà du réglage. */
const MULTER_LIMIT_BYTES = 20 * 1024 * 1024;

@ApiTags('driver')
@ApiBearerAuth()
@Authenticated()
@Controller('driver')
export class DriverApplyController {
  constructor(private readonly profiles: DriverProfileService) {}

  @Post('apply')
  @HttpCode(201)
  @Audit('driver.apply', 'drivers')
  @ApiOperation({ summary: 'Candidature : le compte connecté devient chauffeur en attente (idempotent). Renouveler ensuite le jeton (`POST /auth/refresh`) pour obtenir le rôle' })
  @ZodBody(driverApplySchema)
  @ZodResponse(201, driverProfileSchema)
  @ApiErrors(400, 401, 409, 429)
  apply(@Body(zodPipe(driverApplySchema)) body: z.infer<typeof driverApplySchema>, @CurrentUser() user: UserActor) {
    return this.profiles.apply(user.userId, body);
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver')
export class DriverAccountController {
  constructor(
    private readonly profiles: DriverProfileService,
    private readonly training: DriverTrainingService,
    private readonly activity: DriverActivityService,
  ) {}

  @Get('home')
  @NoAudit()
  @ApiOperation({ summary: 'Accueil : statut, prérequis manquants, assistant d\'inscription, pack, revenus du jour et de la semaine, prochaine planifiée, alertes' })
  @ZodResponse(200, driverHomeSchema)
  @ApiErrors(401, 403, 429)
  home(@CurrentUser() user: UserActor) {
    return this.activity.home(user.userId);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Dossier du chauffeur : identité, qualification, taxes, langues, modes de paiement acceptés, zones préférées' })
  @ZodResponse(200, driverProfileSchema)
  @ApiErrors(401, 403, 429)
  profile(@CurrentUser() user: UserActor) {
    return this.profiles.profile(user.userId);
  }

  @Patch('profile')
  @Audit('driver.profile_updated', 'drivers')
  @ApiOperation({ summary: 'Modifie le dossier (y compris les modes de paiement acceptés : la carte reste toujours acceptée)' })
  @ZodBody(driverProfileUpdateSchema)
  @ZodResponse(200, driverProfileSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  updateProfile(@Body(zodPipe(driverProfileUpdateSchema)) body: z.infer<typeof driverProfileUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.profiles.updateProfile(user.userId, body);
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'Assistant d\'inscription : état de chaque étape et prochaine étape à faire (reprise)' })
  @ZodResponse(200, onboardingSchema)
  @ApiErrors(401, 403, 429)
  async onboarding(@CurrentUser() user: UserActor) {
    return this.profiles.onboarding(await this.profiles.requireDriver(user.userId));
  }

  @Get('vehicle-models')
  @ApiOperation({ summary: 'Modèles admis par catégorie (sélecteur de l\'inscription)' })
  @ZodResponse(200, z.array(admittedModelSchema))
  @ApiErrors(401, 403, 429)
  vehicleModels() {
    return this.profiles.vehicleModels();
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'Véhicules du chauffeur' })
  @ZodResponse(200, z.array(vehicleViewSchema))
  @ApiErrors(401, 403, 429)
  vehicles(@CurrentUser() user: UserActor) {
    return this.profiles.vehicles(user.userId);
  }

  @Post('vehicles')
  @HttpCode(201)
  @Audit('driver.vehicle_added', 'vehicles')
  @ApiOperation({ summary: 'Déclare un véhicule : catégorie déduite du modèle, de l\'année et des places ; en attente de validation' })
  @ZodBody(vehicleInputSchema)
  @ZodResponse(201, vehicleViewSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  addVehicle(@Body(zodPipe(vehicleInputSchema)) body: z.infer<typeof vehicleInputSchema>, @CurrentUser() user: UserActor) {
    return this.profiles.addVehicle(user.userId, body);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Documents exigés, état de chacun (à fournir, en vérification, approuvé, bientôt expiré, expiré, refusé) et suspension' })
  @ZodResponse(200, driverDocumentsViewSchema)
  @ApiErrors(401, 403, 429)
  documents(@CurrentUser() user: UserActor) {
    return this.profiles.documents(user.userId);
  }

  @Post('documents')
  @HttpCode(201)
  @Audit('driver.document_uploaded', 'driver_documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_LIMIT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['type', 'file'], properties: { ...(zodToOpenApi(documentUploadFieldsSchema).properties ?? {}), file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Téléverse un document (JPEG, PNG, WEBP ou PDF, 10 Mo au plus) ; il attend la vérification' })
  @ZodResponse(201, driverDocumentSchema)
  @ApiErrors(400, 401, 403, 404, 413, 415, 429)
  uploadDocument(@Body(zodPipe(documentUploadFieldsSchema)) body: z.infer<typeof documentUploadFieldsSchema>, @UploadedFile() file: DocumentFile | undefined, @CurrentUser() user: UserActor) {
    return this.profiles.uploadDocument(user.userId, body, file);
  }

  @Get('training')
  @ApiOperation({ summary: 'Formation Neomoov : modules (sans les réponses), réussite de chacun, attestation' })
  @ZodResponse(200, trainingViewSchema)
  @ApiErrors(401, 403, 429)
  trainingView(@CurrentUser() user: UserActor) {
    return this.training.view(user.userId);
  }

  @Post('training/:code/submit')
  @HttpCode(200)
  @Audit('driver.training_submitted', 'drivers')
  @ApiOperation({ summary: 'Réponses au quiz d\'un module, corrigées par l\'API ; attestation délivrée quand tous les modules sont réussis' })
  @ZodBody(trainingSubmitSchema)
  @ZodResponse(200, trainingResultSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  submitTraining(@Param('code', zodPipe(moduleCode)) code: string, @Body(zodPipe(trainingSubmitSchema)) body: z.infer<typeof trainingSubmitSchema>, @CurrentUser() user: UserActor) {
    return this.training.submit(user.userId, code, body.answers);
  }

  @Get('payout')
  @ApiOperation({ summary: 'Compte de versement Stripe Connect Express : lié, inscription terminée' })
  @ZodResponse(200, payoutStatusSchema)
  @ApiErrors(401, 403, 429)
  payout(@CurrentUser() user: UserActor) {
    return this.profiles.payoutStatus(user.userId);
  }

  @Post('connect/onboarding-link')
  @HttpCode(201)
  @Audit('driver.payout_link', 'drivers')
  @ApiOperation({ summary: 'Lien d\'inscription Stripe Connect Express (ouvert dans l\'application) ; crée le compte au premier appel' })
  @ZodResponse(201, payoutLinkSchema)
  @ApiErrors(401, 403, 429, 503)
  payoutLink(@CurrentUser() user: UserActor) {
    return this.profiles.payoutLink(user.userId);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'Revenus du jour, de la semaine (lundi au dimanche) ou du mois, heure de Montréal ; chaque ligne renvoie à sa course' })
  @ZodQuery(earningsQuerySchema)
  @ZodResponse(200, earningsSchema)
  @ApiErrors(400, 401, 403, 429)
  earnings(@Query(zodPipe(earningsQuerySchema)) query: z.infer<typeof earningsQuerySchema>, @CurrentUser() user: UserActor) {
    return this.activity.earnings(user.userId, query.period, query.date);
  }

  @Get('statements')
  @ApiOperation({ summary: 'Relevés hebdomadaires émis, du plus récent au plus ancien' })
  @ZodResponse(200, z.array(statementSummarySchema))
  @ApiErrors(401, 403, 429)
  statements(@CurrentUser() user: UserActor) {
    return this.activity.statements(user.userId);
  }

  @Get('statements/:id')
  @ApiOperation({ summary: 'Détail d\'un relevé : crédits et débits ligne par ligne, chaque ligne renvoie à sa course ou à son pack' })
  @ZodResponse(200, driverStatementSchema)
  @ApiErrors(401, 403, 404, 429)
  statement(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.activity.statement(user.userId, id);
  }

  @Get('packs')
  @ApiOperation({ summary: 'Packs : catalogue avec le prix appliqué au chauffeur, pack actif, historique' })
  @ZodResponse(200, driverPacksViewSchema)
  @ApiErrors(401, 403, 429)
  packs(@CurrentUser() user: UserActor) {
    return this.activity.packs(user.userId);
  }

  @Post('packs/activate')
  @HttpCode(200)
  @Audit('driver.pack_activate', 'pack_purchases')
  @ApiOperation({ summary: 'Active un pack (actif tout de suite, facturé au relevé suivant) ou, avec un pack en cours, le programme à son épuisement' })
  @ZodBody(packActivateSchema)
  @ZodResponse(200, driverPacksViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  activatePack(@Body(zodPipe(packActivateSchema)) body: z.infer<typeof packActivateSchema>, @CurrentUser() user: UserActor) {
    return this.activity.activatePack(user.userId, body);
  }

  @Patch('packs/:id')
  @Audit('driver.pack_updated', 'pack_purchases')
  @ApiOperation({ summary: 'Renouvellement automatique et pack suivant' })
  @ZodBody(packUpdateSchema)
  @ZodResponse(200, driverPacksViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updatePack(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(packUpdateSchema)) body: z.infer<typeof packUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.activity.updatePack(user.userId, id, body);
  }

  @Get('loyal-clients')
  @ApiOperation({ summary: 'Mes clients (D38) : clients qui ont mis le chauffeur en favori ou le redemandent' })
  @ZodResponse(200, z.array(loyalClientSchema))
  @ApiErrors(401, 403, 429)
  loyalClients(@CurrentUser() user: UserActor) {
    return this.activity.loyalClients(user.userId);
  }

  @Get('score')
  @ApiOperation({ summary: 'Tableau de conduite sur 30 jours : ponctualité, note, annulations, accélérations et freinages brusques, suggestions' })
  @ZodResponse(200, driverScoreSchema)
  @ApiErrors(401, 403, 429)
  score(@CurrentUser() user: UserActor) {
    return this.activity.score(user.userId);
  }

  @Get('rides/:id')
  @ApiOperation({ summary: 'Fiche de course du chauffeur : course, préférences du client, passager, paiement, attente, contact masqué' })
  @ZodResponse(200, driverRideSchema)
  @ApiErrors(401, 403, 404, 429)
  ride(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.activity.driverRide(user.userId, id);
  }

  @Post('rides/:id/payment-received')
  @HttpCode(200)
  @Audit('driver.payment_received', 'rides', 'id')
  @ApiOperation({ summary: 'Paiement direct : montant reçu du client (espèces, Interac, terminal) ; un écart ouvre un incident' })
  @ZodBody(paymentReceivedSchema)
  @ZodResponse(200, driverRideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  paymentReceived(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(paymentReceivedSchema)) body: z.infer<typeof paymentReceivedSchema>, @CurrentUser() user: UserActor) {
    return this.activity.paymentReceived(user.userId, id, body.amountCents);
  }

  @Post('rides/:id/rate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Évaluation du client par le chauffeur (une seule par course)' })
  @ZodBody(rateClientSchema)
  @ZodResponse(200, driverRideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  rateClient(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(rateClientSchema)) body: z.infer<typeof rateClientSchema>, @CurrentUser() user: UserActor) {
    return this.activity.rateClient(user.userId, id, body);
  }

  @Post('rides/:id/incident')
  @HttpCode(201)
  @Audit('driver.incident_reported', 'incidents')
  @ApiOperation({ summary: 'Signalement d\'incident depuis la course (accident, agression, dommage, objet oublié, comportement, véhicule)' })
  @ZodBody(driverIncidentSchema)
  @ZodResponse(201, z.object({ incidentId: uuid, status: z.literal('open') }))
  @ApiErrors(400, 401, 403, 404, 429)
  incident(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(driverIncidentSchema)) body: z.infer<typeof driverIncidentSchema>, @CurrentUser() user: UserActor) {
    return this.activity.reportIncident(user.userId, id, body);
  }

  @Post('shifts/start')
  @HttpCode(200)
  @Audit('driver.shift_start', 'driver_shifts')
  @ApiOperation({ summary: 'Début de quart avec vérification faciale (V1.1, drapeau FEATURE_FACE_CHECK ; « disabled » sinon)' })
  @ZodBody(shiftStartSchema)
  @ZodResponse(200, shiftStartResultSchema)
  @ApiErrors(400, 401, 403, 429)
  startShift(@Body(zodPipe(shiftStartSchema)) body: z.infer<typeof shiftStartSchema>, @CurrentUser() user: UserActor) {
    return this.activity.startShift(user.userId, body.photoBase64);
  }
}
