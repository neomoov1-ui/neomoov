/**
 * Heure de l'API pour les comptes à rebours (revue du 2 octobre 2026, constat mobile 1) : l'écart avec l'horloge du
 * téléphone est mesuré sur chaque réponse de l'API (`@neomoov/mobile-core/server-clock`). Une offre garde aussi son heure
 * de réception, pour un compte à rebours juste même avant toute mesure (durée de l'offre comptée depuis la réception).
 */
import type { DriverOfferView } from '@neomoov/domain';
import { ServerClock } from '@neomoov/mobile-core/server-clock';
import { offerDeadline } from '@/features/ride/steps';

export const serverClock = new ServerClock();

/** Heure de l'API estimée, à comparer aux dates qu'elle envoie (fin du délai de grâce, attente minimale). */
export function serverNow(): number {
  return serverClock.now();
}

/** Réponse reçue de l'API (observateur `onResponse` du client) : en-têtes `Date` et `Cache-Control`. */
export function observeResponse(response: { headers: { get(name: string): string | null } }, timing: { sentAt: number; receivedAt: number }): void {
  serverClock.observe({ dateHeader: response.headers.get('date'), cacheControl: response.headers.get('cache-control'), ...timing });
}

/** Heure locale de première réception de chaque offre (socket ou liste), oubliée quand l'offre n'est plus en attente. */
const receivedAt = new Map<string, number>();

export function noteOffers(offers: readonly Pick<DriverOfferView, 'id'>[], replaceAll = false): void {
  const now = Date.now();
  if (replaceAll) for (const id of [...receivedAt.keys()]) if (!offers.some((o) => o.id === id)) receivedAt.delete(id);
  for (const offer of offers) if (!receivedAt.has(offer.id)) receivedAt.set(offer.id, now);
}

/** Échéance de l'offre à l'heure du téléphone (millisecondes), à comparer à `Date.now()`. */
export function offerDeadlineOf(offer: Pick<DriverOfferView, 'id' | 'sentAt' | 'expiresAt'>): number {
  return offerDeadline(offer, { offsetMs: serverClock.offsetMs(), receivedAt: receivedAt.get(offer.id) ?? null });
}
