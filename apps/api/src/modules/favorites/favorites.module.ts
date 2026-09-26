import { Module } from '@nestjs/common';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

/** Chauffeurs favoris du client (prompt 08, tâche 5) ; le supplément du devis est traité par la tarification. */
@Module({ controllers: [FavoritesController], providers: [FavoritesService], exports: [FavoritesService] })
export class FavoritesModule {}
