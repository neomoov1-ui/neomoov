/**
 * Profil client autour de la réservation (prompt 10) : préférences de confort copiées sur chaque course (D36, D37),
 * lieux enregistrés, et configuration publique lue par les applications (drapeaux, préavis, catégories).
 */
import { schema } from '@neomoov/db';
import { ridePreferencesSchema, type AppConfig, type RidePreferences, type SavedPlace, type SavedPlaceInput, type VehicleCategory } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';

@Injectable()
export class ClientProfileService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** `GET /v1/config` : ce que l'application affiche ou masque, lu à chaque démarrage (les drapeaux changent sans nouvelle version). */
  async config(): Promise<AppConfig> {
    const s = this.settings;
    const [minLeadSeconds, maxLeadDays, freeCancellationSeconds, cancellationFeeCents, floorPpm, windowSeconds, phone, email, privacyPolicyVersion, termsUrl, privacyUrl] = await Promise.all([
      s.number('rides.min_lead_seconds', 7200), s.number('rides.max_lead_days', 30), s.number('rides.free_cancellation_seconds', 120), s.number('rides.cancellation_fee_cents', 500),
      s.number('pricing.negotiation_floor_ppm', 700_000), s.number('negotiation.window_seconds', 600), s.get<string | null>('support.phone', null), s.get<string | null>('support.email', null),
      s.string('legal.privacy_policy_version', '1.0'), s.string('legal.terms_url', 'https://neomoov.net/conditions-d-utilisation/'), s.string('legal.privacy_url', 'https://neomoov.net/politique-de-confidentialite/'),
    ]);
    const [tipSuggestions, tipMax] = await Promise.all([s.get<unknown>('rides.tip_suggestions_cents', [0, 200, 300, 500]), s.number('rides.tip_max_cents', 10_000)]);
    const categories = await this.db
      .select({ code: schema.vehicleCategories.code, name: schema.vehicleCategories.name, seats: schema.vehicleCategories.seats, description: schema.vehicleCategories.description, allowedModels: schema.vehicleCategories.allowedModels })
      .from(schema.vehicleCategories)
      .where(eq(schema.vehicleCategories.active, true))
      .orderBy(asc(schema.vehicleCategories.rank));
    return {
      // `cardPayments` : vrai comme les devis de cette branche (carte toujours proposée) ; la règle réelle (Stripe réel
      // configuré, `CARD_PAYMENTS`) vient de la branche des paiements et remplace cette valeur à la fusion.
      features: { negotiation: this.env.FEATURE_NEGOTIATION, negotiationAboveMax: this.env.FEATURE_NEGOTIATION_ABOVE_MAX, immediateRides: this.env.FEATURE_IMMEDIATE_RIDES, installments: this.env.FEATURE_INSTALLMENTS, faceCheck: this.env.FEATURE_FACE_CHECK, cardPayments: true },
      booking: { minLeadSeconds, maxLeadDays, freeCancellationSeconds, cancellationFeeCents },
      negotiation: { floorPpm, windowSeconds },
      tips: {
        suggestedCents: Array.isArray(tipSuggestions) ? tipSuggestions.filter((v): v is number => Number.isInteger(v) && v >= 0 && v <= tipMax) : [0, 200, 300, 500],
        maxCents: tipMax,
      },
      support: { phone: typeof phone === 'string' && phone ? phone : null, email: typeof email === 'string' && email ? email : null },
      legal: { privacyPolicyVersion, termsUrl, privacyUrl },
      categories: categories.map((c) => ({
        code: c.code as VehicleCategory, name: c.name, seats: c.seats, description: c.description,
        allowedModels: Array.isArray(c.allowedModels) ? c.allowedModels.filter((m): m is string => typeof m === 'string') : [],
      })),
    };
  }

  private async clientIdOf(userId: string): Promise<string> {
    const [client] = await this.db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    return client.id;
  }

  /** Préférences enregistrées, complétées par les valeurs par défaut ; une valeur ancienne invalide est ignorée plutôt que de bloquer. */
  async preferences(userId: string): Promise<RidePreferences> {
    const [client] = await this.db.select({ preferences: schema.clients.preferences }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    const parsed = ridePreferencesSchema.safeParse(client.preferences ?? {});
    return parsed.success ? parsed.data : ridePreferencesSchema.parse({});
  }

  async setPreferences(userId: string, input: RidePreferences): Promise<RidePreferences> {
    const clientId = await this.clientIdOf(userId);
    await this.db.update(schema.clients).set({ preferences: input }).where(eq(schema.clients.id, clientId));
    return input;
  }

  async places(userId: string): Promise<SavedPlace[]> {
    const clientId = await this.clientIdOf(userId);
    const rows = await this.db
      .select({ id: schema.savedPlaces.id, label: schema.savedPlaces.label, address: schema.savedPlaces.address, position: sql<string>`ST_AsGeoJSON(${schema.savedPlaces.position})` })
      .from(schema.savedPlaces)
      .where(eq(schema.savedPlaces.clientId, clientId))
      .orderBy(asc(schema.savedPlaces.createdAt));
    return rows.map((r) => {
      const point = JSON.parse(r.position) as { coordinates: [number, number] };
      return { id: r.id, label: r.label, address: r.address, coordinates: { lat: point.coordinates[1], lng: point.coordinates[0] } };
    });
  }

  async addPlace(userId: string, input: SavedPlaceInput): Promise<SavedPlace> {
    const clientId = await this.clientIdOf(userId);
    const max = await this.settings.number('clients.saved_places_max', 20);
    const [{ count } = { count: 0 }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.savedPlaces).where(eq(schema.savedPlaces.clientId, clientId));
    if (count >= max) throw AppError.conflict('SAVED_PLACES_LIMIT', `Au plus ${max} lieux enregistrés`, { max });
    const [row] = await this.db
      .insert(schema.savedPlaces)
      .values({ clientId, label: input.label, address: input.address, position: input.coordinates })
      .returning({ id: schema.savedPlaces.id });
    return { id: row!.id, label: input.label, address: input.address, coordinates: input.coordinates };
  }

  async removePlace(userId: string, placeId: string): Promise<void> {
    const clientId = await this.clientIdOf(userId);
    const removed = await this.db.delete(schema.savedPlaces).where(and(eq(schema.savedPlaces.id, placeId), eq(schema.savedPlaces.clientId, clientId))).returning({ id: schema.savedPlaces.id });
    if (!removed.length) throw AppError.notFound('PLACE_NOT_FOUND', 'Lieu introuvable');
  }
}
