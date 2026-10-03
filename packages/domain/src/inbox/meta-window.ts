/**
 * Fenêtre de réponse de Meta (boîte unifiée) pour les messages privés Messenger et Instagram : une réponse ordinaire
 * n'est permise que dans les 24 heures qui suivent le dernier message de la personne ; au-delà, seule la réponse d'un
 * humain marquée de l'étiquette `HUMAN_AGENT` est permise, pendant 7 jours, si Meta a accordé la permission « Human
 * Agent » à l'application (réglage `inbox.meta_human_agent_tag`). Les réponses publiques aux commentaires n'y sont pas
 * soumises. Hors fenêtre, la réponse part par un autre canal connu de la personne (courriel, texto, push), sinon le
 * personnel est prévenu : jamais d'erreur muette. Fonctions pures : l'heure du dernier message reçu, l'auteur de la
 * réponse et le réglage sont des entrées.
 */

export const META_STANDARD_WINDOW_MS = 24 * 3_600_000;
export const META_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 3_600_000;
/** Étiquette de Meta d'une réponse humaine hors de la fenêtre de 24 heures. */
export const META_HUMAN_AGENT_TAG = 'HUMAN_AGENT';

/** `standard` : réponse ordinaire ; `human_agent` : réponse étiquetée ; `closed` : Meta refuserait la réponse. */
export type MetaReplyMode = 'standard' | 'human_agent' | 'closed';

export interface MetaReplyInput {
  network: string | null | undefined;
  /** Nature de la conversation : un commentaire public n'est jamais soumis à la fenêtre. */
  kind: string | null | undefined;
  /** Dernier message reçu de la personne ; null : aucun (la fenêtre n'a jamais été ouverte). */
  lastInboundAt: Date | null;
  now: Date;
  author: 'agent' | 'system' | 'staff';
  /** Permission « Human Agent » accordée par Meta (réglage désactivé par défaut). */
  humanAgentTagEnabled: boolean;
}

/** Réseaux dont les messages privés passent par l'API Send de Meta (fenêtre de 24 heures). */
export function isMetaPrivateNetwork(network: string | null | undefined): boolean {
  return network === 'messenger' || network === 'instagram';
}

export function metaReplyMode(input: MetaReplyInput): MetaReplyMode {
  if (input.kind === 'comment' || !isMetaPrivateNetwork(input.network)) return 'standard';
  if (!input.lastInboundAt) return 'closed';
  const elapsed = input.now.getTime() - input.lastInboundAt.getTime();
  if (elapsed <= META_STANDARD_WINDOW_MS) return 'standard';
  if (input.author === 'staff' && input.humanAgentTagEnabled && elapsed <= META_HUMAN_AGENT_WINDOW_MS) return 'human_agent';
  return 'closed';
}

export interface FallbackContact {
  email: string | null;
  phone: string | null;
  /** Compte avec au moins un appareil (push de l'application). */
  hasPushDevice: boolean;
}

/**
 * Autre canal de la personne quand le réseau refuse la réponse : courriel, sinon texto, sinon push de l'application ;
 * `null` : aucun canal connu, le personnel reprend la conversation à la main.
 */
export function outOfWindowFallback(contact: FallbackContact): 'email' | 'sms' | 'push' | null {
  if (contact.email) return 'email';
  if (contact.phone) return 'sms';
  return contact.hasPushDevice ? 'push' : null;
}
