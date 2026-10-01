/**
 * Crochet de Neomoov Pilote (étape 24) dans la répartition. Le module `pilot` s'y inscrit au démarrage (il dépend du
 * module des courses, jamais l'inverse) ; sans inscription, ou en cas d'erreur de Pilote, la répartition est inchangée :
 * l'offre garde son échéance et l'avis « nouvelle offre » part comme avant.
 */
import type { schema } from '@neomoov/db';
import type { DriverOfferView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import type { RideRow } from './ride-view.js';

export type OfferRow = typeof schema.rideOffers.$inferSelect;

/** Suite donnée à une offre créée : son échéance (allongée en mode multi-applications) et l'avis au chauffeur. */
export interface PilotOfferOutcome {
  expiresAt: Date;
  /** Faux quand Pilote accepte l'offre pour le chauffeur : il reçoit l'avis de Pilote à la place. */
  notify: boolean;
}

export interface OfferPilot {
  /**
   * Offre insérée par la répartition, sous le verrou de la course (le verrou consultatif des offres est déjà relâché) :
   * évaluation selon les critères du chauffeur. Une acceptation automatique passe ensuite par `DispatchService.accept`,
   * une fois le verrou de la course libéré : mêmes verrous et mêmes vérifications qu'une acceptation à la main.
   */
  onOfferCreated(offer: OfferRow, ride: RideRow, driverUserId: string): Promise<PilotOfferOutcome>;
  /** Score Pilote de chaque offre de la vue du chauffeur, Pilote activé ou non. */
  scoreOffers(driverUserId: string, views: DriverOfferView[]): Promise<DriverOfferView[]>;
}

@Injectable()
export class PilotHook {
  private pilot: OfferPilot | null = null;

  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  register(pilot: OfferPilot | null): void {
    this.pilot = pilot;
  }

  async onOfferCreated(offer: OfferRow, ride: RideRow, driverUserId: string): Promise<PilotOfferOutcome> {
    if (!this.pilot) return { expiresAt: offer.expiresAt, notify: true };
    try {
      return await this.pilot.onOfferCreated(offer, ride, driverUserId);
    } catch (error) {
      this.logger.error({ err: error, offerId: offer.id, rideId: ride.id }, 'Neomoov Pilote : offre non évaluée, répartition inchangée');
      return { expiresAt: offer.expiresAt, notify: true };
    }
  }

  async scoreOffers(driverUserId: string, views: DriverOfferView[]): Promise<DriverOfferView[]> {
    if (!this.pilot || !views.length) return views;
    try {
      return await this.pilot.scoreOffers(driverUserId, views);
    } catch (error) {
      this.logger.warn({ err: error }, 'Neomoov Pilote : score des offres indisponible');
      return views;
    }
  }
}
