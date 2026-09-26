import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { SosCallService } from './sos-call.service.js';
import { VoiceWebhooksController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';

/** Agent vocal Vapi (prompt 13) : outils de réservation par téléphone et journal des appels. */
@Module({
  imports: [PricingModule, RidesModule],
  controllers: [VoiceWebhooksController],
  providers: [VoiceService, SosCallService],
  exports: [VoiceService, SosCallService],
})
export class VoiceModule {}
