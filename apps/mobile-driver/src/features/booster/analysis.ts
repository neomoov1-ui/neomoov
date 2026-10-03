/**
 * Analyse Booster asynchrone (finalisation U3 du 3 octobre 2026, contrat de `docs/reviews/finalisation-u3-2026-10-03.md`) :
 * `POST …/analyse?async=true` répond aussitôt à l'état `pending`, le résultat se relit par la route de lecture du rapport
 * (`analysis.status` ou `reading.status` : `pending`, puis `done` ou `failed` ; une attente de plus de 10 minutes est
 * rendue en échec par l'API). Sans React Native, testé par vitest.
 */

/**
 * Demander l'analyse asynchrone : désactivé tant que l'API de main n'a pas la file (branche de U3 en cours
 * d'intégration). Même désactivé, une réponse `pending` (réglage `booster.analysis_async` de l'API) est relue.
 */
export const BOOSTER_ASYNC_ANALYSIS = false;

/** Relecture toutes les 3 secondes, pendant 3 minutes au plus (au-delà, le chauffeur remplit à la main ou revient plus tard). */
export const ANALYSIS_POLL_MS = 3_000;
export const ANALYSIS_WAIT_MS = 3 * 60_000;

/** Analyse encore en cours (état `pending` de l'API, absent d'une API antérieure). */
export function isAnalysisPending(analysis: { status: string } | null | undefined): boolean {
  return analysis?.status === 'pending';
}

export type AnalysisWait<T> = { outcome: 'ready'; result: T } | { outcome: 'timeout'; result: T } | { outcome: 'cancelled' };

/**
 * Relit le rapport tant que son analyse est en cours : s'arrête au résultat, au délai (dernier état connu rendu) ou dès
 * que l'écran est quitté (`cancelled`). Une erreur de lecture passagère n'arrête pas l'attente ; elle est rendue si
 * elle dure jusqu'au délai.
 */
export async function waitForAnalysis<T>(
  first: T,
  read: () => Promise<T>,
  pending: (value: T) => boolean,
  options: { cancelled: () => boolean; sleep?: (ms: number) => Promise<void>; now?: () => number; intervalMs?: number; timeoutMs?: number },
): Promise<AnalysisWait<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? ANALYSIS_WAIT_MS);
  let current = first;
  let lastError: unknown = null;
  while (pending(current)) {
    if (now() >= deadline) {
      if (lastError) throw lastError;
      return { outcome: 'timeout', result: current };
    }
    await sleep(options.intervalMs ?? ANALYSIS_POLL_MS);
    if (options.cancelled()) return { outcome: 'cancelled' };
    try {
      current = await read();
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    if (options.cancelled()) return { outcome: 'cancelled' };
  }
  return { outcome: 'ready', result: current };
}
