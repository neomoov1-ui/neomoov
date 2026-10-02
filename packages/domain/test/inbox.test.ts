import { describe, expect, it } from 'vitest';
import {
  callOutcome, cleanEmailText, decodeEntities, emailExternalId, htmlToText, inboxRelaySchema, inboxListQuerySchema, isAutomatedEmail, isRelayNetwork, isTransferReason, localMinuteOfDay, normalizeMessageId,
  parseEmailAddress, parseQuietHours, quietHoursWindow, replySubject, SHORT_CALL_SECONDS, stableHash, threadReferences,
} from '../src/index.js';

const TZ = 'America/Toronto';

describe('boîte unifiée : courriels entrants', () => {
  it('lit un expéditeur sous ses formes usuelles, en minuscules, et refuse une adresse invalide', () => {
    expect(parseEmailAddress('Marie Tremblay <Marie.T@Example.com>')).toEqual({ name: 'Marie Tremblay', email: 'marie.t@example.com' });
    expect(parseEmailAddress('"Roy, Jean" <jean@example.com>')).toEqual({ name: 'Roy, Jean', email: 'jean@example.com' });
    expect(parseEmailAddress('jean@example.com')).toEqual({ name: null, email: 'jean@example.com' });
    expect(parseEmailAddress('<mailto:jean@example.com>')).toEqual({ name: null, email: 'jean@example.com' });
    expect(parseEmailAddress('')).toBeNull();
    expect(parseEmailAddress(undefined)).toBeNull();
    expect(parseEmailAddress('pas une adresse')).toBeNull();
    expect(parseEmailAddress('Nom <sans-arobase>')).toBeNull();
  });

  it('coupe les citations, les signatures et borne le texte à 4 000 caractères', () => {
    const text = [
      'Bonjour,', '', 'J\'ai oublié mon parapluie dans la voiture hier soir.', 'Pouvez-vous vérifier ?   Merci', '',
      'Cordialement,', 'Marie', '', 'Le 1 oct. 2026 à 10:00, Neomoov <contact@neomoov.net> a écrit :', '> Bonjour Marie', '> Votre réservation est confirmée.',
    ].join('\r\n');
    expect(cleanEmailText(text)).toBe('Bonjour,\n\nJ\'ai oublié mon parapluie dans la voiture hier soir.\nPouvez-vous vérifier ? Merci');
    expect(cleanEmailText('Question rapide\n-- \nJean Roy\nDirecteur')).toBe('Question rapide');
    expect(cleanEmailText('Je serai en retard\n\nEnvoyé de mon iPhone')).toBe('Je serai en retard');
    expect(cleanEmailText('Hi there\n\nSent from my Galaxy')).toBe('Hi there');
    expect(cleanEmailText('Pouvez-vous me rappeler ?\n\n-----Original Message-----\nFrom: x\nblabla')).toBe('Pouvez-vous me rappeler ?');
    // Tout le texte est une citation : le texte brut, espaces réduits, reste transmis plutôt que rien.
    expect(cleanEmailText('> seulement une citation\n> suite')).toBe('> seulement une citation > suite');
    const long = 'a'.repeat(5_000);
    expect(cleanEmailText(long)).toHaveLength(4_000);
    expect(cleanEmailText(long).endsWith('…')).toBe(true);
    expect(cleanEmailText(null, null)).toBe('');
  });

  it('réduit un courriel HTML à du texte quand le texte brut manque', () => {
    const html = '<html><head><style>p{}</style></head><body><p>Bonjour&nbsp;Neomoov,</p><p>Prix pour l&#39;a&eacute;roport ?<br>Merci &amp; bonne journ&eacute;e</p><blockquote>citation</blockquote><script>x()</script></body></html>';
    expect(cleanEmailText('', html)).toBe('Bonjour Neomoov,\n\nPrix pour l\'aéroport ?\nMerci & bonne journée');
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a\nb');
    expect(decodeEntities('&#x27;&#233;&inconnu;&eacute;')).toBe('\'é&inconnu;é');
  });

  it('reconnaît les courriels automatiques : rebonds, réponses d\'absence, listes, expéditeurs sans réponse', () => {
    expect(isAutomatedEmail({ from: 'MAILER-DAEMON@mx.example.com', subject: 'x' })).toEqual({ automated: true, reason: 'bounce' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'Delivery Status Notification (Failure)' })).toEqual({ automated: true, reason: 'bounce' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'Content-Type': 'multipart/report; report-type=delivery-status' } })).toEqual({ automated: true, reason: 'bounce' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'Auto-Submitted': 'auto-replied' } })).toEqual({ automated: true, reason: 'auto_reply' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'Réponse automatique : absent' })).toEqual({ automated: true, reason: 'auto_reply' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'X-Auto-Response-Suppress': 'OOF' } })).toEqual({ automated: true, reason: 'auto_reply' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'x-autoreply': 'yes' } })).toEqual({ automated: true, reason: 'auto_reply' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'x-autorespond': '1' } })).toEqual({ automated: true, reason: 'auto_reply' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { 'List-Id': '<news.example.com>' } })).toEqual({ automated: true, reason: 'list' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { precedence: ['bulk'] } })).toEqual({ automated: true, reason: 'list' });
    expect(isAutomatedEmail({ from: 'no-reply@service.example.com', subject: 'Votre facture' })).toEqual({ automated: true, reason: 'notification' });
    expect(isAutomatedEmail({ from: 'Alerts <notifications@github.com>', subject: 'x' })).toEqual({ automated: true, reason: 'notification' });
    expect(isAutomatedEmail({ from: 'a@b.co', subject: 'x', headers: { precedence: 'auto_reply', ignored: undefined } })).toEqual({ automated: true, reason: 'notification' });
    expect(isAutomatedEmail({ from: 'Marie <marie@example.com>', subject: 'Objet perdu', headers: null })).toEqual({ automated: false, reason: null });
    expect(isAutomatedEmail({ from: null, subject: undefined })).toEqual({ automated: false, reason: null });
  });

  it('identifiants : Message-ID normalisé, identifiant externe borné, références du fil, objet de réponse', () => {
    expect(normalizeMessageId(' <ABC@Example.com> ')).toBe('abc@example.com');
    expect(normalizeMessageId('')).toBeNull();
    expect(emailExternalId('<abc@example.com>', { from: 'x@y.z', subject: null, receivedAt: '2026-10-02T10:00:00Z' })).toBe('email:abc@example.com');
    const long = `<${'x'.repeat(130)}@example.com>`;
    const hashed = emailExternalId(long, { from: 'x@y.z', subject: 's', receivedAt: 't' });
    expect(hashed).toMatch(/^email:h-[0-9a-f]{16}$/);
    expect(stableHash('a')).not.toBe(stableHash('b'));
    expect(stableHash('')).toHaveLength(16);
    expect(hashed).toBe(emailExternalId(long, { from: 'other@y.z', subject: 'autre', receivedAt: 'u' }));
    const noId = emailExternalId(null, { from: 'X@y.z', subject: 'Sujet', receivedAt: '2026-10-02T10:00:00Z' });
    expect(noId).toMatch(/^email:h-/);
    expect(noId).toBe(emailExternalId(undefined, { from: 'x@y.z', subject: 'Sujet', receivedAt: '2026-10-02T10:00:00Z' }));
    expect(emailExternalId(null, { from: 'x@y.z', subject: null, receivedAt: 't' })).toBe(emailExternalId('', { from: 'X@Y.Z', subject: '', receivedAt: 't' }));
    expect(threadReferences('<B@x>', '<a@x> <b@x>')).toEqual(['a@x', 'b@x']);
    expect(threadReferences(null, ['<c@x>', '', '<c@x>'])).toEqual(['c@x']);
    expect(threadReferences(undefined, undefined)).toEqual([]);
    expect(replySubject('Objet perdu')).toBe('Re: Objet perdu');
    expect(replySubject('RE: Objet perdu')).toBe('RE: Objet perdu');
    expect(replySubject('  ')).toBe('Re: Votre message à Neomoov');
    expect(replySubject(null, 'en')).toBe('Re: Your message to Neomoov');
  });
});

