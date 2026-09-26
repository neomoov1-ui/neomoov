import { Module } from '@nestjs/common';
import { AntiBotService } from '../../common/anti-bot.service.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { PublicApiController } from './public-api.controller.js';

/** API publique limitée pour WordPress et les pages web (prompt 12). */
@Module({ imports: [PricingModule], controllers: [PublicApiController], providers: [AntiBotService] })
export class PublicModule {}
