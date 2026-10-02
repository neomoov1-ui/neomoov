/**
 * Appels manqués et messages vocaux (boîte unifiée) : à partir du rapport de fin d'appel du centre vocal, un appel sans
 * réservation ni transfert reste à rappeler. Fonction pure : le rapport et ce que la plateforme sait de l'appel
 * (course créée pendant l'appel, transfert) sont des entrées.
 */

export interface CallReport {
  endedReason: string | null;
  durationSeconds: number | null;
  summary: string | null;
}

export interface CallContext {
  /** Une course a été créée pour l'appelant pendant l'appel. */
  bookedRide: boolean;
  /** L'appel a été transféré à un humain (raison de fin de Vapi, ou outil de transfert appelé). */
  transferred: boolean;
}

export type MissedCallReason = 'voicemail' | 'short' | 'error' | 'no_outcome';

export interface CallOutcome {
  /** Vrai : la conversation `voice` est créée et la personne rappelée. */
  missed: boolean;
  reason: MissedCallReason | null;
  /** `voicemail` : la personne a laissé un message ; `missed_call` sinon. */
  kind: 'voicemail' | 'missed_call' | null;
}

/** Raisons de fin de Vapi qui désignent un transfert réussi. */
export const TRANSFER_REASONS = ['assistant-forwarded-call', 'assistant-transferred-call', 'call-transferred'] as const;
/** Raisons de fin qui désignent un message vocal (répondeur, boîte vocale). */
const VOICEMAIL_REASONS = ['voicemail', 'voicemail-detected', 'customer-left-voicemail'];
/** Raisons de fin qui désignent une panne ou un appel interrompu avant toute suite utile. */
const ERROR_PATTERNS = [/error/i, /timed-out/i, /silence/i, /closed-websocket/i, /exceeded-max-duration/i, /customer-busy/i, /customer-did-not-answer/i, /no-answer/i, /unknown/i];
/** En deçà de cette durée, un appel sans suite est réputé raccroché avant d'avoir abouti. */
export const SHORT_CALL_SECONDS = 45;

export function isTransferReason(endedReason: string | null | undefined): boolean {
  return (TRANSFER_REASONS as readonly string[]).includes(endedReason ?? '');
}

export function callOutcome(report: CallReport, context: CallContext): CallOutcome {
  const reason = (report.endedReason ?? '').toLowerCase();
  if (context.bookedRide || context.transferred || isTransferReason(reason)) return { missed: false, reason: null, kind: null };
  if (VOICEMAIL_REASONS.includes(reason)) return { missed: true, reason: 'voicemail', kind: 'voicemail' };
  if (ERROR_PATTERNS.some((re) => re.test(reason))) return { missed: true, reason: 'error', kind: 'missed_call' };
  if (typeof report.durationSeconds === 'number' && report.durationSeconds < SHORT_CALL_SECONDS) return { missed: true, reason: 'short', kind: 'missed_call' };
  return { missed: true, reason: 'no_outcome', kind: 'missed_call' };
}