describe('boîte unifiée : heures silencieuses', () => {
  const setting = { from: '22:00', to: '07:00', channels: ['email', 'social'] };

  it('lit le réglage et refuse une valeur illisible', () => {
    expect(parseQuietHours(setting)).toEqual(setting);
    expect(parseQuietHours({ from: '22:00', to: '07:00' })).toEqual({ from: '22:00', to: '07:00', channels: [] });
    expect(parseQuietHours({ from: '22:00', to: '07:00', channels: ['email', 3] })).toEqual({ from: '22:00', to: '07:00', channels: ['email'] });
    expect(parseQuietHours({ from: '25:00', to: '07:00' })).toBeNull();
    expect(parseQuietHours({ from: 22, to: '07:00' })).toBeNull();
    expect(parseQuietHours(null)).toBeNull();
    expect(parseQuietHours('22-7')).toBeNull();
  });

  it('fenêtre qui traverse minuit : active la nuit (heure de Montréal), reprise à 7 h, seulement sur les canaux listés', () => {
    // 2026-10-02 03:30 UTC = 23:30 à Montréal (heure avancée, UTC-4) la veille.
    const night = new Date('2026-10-02T03:30:00Z');
    const window = quietHoursWindow(night, TZ, setting, 'email');
    expect(window.active).toBe(true);
    expect(window.resumeLabel).toBe('7 h');
    // 7 h de Montréal le 2 octobre = 11:00 UTC.
    expect(window.resumeAt?.toISOString()).toBe('2026-10-02T11:00:00.000Z');
    // Juste avant minuit local le même jour civil que la reprise : 2026-10-02 02:10 UTC = 22:10 local le 1er.
    expect(quietHoursWindow(new Date('2026-10-02T02:10:00Z'), TZ, setting, 'social').resumeAt?.toISOString()).toBe('2026-10-02T11:00:00.000Z');
    expect(quietHoursWindow(night, TZ, setting, 'app')).toEqual({ active: false, resumeAt: null, resumeLabel: null });
    // 2026-10-02 15:00 UTC = 11 h à Montréal : hors fenêtre.
    expect(quietHoursWindow(new Date('2026-10-02T15:00:00Z'), TZ, setting, 'email').active).toBe(false);
    expect(quietHoursWindow(night, TZ, null, 'email').active).toBe(false);
    expect(quietHoursWindow(night, TZ, { from: '22:00', to: '07:00' }, 'email').active).toBe(false);
    expect(quietHoursWindow(night, TZ, { from: '22:00', to: '22:00', channels: ['email'] }, 'email').active).toBe(false);
    expect(quietHoursWindow(night, TZ, { from: 'x', to: '07:00', channels: ['email'] }, 'email').active).toBe(false);
    expect(localMinuteOfDay(night, TZ)).toBe(23 * 60 + 30);
  });

  it('fenêtre dans la journée (sans traverser minuit) et libellé avec minutes', () => {
    const lunch = { from: '12:00', to: '13:30', channels: ['email'] };
    // 16:45 UTC = 12:45 à Montréal.
    const w = quietHoursWindow(new Date('2026-10-02T16:45:00Z'), TZ, lunch, 'email');
    expect(w.active).toBe(true);
    expect(w.resumeLabel).toBe('13 h 30');
    expect(w.resumeAt?.toISOString()).toBe('2026-10-02T17:30:00.000Z');
    expect(quietHoursWindow(new Date('2026-10-02T18:00:00Z'), TZ, lunch, 'email').active).toBe(false);
  });
});

