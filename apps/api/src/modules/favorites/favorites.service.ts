/**
 * Chauffeurs favoris du client (section 5.10, D37, D38, prompt 08 tâche 5) : la liste « Mes chauffeurs ». Un chauffeur
 * devient favori après une course terminée que le client a notée au moins `favorites.min_rating` (4). Le favori est écrit
 * à la fois dans `favorite_drivers` et dans `client_driver_links.favorite_since`, que la répartition et « Mes clients »
 * lisent tous les deux : l'ajout et le retrait les gardent cohérents, et sont idempotents.
 */
import { schema } from '@neomoov/db';
import type { FavoriteView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

/** États d'une course terminée (la note du client la fait passer à `rated`). */
const COMPLETED_STATES = ['completed', 'rated', 'disputed'] as const;

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async clientIdOf(userId: string): Promise<string> {
    const [client] = await this.db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    return client.id;
  }

  /** `GET /v1/me/favorites` : les favoris du client, le plus récent d'abord. */
  async list(userId: string): Promise<FavoriteView[]> {
    return this.favoritesOf(await this.clientIdOf(userId));
  }

  /**
   * `POST /v1/me/favorites/{driverId}` : autorisé après une course terminée avec ce chauffeur que le client a notée au
   * moins 4. Un chauffeur déjà favori est renvoyé tel quel (ajout idempotent).
   */
  async add(userId: string, driverId: string): Promise<FavoriteView> {
    const clientId = await this.clientIdOf(userId);
    const [driver] = await this.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    const [existing] = await this.favoritesOf(clientId, driverId);
    if (existing) return existing;
    const minRating = await this.settings.number('favorites.min_rating', 4);
    const [eligible] = await this.db
      .select({ id: schema.rides.id })
      .from(schema.rides)
      .innerJoin(schema.rideRatings, and(eq(schema.rideRatings.rideId, schema.rides.id), eq(schema.rideRatings.authorKind, 'client'), gte(schema.rideRatings.score, minRating)))
      .where(and(eq(schema.rides.clientId, clientId), eq(schema.rides.driverId, driverId), inArray(schema.rides.state, [...COMPLETED_STATES])))
      .limit(1);
    if (!eligible) throw AppError.conflict('FAVOURITE_NOT_ELIGIBLE', `Un chauffeur devient favori après une course terminée que vous avez notée ${minRating} ou plus`, { minRating });
    await this.db.transaction(async (tx) => {
      const [added] = await tx.insert(schema.favoriteDrivers).values({ clientId, driverId }).onConflictDoNothing().returning({ addedAt: schema.favoriteDrivers.addedAt });
      await tx
        .insert(schema.clientDriverLinks)
        .values({ clientId, driverId, favoriteSince: added?.addedAt ?? new Date() })
        .onConflictDoUpdate({ target: [schema.clientDriverLinks.clientId, schema.clientDriverLinks.driverId], set: { favoriteSince: sql`COALESCE(${schema.clientDriverLinks.favoriteSince}, excluded.favorite_since)` } });
    });
    const [view] = await this.favoritesOf(clientId, driverId);
    if (!view) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    return view;
  }

  /** `DELETE /v1/me/favorites/{driverId}` : retire le favori des deux tables ; sans effet s'il ne l'était pas. */
  async remove(userId: string, driverId: string): Promise<void> {
    const clientId = await this.clientIdOf(userId);
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.favoriteDrivers).where(and(eq(schema.favoriteDrivers.clientId, clientId), eq(schema.favoriteDrivers.driverId, driverId)));
      await tx.update(schema.clientDriverLinks).set({ favoriteSince: null }).where(and(eq(schema.clientDriverLinks.clientId, clientId), eq(schema.clientDriverLinks.driverId, driverId)));
    });
  }

  /**
   * Favoris d'un client, lus comme la répartition les lit (l'une ou l'autre table) : prénom, note, courses faites
   * ensemble, véhicule actuel, disponibilité (actif et acceptant les réservations). Les comptes supprimés sont exclus.
   */
  private async favoritesOf(clientId: string, driverId?: string): Promise<FavoriteView[]> {
    const conditions: SQL[] = [
      sql`${schema.drivers.id} IN (SELECT f.driver_id FROM favorite_drivers f WHERE f.client_id = ${clientId}::uuid UNION SELECT l.driver_id FROM client_driver_links l WHERE l.client_id = ${clientId}::uuid AND l.favorite_since IS NOT NULL)`,
      isNull(schema.users.deletedAt),
    ];
    if (driverId) conditions.push(eq(schema.drivers.id, driverId));
    const rows = await this.db
      .select({
        driverId: schema.drivers.id,
        firstName: schema.users.firstName,
        rating: schema.drivers.ratingAverage,
        status: schema.drivers.status,
        acceptsScheduled: schema.drivers.acceptsScheduled,
        ridesTogether: schema.clientDriverLinks.ridesCount,
        linkedSince: schema.clientDriverLinks.favoriteSince,
        addedAt: schema.favoriteDrivers.addedAt,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        colour: schema.vehicles.colour,
        category: schema.vehicles.category,
      })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .leftJoin(schema.favoriteDrivers, and(eq(schema.favoriteDrivers.clientId, clientId), eq(schema.favoriteDrivers.driverId, schema.drivers.id)))
      .leftJoin(schema.clientDriverLinks, and(eq(schema.clientDriverLinks.clientId, clientId), eq(schema.clientDriverLinks.driverId, schema.drivers.id)))
      .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.currentVehicleId))
      .where(and(...conditions));
    return rows
      .map((r) => ({
        driverId: r.driverId,
        firstName: r.firstName,
        rating: Math.min(5, Math.max(0, Number(r.rating))),
        ridesTogether: r.ridesTogether ?? 0,
        vehicle: r.make && r.model && r.colour && r.category ? { make: r.make, model: r.model, colour: r.colour, category: r.category } : null,
        available: r.status === 'active' && r.acceptsScheduled,
        since: (r.addedAt ?? r.linkedSince ?? new Date()).toISOString(),
      }))
      .sort((a, b) => b.since.localeCompare(a.since));
  }
}
