/**
 * Réglages d'exploitation lus en base (table `settings`, portée `global`), jamais codés en dur (CLAUDE.md). Cache de
 * 60 secondes par processus : une modification dans My Hub est effective au plus une minute plus tard.
 */
import { schema } from '@neomoov/db';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../infra/db.module.js';
import { CircuitBreakers } from './circuit-breaker.js';
import { FieldCipher } from './field-cipher.js';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class SettingsService {
  private cache: { loadedAt: number; values: Map<string, unknown> } | null = null;
  private loading: Promise<Map<string, unknown>> | null = null;

  constructor(@Inject(DB) private readonly database: Database) {}

  /** Valeur d'un réglage, ou `fallback` s'il n'existe pas en base (les données de départ le créent). */
  async get<T>(key: string, fallback: T): Promise<T> {
    const values = await this.load();
    return values.has(key) ? (values.get(key) as T) : fallback;
  }

  async number(key: string, fallback: number): Promise<number> {
    const value = await this.get<unknown>(key, fallback);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  async string(key: string, fallback: string): Promise<string> {
    const value = await this.get<unknown>(key, fallback);
    return typeof value === 'string' && value ? value : fallback;
  }

  /** Tous les réglages globaux (assemblage des règles de tarification). */
  async all(): Promise<Record<string, unknown>> {
    return Object.fromEntries(await this.load());
  }

  /** Force une relecture au prochain accès (après une modification par My Hub ou dans un test). */
  invalidate() {
    this.cache = null;
  }

  private async load(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.values;
    if (!this.loading) {
      this.loading = this.database.db
        .select({ key: schema.settings.key, value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.scope, 'global'))
        .then((rows) => {
          const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
          this.cache = { loadedAt: Date.now(), values };
          return values;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }
}

/** Réglages et disjoncteurs des fournisseurs : partagés par tout le processus. */
@Global()
@Module({ providers: [SettingsService, CircuitBreakers, FieldCipher], exports: [SettingsService, CircuitBreakers, FieldCipher] })
export class SettingsModule {}
