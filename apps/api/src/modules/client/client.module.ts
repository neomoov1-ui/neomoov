import { Module } from '@nestjs/common';
import { ClientProfileController, ConfigController } from './client-profile.controller.js';
import { ClientProfileService } from './client-profile.service.js';

/** Configuration publique des applications et profil client autour de la réservation (prompt 10). */
@Module({ controllers: [ConfigController, ClientProfileController], providers: [ClientProfileService], exports: [ClientProfileService] })
export class ClientModule {}
