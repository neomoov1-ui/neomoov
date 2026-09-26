/**
 * Matrice des notifications (section 5.14), en données : pour chaque gabarit, le destinataire, les canaux et le repli.
 * Le push est le canal par défaut ; le texto sert de secours (événements critiques) et aux tiers sans application ; le
 * courriel porte les documents ; WhatsApp remplace le push pour un client qui a réservé par WhatsApp.
 */
import type { NotificationChannel } from '../enums.js';

export type NotificationAudience = 'client' | 'driver' | 'staff' | 'passenger';

export interface NotificationRule {
  template: string;
  audience: NotificationAudience;
  /** Canaux d'un destinataire qui a un compte (l'écran de l'application suit le temps réel, pas cette matrice). */
  channels: readonly NotificationChannel[];
  /** Critique : si le push ne part pas (aucun appareil, refus), un texto le remplace. */
  critical: boolean;
  /** Marketing : seulement avec le consentement `marketing` en vigueur. */
  marketing?: boolean;
}

const rule = (template: string, audience: NotificationAudience, channels: NotificationChannel[], critical = false): NotificationRule => ({ template, audience, channels, critical });

export const NOTIFICATION_MATRIX: readonly NotificationRule[] = [
  // Course demandée, attribution, approche et arrivée, fin, annulation.
  rule('ride.requested', 'client', ['push']),
  rule('offer.new', 'driver', ['push'], true),
  rule('ride.assigned', 'client', ['push'], true),
  rule('ride.assigned_to_you', 'driver', ['push'], true),
  rule('ride.driver_departed', 'client', ['push']),
  rule('ride.driver_approaching', 'client', ['push'], true),
  rule('ride.driver_arrived', 'client', ['push'], true),
  rule('ride.completed', 'client', ['push', 'email']),
  rule('ride.completed_driver', 'driver', ['push']),
  rule('invoice.issued', 'client', ['email']),
  rule('ride.cancelled_by_client', 'driver', ['push']),
  rule('ride.cancelled_by_operator', 'client', ['push']),
  rule('ride.driver_reminder', 'driver', ['push']),
  rule('ride.interrupted', 'client', ['push', 'sms'], true),
  rule('ride.no_show', 'client', ['push']),
  rule('ride.no_driver', 'client', ['push']),
  rule('ride.reassigning', 'client', ['push']),
  rule('ride.favourite_unavailable', 'client', ['push']),
  rule('ride.vehicle_unavailable', 'client', ['push']),
  rule('ride.counter_offer', 'client', ['push']),
  rule('ride.negotiation_fallback', 'client', ['push']),
  rule('ride.removed_no_movement', 'driver', ['push']),
  rule('ride.passenger_tracking', 'passenger', ['sms']),
  rule('ride.passenger_approaching', 'passenger', ['sms']),
  rule('ride.passenger_arrived', 'passenger', ['sms']),
  /** Réservation par l'agent vocal : confirmation écrite par texto à l'appelant. */
  rule('ride.voice_confirmation', 'passenger', ['sms']),
  // Réservation planifiée : confirmation, rappel, attribution.
  rule('ride.scheduled_confirmed', 'client', ['push', 'email', 'sms']),
  rule('ride.scheduled_reminder', 'client', ['push', 'email', 'sms']),
  rule('ride.scheduled_confirmed_driver', 'driver', ['push']),
  rule('ride.scheduled_assigned', 'client', ['push', 'email', 'sms'], true),
  /** Départ vers une réservation : le courriel arriverait trop tard pour servir (décision de la revue finale). */
  rule('ride.scheduled_driver_departed', 'client', ['push', 'sms']),
  // Messages dans la course.
  rule('ride.message', 'client', ['push']),
  /** Client sans application (réservation par téléphone ou pour un tiers) : le texte du chauffeur par texto, réponse relayée. */
  rule('ride.message_sms', 'passenger', ['sms']),
  /** Message de l'exploitation à un client sans application. */
  rule('ride.operator_message_sms', 'passenger', ['sms']),
  // Paiements.
  rule('payment.authorization_failed', 'client', ['push', 'email'], true),
  rule('payment.balance_due', 'client', ['push', 'email']),
  rule('guarantee.decided', 'client', ['push', 'email']),
  // Relevés, versements, prélèvements.
  rule('statement.issued', 'driver', ['push', 'email']),
  rule('statement.paid', 'driver', ['push', 'email']),
  rule('statement.settlement_failed', 'driver', ['push', 'email']),
  rule('balance.suspended', 'driver', ['push', 'email', 'sms'], true),
  rule('balance.reactivated', 'driver', ['push', 'email']),
  // Documents et packs.
  rule('document.expiring', 'driver', ['push', 'email', 'sms']),
  rule('vehicle.inspection_due', 'driver', ['push', 'email', 'sms']),
  rule('compliance.suspended', 'driver', ['push', 'email', 'sms'], true),
  rule('compliance.reactivated', 'driver', ['push', 'email']),
  rule('safety.hold', 'driver', ['push', 'email', 'sms'], true),
  rule('safety.lifted', 'driver', ['push', 'email']),
  rule('quality.warning', 'driver', ['push', 'email']),
  rule('quality.restriction', 'driver', ['push', 'email']),
  rule('quality.suspension', 'driver', ['push', 'email', 'sms'], true),
  rule('quality.reinstated', 'driver', ['push', 'email']),
  rule('pack.low', 'driver', ['push']),
  rule('pack.exhausted', 'driver', ['push']),
  rule('pack.renewed', 'driver', ['push']),
  rule('pack.renewal_failed', 'driver', ['push']),
  rule('pack.expired', 'driver', ['push']),
  // Alertes de l'exploitation : le personnel travaille dans My Hub (alertes en temps réel) et n'a pas d'application
  // mobile : hors de My Hub, courriel ; texto en plus pour le SOS (appel du fondateur en plus, par l'agent vocal).
  rule('alert.sos', 'staff', ['sms', 'email'], true),
  rule('alert.no_driver', 'staff', ['email']),
  rule('alert.stuck_ride', 'staff', ['email']),
  rule('alert.scheduled_unconfirmed', 'staff', ['email']),
  rule('alert.vehicle_mismatch', 'staff', ['email']),
  rule('alert.settlement_failed', 'staff', ['email']),
  rule('alert.agent_escalation', 'staff', ['email']),
  rule('alert.agent_budget', 'staff', ['email']),
  rule('alert.client_cancellations', 'staff', ['email']),
  rule('alert.benchmark_exceeded', 'staff', ['email']),
];

const BY_TEMPLATE = new Map(NOTIFICATION_MATRIX.map((r) => [r.template, r]));

export function notificationRule(template: string): NotificationRule | null {
  return BY_TEMPLATE.get(template) ?? null;
}

/**
 * Canaux d'un envoi : ceux de la matrice pour un destinataire avec compte (push remplacé par WhatsApp s'il a réservé
 * par WhatsApp), le texto seul pour un tiers sans compte. Un gabarit hors matrice part en push.
 */
export function channelsFor(template: string, recipient: { hasAccount: boolean; viaWhatsApp?: boolean }): NotificationChannel[] {
  if (!recipient.hasAccount) return ['sms'];
  const channels = [...(notificationRule(template)?.channels ?? ['push'])];
  return recipient.viaWhatsApp ? channels.map((c) => (c === 'push' ? 'whatsapp' : c)) : channels;
}

/** Repli texto : événement critique dont le push n'a pas pu partir. */
export function needsSmsFallback(template: string, channel: NotificationChannel, pushDelivered: boolean): boolean {
  return channel === 'push' && !pushDelivered && Boolean(notificationRule(template)?.critical);
}
