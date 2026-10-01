/**
 * Contexte d'organisation courant (étape 20) : posé par `OrgScopeService.run` pour la durée d'une transaction restreinte
 * (requête d'un membre d'une organisation cliente, tâche en arrière-plan d'une organisation). Le fournisseur de base de
 * données y lit l'exécuteur de la transaction ; le journal d'audit et les avis y lisent l'organisation. Absent pour le
 * personnel de la plateforme et les tâches globales.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface OrgScopeContext {
  /** Organisation visée (dernier segment du chemin). */
  organizationId: string;
  /** Chemin matérialisé `/<racine>/.../<organisation>/` : la portée autorisée est ce sous-arbre. */
  path: string;
  /** Exécuteur Drizzle de la transaction restreinte (typé par le fournisseur de base). */
  tx: unknown;
  /**
   * Étape 21 : traitements à lancer après la validation de la transaction restreinte la plus externe (avis, événements),
   * partagés par les transactions imbriquées. Absent d'un contexte posé à la main (tests).
   */
  afterCommit?: Array<() => unknown>;
}

export const orgScopeStorage = new AsyncLocalStorage<OrgScopeContext>();

/** Contexte d'organisation de la requête ou de la tâche en cours, ou `null` pour la plateforme. */
export function currentOrgScope(): OrgScopeContext | null {
  return orgScopeStorage.getStore() ?? null;
}

/**
 * Étape 21 : un traitement qui écrit hors de la transaction restreinte (avis mis en file, événement de domaine) ne doit
 * ni hériter de cette transaction (close avant qu'il finisse) ni partir si elle est annulée. Hors contexte d'organisation,
 * il s'exécute tout de suite ; dans une transaction restreinte, après sa validation, hors du contexte (pool de la
 * plateforme), avant la réponse ; jamais après une annulation.
 */
export async function afterScopeCommit(fn: () => unknown): Promise<void> {
  const scope = currentOrgScope();
  if (scope?.afterCommit) {
    scope.afterCommit.push(fn);
    return;
  }
  await fn();
}

/** Identifiant d'organisation porté par un chemin matérialisé (`/a/b/` donne `b`). */
export function organizationIdOfPath(orgPath: string): string {
  const segments = orgPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) throw new Error('Chemin d\'organisation vide');
  return last;
}
