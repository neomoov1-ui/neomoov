import { Module } from '@nestjs/common';
import { AdminPricingController, PlacesController, PromotionsController, QuotesController } from './pricing.controller.js';
import { PricingRulesService } from './pricing-rules.service.js';
import { PricingWarmupService } from './pricing-warmup.service.js';
import { PromotionsService } from './promotions.service.js';
import { QuotesService } from './quotes.service.js';
import { ZonesService } from './zones.service.js';

/** Tarification, devis, zones et lieux (étape 4). Les règles viennent de la base ; le moteur est dans @neomoov/domain. */
@Module({
  controllers: [PlacesController, QuotesController, PromotionsController, AdminPricingController],
  providers: [PricingRulesService, ZonesService, QuotesService, PricingWarmupService, PromotionsService],
  exports: [PricingRulesService, ZonesService, QuotesService, PromotionsService],
})
export class PricingModule {}
