/**
 * Neomoov Booster, analyse asynchrone (finalisation du 3 octobre 2026) : au lieu d'un appel synchrone au modèle qui peut
 * durer deux minutes, l'analyse des photos (ou la lecture des captures) est confiée à la file `agents` ; la route répond
 * aussitôt avec l'état `pending`, que les routes de lecture existantes rendent jusqu'au résultat. Une analyse restée en
 * attente plus de 10 minutes (tâche perdue sans Redis, worker arrêté) est rendue en échec `ANALYSIS_TIMEOUT` et peut
 * être relancée. Le mode suit le paramètre `async` de la route, sinon le réglage `booster.analysis_async` (désactivé par
 * défaut tant que l'application chauffeur ne relit pas le rapport pendant l'analyse).
 */
import type { StoredAnalysis } from './booster-images.js';

export const INSPECTION_ANALYSIS_JOB = 'booster.inspection';
export const PERFORMANCE_ANALYSIS_JOB = 'booster.performance';
/** Au-delà de ce délai, une analyse en attente est réputée perdue. */
export const ANALYSIS_STALE_MS = 10 * 60_000;
export const ANALYSIS_TIMEOUT = 'ANALYSIS_TIMEOUT';

/** Tâche de la file `agents` : rapport et tentative attendue (une tentative plus récente rend la tâche caduque). */
export interface BoosterAnalysisJob {
  id: string;
  attempt: number;
}

/** Analyse en attente, gardée dans le rapport jusqu'au résultat. */
export function pendingAnalysis(promptKey: string, attempt: number, now = new Date()): StoredAnalysis {
  return { promptKey, model: null, analysedAt: now.toISOString(), confidence: null, raw: null, error: null, pending: true, requestedAt: now.toISOString(), attempt };
}

/** État d'une analyse enregistrée : aucune, en attente, perdue (attente trop longue), en échec, faite. */
export function analysisState(analysis: StoredAnalysis | null, now = new Date()): 'none' | 'pending' | 'stale' | 'failed' | 'done' {
  if (!analysis) return 'none';
  if (analysis.pending) return now.getTime() - Date.parse(analysis.requestedAt ?? analysis.analysedAt) > ANALYSIS_STALE_MS ? 'stale' : 'pending';
  return analysis.error ? 'failed' : 'done';
}

export function isBoosterAnalysisJob(data: unknown): data is BoosterAnalysisJob {
  const d = data as Partial<BoosterAnalysisJob> | null;
  return typeof d?.id === 'string' && typeof d.attempt === 'number';
}
