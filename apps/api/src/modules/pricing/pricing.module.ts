import { Module } from '@nestjs/common';
import { AdminPricingController, PlacesController, QuotesController } from './pricing.controller.js';
import { PricingRulesService } from './pricing-rules.service.js';
import { PricingWarmupService } from './pricing-warmup.service.js';
import { QuotesService } from './quotes.service.js';
import { ZonesService } from './zones.service.js';

/** Tarification, devis, zones et lieux (étape 4). Les règles viennent de la base ; le moteur est dans @neomoov/domain. */
@Module({
  controllers: [PlacesController, QuotesController, AdminPricingController],
  providers: [PricingRulesService, ZonesService, QuotesService, PricingWarmupService],
  exports: [PricingRulesService, ZonesService, QuotesService],
})
export class PricingModule {}
