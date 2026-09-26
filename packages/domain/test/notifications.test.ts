import { describe, expect, it } from 'vitest';
import { channelsFor, NOTIFICATION_MATRIX, needsSmsFallback, notificationRule } from '../src/index.js';

describe('matrice des notifications (5.14)', () => {
  it('chaque gabarit n\'apparaît qu\'une fois et a au moins un canal', () => {
    const templates = NOTIFICATION_MATRIX.map((r) => r.template);
    expect(new Set(templates).size).toBe(templates.length);
    expect(NOTIFICATION_MATRIX.every((r) => r.channels.length > 0)).toBe(true);
  });

  it('lignes de la section 5.14 : destinataire et canaux', () => {
    expect(notificationRule('ride.completed')).toMatchObject({ audience: 'client', channels: ['push', 'email'] });
    expect(notificationRule('ride.scheduled_reminder')).toMatchObject({ channels: ['push', 'email', 'sms'] });
    expect(notificationRule('statement.issued')).toMatchObject({ audience: 'driver', channels: ['push', 'email'] });
    expect(notificationRule('document.expiring')).toMatchObject({ channels: ['push', 'email', 'sms'] });
    expect(notificationRule('pack.low')).toMatchObject({ channels: ['push'] });
    expect(notificationRule('alert.sos')).toMatchObject({ audience: 'staff', channels: ['push', 'sms'], critical: true });
    expect(notificationRule('ride.passenger_tracking')).toMatchObject({ audience: 'passenger', channels: ['sms'] });
    expect(notificationRule('inconnu')).toBeNull();
  });

  it('canaux selon le destinataire : tiers par texto, WhatsApp à la place du push, gabarit inconnu en push', () => {
    expect(channelsFor('ride.assigned', { hasAccount: false })).toEqual(['sms']);
    expect(channelsFor('ride.completed', { hasAccount: true })).toEqual(['push', 'email']);
    expect(channelsFor('ride.completed', { hasAccount: true, viaWhatsApp: true })).toEqual(['whatsapp', 'email']);
    expect(channelsFor('inconnu', { hasAccount: true })).toEqual(['push']);
  });

  it('repli texto : attribution et arrivée quand le push ne part pas, jamais pour un événement ordinaire', () => {
    expect(needsSmsFallback('ride.assigned', 'push', false)).toBe(true);
    expect(needsSmsFallback('ride.driver_arrived', 'push', false)).toBe(true);
    expect(needsSmsFallback('ride.assigned', 'push', true)).toBe(false);
    expect(needsSmsFallback('pack.low', 'push', false)).toBe(false);
    expect(needsSmsFallback('ride.assigned', 'email', false)).toBe(false);
    expect(needsSmsFallback('inconnu', 'push', false)).toBe(false);
  });
});
