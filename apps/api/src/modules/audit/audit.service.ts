/**
 * Journal d'audit en ajout seul (sections 4.1 et 8) : acteur, action, entité, avant et après (données sensibles
 * masquées), adresse IP, identifiant de corrélation. Les services enregistrent leurs entrées pendant la requête ;
 * l'intercepteur les écrit à la fin, ou écrit une entrée générique pour toute mutation sans entrée explicite.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { Actor } from '../auth/actor.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditContext {
  actor: Actor | null;
  ip: string | null;
  correlationId: string | null;
}

interface AuditStore {
  entries: AuditEntry[];
}

const SENSITIVE_KEY = /(password|passwordHash|token|secret|otp|^code$|hash|totp|backupCode|apiKey|^key$|authorization|cookie)/i;
const MAX_STRING = 500;

/** Copie masquée : les clés sensibles deviennent « [masqué] », les chaînes longues sont tronquées, les cycles coupés. */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[profondeur]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[${value.length} octets]`;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => maskSensitive(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[masqué]' : maskSensitive(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

@Injectable()
export class AuditService {
  readonly storage = new AsyncLocalStorage<AuditStore>();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** Pendant une requête : mis en attente jusqu'à la fin ; hors requête (tâche du worker) : écrit tout de suite, sans acteur. */
  record(entry: AuditEntry): void {
    const store = this.storage.getStore();
    if (store) {
      store.entries.push(entry);
      return;
    }
    void this.write([entry], { actor: null, ip: null, correlationId: null }).catch(() => undefined);
  }

  /** Entrée signée par un agent ou un système (tâches planifiées). */
  async recordSystem(entry: AuditEntry, agentCode?: string): Promise<void> {
    await this.write([entry], { actor: agentCode ? { kind: 'service', apiKeyId: '', name: agentCode, scopes: [], agentCode } : null, ip: null, correlationId: null });
  }

  async write(entries: AuditEntry[], context: AuditContext): Promise<void> {
    if (!entries.length) return;
    const actorUserId = context.actor?.kind === 'user' ? context.actor.userId : null;
    const actorAgentCode = context.actor?.kind === 'service' ? (context.actor.agentCode ?? `key:${context.actor.name}`).slice(0, 40) : null;
    try {
      await this.database.db.insert(schema.auditLog).values(
        entries.map((e) => ({
          actorUserId,
          actorAgentCode,
          action: e.action.slice(0, 80),
          entity: e.entity.slice(0, 60),
          entityId: e.entityId && /^[0-9a-f-]{36}$/i.test(e.entityId) ? e.entityId : null,
          before: e.before === undefined ? null : (maskSensitive(e.before) as object),
          after: e.after === undefined ? null : (maskSensitive(e.after) as object),
          ipAddress: context.ip,
          correlationId: context.correlationId?.slice(0, 64) ?? null,
        })),
      );
    } catch (error) {
      // Le journal d'audit ne doit jamais faire échouer la requête, mais son échec est une erreur à surveiller.
      this.logger.error({ err: error, actions: entries.map((e) => e.action) }, 'Écriture du journal d\'audit impossible');
    }
  }
}
