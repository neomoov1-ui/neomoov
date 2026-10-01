import { Module } from '@nestjs/common';
import { AdminBrandController, MeOrganizationsController, PublicBrandController } from './branding.controller.js';
import { BrandingService } from './branding.service.js';

/** Étape 22 : marque par organisation (publique, administration, rattachement par code) ; `BrandingService` sert aussi la configuration et les avis. */
@Module({
  controllers: [PublicBrandController, AdminBrandController, MeOrganizationsController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
