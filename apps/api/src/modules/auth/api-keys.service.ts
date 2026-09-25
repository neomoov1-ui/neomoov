/**
 * Comptes de service (section 7.1) : clés `nmk_<préfixe>_<secret>` à portée limitée pour les agents et les intégrations.
 * Le secret n'est jamais stocké : seul son haché l'est, et il n'est affiché qu'à la création.
 */
import { schema } from '@neomoov/db';
import type { AgentCode, ApiKeyCreate, ApiKeyScope } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { constantTimeEqual, randomToken, sha256Hex } from '../../common/crypto.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { ServiceActor } from './actor.js';

type ApiKeyRow = typeof schema.apiKeys.$inferSelect;
const KEY_PATTERN = /^nmk_([0-9a-f]{12})_([A-Za-z0-9_-]{40,50})$/;

export function isApiKey(token: string): boolean {
  return token.startsWith('nmk_');
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DB) private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  async create(input: ApiKeyCreate, createdByUserId: string | null) {
    const prefix = randomBytes(6).toString('hex');
    const key = `nmk_${prefix}_${randomToken(32)}`;
    const [row] = await this.db
      .insert(schema.apiKeys)
      .values({ name: input.name, prefix, keyHash: sha256Hex(key), scopes: input.scopes, agentCode: input.agentCode ?? null, createdByUserId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null })
      .returning();
    return { ...ApiKeysService.view(row!), key };
  }

  async list() {
    const rows = await this.db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt));
    return rows.map(ApiKeysService.view);
  }

  async revoke(id: string): Promise<void> {
    const rows = await this.db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, id)).returning({ id: schema.apiKeys.id });
    if (!rows.length) throw AppError.notFound('API_KEY_NOT_FOUND', 'Clé introuvable');
  }

  /** Authentifie une clé présentée en `Authorization: Bearer` ; met à jour `lastUsedAt` au plus une fois par minute. */
  async authenticate(token: string): Promise<ServiceActor> {
    const match = KEY_PATTERN.exec(token);
    if (!match) throw AppError.unauthorized('INVALID_API_KEY', 'Clé d\'API invalide');
    const [row] = await this.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.prefix, match[1]!)).limit(1);
    if (!row || !constantTimeEqual(row.keyHash, sha256Hex(token))) throw AppError.unauthorized('INVALID_API_KEY', 'Clé d\'API invalide');
    if (row.revokedAt) throw AppError.unauthorized('API_KEY_REVOKED', 'Clé d\'API révoquée');
    if (row.expiresAt && row.expiresAt <= new Date()) throw AppError.unauthorized('API_KEY_EXPIRED', 'Clé d\'API expirée');
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id)).catch(() => undefined);
    }
    return { kind: 'service', apiKeyId: row.id, name: row.name, scopes: (row.scopes as string[]) ?? [], agentCode: row.agentCode };
  }

  /** `tools:*` couvre `tools:<n'importe quoi>` ; une route qui exige `*` accepte toute clé valide. */
  static hasScope(actor: ServiceActor, required: string[]): boolean {
    if (required.includes('*')) return actor.scopes.length > 0;
    return required.some((scope) => actor.scopes.some((granted) => granted === scope || (granted.endsWith(':*') && scope.startsWith(granted.slice(0, -1)))));
  }

  static view(row: ApiKeyRow) {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: (row.scopes as ApiKeyScope[]) ?? [],
      agentCode: (row.agentCode as AgentCode | null) ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
