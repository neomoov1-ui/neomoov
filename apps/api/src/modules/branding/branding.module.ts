import { Module } from '@nestjs/common';
import { AdminBrandController, InternalTlsController, MeOrganizationsController, PublicBrandController } from './branding.controller.js';
import { BrandingService } from './branding.service.js';

/** Étape 22 : marque par organisation (publique, administration, rattachement par code) ; `BrandingService` sert aussi la configuration et les avis. Finalisation du 3 octobre 2026 : question « ask » de Caddy (TLS à la demande des domaines vérifiés). */
@Module({
  controllers: [PublicBrandController, AdminBrandController, MeOrganizationsController, InternalTlsController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
