/**
 * Isolation par organisation (étape 20, amendement v1.2 section 4) : une transaction restreinte à une organisation et à
 * son sous-arbre. Elle bascule sur le rôle `neomoov_scoped` (sans contournement de la sécurité au niveau des lignes) et
 * fixe `app.scope_path` ; les politiques de la migration 0021 filtrent alors chaque lecture et chaque écriture. Le rôle
 * et le réglage meurent avec la transaction : compatible avec le regroupement de connexions. Le code de la plateforme,
 * qui n'ouvre pas de telle transaction, n'est pas concerné.
 */
import { schema } from '@neomoov/db';
import { inScope, type MembershipScope } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { organizationIdOfPath, orgScopeStorage } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';

export type ScopedExecutor = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

const PATH = /^(\/[0-9a-f-]{36})+\/$/;

@Injectable()
export class OrgScopeService {
  constructor(@Inject(DB) private readonly database: Database) {}

  /**
   * Exécute `fn` dans une transaction restreinte au sous-arbre `orgPath`. Pendant `fn`, `database.db` de tous les services
   * désigne cette transaction (contexte propagé par AsyncLocalStorage) : les politiques d'isolation s'appliquent à chaque
   * lecture et écriture, et le journal d'audit porte l'organisation. Réentrant : un appel imbriqué ouvre un point de sauvegarde.
   */
  async run<T>(orgPath: string, fn: (tx: ScopedExecutor) => Promise<T>): Promise<T> {
    if (!PATH.test(orgPath)) throw new AppError('INVALID_ORGANIZATION_SCOPE', 'Portée d\'organisation invalide', 500);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE neomoov_scoped`);
      await tx.execute(sql`SELECT set_config('app.scope_path', ${orgPath}, true)`);
      return orgScopeStorage.run({ organizationId: organizationIdOfPath(orgPath), path: orgPath, tx }, () => fn(tx));
    });
  }

  /** Comme `run`, pour une organisation désignée par son identifiant (404 si elle n'existe pas). */
  async runFor<T>(organizationId: string, fn: (tx: ScopedExecutor) => Promise<T>): Promise<T> {
    const [org] = await this.database.db.select({ path: schema.organizations.path }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return this.run(org.path, fn);
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
