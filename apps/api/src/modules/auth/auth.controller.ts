/** Connexion des clients et des chauffeurs (section 7.2, groupe Auth). Aucun mot de passe : téléphone et code SMS, Apple ou Google. */
import {
  logoutSchema, otpRequestResponseSchema, otpRequestSchema, otpVerifySchema, refreshSchema, socialLoginResponseSchema, socialLoginSchema, tokensSchema,
} from '@neomoov/domain';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, CurrentUser, Public, ReqCtx, type RequestContext, type UserActor } from './actor.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoie un code à 6 chiffres par texto (5 minutes, 5 tentatives, limité par numéro et par adresse)' })
  @ZodBody(otpRequestSchema)
  @ZodResponse(200, otpRequestResponseSchema)
  @ApiErrors(400, 429)
  requestOtp(@Body(zodPipe(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>, @ReqCtx() ctx: RequestContext) {
    return this.auth.requestOtp(body.phone, ctx, body.language);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Vérifie le code ; crée le compte à la première connexion (conditions et politique acceptées) et renvoie les jetons' })
  @ZodBody(otpVerifySchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 403, 409, 429)
  verifyOtp(@Body(zodPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>, @ReqCtx() ctx: RequestContext) {
    return this.auth.verifyOtp(body, ctx);
  }

  @Post('apple')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion avec Apple : jetons si le compte est lié, sinon jeton de liaison à confirmer par code SMS' })
  @ZodBody(socialLoginSchema)
  @ZodResponse(200, socialLoginResponseSchema)
  @ApiErrors(400, 401, 403, 429, 501)
  apple(@Body(zodPipe(socialLoginSchema)) body: z.infer<typeof socialLoginSchema>, @ReqCtx() ctx: RequestContext) {
    return this.auth.socialLogin('apple', body, ctx);
  }

  @Post('google')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion avec Google : jetons si le compte est lié, sinon jeton de liaison à confirmer par code SMS' })
  @ZodBody(socialLoginSchema)
  @ZodResponse(200, socialLoginResponseSchema)
  @ApiErrors(400, 401, 403, 429, 501)
  google(@Body(zodPipe(socialLoginSchema)) body: z.infer<typeof socialLoginSchema>, @ReqCtx() ctx: RequestContext) {
    return this.auth.socialLogin('google', body, ctx);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotation du jeton de rafraîchissement ; un jeton réutilisé révoque toutes les sessions de sa famille' })
  @ZodBody(refreshSchema)
  @ZodResponse(200, tokensSchema)
  @ApiErrors(400, 401, 403, 429)
  refresh(@Body(zodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @ReqCtx() ctx: RequestContext) {
    return this.auth.refresh(body.refreshToken, ctx);
  }

  @Post('logout')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Déconnexion : révoque la session courante (et le jeton de rafraîchissement fourni), ou toutes les sessions' })
  @ZodBody(logoutSchema)
  @ApiErrors(401, 429)
  async logout(@Body(zodPipe(logoutSchema)) body: z.infer<typeof logoutSchema>, @CurrentUser() user: UserActor) {
    await this.auth.logout(user, body);
  }
}
