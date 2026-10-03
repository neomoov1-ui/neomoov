/**
 * Croissance côté client (étape 8, sections 5.9 et 5.10) sans React Native, testée par vitest : saisie du code d'un
 * parrain, chauffeurs favoris. Les montants et les seuils viennent de l'API (réglages), jamais de l'application.
 */
import type { FavoriteView, ReferralView } from '@neomoov/domain';

/** Code de parrainage saisi : majuscules, sans espaces ni tirets, 12 caractères au plus (règle de l'API : 4 à 12). */
export function normalizeReferralCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '').slice(0, 12);
}

export function isReferralCode(code: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

/**
 * Saisie du code d'un parrain proposée tant que le compte n'en a pas : l'API refuse ensuite après la première course
 * ou après la fenêtre d'inscription (motif traduit), l'application ne devine pas ces règles.
 */
export function canEnterReferral(view: Pick<ReferralView, 'referredBy'> | null | undefined): boolean {
  return Boolean(view) && view!.referredBy === null;
}

/** Favoris affichés : disponibles d'abord, puis par nombre de courses ensemble, puis par prénom. */
export function sortFavorites(list: readonly FavoriteView[]): FavoriteView[] {
  return [...list].sort((a, b) => Number(b.available) - Number(a.available) || b.ridesTogether - a.ridesTogether || (a.firstName ?? '').localeCompare(b.firstName ?? ''));
}

/**
 * Ajout d'un chauffeur aux favoris proposé à la fin d'une course terminée, s'il n'y est pas déjà ; l'API vérifie la
 * note minimale donnée au chauffeur (motif `FAVOURITE_NOT_ELIGIBLE` traduit sinon).
 */
export function canAddFavorite(ride: { state: string; driver: { id: string } | null }, favorites: readonly Pick<FavoriteView, 'driverId'>[] | undefined): boolean {
  if (!ride.driver || (ride.state !== 'completed' && ride.state !== 'rated')) return false;
  return !(favorites ?? []).some((f) => f.driverId === ride.driver!.id);
}
