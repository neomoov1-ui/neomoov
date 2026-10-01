/** Connexion du personnel de My Hub : courriel et mot de passe, puis second facteur TOTP obligatoire (section 8). */
import { backupCodesSchema, mfaBackupSchema, mfaCodeSchema, mfaEnrollmentSchema, mfaTokenSchema, staffLoginResponseSchema, staffLoginSchema, tokensSchema } from '@neomoov/domain';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, CurrentUser, Public, ReqCtx, type RequestContext, type UserActor } from './actor.js';
import { StaffAuthService } from './staff-auth.service.js';

/**
 * Étape 21 : second facteur TOTP d'un membre d'une organisation cliente connecté par code SMS, proposé dès qu'une
 * permission sensible est nécessaire (gestion des membres et des rôles, relevés, remboursements). Mêmes écrans et même
 * secret que le personnel ; la nouvelle session porte `mfa` dans `amr`, jamais `pwd` ni un rôle du personnel, et remplace
 * celle du code SMS. Les jetons de passage de ces routes ne sont jamais acceptés par celles du personnel, et inversement.
 */
@ApiTags('auth')
@Controller('auth/mfa')
export class MemberMfaController {
  constructor(private readonly staff: StaffAuthService) {}

  @Post('start')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Membre d\'organisation connecté par code SMS : jeton de passage pour vérifier son code TOTP, ou pour l\'inscrire au premier usage' })
  @ZodResponse(200, staffLoginResponseSchema)
  @ApiErrors(401, 409, 423, 429)
  start(@CurrentUser() user: UserActor) {
    return this.staff.startMember(user);
  }

  @Post('enroll')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Inscription du second facteur d\'un membre : secret et QR pour une application d\'authentification' })
  @ZodBody(mfaTokenSchema)
  @ZodResponse(200, mfaEnrollmentSchema)
  @ApiErrors(400, 401, 429)
  enroll(@Body(zodPipe(mfaTokenSchema)) body: z.infer<typeof mfaTokenSchema>) {
    return this.staff.enroll(body.mfaToken, 'member');
  }

  @Post('confirm')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirme l\'inscription d\'un membre par un premier code : codes de secours (une seule fois) et session à double authentification' })
  @ZodBody(mfaCodeSchema)
  @ZodResponse(200, tokensSchema.extend(backupCodesSchema.shape))
  @ApiErrors(400, 401, 409, 423, 429)
  confirm(@Body(zodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.confirmEnrollment(body.mfaToken, body.code, ctx, 'member');
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Code TOTP d\'un membre : session à double authentification (permissions sensibles de son rôle actives)' })
  @ZodBody(mfaCodeSchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 401, 423, 429)
  verify(@Body(zodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.verifyCode(body.mfaToken, body.code, ctx, 'member');
  }

  @Post('backup')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Code de secours d\'un membre (consommé) : session à double authentification' })
  @ZodBody(mfaBackupSchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 401, 423, 429)
  backup(@Body(zodPipe(mfaBackupSchema)) body: z.infer<typeof mfaBackupSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.verifyBackupCode(body.mfaToken, body.backupCode, ctx, 'member');
  }
}

@ApiTags('auth')
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly staff: StaffAuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Première étape : courriel et mot de passe ; renvoie un jeton de passage pour le second facteur' })
  @ZodBody(staffLoginSchema)
  @ZodResponse(200, staffLoginResponseSchema)
  @ApiErrors(400, 401, 423, 429)
  login(@Body(zodPipe(staffLoginSchema)) body: z.infer<typeof staffLoginSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.login(body.email, body.password, ctx.ip);
  }

  @Post('mfa/enroll')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Inscription du second facteur (première connexion) : secret et QR pour une application d\'authentification' })
  @ZodBody(mfaTokenSchema)
  @ZodResponse(200, mfaEnrollmentSchema)
  @ApiErrors(400, 401, 429)
  enroll(@Body(zodPipe(mfaTokenSchema)) body: z.infer<typeof mfaTokenSchema>) {
    return this.staff.enroll(body.mfaToken);
  }

  @Post('mfa/confirm')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirme l\'inscription avec un premier code : codes de secours (affichés une seule fois) et jetons' })
  @ZodBody(mfaCodeSchema)
  @ZodResponse(200, tokensSchema.extend(backupCodesSchema.shape))
  @ApiErrors(400, 401, 429)
  confirm(@Body(zodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.confirmEnrollment(body.mfaToken, body.code, ctx);
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Deuxième étape : code de l\'application d\'authentification ; renvoie les jetons avec les rôles du personnel' })
  @ZodBody(mfaCodeSchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 401, 423, 429)
  verify(@Body(zodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.verifyCode(body.mfaToken, body.code, ctx);
  }

  @Post('mfa/backup')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Deuxième étape avec un code de secours (consommé)' })
  @ZodBody(mfaBackupSchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 401, 423, 429)
  backup(@Body(zodPipe(mfaBackupSchema)) body: z.infer<typeof mfaBackupSchema>, @ReqCtx() ctx: RequestContext) {
    return this.staff.verifyBackupCode(body.mfaToken, body.backupCode, ctx);
  }
}
