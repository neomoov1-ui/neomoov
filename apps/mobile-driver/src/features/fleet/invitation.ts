/**
 * Invitation de flotte (étape 23) côté application chauffeur, sans React Native (testée par vitest) : jeton reçu par le
 * lien du texto (`…/chauffeurs/rejoindre?token=drv_…`), ouvert par l'application ou collé à la main.
 */

/** Préfixe des jetons d'invitation de chauffeur (API, `DRIVER_INVITATION_PREFIX`). */
export const FLEET_INVITATION_PREFIX = 'drv_';

/**
 * Jeton tiré de la saisie : le jeton seul, ou le lien entier du texto (paramètre `token`). Espaces retirés ; rien
 * d'autre n'est modifié (le jeton est sensible à la casse).
 */
export function fleetInvitationToken(input: string): string {
  const text = input.trim();
  const fromLink = /[?&]token=([^&#\s]+)/.exec(text);
  const raw = fromLink ? safeDecode(fromLink[1]!) : text;
  return raw.replace(/\s+/g, '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Jeton plausible avant l'envoi (préfixe et longueur de l'API : 10 à 200 caractères) ; l'API fait foi. */
export function isFleetInvitationToken(token: string): boolean {
  return token.startsWith(FLEET_INVITATION_PREFIX) && token.length >= 10 && token.length <= 200 && /^[A-Za-z0-9_-]+$/.test(token);
}

/** Codes d'erreur de l'acceptation traduits par l'écran (`fleetInvite.errors.*`), les autres par le message de l'API. */
export const FLEET_INVITATION_ERRORS = ['INVITATION_NOT_FOUND', 'INVITATION_EXPIRED', 'INVITATION_ALREADY_USED', 'INVITATION_NOT_FOR_YOU'] as const;
export type FleetInvitationError = (typeof FLEET_INVITATION_ERRORS)[number];

export function fleetInvitationError(code: string | null): FleetInvitationError | null {
  return code && (FLEET_INVITATION_ERRORS as readonly string[]).includes(code) ? (code as FleetInvitationError) : null;
}
