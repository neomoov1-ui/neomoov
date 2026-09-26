/**
 * Contexte « premium » d'une course (sections 5.4 et 5.11) : catégorie au-dessus de Neo Premium (VIP), départ ou arrivée
 * dans une zone aéroport, ou course d'entreprise (compte entreprise du client, organisation partenaire). Il donne le
 * bonus Illimité à la répartition et écarte les chauffeurs restreints, à la recherche comme à l'attribution : une seule
 * définition pour la répartition et `RidesService.assign`.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../infra/db.module.js';
import { ZonesService } from '../pricing/zones.service.js';
import { parseGeoPoint, type RideRow } from './ride-view.js';

@Injectable()
export class RideContextService {
  /** Type des organisations déjà lues (il ne change pas). */
  private readonly organizationTypes = new Map<string, string | null>();

  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly zones: ZonesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Course VIP (catégorie au-dessus de Neo Premium), aéroport ou entreprise. */
  async premium(ride: RideRow): Promise<boolean> {
    if (ride.reservedCategory !== 'neo_premium') return true;
    const [fromAirport, toAirport] = await Promise.all([this.zones.isAirport(parseGeoPoint(ride.originGeo)), this.zones.isAirport(parseGeoPoint(ride.destinationGeo))]);
    return fromAirport || toAirport || (await this.isBusinessRide(ride));
  }

  /**
   * Organisation partenaire de la course (flotte, compagnie de taxi, marque blanche, D42) ; la plateforme Neomoov, posée
   * par défaut sur chaque course, n'en est pas une.
   */
  async partnerOrganizationId(ride: RideRow): Promise<string | null> {
    if (!ride.organizationId) return null;
    let type = this.organizationTypes.get(ride.organizationId);
    if (type === undefined) {
      const [org] = await this.db.select({ type: schema.organizations.type }).from(schema.organizations).where(eq(schema.organizations.id, ride.organizationId)).limit(1);
      type = org?.type ?? null;
      if (org) this.organizationTypes.set(ride.organizationId, type);
    }
    return type !== null && type !== 'platform' ? ride.organizationId : null;
  }

  /** Course d'entreprise : compte entreprise du client ou organisation partenaire. */
  async isBusinessRide(ride: RideRow): Promise<boolean> {
    if (await this.partnerOrganizationId(ride)) return true;
    if (!ride.clientId) return false;
    const [client] = await this.db.select({ businessAccountId: schema.clients.businessAccountId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1);
    return Boolean(client?.businessAccountId);
  }
}
