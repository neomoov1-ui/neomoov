/**
 * Heure de l'API vue du téléphone (revue du 2 octobre 2026, constat mobile 1) : l'écart avec l'horloge du téléphone est
 * mesuré sur chaque réponse de l'API (`@neomoov/mobile-core/server-clock`). Sert à juger l'expiration d'un devis
 * (`validUntil`) sans dépendre d'une horloge décalée.
 */
import { ServerClock } from '@neomoov/mobile-core/server-clock';

export const serverClock = new ServerClock();

/** Heure de l'API estimée, à comparer aux dates qu'elle envoie. */
export function serverNow(): number {
  return serverClock.now();
}

/** Réponse reçue de l'API (observateur `onResponse` du client) : en-têtes `Date` et `Cache-Control`. */
export function observeResponse(response: { headers: { get(name: string): string | null } }, timing: { sentAt: number; receivedAt: number }): void {
  serverClock.observe({ dateHeader: response.headers.get('date'), cacheControl: response.headers.get('cache-control'), ...timing });
}
