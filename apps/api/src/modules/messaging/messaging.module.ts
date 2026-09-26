import { Module } from '@nestjs/common';
import { RidesModule } from '../rides/rides.module.js';
import { InboundMessagesService } from './inbound-messages.service.js';
import { MessagingWebhooksController } from './messaging.controller.js';

/** Messages entrants hors de l'application (prompt 13) : relais des textos d'une course, WhatsApp, vers l'agent relation client. */
@Module({
  imports: [RidesModule],
  controllers: [MessagingWebhooksController],
  providers: [InboundMessagesService],
  exports: [InboundMessagesService],
})
export class MessagingModule {}
