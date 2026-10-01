import { Module } from '@nestjs/common';
import { BrandingModule } from '../branding/branding.module.js';
import { ClientProfileController, ConfigController } from './client-profile.controller.js';
import { ClientProfileService } from './client-profile.service.js';

/** Configuration publique des applications et profil client autour de la réservation (prompt 10) ; marque de l'appelant (étape 22). */
@Module({ imports: [BrandingModule], controllers: [ConfigController, ClientProfileController], providers: [ClientProfileService], exports: [ClientProfileService] })
export class ClientModule {}