describe('boîte unifiée : appels manqués', () => {
  it('un appel avec réservation ou transfert n\'est pas manqué ; sinon message vocal, panne, appel court ou sans suite', () => {
    const none = { bookedRide: false, transferred: false };
    expect(callOutcome({ endedReason: 'customer-ended-call', durationSeconds: 120, summary: 'Réservation faite' }, { bookedRide: true, transferred: false })).toEqual({ missed: false, reason: null, kind: null });
    expect(callOutcome({ endedReason: 'customer-ended-call', durationSeconds: 120, summary: null }, { bookedRide: false, transferred: true }).missed).toBe(false);
    expect(callOutcome({ endedReason: 'assistant-forwarded-call', durationSeconds: 60, summary: null }, none).missed).toBe(false);
    expect(callOutcome({ endedReason: 'voicemail', durationSeconds: 30, summary: 'Message laissé' }, none)).toEqual({ missed: true, reason: 'voicemail', kind: 'voicemail' });
    expect(callOutcome({ endedReason: 'pipeline-error-openai-llm-failed', durationSeconds: 90, summary: null }, none)).toEqual({ missed: true, reason: 'error', kind: 'missed_call' });
    expect(callOutcome({ endedReason: 'silence-timed-out', durationSeconds: 200, summary: null }, none).reason).toBe('error');
    expect(callOutcome({ endedReason: 'customer-ended-call', durationSeconds: SHORT_CALL_SECONDS - 1, summary: null }, none)).toEqual({ missed: true, reason: 'short', kind: 'missed_call' });
    expect(callOutcome({ endedReason: 'customer-ended-call', durationSeconds: 300, summary: 'A demandé le prix puis a raccroché' }, none)).toEqual({ missed: true, reason: 'no_outcome', kind: 'missed_call' });
    expect(callOutcome({ endedReason: null, durationSeconds: null, summary: null }, none).reason).toBe('no_outcome');
    expect(isTransferReason('assistant-forwarded-call')).toBe(true);
    expect(isTransferReason(undefined)).toBe(false);
  });
});

describe('boîte unifiée : réseaux et schémas', () => {
  it('réseaux en relais et schémas de la boîte', () => {
    expect(isRelayNetwork('youtube')).toBe(true);
    expect(isRelayNetwork('messenger')).toBe(false);
    expect(isRelayNetwork(null)).toBe(false);
    expect(inboxListQuerySchema.parse({ channel: 'email', state: 'awaiting' })).toMatchObject({ page: 1, pageSize: 25, channel: 'email', state: 'awaiting' });
    expect(inboxListQuerySchema.safeParse({ channel: 'fax' }).success).toBe(false);
    expect(inboxRelaySchema.parse({ network: 'tiktok', from: '@marie', text: 'Super service !' })).toMatchObject({ kind: 'message', network: 'tiktok' });
    expect(inboxRelaySchema.safeParse({ network: 'messenger', from: 'x', text: 'y' }).success).toBe(false);
    expect(inboxRelaySchema.safeParse({ network: 'x', from: 'x', text: 'y', link: 'pas un lien' }).success).toBe(false);
  });
});
