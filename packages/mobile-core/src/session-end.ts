/**
 * Sortie de session des applications (revue du 2 octobre 2026, constats mobile 2, 13 et 22), sans dépendance à React
 * Native (testée par vitest). La déconnexion, la suppression du compte et la session perdue (jeton de rafraîchissement
 * refusé par l'API) passent par la même suite d'étapes, déclarée par chaque application : arrêt de la localisation,
 * désinscription des notifications, file hors ligne vidée, socket fermé, cache des requêtes vidé, session effacée.
 * Chaque étape est isolée : un échec (stockage, réseau) n'empêche pas les suivantes. Une sortie déjà en cours est
 * partagée : plusieurs requêtes refusées en même temps ne la lancent qu'une fois.
 */

/** `logout` : demandée, l'API est joignable ; `deleted` : compte supprimé, sessions déjà révoquées par l'API ; `expired` : session perdue. */
export type SessionEndReason = 'logout' | 'deleted' | 'expired';

export interface SessionEndStep {
  name: string;
  run: (reason: SessionEndReason) => unknown;
}

/** Routine de sortie : renvoie le nom des étapes en échec (vide si tout s'est bien passé). */
export function createSessionEnd(steps: readonly SessionEndStep[], onError?: (step: string, error: unknown) => void): (reason: SessionEndReason) => Promise<string[]> {
  let running: Promise<string[]> | null = null;
  const runAll = async (reason: SessionEndReason): Promise<string[]> => {
    const failed: string[] = [];
    for (const step of steps) {
      try {
        await step.run(reason);
      } catch (error) {
        failed.push(step.name);
        onError?.(step.name, error);
      }
    }
    return failed;
  };
  return (reason) => {
    running ??= runAll(reason).finally(() => {
      running = null;
    });
    return running;
  };
}

/** Statuts par lesquels l'API refuse un jeton de rafraîchissement : la session est perdue. */
const REFUSAL_STATUSES: readonly number[] = [400, 401, 403];

/**
 * Refus explicite du jeton de rafraîchissement par l'API (400, 401, 403) : la session est perdue. Toute autre erreur
 * (réseau, délai dépassé, panne 5xx, limite de débit 429, erreur inattendue) la garde : l'appelant réessaiera.
 */
export function isRefreshRefused(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === 'number' && REFUSAL_STATUSES.includes(status);
}
