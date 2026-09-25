/**
 * Zones (section 4.4) : polygones actifs chargés de PostGIS (GeoJSON) et gardés en mémoire cinq minutes ; `zoneOf`
 * résout un point sans aller-retour en base (objectif : devis calculé en moins de 100 ms hors cartographie).
 */
import { schema } from '@neomoov/db';
import type { ZoneType } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { GeoPoint } from '../../adapters/types.js';
import { DB, type Database } from '../../infra/db.module.js';
import { pointInPolygon, type GeoJsonPolygon } from '../../common/geo.js';

const CACHE_TTL_MS = 5 * 60_000;
/** Une zone d'aéroport ou de centre-ville l'emporte sur un quartier, qui l'emporte sur l'aire de service. */
const PRIORITY: Record<ZoneType, number> = { airport: 0, downtown: 1, district: 2, service_area: 3 };

export interface ZoneShape {
  id: string;
  cityCode: string;
  code: string;
  name: string;
  type: ZoneType;
  geometry: GeoJsonPolygon;
}

@Injectable()
export class ZonesService {
  private cache: { loadedAt: number; zones: ZoneShape[] } | null = null;
  private loading: Promise<ZoneShape[]> | null = null;

  constructor(@Inject(DB) private readonly database: Database) {}

  async all(): Promise<ZoneShape[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.zones;
    this.loading ??= this.database.db
      .select({ id: schema.zones.id, cityCode: schema.zones.cityCode, code: schema.zones.code, name: schema.zones.name, type: schema.zones.type, geometry: sql<string>`ST_AsGeoJSON(${schema.zones.geometry})` })
      .from(schema.zones)
      .where(eq(schema.zones.active, true))
      .then((rows) => {
        const zones = rows.map((r) => ({ ...r, geometry: JSON.parse(r.geometry) as GeoJsonPolygon }));
        this.cache = { loadedAt: Date.now(), zones };
        return zones;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  invalidate() {
    this.cache = null;
  }

  /** Toutes les zones qui contiennent le point, de la plus précise à la plus large. */
  async zonesOf(point: GeoPoint): Promise<ZoneShape[]> {
    const zones = await this.all();
    return zones.filter((z) => pointInPolygon(point, z.geometry)).sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  }

  /** La zone la plus précise contenant le point (pour les forfaits et les relevés concurrentiels), ou null hors aire de service. */
  async zoneOf(point: GeoPoint): Promise<ZoneShape | null> {
    return (await this.zonesOf(point))[0] ?? null;
  }

  async isAirport(point: GeoPoint): Promise<boolean> {
    return (await this.zonesOf(point)).some((z) => z.type === 'airport');
  }

  async inServiceArea(point: GeoPoint): Promise<boolean> {
    return (await this.zonesOf(point)).length > 0;
  }
}
