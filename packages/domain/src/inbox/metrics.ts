/**
 * Indicateurs de la boîte unifiée pour le rapport quotidien de l'agent d'analyse : temps de première réponse par canal
 * (médiane, 90e centile, réponses au-delà du réglage `inbox.first_reply_seconds`) et rappel des problèmes de compte ou
 * de paiement remis à l'humain (conversations escaladées pour `account` ou `payment`), mesuré contre la cible de
 * `inbox.account_callback_hours` (4 heures). Fonctions pures : les échantillons, l'heure et les seuils sont des entrées.
 */

export interface FirstReplySample {
  channel: string;
  /** Secondes entre le premier message reçu et la première réponse ; null : sans réponse. */
  firstReplySeconds: number | null;
}

export interface ChannelFirstReply {
  channel: string;
  conversations: number;
  answered: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  /** Réponses au-delà du seuil. */
  late: number;
}

/** Centile au rang le plus proche d'une liste triée (non vide). */
function nearestRank(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

export function firstReplyByChannel(samples: readonly FirstReplySample[], thresholdSeconds: number): ChannelFirstReply[] {
  const byChannel = new Map<string, FirstReplySample[]>();
  for (const sample of samples) byChannel.set(sample.channel, [...(byChannel.get(sample.channel) ?? []), sample]);
  return [...byChannel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([channel, list]) => {
      const answered = list.map((s) => s.firstReplySeconds).filter((s): s is number => s !== null).map((s) => Math.max(0, s)).sort((a, b) => a - b);
      return {
        channel,
        conversations: list.length,
        answered: answered.length,
        medianSeconds: answered.length ? nearestRank(answered, 0.5) : null,
        p90Seconds: answered.length ? nearestRank(answered, 0.9) : null,
        late: answered.filter((s) => s > thresholdSeconds).length,
      };
    });
}

/** Motifs d'escalade qui relèvent du rappel sous 4 heures (problème de compte ou de paiement). */
export const ACCOUNT_CALLBACK_REASONS = ['account', 'payment'] as const;

/** Code du motif d'une escalade (`<code> : <résumé>` en base) ; null sans motif. */
export function escalationCode(escalationReason: string | null | undefined): string | null {
  const code = (escalationReason ?? '').split(' : ')[0]!.trim();
  return code || null;
}

export function isAccountCallbackEscalation(escalationReason: string | null | undefined): boolean {
  return (ACCOUNT_CALLBACK_REASONS as readonly string[]).includes(escalationCode(escalationReason) ?? '');
}

export interface CallbackSample {
  escalatedAt: Date;
  /** Première réponse du personnel après l'escalade ; null : pas encore. */
  handledAt: Date | null;
}

export interface CallbackStats {
  targetHours: number;
  escalated: number;
  /** Rappels faits dans la cible. */
  withinTarget: number;
  /** Rappels faits après la cible, ou toujours en attente au-delà. */
  late: number;
  /** En attente, encore dans la cible. */
  pending: number;
  medianMinutes: number | null;
}

export function callbackStats(samples: readonly CallbackSample[], now: Date, targetHours: number): CallbackStats {
  const targetMs = targetHours * 3_600_000;
  const stats: CallbackStats = { targetHours, escalated: samples.length, withinTarget: 0, late: 0, pending: 0, medianMinutes: null };
  const handled: number[] = [];
  for (const sample of samples) {
    if (sample.handledAt) {
      const elapsed = Math.max(0, sample.handledAt.getTime() - sample.escalatedAt.getTime());
      handled.push(elapsed);
      if (elapsed <= targetMs) stats.withinTarget += 1;
      else stats.late += 1;
    } else if (now.getTime() - sample.escalatedAt.getTime() > targetMs) stats.late += 1;
    else stats.pending += 1;
  }
  if (handled.length) stats.medianMinutes = Math.round(nearestRank(handled.sort((a, b) => a - b), 0.5) / 60_000);
  return stats;
}
