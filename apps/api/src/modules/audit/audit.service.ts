/**
 * Journal d'audit en ajout seul (sections 4.1 et 8) : acteur, action, entité, avant et après (données sensibles
 * masquées), adresse IP, identifiant de corrélation. Les services enregistrent leurs entrées pendant la requête ;
 * l'intercepteur les écrit à la fin, ou écrit une entrée générique pour toute mutation sans entrée explicite.
 */
import { schema } from '@neomoov/db';
import { isoDate, uuid } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, like, lt, or, type SQL } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { z } from 'zod';
import { APP_LOGGER } from '../../common/logger.js';
import { currentOrgScope } from '../../common/org-scope.context.js';
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
  /** Organisation de l'action (étape 20) ; à défaut, celle du contexte d'organisation courant ; nulle pour la plateforme. */
  organizationId?: string | null;
}

interface AuditStore {
  entries: AuditEntry[];
}

/** Curseur opaque : `<instant ISO>_<identifiant>` de la dernière entrée de la page précédente. */
const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/, 'Curseur invalide');

export const auditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional(),
  entityId: uuid.optional(),
  actorUserId: uuid.optional(),
  action: z.string().trim().max(80).optional(),
  /** Actions d'un agent IA (code de l'agent). */
  actorAgentCode: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Page suivante : valeur `nextCursor` de la page précédente. */
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditListQuery = z.infer<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: uuid,
  actorUserId: uuid.nullable(),
  actorAgentCode: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: uuid.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  correlationId: z.string().nullable(),
  /** Organisation dans laquelle l'action a eu lieu (étape 20) ; nulle pour la plateforme. */
  organizationId: uuid.nullable(),
  occurredAt: isoDate,
});

export const auditPageSchema = z.object({ items: z.array(auditEntrySchema), nextCursor: z.string().nullable() });
export type AuditPage = z.infer<typeof auditPageSchema>;

/** Conditions de filtrage communes à la consultation et à l'export (entité, action, acteur, agent, période). */
export function auditConditions(query: Omit<AuditListQuery, 'cursor' | 'limit'>): SQL[] {
  const conditions: SQL[] = [];
  if (query.entity) conditions.push(eq(schema.auditLog.entity, query.entity));
  if (query.entityId) conditions.push(eq(schema.auditLog.entityId, query.entityId));
  if (query.actorUserId) conditions.push(eq(schema.auditLog.actorUserId, query.actorUserId));
  if (query.action) conditions.push(eq(schema.auditLog.action, query.action));
  if (query.actorAgentCode) conditions.push(eq(schema.auditLog.actorAgentCode, query.actorAgentCode));
  if (query.from) conditions.push(gte(schema.auditLog.occurredAt, new Date(query.from)));
  if (query.to) conditions.push(lt(schema.auditLog.occurredAt, new Date(query.to)));
  return conditions;
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

  /**
   * Journal, du plus récent au plus ancien, par curseur. Pour une organisation (`subtreePath`, route d'organisation) :
   * filtre explicite sur les entrées de son sous-arbre, qui laisse le planificateur passer par l'index
   * (`organization_id`, `occurred_at`) au lieu d'évaluer la politique sur tout le journal ; les politiques de la
   * transaction restreinte appliquent de toute façon le même filtre.
   */
  async list(query: AuditListQuery, subtreePath?: string): Promise<AuditPage> {
    const conditions = auditConditions(query);
    if (subtreePath) {
      const subtree = this.database.db.select({ id: schema.organizations.id }).from(schema.organizations).where(like(schema.organizations.path, `${subtreePath}%`));
      conditions.push(inArray(schema.auditLog.organizationId, subtree));
    }
    if (query.cursor) {
      // Plusieurs entrées partagent souvent le même instant (un INSERT par requête) : le curseur porte aussi l'identifiant.
      const [at, id] = query.cursor.split('_') as [string, string];
      const instant = new Date(at);
      conditions.push(or(lt(schema.auditLog.occurredAt, instant), and(eq(schema.auditLog.occurredAt, instant), lt(schema.auditLog.id, id)))!);
    }
    const rows = await this.database.db
      .select()
      .from(schema.auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
      nextCursor: rows.length > query.limit && last ? `${last.occurredAt.toISOString()}_${last.id}` : null,
    };
  }

  async write(entries: AuditEntry[], context: AuditContext): Promise<void> {
    if (!entries.length) return;
    const actorUserId = context.actor?.kind === 'user' ? context.actor.userId : null;
    const actorAgentCode = context.actor?.kind === 'service' ? (context.actor.agentCode ?? `key:${context.actor.name}`).slice(0, 40) : null;
    // Étape 20 : une entrée écrite pour une organisation (route d'organisation, ou contexte d'une tâche) lui appartient :
    // visible dans son journal, invisible ailleurs.
    const organizationId = context.organizationId ?? currentOrgScope()?.organizationId ?? null;
    try {
      await this.database.db.insert(schema.auditLog).values(
        entries.map((e) => ({
          actorUserId,
          actorAgentCode,
          organizationId,
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
