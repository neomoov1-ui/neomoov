import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { SosCallService } from './sos-call.service.js';
import { VoiceWebhooksController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';

/** Agent vocal Vapi (prompt 13) : outils de réservation par téléphone et journal des appels ; rapports des appels sortants commerciaux remis au module des ventes. */
@Module({
  imports: [PricingModule, RidesModule, SalesModule],
  controllers: [VoiceWebhooksController],
  providers: [VoiceService, SosCallService],
  exports: [VoiceService, SosCallService],
})
export class VoiceModule {}
