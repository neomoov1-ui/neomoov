import { describe, expect, it } from 'vitest';
import { ExpoPushProvider } from '../src/adapters/real/expo-push.js';
import { ResendEmailProvider } from '../src/adapters/real/resend.js';
import { TwilioSmsProvider, twilioSignature } from '../src/adapters/real/twilio.js';
import { WhatsAppCloudProvider, whatsappSignature } from '../src/adapters/real/whatsapp-cloud.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Faux `fetch` : enregistre chaque requête et renvoie la réponse préparée pour la fin de son chemin. */
function fakeFetch(responses: Array<{ match: string; status?: number; json: unknown }>) {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    const response = responses.find((r) => url.includes(r.match)) ?? { status: 404, json: {} };
    return new Response(JSON.stringify(response.json), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}

describe('adaptateurs réels des messages (sans réseau)', () => {
  it('Twilio : texto en formulaire avec authentification de base et adresse de statut ; refus typé', async () => {
    const { calls, impl } = fakeFetch([{ match: '/Messages.json', json: { sid: 'SM123' } }]);
    const sms = new TwilioSmsProvider('AC1', 'secret-token', '+15145550100', 'https://api.neomoov.net/v1/webhooks/twilio/status', impl);
    expect(await sms.send({ to: '+15145550142', body: 'Votre chauffeur arrive' })).toEqual({ messageId: 'SM123' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(calls[0]!.headers['authorization']).toBe(`Basic ${Buffer.from('AC1:secret-token').toString('base64')}`);
    const form = new URLSearchParams(calls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({ To: '+15145550142', From: '+15145550100', Body: 'Votre chauffeur arrive', StatusCallback: 'https://api.neomoov.net/v1/webhooks/twilio/status' });
    expect(JSON.stringify(sms)).not.toContain('secret-token');

    const refused = new TwilioSmsProvider('AC1', 'secret-token', '+15145550100', null, fakeFetch([{ match: '/Messages.json', status: 400, json: { code: 21211, message: 'Invalid To' } }]).impl);
    await expect(refused.send({ to: 'bad', body: 'x' })).rejects.toMatchObject({ code: 'SMS_SEND_FAILED', details: { code: 21211 } });
  });

  it('Twilio : signature du webhook de statut (exemple de la documentation Twilio) et lecture du statut', () => {
    // Exemple publié par Twilio pour valider une implémentation de la signature.
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    const sms = new TwilioSmsProvider('AC1', '12345', '+15145550100');
    expect(sms.verifyStatusWebhook({ url, params, signature: '0/KCTR6DLpKmkAf8muzZqo1nDgQ=' })).toBe(true);
    expect(sms.verifyStatusWebhook({ url, params: { ...params, Digits: '9' }, signature: '0/KCTR6DLpKmkAf8muzZqo1nDgQ=' })).toBe(false);
    expect(sms.parseStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })).toEqual({ messageId: 'SM1', status: 'delivered', errorCode: null });
    expect(sms.parseStatus({ MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30003' })).toEqual({ messageId: 'SM1', status: 'failed', errorCode: '30003' });
    expect(sms.parseStatus({ MessageSid: 'SM1', MessageStatus: 'sent' })!.status).toBe('pending');
    expect(sms.parseStatus({})).toBeNull();
  });

  it('Resend : expéditeur du domaine, pièces jointes en base64, clé d\'idempotence ; refus typé', async () => {
    const { calls, impl } = fakeFetch([{ match: 'api.resend.com/emails', json: { id: 'em_1' } }]);
    const email = new ResendEmailProvider('re_key', 'Neomoov <notifications@neomoov.net>', impl);
    const sent = await email.send({ to: 'client@example.com', subject: 'Votre facture', html: '<p>Merci</p>', attachments: [{ filename: 'facture.pdf', content: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' }], idempotencyKey: 'invoice:1' });
    expect(sent).toEqual({ messageId: 'em_1' });
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer re_key', 'idempotency-key': 'invoice:1' });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      from: 'Neomoov <notifications@neomoov.net>', to: ['client@example.com'], subject: 'Votre facture', html: '<p>Merci</p>',
      attachments: [{ filename: 'facture.pdf', content: Buffer.from('%PDF-1.7').toString('base64'), content_type: 'application/pdf' }],
    });
    const refused = new ResendEmailProvider('re_key', 'x@y', fakeFetch([{ match: 'resend', status: 422, json: { name: 'validation_error' } }]).impl);
    await expect(refused.send({ to: 'a', subject: 'b', html: 'c' })).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });
  });

  it('Expo : lots de 100, tickets par jeton, appareil désinstallé signalé, reçus', async () => {
    const tokens = Array.from({ length: 101 }, (_, i) => `ExponentPushToken[${i}]`);
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      if (String(input).endsWith('/getReceipts')) {
        return new Response(JSON.stringify({ data: { t1: { status: 'ok' }, t2: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }), { status: 200 });
      }
      const batch = JSON.parse(init!.body as string) as Array<{ to: string; sound: string | null; priority: string }>;
      expect(batch.every((m) => m.sound === 'default' && m.priority === 'high')).toBe(true);
      return new Response(JSON.stringify({ data: batch.map((m) => (m.to === 'ExponentPushToken[3]' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `t-${m.to}` })) }), { status: 200 });
    }) as typeof fetch;
    const push = new ExpoPushProvider(null, impl);
    const { tickets } = await push.send({ tokens, title: 'Neomoov', body: 'Votre chauffeur est arrivé', data: { rideId: 'r1' } });
    expect(calls.filter((c) => c.endsWith('/send'))).toHaveLength(2);
    expect(tickets).toHaveLength(101);
    expect(tickets[3]).toEqual({ token: 'ExponentPushToken[3]', status: 'error', detail: 'DeviceNotRegistered' });
    expect(tickets[0]).toEqual({ token: 'ExponentPushToken[0]', status: 'ok', ticketId: 't-ExponentPushToken[0]' });
    expect(await push.receipts(['t1', 't2'])).toEqual([{ ticketId: 't1', status: 'ok' }, { ticketId: 't2', status: 'error', detail: 'DeviceNotRegistered' }]);
  });

  it('WhatsApp Cloud : texte et gabarit, abonnement du webhook, signature, messages entrants', async () => {
    const { calls, impl } = fakeFetch([{ match: '/messages', json: { messages: [{ id: 'wamid.1' }] } }]);
    const wa = new WhatsAppCloudProvider('wa-token', '123456', 'verif', 'app-secret', impl);
    expect(await wa.sendText({ to: '+15145550142', text: 'Bonjour' })).toEqual({ messageId: 'wamid.1' });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v20.0/123456/messages');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ messaging_product: 'whatsapp', to: '15145550142', type: 'text', text: { body: 'Bonjour', preview_url: true } });
    await wa.sendTemplate({ to: '+15145550142', template: 'ride_reminder', language: 'fr_CA', parameters: ['demain 8 h'] });
    expect(JSON.parse(calls[1]!.body!).template).toEqual({ name: 'ride_reminder', language: { code: 'fr_CA' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'demain 8 h' }] }] });

    expect(wa.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verif', 'hub.challenge': '42' })).toBe('42');
    expect(wa.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'autre', 'hub.challenge': '42' })).toBeNull();
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '15145550142', id: 'wamid.in', timestamp: '1790000000', type: 'text', text: { body: 'Je veux réserver' } }, { from: '1', id: 'x', type: 'image' }] } }] }] });
    expect(wa.verifySignature(raw, whatsappSignature('app-secret', raw))).toBe(true);
    expect(wa.verifySignature(raw, whatsappSignature('autre', raw))).toBe(false);
    expect(wa.verifySignature(raw, undefined)).toBe(false);
    expect(wa.parseInbound(JSON.parse(raw))).toEqual([{ from: '+15145550142', text: 'Je veux réserver', messageId: 'wamid.in', timestamp: new Date(1790000000 * 1000) }]);
    expect(JSON.stringify(wa)).not.toContain('wa-token');
  });
});
