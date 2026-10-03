/**
 * Horloge de l'API vue du téléphone (revue du 2 octobre 2026, constat mobile 1), sans dépendance à React Native (testée
 * par vitest). Une échéance envoyée par l'API (fin d'une offre, délai de grâce, attente minimale) se compare à l'heure
 * de l'API, jamais à l'horloge du téléphone, qui peut être décalée de plusieurs secondes ou minutes.
 *
 * L'écart est mesuré sur l'en-tête `Date` des réponses de l'API (précision d'une seconde) : chaque réponse borne
 * l'écart entre l'envoi et la réception de la requête ; l'intersection des bornes des réponses successives le resserre.
 * Une borne incompatible (horloge du téléphone changée entre-temps) fait repartir de la dernière réponse. Une réponse
 * qu'un cache a pu resservir (`max-age`, `public`) ou trop lente n'est pas retenue. Sans mesure, l'heure du téléphone
 * est gardée telle quelle.
 */

export interface ClockBounds {
  /** Écart minimal (heure de l'API moins heure du téléphone), en millisecondes. */
  low: number;
  /** Écart maximal, en millisecondes. */
  high: number;
}

/** Une réponse plus lente que cela borne trop mal l'écart pour être retenue. */
const MAX_ROUND_TRIP_MS = 10_000;

/** Réponse qu'un cache HTTP du téléphone peut resservir plus tard avec son ancienne date. */
function cacheable(cacheControl: string | null | undefined): boolean {
  return Boolean(cacheControl && /\b(public|immutable|max-age=[1-9])/i.test(cacheControl));
}

/**
 * Bornes de l'écart données par une réponse : l'API l'a datée entre l'envoi et la réception, et l'en-tête `Date` est
 * tronqué à la seconde. Null si l'en-tête manque ou est illisible.
 */
export function offsetBounds(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): ClockBounds | null {
  if (!dateHeader || receivedAt < sentAt) return null;
  const server = Date.parse(dateHeader);
  if (!Number.isFinite(server)) return null;
  return { low: server - receivedAt, high: server + 1000 - sentAt };
}

export class ServerClock {
  private bounds: ClockBounds | null = null;

  constructor(private readonly localNow: () => number = Date.now) {}

  /** Prend en compte une réponse de l'API (en-têtes `Date` et `Cache-Control`, heures locales d'envoi et de réception). */
  observe(response: { dateHeader: string | null | undefined; cacheControl?: string | null | undefined; sentAt: number; receivedAt: number }): void {
    if (cacheable(response.cacheControl) || response.receivedAt - response.sentAt > MAX_ROUND_TRIP_MS) return;
    const sample = offsetBounds(response.dateHeader, response.sentAt, response.receivedAt);
    if (!sample) return;
    const current = this.bounds;
    if (!current) {
      this.bounds = sample;
      return;
    }
    const low = Math.max(current.low, sample.low);
    const high = Math.min(current.high, sample.high);
    this.bounds = low <= high ? { low, high } : sample;
  }

  /** Écart estimé (heure de l'API moins heure du téléphone), en millisecondes ; null tant qu'aucune réponse n'est mesurée. */
  offsetMs(): number | null {
    return this.bounds ? Math.round((this.bounds.low + this.bounds.high) / 2) : null;
  }

  /** Heure de l'API estimée (millisecondes) ; l'heure du téléphone tant que l'écart n'est pas mesuré. */
  now(): number {
    return this.localNow() + (this.offsetMs() ?? 0);
  }
}
