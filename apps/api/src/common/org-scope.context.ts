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
  /** Exécuteur Drizzle de la transaction restreinte, ou de son point de sauvegarde (typé par le fournisseur de base). */
  tx: unknown;
  /**
   * Vrai une fois la transaction (ou le point de sauvegarde) terminée : le travail asynchrone qui lui survit (abonnés aux
   * événements de domaine, files en mémoire) retombe sur le contexte englobant encore ouvert, sinon sur le pool de la
   * plateforme, au lieu d'un exécuteur mort ; il garde l'organisation du contexte pour étiqueter ce qu'il écrit.
   */
  ended: boolean;
  /** Contexte englobant de la même organisation (point de sauvegarde), ou `null` pour une transaction de premier niveau. */
  parent: OrgScopeContext | null;
  /**
   * Étape 21 : traitements à lancer après la validation de la transaction restreinte la plus externe (avis, événements),
   * partagés par les transactions imbriquées. Absent d'un contexte posé à la main (tests).
   */
  afterCommit?: Array<() => unknown>;
}

export const orgScopeStorage = new AsyncLocalStorage<OrgScopeContext>();

/** Contexte d'organisation de la requête ou de la tâche en cours (même terminé), ou `null` pour la plateforme. */
export function currentOrgScope(): OrgScopeContext | null {
  return orgScopeStorage.getStore() ?? null;
}

/** Contexte dont la transaction est encore ouverte (le plus proche), ou `null` : c'est lui qui désigne l'exécuteur des requêtes. */
export function activeOrgScope(): OrgScopeContext | null {
  let scope = orgScopeStorage.getStore() ?? null;
  while (scope?.ended) scope = scope.parent;
  return scope;
}

/**
 * Organisation à poser sur une ligne créée maintenant : celle du contexte (requête ou tâche d'une organisation cliente),
 * sinon `fallback` (organisation de la course ou du chauffeur concerné, quand le service la connaît), sinon la plateforme.
 * Les défauts et déclencheurs de la migration 0022 font la même dérivation côté base pour les insertions qui ne passent pas ici.
 */
export function organizationIdFor(fallback?: string | null): string | null {
  return currentOrgScope()?.organizationId ?? fallback ?? null;
}

/**
 * Exécute `fn` hors de tout contexte d'organisation : pour les données réservées à la plateforme qu'une transaction
 * restreinte ne voit pas ou ne peut pas modifier. Les requêtes lancées dans `fn` passent par le pool de la plateforme, hors
 * de la transaction en cours : à réserver aux cas rares (chaque appel sous contexte prend une seconde connexion du pool).
 */
export function withoutOrgScope<T>(fn: () => T): T {
  return orgScopeStorage.exit(fn);
}

/** Préfixe des clés de stockage des fichiers écrits sous le contexte d'une organisation cliente (`org/<identifiant>/`) ; vide pour la plateforme. */
export function storageKeyPrefix(organizationId?: string | null): string {
  return organizationId ? `org/${organizationId}/` : '';
}

/**
 * Étape 21 : un traitement qui écrit hors de la transaction restreinte (avis mis en file, événement de domaine) ne doit
 * ni hériter de cette transaction (close avant qu'il finisse) ni partir si elle est annulée. Hors contexte d'organisation,
 * il s'exécute tout de suite ; dans une transaction restreinte, après sa validation, hors du contexte (pool de la
 * plateforme), avant la réponse ; jamais après une annulation.
 */
export async function afterScopeCommit(fn: () => unknown): Promise<void> {
  const scope = activeOrgScope();
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
