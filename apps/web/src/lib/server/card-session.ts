/**
 * Page de saisie de carte `/carte` (étape 26), côté serveur web : lecture de la session signée auprès de l'API et
 * confirmation du jeton de carte. Le navigateur ne parle qu'au serveur web ; aucun jeton d'accès de l'utilisateur ne
 * transite (la session signée de 15 minutes, liée à l'utilisateur, en tient lieu) et aucune donnée de carte n'arrive ici :
 * seulement le jeton produit par le Web Payments SDK de Square. Fonctions sans dépendance à Next.js (testées seules).
 */
import { cardSessionConfirmSchema, type CardSessionInfo } from '@neomoov/domain';

export type CardSessionState =
  | { state: 'ok'; info: CardSessionInfo }
  | { state: 'missing' | 'invalid' | 'expired' | 'unavailable' };

export interface CardSessionOptions {
  /** Adresse de l'API vue du serveur web, sans barre finale. */
  apiUrl: string;
  /** En-têtes relayés (langue, corrélation, adresse du navigateur pour la limitation de débit). */
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/** Forme d'une session (base64url) : un lien bricolé est refusé sans appel à l'API. */
const SESSION = /^[A-Za-z0-9_-]{20,400}$/;

/** Session de saisie lue auprès de l'API : informations publiques du formulaire, ou motif du refus. */
export async function loadCardSession(session: string | null | undefined, options: CardSessionOptions): Promise<CardSessionState> {
  if (!session) return { state: 'missing' };
  if (!SESSION.test(session)) return { state: 'invalid' };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${options.apiUrl}/v1/payment-methods/card-session?session=${encodeURIComponent(session)}`, {
      headers: { accept: 'application/json', ...options.headers },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (res.ok) return { state: 'ok', info: body as CardSessionInfo };
    if (body.code === 'CARD_SESSION_EXPIRED') return { state: 'expired' };
    if (res.status === 400 || res.status === 401) return { state: 'invalid' };
    return { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

/**
 * Confirmation relayée à l'API (`POST /v1/payment-methods/card-session/confirm`) : corps validé ici (session, jeton de
 * carte, jeton de vérification facultatif), rien d'autre n'est transmis ; la réponse de l'API est rendue telle quelle.
 */
export async function confirmCardSession(input: unknown, options: CardSessionOptions): Promise<{ status: number; body: unknown }> {
  const parsed = cardSessionConfirmSchema.safeParse(input);
  if (!parsed.success) return { status: 400, body: { code: 'VALIDATION_ERROR', message: 'Requête invalide' } };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${options.apiUrl}/v1/payment-methods/card-session/confirm`, {
      method: 'POST',
      headers: { accept: 'application/json', ...options.headers, 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'Service de paiement indisponible' } };
  }
}

/** Langue de la page : `lang` de l'adresse (transmis par l'application), sinon celle du navigateur, sinon le français. */
export function cardPageLanguage(lang: string | null | undefined, acceptLanguage: string | null | undefined): 'fr-CA' | 'en' {
  if (lang === 'en' || lang === 'fr' || lang === 'fr-CA') return lang === 'en' ? 'en' : 'fr-CA';
  return /^\s*en\b/i.test(acceptLanguage ?? '') ? 'en' : 'fr-CA';
}
