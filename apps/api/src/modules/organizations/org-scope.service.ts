/**
 * Isolation par organisation (étape 20, amendement v1.2 section 4) : une transaction restreinte à une organisation et à
 * son sous-arbre. Elle bascule sur le rôle `neomoov_scoped` (sans contournement de la sécurité au niveau des lignes) et
 * fixe `app.scope_path` ; les politiques de la migration 0021 filtrent alors chaque lecture et chaque écriture. Le rôle
 * et le réglage meurent avec la transaction : compatible avec le regroupement de connexions. Le code de la plateforme,
 * qui n'ouvre pas de telle transaction, n'est pas concerné. Les tâches de fond regroupent leur travail par organisation
 * cliente (`runGrouped`, `runForOrganization`) : un lot par organisation sous son contexte, puis la plateforme sans contexte.
 */
import { schema } from '@neomoov/db';
import { inScope, type MembershipScope } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { activeOrgScope, organizationIdOfPath, orgScopeStorage, withoutOrgScope, type OrgScopeContext } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';

export type ScopedExecutor = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

const PATH = /^(\/[0-9a-f-]{36})+\/$/;

@Injectable()
export class OrgScopeService {
  /** Identifiant de la racine (la plateforme), lu une fois : il ne change jamais. */
  private rootId: string | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Exécute `fn` dans une transaction restreinte au sous-arbre `orgPath`. Pendant `fn`, `database.db` de tous les services
   * désigne cette transaction (contexte propagé par AsyncLocalStorage) : les politiques d'isolation s'appliquent à chaque
   * lecture et écriture, et le journal d'audit porte l'organisation. Réentrant : sous la même portée, un appel imbriqué ouvre
   * un point de sauvegarde ; sous une autre portée, il ouvre une transaction à part (jamais un point de sauvegarde, dont le
   * `SET LOCAL` survivrait et changerait la portée de la transaction englobante). Une fois la transaction terminée, le
   * contexte est marqué fini : ce qui lui survit repasse par le contexte englobant encore ouvert, sinon par le pool.
   * Étapes 21 et 23 : les suites confiées à `afterScopeCommit` ou `afterOrgScopeCommit` pendant `fn` partent après la
   * validation de la transaction de premier niveau (celles d'un point de sauvegarde ne lui reviennent que s'il réussit),
   * avant la réponse ; une annulation les abandonne.
   */
  async run<T>(orgPath: string, fn: (tx: ScopedExecutor) => Promise<T>): Promise<T> {
    if (!PATH.test(orgPath)) throw new AppError('INVALID_ORGANIZATION_SCOPE', 'Portée d\'organisation invalide', 500);
    const active = activeOrgScope();
    if (active && active.path === orgPath) {
      return (active.tx as ScopedExecutor).transaction((sp) => this.within({ organizationId: active.organizationId, path: orgPath, tx: sp, ended: false, parent: active, afterCommit: [] }, fn));
    }
    const opened: { store: OrgScopeContext | null } = { store: null };
    const result = await withoutOrgScope(() =>
      this.database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE neomoov_scoped`);
        await tx.execute(sql`SELECT set_config('app.scope_path', ${orgPath}, true)`);
        opened.store = { organizationId: organizationIdOfPath(orgPath), path: orgPath, tx, ended: false, parent: null, afterCommit: [] };
        return this.within(opened.store, fn);
      }),
    );
    // Étapes 21 et 23 : la transaction est validée ; les suites différées (avis, événements de domaine) partent maintenant.
    await this.flushAfterCommit(opened.store);
    return result;
  }

  private async within<T>(store: OrgScopeContext, fn: (tx: ScopedExecutor) => Promise<T>): Promise<T> {
    try {
      const result = await orgScopeStorage.run(store, () => fn(store.tx as ScopedExecutor));
      // Point de sauvegarde réussi : ses suites attendent la validation de la transaction englobante.
      if (store.parent && store.afterCommit?.length) (store.parent.afterCommit ??= []).push(...store.afterCommit.splice(0));
      return result;
    } finally {
      store.ended = true;
    }
  }

  /**
   * Suites différées d'une transaction validée, une à une et attendues, dans son contexte terminé (pool de la plateforme,
   * organisation gardée pour étiqueter ce qu'elles écrivent) ; un échec est journalisé et n'annule rien de validé.
   */
  private async flushAfterCommit(store: OrgScopeContext | null): Promise<void> {
    const callbacks = store?.afterCommit?.splice(0) ?? [];
    for (const callback of callbacks) {
      try {
        await orgScopeStorage.run(store!, async () => callback());
      } catch (error) {
        this.logger.error({ err: error, organizationId: store!.organizationId }, 'Suite différée d\'une transaction d\'organisation en échec');
      }
    }
  }

  /** Comme `run`, pour une organisation désignée par son identifiant (404 si elle n'existe pas). Le chemin est lu par la plateforme. */
  async runFor<T>(organizationId: string, fn: (tx: ScopedExecutor) => Promise<T>): Promise<T> {
    const active = activeOrgScope();
    const [org] = active?.organizationId === organizationId
      ? [{ path: active.path }]
      : await withoutOrgScope(() => this.database.db.select({ path: schema.organizations.path }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1));
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return this.run(org.path, fn);
  }

  /** Identifiant de l'organisation racine (la plateforme), lu hors contexte : une transaction restreinte ne la voit pas. */
  async rootOrganizationId(): Promise<string> {
    if (!this.rootId) {
      const [root] = await withoutOrgScope(() =>
        this.database.db.select({ id: schema.organizations.id }).from(schema.organizations).where(isNull(schema.organizations.parentId)).orderBy(asc(schema.organizations.createdAt)).limit(1),
      );
      if (!root) throw new AppError('ROOT_ORGANIZATION_MISSING', 'Organisation racine absente', 500);
      this.rootId = root.id;
    }
    return this.rootId;
  }

  /** Organisations clientes parmi des identifiants (ni absent, ni la racine), dédoublonnées et triées : celles dont un lot s'exécute sous contexte. */
  async clientOrganizations(ids: Iterable<string | null | undefined>): Promise<string[]> {
    const root = await this.rootOrganizationId();
    return [...new Set([...ids].filter((id): id is string => Boolean(id) && id !== root))].sort();
  }

  /** Organisations clientes qui ont au moins un chauffeur (relevés, conformité), vues par la plateforme. */
  async clientOrganizationsOfDrivers(): Promise<string[]> {
    const rows = await withoutOrgScope(() => this.database.db.selectDistinct({ id: schema.drivers.organizationId }).from(schema.drivers).where(isNotNull(schema.drivers.organizationId)));
    return this.clientOrganizations(rows.map((r) => r.id));
  }

  /** Organisations clientes en service (ni la racine, ni fermées), vues par la plateforme (facturation : une course peut appartenir à une organisation sans chauffeur). */
  async activeClientOrganizations(): Promise<string[]> {
    const rows = await withoutOrgScope(() => this.database.db.select({ id: schema.organizations.id }).from(schema.organizations).where(and(isNotNull(schema.organizations.parentId), ne(schema.organizations.status, 'closed'))));
    return this.clientOrganizations(rows.map((r) => r.id));
  }

  /**
   * `fn` sous le contexte de l'organisation si c'est une organisation cliente, sinon hors de tout contexte (plateforme).
   * Déjà dans le contexte de cette organisation (tâche lancée depuis son lot) : `fn` s'exécute dans la transaction en cours.
   */
  async runForOrganization<T>(organizationId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    if (!organizationId || organizationId === (await this.rootOrganizationId())) return withoutOrgScope(fn);
    if (activeOrgScope()?.organizationId === organizationId) return fn();
    return this.runFor(organizationId, () => fn());
  }

  /**
   * Lots d'une tâche de fond : `fn` une fois par organisation cliente, sous son contexte (elle ne voit et n'écrit que ses
   * lignes, créées à son nom), puis une fois sans contexte pour la plateforme, qui traite tout ce qui reste comme avant.
   * L'échec d'un lot est journalisé et n'arrête pas les autres (la passe de la plateforme reprend son travail) ; celui de la
   * plateforme se propage. Renvoie les résultats, celui de la plateforme en dernier.
   */
  async runGrouped<T>(organizationIds: Iterable<string | null | undefined>, fn: () => Promise<T>, label = 'tâche de fond'): Promise<T[]> {
    const results: T[] = [];
    for (const organizationId of await this.clientOrganizations(organizationIds)) {
      try {
        results.push(await this.runFor(organizationId, () => fn()));
      } catch (error) {
        this.logger.error({ err: error, organizationId, label }, 'Lot d\'organisation en échec');
      }
    }
    results.push(await withoutOrgScope(fn));
    return results;
  }

  /**
   * Portée d'un utilisateur sur une organisation cible : chemin de la cible si une de ses adhésions actives la couvre
   * (l'organisation elle-même, ou un ancêtre avec la portée « sous-arbre ») ; sinon 403. 404 si la cible n'existe pas.
   */
  async scopeFor(userId: string, organizationId: string, now = new Date()): Promise<{ path: string; organizationId: string }> {
    const [target] = await this.database.db.select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!target) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    const memberships = await this.database.db
      .select({ path: schema.organizations.path, scope: schema.memberships.scope, expiresAt: schema.memberships.expiresAt })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')));
    const covered = memberships.some((m) => (!m.expiresAt || m.expiresAt > now) && inScope(target.path, m.path, m.scope as MembershipScope));
    if (!covered) throw AppError.forbidden('NOT_A_MEMBER', 'Vous n\'êtes pas membre de cette organisation');
    return { path: target.path, organizationId: target.id };
  }
}
