import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AntiBotService } from '../../common/anti-bot.service.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { AdminApiKeysController, AdminStaffController, ServiceController } from './admin.controller.js';
import { AccessService } from './access.service.js';
import { ApiKeysService } from './api-keys.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard, OwnershipGuard, RateLimitGuard } from './guards.js';
import { OtpService } from './otp.service.js';
import { SocialService } from './social.service.js';
import { MemberMfaController, StaffAuthController } from './staff-auth.controller.js';
import { StaffAuthService } from './staff-auth.service.js';
import { TokensService } from './tokens.service.js';

/**
 * Identité : connexion, jetons, second facteur du personnel, clés de service, et les trois gardes globales dans l'ordre
 * (limite par adresse, authentification et politique, propriété de la ressource). Module global : les services de
 * jetons, de limitation et d'anti-robots servent aux autres modules (profil, confidentialité, API publique, worker).
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [AuthController, StaffAuthController, AdminStaffController, AdminApiKeysController, ServiceController, MemberMfaController],
  providers: [
    RateLimitService,
    AntiBotService,
    TokensService,
    OtpService,
    SocialService,
    StaffAuthService,
    ApiKeysService,
    AuthService,
    AccessService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OwnershipGuard },
  ],
  exports: [RateLimitService, AntiBotService, TokensService, OtpService, SocialService, StaffAuthService, ApiKeysService, AuthService, AccessService],
})
export class AuthModule {}
